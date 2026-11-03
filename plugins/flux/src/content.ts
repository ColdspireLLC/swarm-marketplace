// Flux stores descriptions and comments as TipTap HTML. Agents and the CLI
// speak Markdown, so this module converts both ways and maps mentions:
// `@username` in Markdown becomes a Flux mention (which notifies the person),
// and a Flux mention reads back as `@username`.
import { Marked, type Token, type Tokens } from "marked";
import TurndownService from "turndown";
import { HTML_IMAGE, imageOf, readImageTag, writeImage, type ImageTag } from "./markdown";

export interface MentionTarget {
  id: string;
  name: string;
  username: string;
}

const ASSET_PATH = /^\/assets\/[0-9a-f-]{36}$/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (/^(\/(?!\/)|#|\?)/.test(trimmed)) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/**
 * A task item's blocks without marked's checkbox (the state is on the item):
 * a tight item has it before its text, a loose one inside its first
 * paragraph.
 */
function withoutCheckbox(tokens: readonly Token[]): Token[] {
  return tokens
    .filter((token) => token.type !== "checkbox")
    .map((token, index) =>
      index === 0 && token.type === "paragraph" && token.tokens
        ? {
            ...token,
            tokens: token.tokens.filter((inline) => inline.type !== "checkbox"),
          }
        : token,
    );
}

function createMarked(baseUrl: string): Marked {
  // Flux reference-counts uploaded images by their `/assets/<id>` path.
  const imageHtml = (image: ImageTag, title?: string | null): string => {
    if (!isSafeHref(image.src)) return escapeHtml(image.alt);
    let src = image.src;
    if (src.startsWith(baseUrl)) {
      const path = src.slice(baseUrl.length);
      if (ASSET_PATH.test(path)) src = path;
    }
    let attrs = ` alt="${escapeHtml(image.alt)}"`;
    if (title) attrs += ` title="${escapeHtml(title)}"`;
    if (image.width) attrs += ` width="${image.width}"`;
    if (image.width && image.height) attrs += ` height="${image.height}"`;
    if (image.align) attrs += ` data-align="${image.align}"`;
    return `<img src="${escapeHtml(src)}"${attrs}>`;
  };
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      // Raw HTML from an agent is shown as text, never interpreted, but
      // for images of a size or alignment, as Swarm's editor writes them:
      // written anew, of what Flux's image node keeps.
      html({ text }: Tokens.HTML | Tokens.Tag) {
        if (/^\s*(<img\b(?:[^>"']|"[^"]*"|'[^']*')*>\s*)+$/i.test(text)) {
          const tags = [...text.matchAll(HTML_IMAGE)].map((m) => readImageTag(m[0]));
          if (tags.every((tag) => tag !== null)) return tags.map((tag) => imageHtml(tag!)).join("");
        }
        return escapeHtml(text);
      },
      // Task lists use TipTap's markup so they stay checkable in Flux.
      list(token: Tokens.List) {
        if (!token.items.every((item) => item.task)) return false;
        const items = token.items
          .map((item) => {
            const inner = this.parser.parse(withoutCheckbox(item.tokens));
            const body = inner.trim().startsWith("<p>")
              ? inner
              : `<p>${inner.trim()}</p>`;
            return `<li data-type="taskItem" data-checked="${item.checked ? "true" : "false"}">${body}</li>`;
          })
          .join("");
        return `<ul data-type="taskList">${items}</ul>`;
      },
      // Only web, mail, and in-app links; never `javascript:` and friends.
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        if (!isSafeHref(href)) return text;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        return imageHtml({ src: href, alt: text }, title);
      },
    },
  });
  return marked;
}

/**
 * Replaces `@username` (or `@"Display Name"`) outside code with Flux mention
 * nodes. Unknown handles stay as plain text.
 */
function linkMentions(html: string, members: readonly MentionTarget[]): string {
  if (members.length === 0) return html;
  const byHandle = new Map<string, MentionTarget>();
  for (const member of members) {
    byHandle.set(member.username.toLowerCase(), member);
  }
  const byName = new Map<string, MentionTarget>();
  for (const member of members) byName.set(member.name.toLowerCase(), member);

  let codeDepth = 0;
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith("<")) {
        if (/^<(code|pre)\b/i.test(part)) codeDepth += 1;
        else if (/^<\/(code|pre)>/i.test(part))
          codeDepth = Math.max(0, codeDepth - 1);
        return part;
      }
      if (codeDepth > 0) return part;
      return part.replace(
        /(^|[\s(])@(?:&quot;([^&]{1,80})&quot;|([A-Za-z0-9_-]{3,40}))/g,
        (match, lead: string, quoted?: string, handle?: string) => {
          const member = quoted
            ? byName.get(quoted.toLowerCase())
            : byHandle.get(handle!.toLowerCase());
          if (!member) return match;
          const label = escapeHtml(member.name);
          return `${lead}<span data-type="mention" class="mention" data-id="${member.id}" data-label="${label}">@${label}</span>`;
        },
      );
    })
    .join("");
}

