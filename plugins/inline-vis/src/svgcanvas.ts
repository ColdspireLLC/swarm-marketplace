import type { CanvasPaint, ColorValue } from "swarm";
import { Builder, type Scene } from "./scene";
import { textWidth } from "./text";

// pele's SVG, drawn with a canvas's commands: Swarm draws SVG pictures but
// not their text, so the diagram is read here and drawn shape by shape.
// pele colours its drawing with CSS variables, which become Swarm's own
// colours, so the diagram follows the theme; its series' colours are the
// palette's, a theme's steps each.

export interface Node {
	tag: string;
	attrs: { [name: string]: string };
	children: (Node | string)[];
}

const ENTITIES: { [name: string]: string } = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
	return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
		if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
		return ENTITIES[e] ?? m;
	});
}

/** An SVG document read into its elements. Comments, processing instructions and doctypes are skipped. */
export function parseXML(src: string): Node {
	const root: Node = { tag: "#root", attrs: {}, children: [] };
	const stack: Node[] = [root];
	let i = 0;
	while (i < src.length) {
		const lt = src.indexOf("<", i);
		if (lt < 0) {
			const t = src.slice(i);
			if (t.trim()) stack[stack.length - 1].children.push(decode(t));
			break;
		}
		if (lt > i) {
			const t = src.slice(i, lt);
			if (t.trim() || stack[stack.length - 1].tag === "text" || stack[stack.length - 1].tag === "tspan") stack[stack.length - 1].children.push(decode(t));
		}
		if (src.startsWith("<!--", lt)) {
			const end = src.indexOf("-->", lt);
			i = end < 0 ? src.length : end + 3;
			continue;
		}
		if (src.startsWith("<![CDATA[", lt)) {
			const end = src.indexOf("]]>", lt);
			stack[stack.length - 1].children.push(src.slice(lt + 9, end < 0 ? src.length : end));
			i = end < 0 ? src.length : end + 3;
			continue;
		}
		if (src[lt + 1] === "?" || src[lt + 1] === "!") {
			const end = src.indexOf(">", lt);
			i = end < 0 ? src.length : end + 1;
			continue;
		}
		if (src[lt + 1] === "/") {
			const end = src.indexOf(">", lt);
			const name = src.slice(lt + 2, end).trim();
			for (let k = stack.length - 1; k > 0; k--) {
				if (stack[k].tag === name) {
					stack.length = k;
					break;
				}
			}
			i = end < 0 ? src.length : end + 1;
			continue;
		}
		// A start tag: its name, its attributes (quoted either way), and whether it closes itself.
		let j = lt + 1;
		while (j < src.length && !/[\s/>]/.test(src[j])) j++;
		const node: Node = { tag: src.slice(lt + 1, j), attrs: {}, children: [] };
		const attr = /\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
		for (;;) {
			attr.lastIndex = j;
			const m = attr.exec(src);
			if (!m || !m[0].trim()) break;
			node.attrs[m[1]] = decode(m[2] ?? m[3] ?? m[4] ?? "");
			j = attr.lastIndex;
		}
		while (j < src.length && src[j] !== ">") j++;
		const selfClosing = src[j - 1] === "/";
		stack[stack.length - 1].children.push(node);
		if (!selfClosing) stack.push(node);
		i = j + 1;
	}
	return root;
}

// ---- Colours ----

// pele's variables, as Swarm's tokens. Its own names first (--pele-…),
// then the short ones it sets from them (--_…), as t3code maps them to its
// theme: lines and muted text alike in the secondary text's colour.
const TOKENS: { [name: string]: ColorValue } = {
	"--pele-bg": "raised",
	"--pele-fg": "text",
	"--pele-muted": "text2",
	"--pele-line": "text2",
	"--pele-surface": "field",
	"--pele-surface-alt": "selected",
	"--pele-border": "borderStrong",
	"--pele-accent": "accent",
	"--pele-critical": "red",
	"--_bg": "raised",
	"--_fg": "text",
	"--_m": "text2",
	"--_l": "text2",
	"--_s": "field",
	"--_a": "selected",
	"--_b": "borderStrong",
	"--_c": "accent",
};

