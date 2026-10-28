import type { ColorValue } from "swarm";
import katex, { __getCharacterMetrics } from "../vendor/katex/katex.mjs";
import { Builder, type Scene } from "./scene";
import { flatten, parseXML, type Node as XNode } from "./svgcanvas";

// ```math, and $$…$$ in a diagram's labels: TeX laid out by KaTeX, the
// typesetter t3code uses, and drawn with Swarm's canvas in KaTeX's own
// fonts. KaTeX's HTML tree says where everything goes, as its CSS has the
// browser lay it out: each glyph's width, height and depth, and each
// stack's (a fraction's, a script's, a root's) rows at their offsets.
// layout() reads that tree as the browser would, into glyphs, rules and
// paths; scene() draws them, and svg() writes them for pele.

/** KaTeX's font files, by the family each registers under (ui.font). */
export const FONTS: { [family: string]: string } = Object.fromEntries(
	[
		"AMS-Regular", "Caligraphic-Bold", "Caligraphic-Regular", "Fraktur-Bold", "Fraktur-Regular", "Main-Bold", "Main-BoldItalic",
		"Main-Italic", "Main-Regular", "Math-BoldItalic", "Math-Italic", "SansSerif-Bold", "SansSerif-Italic", "SansSerif-Regular",
		"Script-Regular", "Size1-Regular", "Size2-Regular", "Size3-Regular", "Size4-Regular", "Typewriter-Regular",
	].map((f) => ["KaTeX_" + f, `vendor/katex/fonts/KaTeX_${f}.ttf`]),
);

export type Item =
	| { kind: "glyph"; x: number; y: number; text: string; font: string; size: number; color?: string }
	| { kind: "rule"; x: number; y: number; w: number; h: number; color?: string }
	| { kind: "path"; x: number; y: number; w: number; h: number; scale: number; d: string[]; color?: string; ox?: number };

export interface Box {
	w: number;
	h: number;
	d: number;
	items: Item[];
	/** As wide as its stack: a fraction's line, a root's sign. */
	stretch?: { min: number; draw: (w: number) => Item[] };
}

interface Font {
	family: string;
	bold: boolean;
	italic: boolean;
}

interface Ctx {
	em: number;
	font: Font;
	color?: string;
}

// Sizes, as KaTeX's .sizing.reset-sizeN.sizeM rules scale the em.
const SIZES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.44, 1.728, 2.074, 2.488];

/** A font as KaTeX's CSS classes set it, over the one it's in. */
function fontOf(f: Font, classes: string[]): Font {
	let { family, bold, italic } = f;
	const has = (c: string) => classes.includes(c);
	for (const c of classes) {
		switch (c) {
			case "mathnormal":
				[family, italic, bold] = ["Math", true, false];
				break;
			case "boldsymbol":
				[family, italic, bold] = ["Math", true, true];
				break;
			case "mathit":
				[family, italic] = ["Main", true];
				break;
			case "mathbf":
				[family, bold] = ["Main", true];
				break;
			case "textbf":
				bold = true;
				break;
			case "textit":
				italic = true;
				break;
			case "textup":
			case "textmd":
				italic = false;
				bold = c === "textmd" ? false : bold;
				break;
			case "mainrm":
			case "textrm":
				[family, italic] = ["Main", false];
				break;
			case "amsrm":
			case "mathbb":
			case "textbb":
				[family, italic, bold] = ["AMS", false, false];
				break;
			case "mathcal":
				family = "Caligraphic";
				break;
			case "mathfrak":
			case "textfrak":
				family = "Fraktur";
				break;
			case "mathboldfrak":
			case "textboldfrak":
				[family, bold] = ["Fraktur", true];
				break;
			case "mathscr":
			case "textscr":
				family = "Script";
				break;
			case "mathsf":
			case "textsf":
				[family, italic] = ["SansSerif", false];
				break;
			case "mathboldsf":
			case "textboldsf":
				[family, bold] = ["SansSerif", true];
				break;
			case "mathsfit":
			case "mathitsf":
			case "textitsf":
				[family, italic] = ["SansSerif", true];
				break;
			case "mathtt":
			case "texttt":
				family = "Typewriter";
				break;
		}
	}
	if (has("delimsizing")) {
		for (const n of [1, 2, 3, 4]) if (has("size" + n)) [family, bold, italic] = ["Size" + n, false, false];
	}
	if (has("delim-size1")) [family, bold, italic] = ["Size1", false, false];
	if (has("delim-size4")) [family, bold, italic] = ["Size4", false, false];
	if (has("op-symbol") && has("small-op")) [family, bold, italic] = ["Size1", false, false];
	if (has("op-symbol") && has("large-op")) [family, bold, italic] = ["Size2", false, false];
	return { family, bold, italic };
}

