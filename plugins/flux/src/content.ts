// Flux stores descriptions and comments as TipTap HTML. Agents and the CLI
// speak Markdown, so this module converts both ways and maps mentions:
// `@username` in Markdown becomes a Flux mention (which notifies the person),
// and a Flux mention reads back as `@username`.
import { Marked, type Token, type Tokens } from "marked";
import TurndownService from "turndown";

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
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      // Raw HTML from an agent is shown as text, never interpreted.
      html({ text }: Tokens.HTML | Tokens.Tag) {
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
      // Flux reference-counts uploaded images by their `/assets/<id>` path.
      image({ href, title, text }: Tokens.Image) {
        if (!isSafeHref(href)) return escapeHtml(text);
        let src = href;
        if (src.startsWith(baseUrl)) {
          const path = src.slice(baseUrl.length);
          if (ASSET_PATH.test(path)) src = path;
        }
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${titleAttr}>`;
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

export function htmlToMarkdown(
  html: string,
  options: { baseUrl: string; members: readonly MentionTarget[] },
): string {
  if (!html.trim()) return "";
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
      const alt = element.getAttribute("alt") ?? "";
      return src ? `![${alt}](${src})` : "";
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