/** A colour as SVG writes it, as a canvas paints it: none is null. */
export function colorOf(v: string | undefined, palette: ColorValue[]): ColorValue | null | undefined {
	if (v === undefined) return undefined;
	v = v.trim();
	if (!v || v === "none" || v === "transparent") return null;
	const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
	if (m) {
		const series = /^--(?:pele-series-|_s)(\d+)$/.exec(m[1]);
		if (series) return palette[(+series[1] - 1) % palette.length];
		if (TOKENS[m[1]]) return TOKENS[m[1]];
		return m[2] !== undefined ? colorOf(m[2], palette) : "text";
	}
	if (v === "currentColor") return "text";
	if (/^(#[0-9a-fA-F]{3,8}|rgba?\(.*\)|hsla?\(.*\)|[a-zA-Z]+)$/.test(v)) return v as ColorValue;
	return "text";
}

function num(v: string | undefined, fallback = 0): number {
	if (v === undefined) return fallback;
	const n = parseFloat(v);
	return isFinite(n) ? n : fallback;
}

// ---- Paths, flattened, for what a canvas can't stroke itself: dashes ----

/** An SVG path's data as polylines, one a subpath, in points x, y, x, y… */
export function flatten(d: string): number[][] {
	const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
	const out: number[][] = [];
	let cur: number[] = [];
	let x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0;
	let cmd = "", prev = "";
	let i = 0;
	const n = () => parseFloat(toks[i++]);
	const push = (px: number, py: number) => cur.push(px, py);
	const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
		for (let s = 1; s <= 12; s++) {
			const t = s / 12, u = 1 - t;
			push(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
		}
	};
	const quad = (x1: number, y1: number, ex: number, ey: number) => {
		for (let s = 1; s <= 10; s++) {
			const t = s / 10, u = 1 - t;
			push(u * u * x + 2 * u * t * x1 + t * t * ex, u * u * y + 2 * u * t * y1 + t * t * ey);
		}
	};
	const arc = (rx: number, ry: number, rot: number, large: number, sweep: number, ex: number, ey: number) => {
		// SVG's endpoint arc as its centre's (SVG 1.1, F.6.5).
		if (!rx || !ry) {
			push(ex, ey);
			return;
		}
		rx = Math.abs(rx);
		ry = Math.abs(ry);
		const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
		const dx = (x - ex) / 2, dy = (y - ey) / 2;
		const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
		const l = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
		if (l > 1) {
			rx *= Math.sqrt(l);
			ry *= Math.sqrt(l);
		}
		const sign = large === sweep ? -1 : 1;
		const k = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
		const cxp = (k * rx * y1) / ry, cyp = (-k * ry * x1) / rx;
		const ccx = cos * cxp - sin * cyp + (x + ex) / 2, ccy = sin * cxp + cos * cyp + (y + ey) / 2;
		const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
		const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
		let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
		if (!sweep && dt > 0) dt -= 2 * Math.PI;
		if (sweep && dt < 0) dt += 2 * Math.PI;
		const steps = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12)));
		for (let s = 1; s <= steps; s++) {
			const t = t1 + (dt * s) / steps;
			push(ccx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, ccy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos);
		}
	};
	while (i < toks.length) {
		if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
		else if (!cmd) break;
		const rel = cmd === cmd.toLowerCase();
		const ox = rel ? x : 0, oy = rel ? y : 0;
		switch (cmd.toUpperCase()) {
			case "M": {
				if (cur.length > 2) out.push(cur);
				x = ox + n();
				y = oy + n();
				sx = x;
				sy = y;
				cur = [x, y];
				cmd = rel ? "l" : "L"; // what follows a moveto's pair is a lineto
				break;
			}
			case "L":
				x = ox + n();
				y = oy + n();
				push(x, y);
				break;
			case "H":
				x = ox + n();
				push(x, y);
				break;
			case "V":
				y = oy + n();
				push(x, y);
				break;
			case "C": {
				const x1 = ox + n(), y1 = oy + n();
				cx = ox + n();
				cy = oy + n();
				const ex = ox + n(), ey = oy + n();
				cubic(x1, y1, cx, cy, ex, ey);
				x = ex;
				y = ey;
				break;
			}
			case "S": {
				const x1 = /[CS]/i.test(prev) ? 2 * x - cx : x, y1 = /[CS]/i.test(prev) ? 2 * y - cy : y;
				cx = ox + n();
				cy = oy + n();
				const ex = ox + n(), ey = oy + n();
				cubic(x1, y1, cx, cy, ex, ey);
				x = ex;
				y = ey;
				break;
			}
			case "Q": {
				qx = ox + n();
				qy = oy + n();
				const ex = ox + n(), ey = oy + n();
				quad(qx, qy, ex, ey);
				x = ex;
				y = ey;
				break;
			}
			case "T": {
				qx = /[QT]/i.test(prev) ? 2 * x - qx : x;
				qy = /[QT]/i.test(prev) ? 2 * y - qy : y;
				const ex = ox + n(), ey = oy + n();
				quad(qx, qy, ex, ey);
				x = ex;
				y = ey;
				break;
			}
			case "A": {
				const rx = n(), ry = n(), rot = n(), large = n(), sweep = n();
				const ex = ox + n(), ey = oy + n();
				arc(rx, ry, rot, large, sweep, ex, ey);
				x = ex;
				y = ey;
				break;
			}
			case "Z":
				push(sx, sy);
				x = sx;
				y = sy;
				out.push(cur);
				cur = [x, y];
				break;
			default:
				i++;
		}
		prev = cmd;
		if (toks[i] !== undefined && /[a-zA-Z]/.test(toks[i]) === false && cmd.toUpperCase() === "Z") break;
	}
	if (cur.length > 2) out.push(cur);
	return out;
}

