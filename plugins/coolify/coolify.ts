// Coolify's API (v4, /api/v1), as much of it as the plugin uses: the
// resources (applications, services, databases), their projects, an
// application's deployments and their logs, and the actions: deploy,
// start, stop and restart.
//
// Coolify turned its actions from GET into POST late in v4; an older
// server answers POST with 405, and those are asked again with GET.

/** A Coolify to reach: the address it opens at, and an API token. */
export interface Conn {
	url: string;
	token: string;
}

/** What Coolify said no to: its HTTP status (0 for none reached) and why. */
export class CoolifyError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/** The kind of resource, as its path in the API has it. */
export type Kind = "applications" | "services" | "databases";

/** An application, a service or a database, as /resources lists them. */
export interface Resource {
	id?: number;
	uuid: string;
	name: string;
	description?: string | null;
	/** application, service, or standalone-<engine> (standalone-postgresql). */
	type: string;
	/** running:healthy, exited:unhealthy… */
	status: string;
	/** An application's domains, comma-separated URLs. */
	fqdn?: string | null;
	git_repository?: string | null;
	git_branch?: string | null;
	environment_id?: number;
	created_at?: string;
	updated_at?: string;
	/** An application's: nixpacks, railpack, dockerfile, dockercompose, dockerimage, static. */
	build_pack?: string | null;
	git_commit_sha?: string | null;
	/** A dockerimage application's image, and its tag. Its git_repository is then a placeholder. */
	docker_registry_image_name?: string | null;
	docker_registry_image_tag?: string | null;
	ports_exposes?: string | null;
	health_check_enabled?: boolean;
	health_check_path?: string | null;
	last_online_at?: string | null;
	/** A database's image, and whether it's reached from outside, on which port. */
	image?: string | null;
	is_public?: boolean;
	public_port?: number | null;
	/** A service's template, and its parts. */
	service_type?: string | null;
	applications?: { uuid?: string; name: string; status?: string; fqdn?: string | null; image?: string | null }[];
	databases?: { uuid?: string; name: string; status?: string; image?: string | null }[];
}

/** A server Coolify deploys to. */
export interface Server {
	uuid: string;
	name: string;
	description?: string | null;
	ip?: string;
	user?: string;
	port?: number;
	proxy_type?: string | null;
	unreachable_count?: number;
	settings?: { is_reachable?: boolean; is_usable?: boolean; is_build_server?: boolean; concurrent_builds?: number };
}

/** A resource as a server lists it. */
export interface ServerResource {
	uuid: string;
	name: string;
	type: string;
	status: string;
}

/** An environment variable. value is there only when the token may read what's sensitive. */
export interface EnvVar {
	uuid?: string;
	key: string;
	value?: string | null;
	real_value?: string | null;
	is_preview?: boolean;
	is_buildtime?: boolean;
	is_runtime?: boolean;
	is_shown_once?: boolean;
	is_multiline?: boolean;
	is_literal?: boolean;
	comment?: string | null;
}

/** An image an application can roll back to. */
export interface RollbackImage {
	tag: string;
	created_at?: string;
	is_current?: boolean;
}

/** A project's environment, which a resource names by its id. */
export interface Place {
	project: string;
	projectUuid: string;
	environment: string;
	environmentUuid?: string;
}

/** A deployment of an application. */
export interface Deployment {
	deployment_uuid: string;
	/** queued, in_progress, finished, failed, cancelled-by-user. */
	status: string;
	application_name?: string;
	commit?: string | null;
	commit_message?: string | null;
	force_rebuild?: boolean;
	restart_only?: boolean;
	is_webhook?: boolean;
	is_api?: boolean;
	rollback?: boolean;
	created_at?: string;
	updated_at?: string;
	/** A JSON list of its lines, when the token may read what's sensitive. */
	logs?: string | null;
}