/** The file a font is drawn from: the nearest face KaTeX has. */
export function faceOf(f: Font): string {
	const faces: { [family: string]: string[] } = {
		Main: ["Regular", "Bold", "Italic", "BoldItalic"],
		Math: ["Italic", "Italic", "Italic", "BoldItalic"],
		AMS: ["Regular", "Regular", "Regular", "Regular"],
		Caligraphic: ["Regular", "Bold", "Regular", "Bold"],
		Fraktur: ["Regular", "Bold", "Regular", "Bold"],
		SansSerif: ["Regular", "Bold", "Italic", "Bold"],
		Script: ["Regular", "Regular", "Regular", "Regular"],
		Typewriter: ["Regular", "Regular", "Regular", "Regular"],
		Size1: ["Regular", "Regular", "Regular", "Regular"],
		Size2: ["Regular", "Regular", "Regular", "Regular"],
		Size3: ["Regular", "Regular", "Regular", "Regular"],
		Size4: ["Regular", "Regular", "Regular", "Regular"],
	};
	const list = faces[f.family] ?? faces.Main;
	return `KaTeX_${faces[f.family] ? f.family : "Main"}-${list[(f.bold ? 1 : 0) + (f.italic ? 2 : 0)]}`;
}

/** A CSS length as KaTeX writes them (in ems), in pixels. */
function len(v: unknown, em: number): number {
	if (typeof v !== "string") return 0;
	const m = /^(-?[\d.]+)(em|px)?$/.exec(v.trim());
	if (!m) return 0;
	return m[2] === "px" ? +m[1] : +m[1] * em;
}

function minW0(style: any, em: number): number {
	return len(style.minWidth, em);
}

function shift(items: Item[], dx: number, dy: number): Item[] {
	if (!dx && !dy) return items;
	return items.map((i) => ({ ...i, x: i.x + dx, y: i.y + dy }));
}

function isSymbol(n: any): boolean {
	return typeof n?.text === "string" && "italic" in n;
}

function isSvg(n: any): boolean {
	return typeof n?.toMarkup === "function" && Array.isArray(n?.children) && n.children.some((c: any) => "pathName" in c || c?.constructor?.name === "PathNode") || n?.constructor?.name === "SvgNode";
}

const EMPTY: Box = { w: 0, h: 0, d: 0, items: [] };