/** A polyline in dashes: on, off, on, off… as stroke-dasharray lists them. */
export function dashes(pts: number[], pattern: number[]): number[][] {
	if (!pattern.length || pattern.every((p) => p <= 0)) return [pts];
	if (pattern.length % 2) pattern = pattern.concat(pattern);
	const out: number[][] = [];
	let k = 0, left = pattern[0], on = true;
	let seg: number[] = [pts[0], pts[1]];
	for (let i = 2; i < pts.length; i += 2) {
		let x = pts[i - 2], y = pts[i - 1];
		const tx = pts[i], ty = pts[i + 1];
		let len = Math.hypot(tx - x, ty - y);
		while (len > 1e-9) {
			const step = Math.min(left, len);
			x += ((tx - x) * step) / len;
			y += ((ty - y) * step) / len;
			len -= step;
			left -= step;
			if (on) seg.push(x, y);
			if (left <= 1e-9) {
				if (on && seg.length >= 4) out.push(seg);
				on = !on;
				k = (k + 1) % pattern.length;
				left = pattern[k];
				seg = [x, y];
			}
		}
	}
	if (on && seg.length >= 4) out.push(seg);
	return out;
}

// ---- Drawing ----

interface Style {
	fill: ColorValue | null;
	stroke: ColorValue | null;
	strokeWidth: number;
	dash: number[];
	opacity: number;
	fillOpacity: number;
	strokeOpacity: number;
	fontSize: number;
	fontWeight: number;
	anchor: "start" | "middle" | "end";
	mono: boolean;
	/** A KaTeX font, which math's SVG names (math.ts); "" for Swarm's sans. */
	font: string;
}

// Inter's ascent, in ems (its typo metrics, which its fsSelection asks for):
// from an alphabetic baseline (SVG's) to the top of the line a canvas's
// text starts at. Pango rounds it up to a whole pixel, as the canvas lays
// the line out.
const ASCENT = 0.969;

function weightOf(v: string): number {
	if (v === "bold" || v.startsWith("var(")) return 600;
	if (v === "normal") return 400;
	const n = parseInt(v, 10);
	return isFinite(n) ? (n >= 600 ? 600 : n >= 500 ? 500 : 400) : 400;
}

/** Inline style (style="a:b;c:d") over the element's attributes, as CSS has it. */
function attrsOf(n: Node): { [name: string]: string } {
	const a = { ...n.attrs };
	if (n.attrs.style) {
		for (const decl of n.attrs.style.split(";")) {
			const c = decl.indexOf(":");
			if (c < 0) continue;
			const k = decl.slice(0, c).trim(), v = decl.slice(c + 1).trim();
			if (k && !k.startsWith("--")) a[k] = v;
		}
	}
	return a;
}

