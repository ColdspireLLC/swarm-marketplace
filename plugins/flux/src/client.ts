// A small typed client for the Flux HTTP API (bb's). A response body streams
// as it's read. The workspace stays live on GET /sync/events. Pictures go
// up with POST /assets. Request bodies are read whole, 32 MB at most.
// Authenticated with a personal API token (Settings → API tokens in Flux).
import { z } from "zod";

const REQUEST_TIMEOUT_MS = 20_000;

export class FluxHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "FluxHttpError";
  }

  get code(): string | null {
    const body = this.body;
    if (body && typeof body === "object" && "code" in body) {
      const code = (body as { code: unknown }).code;
      return typeof code === "string" ? code : null;
    }
    return null;
  }
}

/** Flux didn't answer at all: it's down, or the network is. */
export class FluxUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FluxUnreachableError";
  }
}

/**
 * Whether a request failed because Flux couldn't be reached (not because
 * it refused), so the same request may work later. A proxy in front of a
 * Flux that's down answers 502 to 504.
 */
export function isUnreachable(cause: unknown): boolean {
  return (
    cause instanceof FluxUnreachableError ||
    (cause instanceof FluxHttpError &&
      (cause.status === 502 || cause.status === 503 || cause.status === 504))
  );
}

/** Whether Flux refused the API token (revoked, expired, or mistyped). */
export function isUnauthorized(cause: unknown): cause is FluxHttpError {
  return cause instanceof FluxHttpError && cause.status === 401;
}

export const accountSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable().optional(),
  avatarColor: z.string().optional(),
});
export type Account = z.infer<typeof accountSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  latestVersion: z.number(),
});

export const membersSchema = z.object({
  members: z.array(accountSchema),
});

export const syncItemSchema = z.object({
  id: z.string(),
  version: z.number(),
  deleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  body: z.unknown(),
});
export type SyncItem = z.infer<typeof syncItemSchema>;

export const pullSchema = z.object({
  items: z.array(syncItemSchema),
  nextVersion: z.number(),
  hasMore: z.boolean(),
  latestVersion: z.number(),
});

export type SyncOp =
  | {
      type: "upsert";
      id: string;
      itemId: string;
      baseVersion: number;
      body: unknown;
    }
  | { type: "delete"; id: string; itemId: string; baseVersion: number };

export const pushSchema = z.object({
  applied: z.array(
    z.object({ opId: z.string(), itemId: z.string(), version: z.number() }),
  ),
  latestVersion: z.number(),
});
export type PushResult = z.infer<typeof pushSchema>;

export const uploadedAssetSchema = z.object({
  id: z.string(),
  url: z.string(),
});

export interface FluxClientOptions {
  baseUrl: string;
  token: string;
  deviceId: string;
  workspaceId?: string | null;
  /** Called whenever Flux answers 401: the token no longer works. */
  onUnauthorized?: (error: FluxHttpError) => void;
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Flux URL must start with http:// or https://");
  }
  return url.origin;
}

export class FluxClient {
  readonly baseUrl: string;
  workspaceId: string | null;

  constructor(private readonly options: FluxClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.workspaceId = options.workspaceId ?? null;
  }

  headers(extra?: Record<string, string>): Record<string, string> {
    return {
      accept: "application/json",
      authorization: `Bearer ${this.options.token}`,
      "x-device-id": this.options.deviceId,
      ...(this.workspaceId ? { "x-workspace-id": this.workspaceId } : {}),
      ...extra,
    };
  }