/** A KaTeX node laid out: its width, its height and depth about its baseline, and what it draws. */
export function lay(n: any, ctx: Ctx): Box {
	if (!n || typeof n !== "object") return EMPTY;
	if (isSymbol(n)) return glyph(n, ctx);
	if (isSvg(n)) return svgBox(n, ctx);
	const classes: string[] = (n.classes ?? []).filter(Boolean);
	const style = n.style ?? {};
	if (classes.includes("strut") || classes.includes("vlist-s") || classes.includes("pstrut")) return EMPTY;
	let em = ctx.em;
	const reset = classes.find((c) => c.startsWith("reset-size"));
	const size = classes.find((c) => /^size\d+$/.test(c));
	if (reset && size && (classes.includes("sizing") || classes.includes("fontsize-ensurer"))) {
		em = (em * SIZES[+size.slice(4) - 1]) / SIZES[+reset.slice(10) - 1];
	}
	const inner: Ctx = { em, font: fontOf(ctx.font, classes), color: typeof style.color === "string" ? style.color : ctx.color };
	const ml = len(style.marginLeft, ctx.em), mr = len(style.marginRight, ctx.em);
	const pl = len(style.paddingLeft, ctx.em), pr = len(style.paddingRight, ctx.em);

	// A rule as wide as what holds it: a fraction's line, an overline, a table's line.
	const border = len(style.borderBottomWidth, ctx.em) || len(style.borderTopWidth, ctx.em);
	if (border && !(n.children ?? []).length && (classes.some((c) => /line$|^hline|^hdashline/.test(c)))) {
		const color = inner.color;
		return { w: 0, h: border, d: 0, items: [], stretch: { min: 0, draw: (w) => [{ kind: "rule", x: 0, y: -border, w, h: border, color }] } };
	}
	// \rule: its borders are its box.
	if (classes.includes("rule")) {
		const w = len(style.borderRightWidth, ctx.em), h = len(style.borderTopWidth, ctx.em), b = len(style.bottom, ctx.em);
		// \vdots and the like hold their height with a rule of no width: nothing to draw.
		const items: Item[] = w > 0 && h > 0 ? [{ kind: "rule", x: ml, y: -h - b, w, h, color: inner.color }] : [];
		return { w: w + ml + mr, h: h + b, d: -b, items };
	}

	// A stretchy arrow's or brace's pieces, each a share of its width at its end (KaTeX's CSS).
	const pieces = (n.children ?? []).filter((c: any) => (c.classes ?? []).some((k: string) => /^(halfarrow|brace)-(left|center|right)$/.test(k)));
	if (pieces.length && pieces.length === (n.children ?? []).length) {
		const parts = pieces.map((c: any) => {
			const k = (c.classes as string[]).find((x) => /^(halfarrow|brace)-/.test(x))!;
			const share = k.startsWith("halfarrow") ? 0.502 : k.endsWith("center") ? 0.5 : 0.251;
			const at = k.endsWith("left") ? "left" : k.endsWith("right") ? "right" : "center";
			return { b: lay(c, inner), share, at };
		});
		const minH = Math.max(0, ...parts.map((p: any) => p.b.h)), minD = Math.max(0, ...parts.map((p: any) => p.b.d));
		return {
			w: 0, h: minH, d: minD, items: [],
			stretch: {
				min: Math.max(minW0(style, ctx.em), ...parts.map((p: any) => (p.b.stretch?.min ?? 0) / p.share)),
				draw: (w) => parts.flatMap((p: any) => {
					const pw = w * p.share;
					const x = p.at === "left" ? 0 : p.at === "right" ? w - pw : w * 0.25;
					return shift(p.b.stretch ? p.b.stretch.draw(pw) : p.b.items, x, 0);
				}),
			},
		};
	}

	let body: Box;
	if (classes.includes("vlist-t")) body = vlist(n, inner, align(classes));
	else body = row(n.children ?? [], inner, classes);

	let w = body.w + pl + pr;
	if (classes.includes("nulldelimiter")) w = Math.max(w, 0.12 * em);
	if (style.width) w = Math.max(w, len(style.width, ctx.em));
	const minW = len(style.minWidth, ctx.em);
	let items = shift(body.items, ml + pl, 0);
	let h = body.h, d = body.d;
	// Raised or lowered: vertical-align, and a relative position's top and left.
	const raise = len(style.verticalAlign, ctx.em) - len(style.top, ctx.em);
	if (raise) {
		items = shift(items, 0, -raise);
		h += raise;
		d -= raise;
	}
	const left = len(style.left, ctx.em);
	if (left) items = shift(items, left, 0);
	// What's as wide as its stack (a root's sign, a stretchy arrow) stays so.
	if ((classes.includes("hide-tail") || classes.includes("stretchy") || (body.stretch && body.w === 0)) && !classes.includes("vlist-t")) {
		const draw = body.stretch?.draw;
		const content = items;
		return {
			w: ml + mr, h, d, items: [],
			stretch: { min: Math.max(minW, body.stretch?.min ?? 0, w), draw: (sw) => [...content, ...(draw ? shift(draw(sw - ml - mr), ml, 0) : [])] },
		};
	}
	return { w: ml + Math.max(w, minW) + mr, h, d, items };
}

/** Children side by side on one baseline. */
function row(children: any[], ctx: Ctx, classes: string[]): Box {
	let x = 0, h = 0, d = 0;
	const items: Item[] = [];
	let stretch: Box["stretch"];
	for (const c of children) {
		const b = lay(c, ctx);
		items.push(...shift(b.items, x, 0));
		if (b.stretch) {
			// A lone stretchy child (the root's sign in its row) is the row's.
			const at = x, s = b.stretch;
			stretch = { min: Math.max(stretch?.min ?? 0, at + s.min), draw: (w) => shift(s.draw(w - at), at, 0) };
		}
		x += b.w;
		h = Math.max(h, b.h);
		d = Math.max(d, b.d);
	}
	void classes;
	return { w: x, h, d, items, stretch };
}

/** How a stack's rows line up, as KaTeX's CSS centres them. */
function align(classes: string[]): "left" | "center" | "right" {
	if (classes.includes("col-align-r")) return "right";
	if (classes.includes("col-align-l")) return "left";
	return "center";
}