function inherit(s: Style, a: { [name: string]: string }, palette: ColorValue[]): Style {
	const t = { ...s };
	const fill = colorOf(a.fill, palette);
	if (fill !== undefined) t.fill = fill;
	const stroke = colorOf(a.stroke, palette);
	if (stroke !== undefined) t.stroke = stroke;
	if (a["stroke-width"] !== undefined) t.strokeWidth = num(a["stroke-width"], 1);
	if (a["stroke-dasharray"] !== undefined) t.dash = a["stroke-dasharray"] === "none" ? [] : a["stroke-dasharray"].split(/[\s,]+/).map((v) => num(v)).filter((v) => v >= 0);
	if (a.opacity !== undefined) t.opacity = s.opacity * num(a.opacity, 1);
	if (a["fill-opacity"] !== undefined) t.fillOpacity = num(a["fill-opacity"], 1);
	if (a["stroke-opacity"] !== undefined) t.strokeOpacity = num(a["stroke-opacity"], 1);
	if (a["font-size"] !== undefined) t.fontSize = num(a["font-size"], s.fontSize);
	if (a["font-weight"] !== undefined) t.fontWeight = weightOf(a["font-weight"]);
	if (a["text-anchor"] !== undefined) t.anchor = a["text-anchor"] === "middle" ? "middle" : a["text-anchor"] === "end" ? "end" : "start";
	if (a["font-family"] !== undefined) {
		t.mono = /mono|--_fm/.test(a["font-family"]);
		t.font = /^KaTeX_[\w-]+$/.test(a["font-family"].trim()) ? a["font-family"].trim() : "";
	}
	if (a.font !== undefined) {
		const size = /(\d+(?:\.\d+)?)px/.exec(a.font);
		if (size) t.fontSize = +size[1];
	}
	return t;
}

/** A shape's fill and stroke as a canvas paints them, or nothing to paint. */
function paints(s: Style): { fill?: CanvasPaint; stroke?: CanvasPaint } {
	const out: { fill?: CanvasPaint; stroke?: CanvasPaint } = {};
	if (s.fill) out.fill = { fill: s.fill, opacity: s.opacity * s.fillOpacity };
	if (s.stroke && s.strokeWidth > 0) out.stroke = { stroke: s.stroke, lineWidth: s.strokeWidth, opacity: s.opacity * s.strokeOpacity };
	return out;
}

function transform(b: Builder, t: string) {
	for (const m of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
		const v = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
		switch (m[1]) {
			case "translate":
				b.ops.push((g) => g.translate(v[0] ?? 0, v[1] ?? 0));
				break;
			case "scale":
				b.ops.push((g) => g.scale(v[0] ?? 1, v[1] ?? v[0] ?? 1));
				break;
			case "rotate":
				if (v.length >= 3) {
					b.ops.push((g) => {
						g.translate(v[1], v[2]);
						g.rotate(v[0]);
						g.translate(-v[1], -v[2]);
					});
				} else b.ops.push((g) => g.rotate(v[0] ?? 0));
				break;
		}
	}
}

/** The text of a text element, its own and its tspans', as runs at their places. */
function runs(n: Node, s: Style, palette: ColorValue[], x: number, y: number, out: { x: number; y: number; text: string; style: Style }[], at: { x: number; y: number }) {
	for (const c of n.children) {
		if (typeof c === "string") {
			const text = c.replace(/\s+/g, " ");
			if (!text.trim() && !out.length) continue;
			out.push({ x: at.x, y: at.y, text, style: s });
			at.x += textWidth(text, s.fontSize, s.fontWeight);
			continue;
		}
		if (c.tag !== "tspan") continue;
		const a = attrsOf(c);
		const t = inherit(s, a, palette);
		if (/\bpele-mono\b|\bmono\b/.test(a.class ?? "")) t.mono = true;
		if (a.x !== undefined) at.x = num(a.x);
		if (a.y !== undefined) at.y = num(a.y);
		if (a.dx !== undefined) at.x += num(a.dx);
		if (a.dy !== undefined) at.y += num(a.dy) * (/em$/.test(a.dy) ? t.fontSize : 1);
		runs(c, t, palette, x, y, out, at);
	}
}