export function markdownToHtml(
  markdown: string,
  options: { baseUrl: string; members: readonly MentionTarget[] },
): string {
  const html = createMarked(options.baseUrl).parse(markdown.trim(), {
    async: false,
  });
  return linkMentions(html.trim(), options.members);
}

/** The Markdown of HTML lately converted, by what it was of: oldest first. */
const converted = new Map<string, string>();
let convertedSize = 0;
/** How much of it is kept, in characters of HTML and Markdown. */
const CONVERTED_MAX = 1 << 21;

/**
 * Flux's HTML as Markdown. The issue page renders on each key typed, with
 * its description and comments: each is converted once, while it stays
 * as it is (as do the mentions' handles), not on each render.
 */
export function htmlToMarkdown(
  html: string,
  options: { baseUrl: string; members: readonly MentionTarget[] },
): string {
  if (!html.trim()) return "";
  const key = `${options.baseUrl}\0${options.members.map((m) => `${m.id}=${m.username}`).join(",")}\0${html}`;
  const had = converted.get(key);
  if (had !== undefined) return had;
  const md = convertHtml(html, options);
  converted.set(key, md);
  convertedSize += key.length + md.length;
  for (const [k, v] of converted) {
    if (convertedSize <= CONVERTED_MAX) break;
    converted.delete(k);
    convertedSize -= k.length + v.length;
  }
  return md;
}

function convertHtml(
  html: string,
  options: { baseUrl: string; members: readonly MentionTarget[] },
): string {
  const handles = new Map(
    options.members.map((member) => [member.id, member.username]),
  );
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    hr: "---",
  });
  turndown.addRule("mention", {
    filter: (node) =>
      node.nodeName === "SPAN" && node.getAttribute("data-type") === "mention",
    replacement: (content, node) => {
      const element = node as HTMLElement;
      const handle = handles.get(element.getAttribute("data-id") ?? "");
      if (handle) return `@${handle}`;
      const label = element.getAttribute("data-label");
      return label ? `@${label}` : content;
    },
  });
  turndown.addRule("taskItem", {
    filter: (node) =>
      node.nodeName === "LI" &&
      node.parentElement?.getAttribute("data-type") === "taskList",
    replacement: (content, node) => {
      const checked =
        (node as HTMLElement).getAttribute("data-checked") === "true";
      const text = content.replace(/^\n+|\n+$/g, "").replace(/\n/g, "\n  ");
      return `- [${checked ? "x" : " "}] ${text}\n`;
    },
  });
  // Flux's tables, as GFM's: their first row the header. A cell's
  // lines are joined, and its pipes escaped.
  turndown.addRule("table", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLElement).querySelectorAll("tr") as ArrayLike<HTMLElement>).map((tr) =>
        Array.from(tr.children).map((cell) =>
          turndown
            .turndown((cell as HTMLElement).innerHTML)
            .replace(/\n+/g, " ")
            .replace(/\|/g, "\\|")
            .trim(),
        ),
      );
      if (rows.length === 0) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
      return `\n\n${[line(rows[0]!), line(Array.from({ length: width }, () => "---")), ...rows.slice(1).map(line)].join("\n")}\n\n`;
    },
  });
  turndown.addRule("image", {
    filter: "img",
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      let src = element.getAttribute("src") ?? "";
      if (src.startsWith("/")) src = `${options.baseUrl}${src}`;
      if (!src) return "";
      // Its size and alignment, as Flux's image node has them: an <img>.
      const at = (name: string) => element.getAttribute(name);
      const tag = imageOf({ src, alt: at("alt"), width: at("width"), height: at("height"), "data-align": at("data-align") });
      if (!tag) return "";
      const md = writeImage(tag, escapeHtml);
      // A block of its own, as Flux's are, which Markdown keeps apart.
      return tag.width || tag.align ? `\n\n${md}\n\n` : md;
    },
  });
  turndown.addRule("unsafeLink", {
    filter: (node) =>
      node.nodeName === "A" && !isSafeHref(node.getAttribute("href") ?? ""),
    replacement: (content) => content,
  });
  turndown.addRule("callout", {
    filter: (node) =>
      node.nodeName === "DIV" && node.getAttribute("data-type") === "callout",
    replacement: (content) =>
      `\n\n${content
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`,
  });
  return turndown.turndown(html).trim();
}