/**
 * A vlist: rows stacked at their offsets. Each row's static place is the
 * stack's baseline; its top (style) moves it, and its pstrut's height puts
 * its content's baseline that far below the row's top.
 */
function vlist(vt: any, ctx: Ctx, rowAlign: "left" | "center" | "right"): Box {
	const first = (vt.children ?? [])[0];
	const list = (first?.children ?? []).find((c: any) => (c.classes ?? []).includes("vlist"));
	const rows: { b: Box; y: number; x: number; ml: number; mr: number; center: boolean }[] = [];
	for (const r of list?.children ?? []) {
		const st = r.style ?? {};
		const kids: any[] = r.children ?? [];
		const pstrut = kids.find((k) => (k.classes ?? []).includes("pstrut"));
		const p = len(pstrut?.style?.height, ctx.em);
		const content = kids.filter((k) => k !== pstrut);
		const rc: string[] = (r.classes ?? []).filter(Boolean);
		const b = row(content, { ...ctx, font: fontOf(ctx.font, rc) }, rc);
		rows.push({ b, y: len(st.top, ctx.em) + p, x: 0, ml: len(st.marginLeft, ctx.em), mr: len(st.marginRight, ctx.em), center: !rc.includes("svg-align") });
	}
	let w = 0;
	for (const r of rows) w = Math.max(w, r.ml + r.b.w + r.mr, r.b.stretch ? r.ml + r.b.stretch.min + r.mr : 0);
	const items: Item[] = [];
	let h = 0, d = 0;
	for (const r of rows) {
		const rw = r.ml + r.b.w + r.mr;
		const x = r.ml + (r.center && !r.b.stretch ? (rowAlign === "center" ? (w - rw) / 2 : rowAlign === "right" ? w - rw : 0) : 0);
		items.push(...shift(r.b.items, x, r.y));
		if (r.b.stretch) items.push(...shift(r.b.stretch.draw(w - r.ml - r.mr), r.ml, r.y));
		h = Math.max(h, r.b.h - r.y);
		d = Math.max(d, r.b.d + r.y);
	}
	return { w, h, d, items };
}

function glyph(n: any, ctx: Ctx): Box {
	const classes: string[] = (n.classes ?? []).filter(Boolean);
	const font = fontOf(ctx.font, classes);
	const style = n.style ?? {};
	const em = ctx.em;
	const ml = len(style.marginLeft, em), mr = len(style.marginRight, em);
	const text: string = n.text.replace(/\u200b/g, "");
	const face = faceOf(font);
	let w = (n.width ?? 0) * em;
	const chars = [...text];
	if (chars.length > 1) {
		// A run KaTeX combined into one node: its width is its characters'.
		let sum = 0;
		for (const ch of chars) {
			const m = __getCharacterMetrics(ch, face.slice(6), "text");
			sum += m ? m.width : 0.5;
		}
		w = sum * em;
	}
	const top = len(style.top, em);
	const color = typeof style.color === "string" ? style.color : ctx.color;
	const items: Item[] = text ? [{ kind: "glyph", x: ml, y: top, text, font: face, size: em, color }] : [];
	return { w: ml + w + mr, h: (n.height ?? 0) * em - top, d: (n.depth ?? 0) * em + top, items };
}