/** A line of a deployment's log. */
export interface LogLine {
	output: string;
	stderr: boolean;
	at?: string;
}

/** The address Coolify's API is under, from what the user typed. */
export function baseOf(url: string): string {
	let u = url.trim().replace(/\/+$/, "");
	if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
	return u.replace(/\/api(\/v1)?$/, "");
}

/** What's wrong with an address, or "". */
export function urlProblem(url: string): string {
	const u = baseOf(url);
	if (!u) return "Give Coolify's URL: the address you open its dashboard at.";
	try {
		new URL(u);
	} catch {
		return `${url.trim()} isn't a URL.`;
	}
	return "";
}

function describe(status: number, body: string): string {
	let said = "";
	try {
		const j = JSON.parse(body) as { message?: string; error?: string };
		said = j.message || j.error || "";
	} catch {
		// Not JSON: a proxy's page, most likely.
	}
	if (status === 401) return "Coolify refused the token. Make one under Keys & Tokens, API tokens.";
	if (status === 403) return said ? `Coolify refused: ${said}` : "The token may not do that: give it the permission in Coolify's Keys & Tokens.";
	if (status === 404 && !said) return "Coolify has no such thing, or the URL isn't Coolify's.";
	if (said) return said;
	return `Coolify answered ${status}.`;
}

