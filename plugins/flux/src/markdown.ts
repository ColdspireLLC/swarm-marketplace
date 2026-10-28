// Markdown helpers both the app and the server use.

/** `![alt](url "title")`: alt, url, and the optional title (with its space). */
export const MARKDOWN_IMAGE =
  /!\[((?:\\.|[^\\\]])*)\]\(([^()\s]+)((?:\s+"[^"]*")?)\)/g;

/** Rewrites Markdown text outside fenced blocks and inline code. */
export function mapOutsideCode(
  markdown: string,
  change: (text: string) => string,
): string {
  return markdown
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
    .map((part, index) => (index % 2 === 1 ? part : change(part)))
    .join("");
}