  async request<T>(
    schema: z.ZodType<T>,
    path: string,
    init: {
      method?: string;
      body?: unknown;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const response = await this.send(path, {
      method: init.method,
      headers:
        init.body === undefined
          ? undefined
          : { "content-type": "application/json" },
      body:
        init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok) throw this.refused(response.status, parsed);
    // GET /user is a 204 for a visitor: a token Flux doesn't know as one.
    if (response.status === 204 && path === "/user") {
      throw this.refused(401, null);
    }
    const result = schema.safeParse(parsed ?? null);
    if (result.success) return result.data;
    throw new FluxHttpError(
      response.status,
      unexpected(this.baseUrl, `${init.method ?? "GET"} ${path}`, response, text, result.error),
      parsed,
    );
  }

  /** The error for a refused request, telling the owner about a 401. */
  private refused(status: number, body: unknown): FluxHttpError {
    const error = new FluxHttpError(status, errorMessage(status, body), body);
    if (status === 401) this.options.onUnauthorized?.(error);
    return error;
  }

  /** A signed-in request with the usual timeout; the caller reads the body. */
  private async send(
    path: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: this.headers(init.headers),
        body: init.body,
        signal,
      });
    } catch (cause) {
      if (init.signal?.aborted) throw cause;
      if (timeout.aborted) {
        throw new FluxUnreachableError(
          `Flux did not answer ${path} within 20s`,
        );
      }
      throw this.unreachable(cause);
    }
  }

  private unreachable(cause: unknown): FluxUnreachableError {
    return new FluxUnreachableError(
      `Could not reach Flux at ${this.baseUrl}: ${describe(cause)}`,
    );
  }

  /**
   * An uploaded image (`/assets/<id>`). Flux only serves these to members,
   * hence the token. Throws FluxHttpError when Flux refuses.
   */
  async asset(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: ArrayBuffer; contentType: string }> {
    const response = await this.send(`/assets/${encodeURIComponent(id)}`, {
      headers: { accept: "image/*" },
      signal,
    });
    if (!response.ok) {
      const parsed = parseJson(await response.text().catch(() => ""));
      throw this.refused(response.status, parsed);
    }
    return {
      bytes: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") ?? "",
    };
  }

  me(signal?: AbortSignal): Promise<Account> {
    return this.request(accountSchema, "/user", { signal });
  }

  workspace(signal?: AbortSignal) {
    return this.request(workspaceSchema, "/workspace", { signal });
  }

  members(signal?: AbortSignal) {
    return this.request(membersSchema, "/workspace/members", { signal });
  }

  pull(since: number, signal?: AbortSignal) {
    // A page at a time, small: a page is read whole into the plugin's
    // memory, which a big workspace's descriptions in one page ran out of.
    return this.request(pullSchema, `/sync/pull/${since}?limit=100`, {
      signal,
    });
  }

  push(ops: SyncOp[], signal?: AbortSignal): Promise<PushResult> {
    return this.request(pushSchema, "/sync/push", {
      method: "POST",
      body: { ops },
      signal,
    });
  }

  /**
   * Flux's event stream. null when this Flux has none (404 or 405): the
   * caller polls instead. The caller reads the body and aborts signal to
   * stop.
   */
  async events(signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/sync/events`, {
        headers: this.headers({ accept: "text/event-stream" }),
        signal,
      });
    } catch (cause) {
      if (signal.aborted) throw cause;
      throw this.unreachable(cause);
    }
    if (response.status === 404 || response.status === 405) {
      await response.arrayBuffer().catch(() => {});
      return null;
    }
    if (!response.ok || !response.body) {
      const parsed = parseJson(await response.text().catch(() => ""));
      throw this.refused(response.status, parsed);
    }
    return response.body;
  }

  /** Uploads a picture. entity is what Flux files it as. */
  async upload(
    file: { name: string; type: string; bytes: Uint8Array },
    entity: string,
    signal?: AbortSignal,
  ): Promise<{ id: string; url: string }> {
    const form = new FormData();
    form.append("entityType", entity);
    form.append("file", new File([file.bytes as unknown as BlobPart], file.name || "image", { type: file.type || "application/octet-stream" }));
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(`${this.baseUrl}/assets`, {
      method: "POST",
      headers: this.headers(),
      body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok) throw this.refused(response.status, parsed);
    return uploadedAssetSchema.parse(parsed);
  }

}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * What Flux answered that the plugin can't read, said in a line: a web page
 * where its API should be is a URL that isn't Flux's, else what was wrong
 * and the start of what came.
 */
function unexpected(
  baseUrl: string,
  request: string,
  response: Response,
  text: string,
  error: z.ZodError,
): string {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/html") || /^\s*<(!doctype|html)/i.test(text)) {
    return `${baseUrl} answered ${request} with a web page, not Flux's API. Check the Flux URL: the address you open Flux at.`;
  }
  const issue = error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  const start = text.replace(/\s+/g, " ").trim().slice(0, 80);
  return `Flux answered ${request} with what Swarm's Flux can't read (${where}${issue?.message ?? "not what it expected"})${start ? `: ${start}${text.length > 80 ? "…" : ""}` : ", an empty body"}.`;
}

function errorMessage(status: number, body: unknown): string {
  if (status === 401) {
    return "Flux rejected the API token. Create a new one in Flux under Settings → API tokens.";
  }
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === "string" && message !== "Request failed") {
      return message;
    }
  }
  if (body && typeof body === "object" && "code" in body) {
    return `Flux request failed (${String((body as { code: unknown }).code)})`;
  }
  if (typeof body === "string" && body.length > 0 && body.length < 300) {
    return body;
  }
  return `Flux request failed with HTTP ${status}`;
}

export function describe(cause: unknown): string {
  if (cause instanceof z.ZodError) {
    const issue = cause.issues[0];
    return `Flux sent what Swarm's Flux can't read (${issue?.path.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "not what it expected"}).`;
  }
  if (cause instanceof Error) {
    const inner = (cause as Error & { cause?: unknown }).cause;
    if (inner instanceof Error && inner.message) {
      return `${cause.message} (${inner.message})`;
    }
    return cause.message;
  }
  return String(cause);
}