/** Asks Coolify's API, and returns what it answered, parsed. */
export async function request<T = unknown>(conn: Conn, method: string, path: string, query?: { [k: string]: string | number | boolean | undefined }, json?: unknown): Promise<T> {
	const qs = Object.entries(query ?? {})
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
		.join("&");
	const url = `${baseOf(conn.url)}/api/v1${path}${qs ? "?" + qs : ""}`;
	let res: Response;
	try {
		const headers: { [k: string]: string } = { Authorization: `Bearer ${conn.token}`, Accept: "application/json" };
		if (json !== undefined) headers["Content-Type"] = "application/json";
		res = await fetch(url, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
	} catch (e) {
		throw new CoolifyError(`Couldn't reach ${baseOf(conn.url)}: ${e instanceof Error ? e.message : e}`, 0);
	}
	const body = await res.text();
	if (!res.ok) throw new CoolifyError(describe(res.status, body), res.status);
	try {
		return JSON.parse(body) as T;
	} catch {
		// /version answers in plain text.
		return body as T;
	}
}

/** An action that's POST now and was GET before. */
async function act<T>(conn: Conn, path: string, query?: { [k: string]: string | number | boolean | undefined }): Promise<T> {
	try {
		return await request<T>(conn, "POST", path, query);
	} catch (e) {
		if (e instanceof CoolifyError && e.status === 405) return request<T>(conn, "GET", path, query);
		throw e;
	}
}

/** Coolify's version, which tells the URL and token work. */
export async function version(conn: Conn): Promise<string> {
	const v = await request<unknown>(conn, "GET", "/version");
	return String(v).trim();
}

export const resources = (conn: Conn) => request<Resource[]>(conn, "GET", "/resources");

/** Each environment's project and name, by its id. */
export async function places(conn: Conn): Promise<Map<number, Place>> {
	const out = new Map<number, Place>();
	const projects = await request<{ uuid: string; name: string }[]>(conn, "GET", "/projects");
	const each = await Promise.all(
		projects.map((p) => request<{ environments?: { id: number; uuid?: string; name: string }[] }>(conn, "GET", `/projects/${encodeURIComponent(p.uuid)}`).catch(() => ({ environments: [] }))),
	);
	projects.forEach((p, i) => {
		for (const env of each[i]?.environments ?? []) out.set(env.id, { project: p.name, projectUuid: p.uuid, environment: env.name, environmentUuid: env.uuid });
	});
	return out;
}

/** An application's last deployments, newest first. */
export async function deployments(conn: Conn, app: string, take = 10): Promise<Deployment[]> {
	const r = await request<Deployment[] | { deployments?: Deployment[] }>(conn, "GET", `/deployments/applications/${encodeURIComponent(app)}`, { skip: 0, take });
	return Array.isArray(r) ? r : (r.deployments ?? []);
}

export const deployment = (conn: Conn, uuid: string) => request<Deployment>(conn, "GET", `/deployments/${encodeURIComponent(uuid)}`);

/** Deploys a resource by its uuid; force rebuilds without the cache. The deployment's uuid, when it's an application's. */
export async function deploy(conn: Conn, uuid: string, force = false): Promise<{ message: string; deployment?: string }> {
	const r = await act<{ deployments?: { message?: string; resource_uuid?: string; deployment_uuid?: string }[]; message?: string }>(conn, "/deploy", { uuid, force });
	const d = r.deployments?.find((x) => x.resource_uuid === uuid) ?? r.deployments?.[0];
	return { message: d?.message ?? r.message ?? "Deployment queued.", deployment: d?.deployment_uuid || undefined };
}

export type Action = "start" | "stop" | "restart";

/** Starts, stops or restarts a resource. A start or restart of an application is a deployment, whose uuid it returns. */
export async function action(conn: Conn, kind: Kind, uuid: string, what: Action): Promise<{ message: string; deployment?: string }> {
	const r = await act<{ message?: string; deployment_uuid?: string }>(conn, `/${kind}/${encodeURIComponent(uuid)}/${what}`);
	return { message: r.message ?? "Done.", deployment: r.deployment_uuid || undefined };
}

/** A resource's containers' last lines. Services aren't asked: their logs are each container's. */
export async function logs(conn: Conn, kind: Kind, uuid: string, lines = 200): Promise<string> {
	const r = await request<{ logs?: string }>(conn, "GET", `/${kind}/${encodeURIComponent(uuid)}/logs`, { lines });
	return r.logs ?? "";
}

export const cancel = (conn: Conn, uuid: string) => request<{ message?: string }>(conn, "POST", `/deployments/${encodeURIComponent(uuid)}/cancel`);

/** Where a resource's type puts it in the API. */
export function kindOf(type: string): Kind {
	if (type === "application") return "applications";
	if (type === "service") return "services";
	return "databases";
}

/** A type as a word: Application, Service, PostgreSQL… */
export function typeLabel(type: string): string {
	if (type === "application") return "Application";
	if (type === "service") return "Service";
	const engine = type.replace(/^standalone-/, "");
	const names: { [k: string]: string } = { postgresql: "PostgreSQL", mysql: "MySQL", mariadb: "MariaDB", mongodb: "MongoDB", redis: "Redis", keydb: "KeyDB", dragonfly: "Dragonfly", clickhouse: "ClickHouse" };
	return names[engine] ?? engine.charAt(0).toUpperCase() + engine.slice(1);
}

export type Tone = "green" | "amber" | "red" | "muted";

/** A resource's status as a word and a tone: running:healthy is Running and green. */
export function statusOf(status: string): { label: string; tone: Tone; running: boolean } {
	const [state = "", health = ""] = (status || "").toLowerCase().split(/[:(]/);
	if (state.startsWith("running")) {
		if (health.startsWith("unhealthy")) return { label: "Unhealthy", tone: "amber", running: true };
		return { label: "Running", tone: "green", running: true };
	}
	if (state.startsWith("restarting")) return { label: "Restarting", tone: "amber", running: true };
	if (state.startsWith("starting")) return { label: "Starting", tone: "amber", running: true };
	if (state.startsWith("degraded")) return { label: "Degraded", tone: "amber", running: true };
	if (state.startsWith("exited") || state.startsWith("stopped")) return { label: "Stopped", tone: "muted", running: false };
	if (!state) return { label: "Unknown", tone: "muted", running: false };
	return { label: state.charAt(0).toUpperCase() + state.slice(1), tone: "muted", running: false };
}

/** Whether a deployment is still going. */
export const deploying = (d: Deployment) => d.status === "queued" || d.status === "in_progress";

/** A deployment's status as a word and a tone. */
export function deploymentStatus(status: string): { label: string; tone: Tone | "accent" } {
	switch (status) {
		case "finished":
			return { label: "Finished", tone: "green" };
		case "failed":
			return { label: "Failed", tone: "red" };
		case "in_progress":
			return { label: "In progress", tone: "accent" };
		case "queued":
			return { label: "Queued", tone: "muted" };
		case "cancelled-by-user":
			return { label: "Cancelled", tone: "muted" };
		default:
			return { label: status, tone: "muted" };
	}
}

/** A deployment's log, as lines, without those Coolify hides. */
export function logLines(logs: string | null | undefined): LogLine[] {
	if (!logs) return [];
	let rows: { output?: string; type?: string; timestamp?: string; hidden?: boolean }[];
	try {
		rows = JSON.parse(logs);
	} catch {
		return logs.split("\n").map((output) => ({ output, stderr: false }));
	}
	if (!Array.isArray(rows)) return [];
	return rows.filter((r) => !r.hidden && r.output).map((r) => ({ output: String(r.output).replace(/\s+$/, ""), stderr: r.type === "stderr", at: r.timestamp }));
}

/** An application's domains, as URLs. */
export function domains(fqdn: string | null | undefined): string[] {
	return (fqdn ?? "")
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean);
}

/** The resource's page in Coolify's dashboard, when its place is known. */
export function dashboardUrl(conn: Conn, r: Resource, place?: Place): string {
	const base = baseOf(conn.url);
	if (!place?.environmentUuid) return base;
	const seg = r.type === "application" ? "application" : r.type === "service" ? "service" : "database";
	return `${base}/project/${place.projectUuid}/environment/${place.environmentUuid}/${seg}/${r.uuid}`;
}

/** Finds a resource by its uuid, else its name, else the start of its name; an error naming the choices when that's not one. */
export function find(list: Resource[], what: string, places?: Map<number, Place>): Resource {
	const w = what.trim().toLowerCase();
	const byUuid = list.find((r) => r.uuid === what.trim());
	if (byUuid) return byUuid;
	const where = (r: Resource) => (r.environment_id !== undefined ? places?.get(r.environment_id) : undefined);
	const names = (r: Resource) => [r.name.toLowerCase(), displayName(r).toLowerCase()];
	// Project/name, or Project/environment/name.
	const slash = w.split("/");
	let pool = list;
	let name = w;
	if (slash.length > 1 && places) {
		name = slash[slash.length - 1]!;
		const project = slash[0]!;
		const env = slash.length > 2 ? slash[1]! : "";
		pool = list.filter((r) => {
			const p = where(r);
			return p && p.project.toLowerCase() === project && (!env || p.environment.toLowerCase() === env);
		});
	}
	const exact = pool.filter((r) => names(r).includes(name));
	if (exact.length === 1) return exact[0]!;
	const near = exact.length ? exact : pool.filter((r) => names(r).some((n) => n.includes(name)));
	if (near.length === 1) return near[0]!;
	if (near.length === 0) throw new CoolifyError(`No resource is called ${what}. swarm coolify list shows them.`, 404);
	const label = (r: Resource) => {
		const p = where(r);
		return `${p ? p.project + "/" : ""}${displayName(r)} (${r.uuid})`;
	};
	throw new CoolifyError(`${what} could be ${near.map(label).join(", ")}: give Project/name or the uuid.`, 400);
}

/** A time as Coolify writes it, "2026-10-30T19:21:04.000000Z" or "2026-10-31 20:44:59" (UTC), in ms; NaN for none. */
export function parseTime(t: string | null | undefined): number {
	if (!t) return NaN;
	let s = t.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
	if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += "Z";
	return Date.parse(s);
}

/** How long ago a time was, in a word or two. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return "";
	const t = parseTime(iso);
	if (Number.isNaN(t)) return "";
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 60) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} hr ago`;
	const d = Math.round(h / 24);
	return d === 1 ? "yesterday" : `${d} days ago`;
}

/** How long a deployment took, or has taken: 1m 12s. */
export function took(d: Deployment, now = Date.now()): string {
	const a = parseTime(d.created_at);
	const b = deploying(d) ? now : parseTime(d.updated_at);
	if (Number.isNaN(a) || Number.isNaN(b)) return "";
	const s = Math.max(0, Math.round((b - a) / 1000));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
	if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
	return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

// ---- Coolify's own MCP server (4.5 on), at /mcp ----

/** Whether Coolify's MCP server answers: "on", "off" (404: an admin hasn't turned it on), or why it couldn't tell. */
export async function mcpState(conn: Conn): Promise<"on" | "off" | string> {
	let res: Response;
	try {
		res = await fetch(`${baseOf(conn.url)}/mcp`, {
			method: "POST",
			headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "swarm-coolify", version: "1.0.0" } } }),
		});
	} catch (e) {
		return `Couldn't reach ${baseOf(conn.url)}: ${e instanceof Error ? e.message : e}`;
	}
	await res.text();
	if (res.ok) return "on";
	if (res.status === 404) return "off";
	if (res.status === 401) return "Coolify refused the token.";
	if (res.status === 403) return "Coolify's MCP server is off for this team, or for the address Swarm calls from (Settings, Advanced, allowed IPs).";
	return `Coolify's MCP server answered ${res.status}.`;
}