/** KaTeX's SVG (a root's sign, a stretchy delimiter or arrow): its paths, scaled to its height, cut at its box's width. */
function svgBox(n: any, ctx: Ctx): Box {
	const markup: string = n.toMarkup();
	const doc = parseXML(markup).children.find((c): c is XNode => typeof c !== "string" && c.tag === "svg");
	if (!doc) return EMPTY;
	const vb = (doc.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
	const h = len(doc.attrs.height, ctx.em);
	const scale = vb[3] ? h / vb[3] : 1;
	const d: string[] = [];
	const walk = (x: XNode) => {
		for (const c of x.children) {
			if (typeof c === "string") continue;
			if (c.tag === "path" && c.attrs.d) d.push(c.attrs.d);
			walk(c);
		}
	};
	walk(doc);
	const width = doc.attrs.width;
	const fixed = width && !/^400em$/.test(width) ? len(width, ctx.em) : 0;
	const color = ctx.color;
	// Sliced at its start, end or middle, as its preserveAspectRatio says: a right half-arrow keeps its head.
	const par = doc.attrs.preserveAspectRatio ?? "";
	const full = (vb[2] || 0) * scale;
	const path = (w: number): Item[] => [{ kind: "path", x: 0, y: -h, w, h, scale, d, color, ox: /xMax/.test(par) ? w - full : /xMid/.test(par) ? (w - full) / 2 : 0 }];
	if (fixed) return { w: fixed, h, d: 0, items: path(fixed) };
	return { w: 0, h, d: 0, items: [], stretch: { min: 0, draw: path } };
}

export interface Typeset {
	w: number;
	h: number;
	d: number;
	items: Item[];
}

/** TeX typeset at em pixels to the em. Throws KaTeX's error, saying what's wrong. */
export function typeset(tex: string, em: number, display = true): Typeset {
	const tree = katex.__renderToHTMLTree(tex, { displayMode: display, throwOnError: true, strict: "ignore", trust: false, maxSize: 20, maxExpand: 1000 });
	const b = lay(tree, { em, font: { family: "Main", bold: false, italic: false } });
	return { w: b.w, h: b.h, d: b.d, items: b.items };
}

/** A typeset formula drawn: padded, its baseline h + pad down. */
export function scene(t: Typeset, pad = 8): Scene {
	const b = new Builder(Math.ceil(t.w + pad * 2), Math.ceil(t.h + t.d + pad * 2));
	const ox = pad, oy = pad + t.h;
	for (const i of t.items) {
		const color = (i.color as ColorValue | undefined) ?? "text";
		if (i.kind === "glyph") {
			b.texts.push(i.text);
			b.ops.push((g) => g.text(ox + i.x, oy + i.y, i.text, color, { size: i.size, font: i.font, baseline: "alphabetic" }));
		} else if (i.kind === "rule") {
			b.ops.push((g) => g.rect(ox + i.x, oy + i.y, Math.max(i.w, 0.5), Math.max(i.h, 0.5), color));
		} else {
			const shapes = outline(i, ox, oy);
			b.ops.push((g) => {
				g.save();
				g.clip(ox + i.x, oy + i.y, i.w, i.h);
				for (const s of shapes) g.poly(s, color, true);
				g.restore();
			});
		}
	}
	return b.scene();
}

/**
 * A path item's outlines as polygons in the drawing's own space, already
 * scaled and placed: KaTeX's paths run to 400,000 units, which a canvas's
 * small scale draws wrongly, so they're flattened here instead.
 */
export function outline(i: Extract<Item, { kind: "path" }>, ox: number, oy: number): number[][] {
	const dx = ox + i.x + (i.ox ?? 0), dy = oy + i.y;
	const out: number[][] = [];
	for (const d of i.d) {
		for (const pts of flatten(d)) {
			const s = new Array<number>(pts.length);
			for (let k = 0; k < pts.length; k += 2) {
				s[k] = Math.round((dx + pts[k] * i.scale) * 100) / 100;
				s[k + 1] = Math.round((dy + pts[k + 1] * i.scale) * 100) / 100;
			}
			out.push(s);
		}
	}
	return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A typeset formula as an SVG, for pele's labels: its baseline at its height. */
export function svg(t: Typeset): { svg: string; width: number; height: number } {
	const W = Math.ceil(t.w), H = Math.ceil(t.h + t.d);
	const r = (v: number) => Math.round(v * 100) / 100;
	const parts: string[] = [];
	for (const i of t.items) {
		const fill = i.color ? ` fill="${esc(i.color)}"` : "";
		if (i.kind === "glyph") {
			parts.push(`<text x="${r(i.x)}" y="${r(t.h + i.y)}" font-family="${i.font}" font-size="${r(i.size)}"${fill}>${esc(i.text)}</text>`);
		} else if (i.kind === "rule") {
			parts.push(`<rect x="${r(i.x)}" y="${r(t.h + i.y)}" width="${r(Math.max(i.w, 0.5))}" height="${r(Math.max(i.h, 0.5))}"${fill}/>`);
		} else {
			const shapes = outline(i, -i.x, -i.y);
			const d = shapes.map((s) => "M" + s.map((v, k) => (k % 2 ? "," : k ? "L" : "") + r(v)).join("") + "Z").join("");
			parts.push(`<svg x="${r(i.x)}" y="${r(t.h + i.y)}" width="${r(i.w)}" height="${r(i.h)}"><path d="${d}"${fill}/></svg>`);
		}
	}
	return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="currentColor">${parts.join("")}</svg>`, width: W, height: H };
}

/** KaTeX's error, as a sentence. */
export function mathError(e: unknown): Error {
	const msg = e instanceof Error ? e.message : String(e);
	return new Error(msg.replace(/^KaTeX parse error: /, "").replace(/\s+/g, " ").trim());
}