function drawText(b: Builder, n: Node, s: Style, palette: ColorValue[]) {
	const a = attrsOf(n);
	const x = num(a.x), y = num(a.y) + num(a.dy) * (/em$/.test(a.dy ?? "") ? s.fontSize : 1);
	const out: { x: number; y: number; text: string; style: Style }[] = [];
	runs(n, s, palette, x, y, out, { x: x + num(a.dx), y });
	// Lines are the runs at one y; each line is anchored as a whole.
	const lines = new Map<string, typeof out>();
	for (const r of out) {
		const key = r.y.toFixed(2);
		(lines.get(key) ?? lines.set(key, []).get(key)!).push(r);
	}
	for (const line of lines.values()) {
		const text = line.map((r) => r.text).join("");
		if (!text.trim()) continue;
		const w = line.reduce((acc, r) => acc + textWidth(r.text, r.style.fontSize, r.style.fontWeight), 0);
		const anchor = line[0].style.anchor;
		let left = line[0].x - (anchor === "middle" ? w / 2 : anchor === "end" ? w : 0);
		for (const r of line) {
			const fill = r.style.fill ?? "text";
			const size = r.style.fontSize;
			const top = r.y - Math.ceil(ASCENT * size);
			const t = r.text;
			if (t.trim()) {
				const lx = left;
				b.texts.push(t);
				const font = r.style.font;
				if (font) {
					// Math's glyphs: KaTeX's font, at the baseline SVG gives.
					b.ops.push((g) => g.text(lx, r.y, t, { fill, opacity: r.style.opacity * r.style.fillOpacity }, { size, font, baseline: "alphabetic" }));
				} else {
					b.ops.push((g) => g.text(lx, top, t, { fill, opacity: r.style.opacity * r.style.fillOpacity }, { size, weight: r.style.fontWeight, align: "start", baseline: "top" }));
				}
			}
			left += textWidth(t, size, r.style.fontWeight);
		}
	}
}

function shape(b: Builder, n: Node, s: Style) {
	const a = attrsOf(n);
	const p = paints(s);
	if (!p.fill && !p.stroke) return;
	const dashed = s.dash.length > 0 && p.stroke;
	let outline: number[][] | null = null;
	switch (n.tag) {
		case "rect": {
			const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
			if (w <= 0 || h <= 0) return;
			let r = num(a.rx ?? a.ry, 0);
			if ((a.rx ?? "").startsWith("var(")) r = 4;
			r = Math.min(r, w / 2, h / 2);
			const opts = r ? { radius: r } : undefined;
			if (p.fill) b.ops.push((g) => g.rect(x, y, w, h, p.fill!, opts));
			if (p.stroke && !dashed) b.ops.push((g) => g.rect(x, y, w, h, p.stroke!, opts));
			if (dashed) outline = [[x, y, x + w, y, x + w, y + h, x, y + h, x, y]];
			break;
		}
		case "circle": {
			const cx = num(a.cx), cy = num(a.cy), r = num(a.r);
			if (r <= 0) return;
			if (p.fill) b.ops.push((g) => g.circle(cx, cy, r, p.fill!));
			if (p.stroke && !dashed) b.ops.push((g) => g.circle(cx, cy, r, p.stroke!));
			if (dashed) outline = flatten(`M${cx + r},${cy}A${r},${r} 0 1 1 ${cx - r},${cy}A${r},${r} 0 1 1 ${cx + r},${cy}`);
			break;
		}
		case "ellipse": {
			const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry);
			if (rx <= 0 || ry <= 0) return;
			if (p.fill) b.ops.push((g) => g.ellipse(cx, cy, rx, ry, p.fill!));
			if (p.stroke && !dashed) b.ops.push((g) => g.ellipse(cx, cy, rx, ry, p.stroke!));
			if (dashed) outline = flatten(`M${cx + rx},${cy}A${rx},${ry} 0 1 1 ${cx - rx},${cy}A${rx},${ry} 0 1 1 ${cx + rx},${cy}`);
			break;
		}
		case "line": {
			const pts = [num(a.x1), num(a.y1), num(a.x2), num(a.y2)];
			if (p.stroke && !dashed) b.ops.push((g) => g.line(pts[0], pts[1], pts[2], pts[3], p.stroke!));
			if (dashed) outline = [pts];
			break;
		}
		case "polyline":
		case "polygon": {
			const pts = (a.points ?? "").trim().split(/[\s,]+/).map(Number).filter((v) => isFinite(v));
			if (pts.length < 4) return;
			const closed = n.tag === "polygon";
			if (p.fill && closed) b.ops.push((g) => g.poly(pts, p.fill!, true));
			if (p.stroke && !dashed) b.ops.push((g) => g.poly(pts, p.stroke!, closed));
			if (dashed) outline = [closed ? pts.concat(pts[0], pts[1]) : pts];
			break;
		}
		case "path": {
			const d = a.d ?? "";
			if (!d) return;
			if (p.fill) b.ops.push((g) => g.path(d, p.fill!));
			if (p.stroke && !dashed) b.ops.push((g) => g.path(d, p.stroke!));
			if (dashed) outline = flatten(d);
			break;
		}
	}
	if (outline && p.stroke) {
		const stroke = p.stroke;
		for (const line of outline) for (const dash of dashes(line, s.dash)) b.ops.push((g) => g.poly(dash, stroke));
	}
}