/** Turns Coolify's MCP server on, as a token of its root team may. */
export const enableMcp = (conn: Conn) => request<{ message?: string }>(conn, "POST", "/mcp/enable");

/** The headers an MCP request carries on to Coolify, and those its answer carries back. */
const MCP_IN = ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const MCP_OUT = ["content-type", "mcp-session-id", "mcp-protocol-version", "www-authenticate"];

/** Passes an agent's MCP request on to Coolify's /mcp with the token, and Coolify's answer back, whole. */
export async function forwardMcp(conn: Conn, req: { method: string; headers: { [name: string]: string }; body?: string }): Promise<{ status: number; headers: { [name: string]: string }; body: string }> {
	const lower: { [name: string]: string } = {};
	for (const [k, v] of Object.entries(req.headers)) lower[k.toLowerCase()] = v;
	const headers: { [name: string]: string } = { Authorization: `Bearer ${conn.token}` };
	for (const h of MCP_IN) if (lower[h]) headers[h] = lower[h];
	let res: Response;
	try {
		res = await fetch(`${baseOf(conn.url)}/mcp`, { method: req.method, headers, body: req.method === "GET" || req.method === "DELETE" ? undefined : (req.body ?? "") });
	} catch (e) {
		return { status: 502, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: `Couldn't reach ${baseOf(conn.url)}: ${e instanceof Error ? e.message : e}` }) };
	}
	const out: { [name: string]: string } = {};
	for (const h of MCP_OUT) {
		const v = res.headers.get(h);
		if (v) out[h] = v;
	}
	return { status: res.status, headers: out, body: await res.text() };
}

