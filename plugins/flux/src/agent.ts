// The coding agent that wrote a comment for its author, as Flux stores it on
// the comment (`agent`, app/src/lib/comment-agent.ts). The comment still
// belongs to the author's account; this only changes how it's shown. Shared
// by the server, which writes it for comments from bb threads, and the app,
// which shows it.
import { z } from "zod";

export const commentAgentSchema = z.object({
  name: z.string(),
  /** bb's provider id, such as "claude-code". */
  provider: z.string(),
  /** The provider's mark: a base64 SVG data URL, drawn as a mask. */
  icon: z.string().optional(),
  /** The mark's color in each theme. */
  tint: z.object({ light: z.string(), dark: z.string() }).optional(),
  /** A link to the bb thread the agent ran in. */
  url: z.string().optional(),
  /** The bb thread the agent ran in. */
  threadId: z.string().optional(),
});
export type CommentAgent = z.infer<typeof commentAgentSchema>;

const MAX_NAME = 60;
export const MAX_AGENT_ICON = 12_000;
const ICON = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/;
const THREAD_ID = /^[\w-]{1,64}$/;
const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * A comment's agent from its stored body, with Flux's checks: anyone with a
 * token can write one, so the icon must be a base64 SVG, colors hex, and the
 * link http(s).
 */
export function parseCommentAgent(value: unknown): CommentAgent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const provider = typeof raw.provider === "string" ? raw.provider : "";
  if (!name || !provider) return null;
  const agent: CommentAgent = {
    name: name.slice(0, MAX_NAME),
    provider: provider.slice(0, MAX_NAME),
  };
  if (
    typeof raw.icon === "string" &&
    raw.icon.length <= MAX_AGENT_ICON &&
    ICON.test(raw.icon)
  ) {
    agent.icon = raw.icon;
  }
  const tint = raw.tint as Record<string, unknown> | undefined;
  if (
    tint &&
    typeof tint.light === "string" &&
    typeof tint.dark === "string" &&
    COLOR.test(tint.light) &&
    COLOR.test(tint.dark)
  ) {
    agent.tint = { light: tint.light, dark: tint.dark };
  }
  if (typeof raw.url === "string" && /^https?:\/\//i.test(raw.url)) {
    try {
      agent.url = new URL(raw.url).href;
    } catch {
      // Not a URL; leave it out.
    }
  }
  if (typeof raw.threadId === "string" && THREAD_ID.test(raw.threadId)) {
    agent.threadId = raw.threadId;
  }
  return agent;
}