function walk(b: Builder, n: Node, s: Style, palette: ColorValue[]) {
	for (const c of n.children) {
		if (typeof c === "string") continue;
		if (c.tag === "title" || c.tag === "desc" || c.tag === "defs" || c.tag === "style" || c.tag === "metadata") continue;
		const a = attrsOf(c);
		if (a.display === "none" || a.visibility === "hidden") continue;
		const t = inherit(s, a, palette);
		const moved = !!a.transform;
		if (moved) {
			b.ops.push((g) => g.save());
			transform(b, a.transform);
		}
		if (c.tag === "svg") nested(b, c, t, palette);
		else if (c.tag === "g" || c.tag === "a") walk(b, c, t, palette);
		else if (c.tag === "text") drawText(b, c, t, palette);
		else shape(b, c, t);
		if (moved) b.ops.push((g) => g.restore());
	}
}

/** An svg in an svg (math in a label, a root's sign): at its x and y, its viewBox scaled to its size, cut to it. */
function nested(b: Builder, n: Node, s: Style, palette: ColorValue[]) {
	const a = n.attrs;
	const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
	const vb = (a.viewBox ?? "").split(/[\s,]+/).map(Number);
	b.ops.push((g) => {
		g.save();
		g.translate(x, y);
		if (w > 0 && h > 0 && a.overflow !== "visible") g.clip(0, 0, w, h);
		if (vb.length === 4 && vb[2] > 0 && vb[3] > 0 && w > 0 && h > 0) {
			const slice = /slice/.test(a.preserveAspectRatio ?? "");
			const k = slice ? Math.max(w / vb[2], h / vb[3]) : Math.min(w / vb[2], h / vb[3]);
			g.scale(k, k);
			g.translate(-vb[0], -vb[1]);
		}
	});
	walk(b, n, s, palette);
	b.ops.push((g) => g.restore());
}

/** pele's SVG as a scene, in Swarm's colours and palette's series. */
export function svgScene(svg: string, palette: ColorValue[]): Scene & { title?: string } {
	const doc = parseXML(svg);
	const root = doc.children.find((c): c is Node => typeof c !== "string" && c.tag === "svg");
	if (!root) throw new Error("The diagram came out empty.");
	const a = attrsOf(root);
	const vb = (root.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
	const w = num(root.attrs.width, vb[2] || 300), h = num(root.attrs.height, vb[3] || 150);
	const b = new Builder(w, h);
	const base: Style = {
		fill: "text", stroke: null, strokeWidth: 1, dash: [], opacity: 1, fillOpacity: 1, strokeOpacity: 1,
		fontSize: 16, fontWeight: 400, anchor: "start", mono: false, font: "",
	};
	const s = inherit(base, a, palette);
	const scaled = vb.length === 4 && vb.every((v) => isFinite(v)) && (vb[2] !== w || vb[3] !== h || vb[0] || vb[1]);
	if (scaled) {
		b.ops.push((g) => {
			g.save();
			g.scale(w / vb[2], h / vb[3]);
			g.translate(-vb[0], -vb[1]);
		});
	}
	walk(b, root, s, palette);
	if (scaled) b.ops.push((g) => g.restore());
	const title = root.children.find((c): c is Node => typeof c !== "string" && c.tag === "title");
	return { ...b.scene(), title: title ? title.children.filter((c) => typeof c === "string").join("").trim() : undefined };
}