// ---- More of the API: what's deploying, servers, env vars, rollbacks ----

/** Every deployment queued or in progress, of every application. */
export async function running(conn: Conn): Promise<Deployment[]> {
	const r = await request<Deployment[] | { [k: string]: Deployment }>(conn, "GET", "/deployments");
	return Array.isArray(r) ? r : Object.values(r ?? {});
}

export const servers = (conn: Conn) => request<Server[]>(conn, "GET", "/servers");
export const serverResources = (conn: Conn, uuid: string) => request<ServerResource[]>(conn, "GET", `/servers/${encodeURIComponent(uuid)}/resources`);

/** A resource's environment variables. */
export const envs = (conn: Conn, kind: Kind, uuid: string) => request<EnvVar[]>(conn, "GET", `/${kind}/${encodeURIComponent(uuid)}/envs`);

/** The images an application can roll back to, newest first. */
export async function rollbackImages(conn: Conn, app: string): Promise<RollbackImage[]> {
	const r = await request<{ images?: RollbackImage[] } | RollbackImage[]>(conn, "GET", `/applications/${encodeURIComponent(app)}/rollback-images`);
	return Array.isArray(r) ? r : (r.images ?? []);
}

/** Rolls an application back to an image of before: a deployment, whose uuid it returns. */
export async function rollback(conn: Conn, app: string, tag: string): Promise<{ message: string; deployment?: string }> {
	const r = await request<{ message?: string; deployment_uuid?: string }>(conn, "POST", `/applications/${encodeURIComponent(app)}/rollback`, undefined, { commit: tag });
	return { message: r.message ?? "Rollback queued.", deployment: r.deployment_uuid || undefined };
}

