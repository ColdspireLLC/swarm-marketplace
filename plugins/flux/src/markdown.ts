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

/**
 * `<img src alt width height data-align>`: an image of a size, or one
 * aligned, as Swarm's editor writes it and Flux's image node keeps it.
 */
export const HTML_IMAGE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

/** An image's tag, read: its source, its name, its size and alignment. */
export interface ImageTag {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  align?: "center" | "right";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** Reads an `<img>` tag; null for anything else, or one with no source. */
export function readImageTag(tag: string): ImageTag | null {
  if (!/^<img\b/i.test(tag.trim())) return null;
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    attrs[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e]!);
  }
  return imageOf(attrs);
}

/** An image of an img's attributes, as an element or a tag has them; null with no source. */
export function imageOf(attrs: { src?: string | null; alt?: string | null; width?: string | null; height?: string | null; "data-align"?: string | null }): ImageTag | null {
  const src = (attrs.src ?? "").trim();
  if (!src) return null;
  const side = (v?: string | null) => {
    const n = Number.parseFloat(v ?? "");
    return Number.isFinite(n) && n > 0 && n <= 1e5 ? Math.round(n) : undefined;
  };
  const align = attrs["data-align"];
  return {
    src,
    alt: attrs.alt ?? "",
    width: side(attrs.width),
    height: side(attrs.height),
    align: align === "center" || align === "right" ? align : undefined,
  };
}

/** An image as Markdown: `![alt](src)`, or its tag when it has a size or alignment. */
export function writeImage(image: ImageTag, escape: (s: string) => string): string {
  if (!image.width && !image.align) return `![${image.alt.replace(/([\\\[\]])/g, "\\$1")}](${image.src})`;
  let tag = `<img src="${escape(image.src)}" alt="${escape(image.alt)}"`;
  if (image.width) tag += ` width="${image.width}"`;
  if (image.width && image.height) tag += ` height="${image.height}"`;
  if (image.align) tag += ` data-align="${image.align}"`;
  return tag + ">";
}

/** The source of each image in Markdown, `![]()` and `<img>` alike, in order. */
export function imageSources(markdown: string): string[] {
  const found: { at: number; src: string }[] = [];
  for (const m of markdown.matchAll(MARKDOWN_IMAGE)) found.push({ at: m.index!, src: m[2]! });
  for (const m of markdown.matchAll(HTML_IMAGE)) {
    const tag = readImageTag(m[0]);
    if (tag) found.push({ at: m.index!, src: tag.src });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.src);
}