/** The image a rollback image is, for a deployment of that commit. */
export const sameCommit = (commit: string | null | undefined, tag: string) => !!commit && commit !== "HEAD" && (commit.startsWith(tag) || tag.startsWith(commit));

// ---- What's worked out from Coolify's answers ----

/** A resource's name without the uuid Coolify adds to the names it makes: "website:main-rkltwp…" is "website:main". */
export function displayName(r: { name: string; uuid: string }): string {
	return r.name.endsWith("-" + r.uuid) ? r.name.slice(0, -r.uuid.length - 1) : r.name;
}

/** What a resource holds that no agent or script needs to read: passwords, webhook secrets, compose files with their secrets. */
const SECRET = /password|secret|token|private_key|webhook|docker_compose|dockerfile$|custom_labels|custom_nginx|internal_db_url|external_db_url|_url$/i;

/** A resource without what SECRET names, for --json. */
export function withoutSecrets<T extends object>(r: T): Partial<T> {
	const out: { [k: string]: unknown } = {};
	for (const [k, v] of Object.entries(r)) if (!SECRET.test(k) || k === "fqdn") out[k] = v;
	return out as Partial<T>;
}

/** A repository's path, "owner/repo", from what git or Coolify has: git@host:owner/repo.git, https://host/owner/repo, owner/repo. */
export function repoPath(url: string | null | undefined): string {
	let u = (url ?? "").trim();
	if (!u) return "";
	u = u.replace(/\.git$/, "").replace(/\/+$/, "");
	const scp = /^[^@/\s]+@[^:/\s]+:(.+)$/.exec(u);
	if (scp) return scp[1]!.toLowerCase();
	const web = /^[a-z+]+:\/\/[^/]+\/(.+)$/i.exec(u);
	if (web) return web[1]!.toLowerCase();
	return u.toLowerCase();
}

/** The repository paths a resource is built from: its git repository's, or a docker image's path under its registry (registry.example.com/owner/repo/web), whose repository is owner/repo or a folder above it. */
export function sourcesOf(r: Resource): { repo?: string; image?: string } {
	if (r.type !== "application") return {};
	if (r.build_pack === "dockerimage") {
		const img = (r.docker_registry_image_name ?? "").replace(/:[^/]*$/, "");
		const parts = img.split("/");
		// A first part with a dot or a port is a registry's host.
		const path = parts.length > 1 && /[.:]/.test(parts[0]!) ? parts.slice(1).join("/") : img;
		return { image: path.toLowerCase() };
	}
	return { repo: repoPath(r.git_repository) || undefined };
}

/** Whether a resource is built from the repository at path. */
export function builtFrom(r: Resource, path: string): boolean {
	if (!path) return false;
	const s = sourcesOf(r);
	if (s.repo) return s.repo === path || s.repo.endsWith("/" + path) || path.endsWith("/" + s.repo);
	if (s.image) return s.image === path || s.image.startsWith(path + "/");
	return false;
}

/** How bad a status is, for sorting and the overview: 2 unhealthy, 1 stopped, 0 well. */
export function trouble(status: string): number {
	const s = statusOf(status);
	return s.tone === "amber" || s.tone === "red" ? 2 : s.running ? 0 : 1;
}

// ---- Environment variables: adding, changing, removing, importing ----

/** A variable as it's written: what Coolify takes of it. Build time, runtime, preview and comment are an application's alone. */
export interface EnvInput {
	key: string;
	value: string;
	is_literal?: boolean;
	is_multiline?: boolean;
	is_shown_once?: boolean;
	is_buildtime?: boolean;
	is_runtime?: boolean;
	is_preview?: boolean;
	comment?: string;
}

/** What of a variable a kind of resource takes: Coolify refuses a field it doesn't. */
export function envBody(kind: Kind, v: EnvInput): EnvInput {
	const out: EnvInput = { key: v.key, value: v.value };
	for (const k of ["is_literal", "is_multiline", "is_shown_once"] as const) if (v[k] !== undefined) out[k] = v[k];
	if (kind === "applications") {
		for (const k of ["is_buildtime", "is_runtime", "is_preview"] as const) if (v[k] !== undefined) out[k] = v[k];
		if (v.comment) out.comment = v.comment;
	}
	return out;
}

const envsPath = (kind: Kind, uuid: string) => `/${kind}/${encodeURIComponent(uuid)}/envs`;

/** Adds a variable; Coolify answers 409 for a key it has. */
export const createEnv = (conn: Conn, kind: Kind, uuid: string, v: EnvInput) => request<{ uuid?: string }>(conn, "POST", envsPath(kind, uuid), undefined, envBody(kind, v));
/** Changes the variable of v's key. */
export const updateEnv = (conn: Conn, kind: Kind, uuid: string, v: EnvInput) => request<EnvVar>(conn, "PATCH", envsPath(kind, uuid), undefined, envBody(kind, v));
export const deleteEnv = (conn: Conn, kind: Kind, uuid: string, env: string) => request<{ message?: string }>(conn, "DELETE", `${envsPath(kind, uuid)}/${encodeURIComponent(env)}`);
/** Adds or changes many at once, by key. */
export const bulkEnvs = (conn: Conn, kind: Kind, uuid: string, vs: EnvInput[]) => request<EnvVar[]>(conn, "PATCH", `${envsPath(kind, uuid)}/bulk`, undefined, { data: vs.map((v) => envBody(kind, v)) });

/** Saves a variable: changes it, or adds it when it's new; a renamed one is added and the old one removed. */
export async function saveEnv(conn: Conn, kind: Kind, uuid: string, v: EnvInput, was?: EnvVar): Promise<void> {
	if (was && was.key === v.key) {
		await updateEnv(conn, kind, uuid, v);
		return;
	}
	await createEnv(conn, kind, uuid, v);
	if (was?.uuid) await deleteEnv(conn, kind, uuid, was.uuid);
}

/** What's wrong with a key, or "": letters, digits and underscores, not first a digit. */
export function envKeyProblem(key: string): string {
	if (!key.trim()) return "Give it a name.";
	if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key.trim())) return "A name is letters, digits and underscores, and doesn't start with a digit.";
	return "";
}

/** A .env file's variables: KEY=value lines, export KEY=value, quoted values ("…" over several lines, with \n), # comments. */
export function parseDotenv(text: string): { key: string; value: string }[] {
	const out: { key: string; value: string }[] = [];
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(lines[i]!);
		if (!m) continue;
		let value = m[2]!;
		const q = value[0];
		if (q === '"' || q === "'" || q === "`") {
			let body = value.slice(1);
			while (!new RegExp(`(^|[^\\\\])${q}\\s*(#.*)?$`).test(body) && i + 1 < lines.length) body += "\n" + lines[++i];
			body = body.replace(new RegExp(`${q}\\s*(#.*)?$`), "");
			value = q === '"' ? body.replace(/\\n/g, "\n").replace(/\\"/g, '"') : body;
		} else value = value.replace(/\s+#.*$/, "").trim();
		const at = out.findIndex((v) => v.key === m[1]);
		if (at >= 0) out.splice(at, 1);
		out.push({ key: m[1]!, value });
	}
	return out;
}

/** Variables as a .env file, values quoted where they need it. */
export function toDotenv(vars: { key: string; value: string }[]): string {
	const quote = (v: string) => (/^[A-Za-z0-9_./:@+-]*$/.test(v) ? v : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`);
	return vars.map((v) => `${v.key}=${quote(v.value)}`).join("\n") + "\n";
}

// ---- What the token may do ----

/** An MCP answer's JSON-RPC message, whether Coolify sent it as JSON or as a stream's events. */
function mcpMessage(body: string): { result?: { tools?: { name: string }[] } } | null {
	try {
		return JSON.parse(body);
	} catch {
		for (const line of body.split("\n")) {
			if (!line.startsWith("data:")) continue;
			try {
				return JSON.parse(line.slice(5));
			} catch {
				// Not this one.
			}
		}
	}
	return null;
}

/** The tools Coolify's MCP server offers this token, which hides those it may not use; null when it can't be asked. */
export async function mcpTools(conn: Conn): Promise<string[] | null> {
	const ask = (body: unknown, session?: string) =>
		forwardMcp(conn, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session, "mcp-protocol-version": "2025-06-18" } : {}) }, body: JSON.stringify(body) });
	const init = await ask({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "swarm-coolify", version: "1.0.0" } } });
	if (init.status !== 200) return null;
	const session = init.headers["mcp-session-id"];
	await ask({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
	const list = await ask({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, session);
	const tools = mcpMessage(list.body)?.result?.tools;
	return tools ? tools.map((t) => t.name) : null;
}

/** What the token may do, as far as Coolify tells: true, false, or null for not known until it's used. */
export interface Abilities {
	read: boolean;
	deploy: boolean | null;
	write: boolean | null;
	sensitive: boolean | null;
}

/** Works out what the token may do: from the MCP server's tools where it's on, else from what Coolify sends to read. */
export async function abilities(conn: Conn, list: Resource[]): Promise<Abilities> {
	const out: Abilities = { read: true, deploy: null, write: null, sensitive: null };
	const tools = await mcpTools(conn).catch(() => null);
	if (tools) {
		out.deploy = tools.includes("deploy") || tools.includes("control");
		out.write = tools.some((t) => t.startsWith("manage_") || t.startsWith("create_"));
		out.sensitive = tools.includes("get_env_values");
		return out;
	}
	const app = list.find((r) => r.type === "application");
	if (app) {
		try {
			const vars = await envs(conn, "applications", app.uuid);
			if (vars.length) out.sensitive = vars.some((v) => v.value != null || v.real_value != null);
		} catch {
			// Asked below.
		}
		if (out.sensitive === null) {
			try {
				await logs(conn, "applications", app.uuid, 1);
				out.sensitive = true;
			} catch (e) {
				if (e instanceof CoolifyError && (e.status === 403 || e.status === 401)) out.sensitive = false;
			}
		}
	}
	return out;
}

/** A log as text for the viewer: its colour codes out, at most its last max characters, from a line's start. */
export function logText(text: string, max = 30_000): string {
	// eslint-disable-next-line no-control-regex
	let t = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r(?!\n)/g, "\n").replace(/\s+$/, "");
	if (t.length > max) {
		t = t.slice(t.length - max);
		const nl = t.indexOf("\n");
		if (nl >= 0) t = t.slice(nl + 1);
	}
	return t;
}
