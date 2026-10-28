import type { CanvasPaint, ColorValue } from "swarm";
import { type Flow, type FlowEdge, type FlowNode, parseFlowchart, parseState } from "./flow";
import { layout, type Placed } from "./layout";
import { Builder, type Scene } from "./scene";
import { parseSequence, drawSequence } from "./sequence";
import { type Chart } from "./chart";
import { textWidth, wrap } from "./text";

// ```mermaid: the kinds Swarm draws, each laid out here, as a scene.

export const FONT = 13;
const LINE = 17;
const LABEL = 12;
const MAX_TEXT = 220;
const MARGIN = 12;

export const NODE_FILL = "bg";
export const NODE_STROKE = "borderStrong";
export const EDGE_INK = "text3";
export const INK = "text";
export const INK2 = "text2";
export const SURFACE = "raised";

export type Diagram =
	| { kind: "flowchart" | "state"; flow: Flow }
	| { kind: "sequence"; seq: ReturnType<typeof parseSequence> }
	| { kind: "pie"; chart: Chart };

const KINDS = ["flowchart", "graph", "sequenceDiagram", "stateDiagram", "stateDiagram-v2", "pie"];

/** What a Mermaid diagram is, read. Throws saying what's wrong, or that Swarm doesn't draw its kind. */
export function parseMermaid(src: string): Diagram {
	// A front matter's config (---…---) and %%{init}%% directives don't change what's drawn here.
	let text = src.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, "").replace(/%%\{[\s\S]*?\}%%/g, "");
	const first = text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("%%")) ?? "";
	const kind = first.split(/\s+/)[0];
	if (/^(flowchart|graph)$/i.test(kind)) return { kind: "flowchart", flow: parseFlowchart(text.trim()) };
	if (/^stateDiagram(-v2)?$/.test(kind)) return { kind: "state", flow: parseState(text.trim()) };
	if (kind === "sequenceDiagram") return { kind: "sequence", seq: parseSequence(text.trim()) };
	if (kind === "pie") return { kind: "pie", chart: parsePie(text) };
	if (!kind) throw new Error("The diagram is empty.");
	throw new Error(`Swarm draws Mermaid's ${KINDS.filter((k) => k !== "graph" && k !== "stateDiagram").join(", ")}; not ${kind}.`);
}

function parsePie(src: string): Chart {
	const ls = src.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
	let title = /^pie\b.*?\btitle\s+(.+)$/.exec(ls[0])?.[1];
	const x: string[] = [];
	const data: number[] = [];
	for (const l of ls.slice(1)) {
		const t = /^title\s+(.+)$/.exec(l);
		if (t) {
			title = t[1];
			continue;
		}
		const m = /^"([^"]*)"\s*:\s*([0-9.eE+-]+)$/.exec(l);
		if (!m) {
			if (/^(showData|accTitle|accDescr)/.test(l)) continue;
			throw new Error(`A pie's slice is "Label" : value, not ${l}.`);
		}
		x.push(m[1]);
		data.push(+m[2]);
	}
	if (!x.length) throw new Error('A pie needs slices: "Label" : value.');
	if (data.some((v) => !isFinite(v) || v < 0)) throw new Error("A pie's values are numbers, none below zero.");
	if (!data.some((v) => v > 0)) throw new Error("A pie needs a value above zero.");
	return { type: "pie", title, x, series: [{ name: title ?? "Value", data }] };
}

/** A diagram's scene. */
export function drawMermaid(d: Diagram): Scene {
	if (d.kind === "sequence") return drawSequence(d.seq);
	if (d.kind === "pie") throw new Error("A pie is drawn as a chart.");
	return drawFlow(d.flow);
}

// ---- Flowcharts and state diagrams ----

interface Sized {
	node: FlowNode;
	lines: string[];
	tw: number;
	w: number;
	h: number;
}

function size(n: FlowNode): Sized {
	const lines = n.label ? wrap(n.label, FONT, MAX_TEXT) : [];
	const tw = Math.max(0, ...lines.map((l) => textWidth(l, FONT)));
	const th = lines.length * LINE;
	let w = tw + 28, h = Math.max(th + 18, 36);
	switch (n.shape) {
		case "start":
			w = h = 16;
			break;
		case "end":
			w = h = 20;
			break;
		case "fork":
			w = 64;
			h = 8;
			break;
		case "choice":
			w = h = 28;
			break;
		case "circle":
		case "doublecircle":
			w = h = Math.max(tw, th) + 28 + (n.shape === "doublecircle" ? 8 : 0);
			break;
		case "rhombus": {
			// A diamond holding the text's box: half its height over each side.
			const s = Math.max(tw + 24, th + 16);
			w = s + th + 16;
			h = Math.max(th + 16 + (tw + 24) * 0.5, 44);
			if (w < h) w = h;
			break;
		}
		case "hexagon":
			w = tw + 28 + h * 0.5;
			break;
		case "lean-r":
		case "lean-l":
		case "trap-t":
		case "trap-b":
			w = tw + 28 + h * 0.6;
			break;
		case "cylinder":
			h += 14;
			break;
		case "subroutine":
			w += 16;
			break;
		case "stadium":
			w += h * 0.4;
			break;
	}
	return { node: n, lines, tw, w, h };
}

export function drawFlow(f: Flow): Scene {
	const sized = new Map<string, Sized>();
	for (const n of f.nodes.values()) sized.set(n.id, size(n));
	const clusterOf = new Map<string, string>();
	for (const c of f.clusters) for (const m of c.nodes) if (f.nodes.has(m)) clusterOf.set(m, c.id);
	const visible = f.edges;
	const labels = visible.map((e) => (e.label ? wrap(e.label, LABEL, 160) : []));
	const L = layout(
		[...sized.values()].map((s) => ({ id: s.node.id, w: s.w, h: s.h, cluster: clusterOf.get(s.node.id) })),
		visible.map((e, i) => {
			const ls = labels[i];
			return ls.length ? { from: e.from, to: e.to, lw: Math.max(...ls.map((l) => textWidth(l, LABEL))) + 12, lh: ls.length * 15 + 6 } : { from: e.from, to: e.to };
		}),
		f.dir,
		{ node: 28, rank: f.clusters.length ? 56 : 44, cluster: 40 },
		new Map(f.clusters.map((c) => [c.id, c.parent])),
	);

	// Clusters' boxes, outermost first, around what's in them.
	const depth = (id?: string): number => (id ? 1 + depth(f.clusters.find((c) => c.id === id)?.parent) : 0);
	const boxes = new Map<string, Placed>();
	const boxOf = (id: string): Placed | undefined => {
		if (boxes.has(id)) return boxes.get(id);
		const c = f.clusters.find((c) => c.id === id);
		if (!c) return undefined;
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (const m of c.nodes) {
			const p = L.nodes.get(m) ?? boxOf(m);
			if (!p) continue;
			x0 = Math.min(x0, p.x - p.w / 2);
			y0 = Math.min(y0, p.y - p.h / 2);
			x1 = Math.max(x1, p.x + p.w / 2);
			y1 = Math.max(y1, p.y + p.h / 2);
		}
		if (!isFinite(x0)) return undefined;
		const titleW = c.title ? textWidth(c.title, LABEL, 600) + 24 : 0;
		const pad = 14, top = c.title ? 28 : 14;
		const w = Math.max(x1 - x0 + pad * 2, titleW);
		const box = { x: (x0 + x1) / 2, y: (y0 - top + y1 + pad) / 2, w, h: y1 - y0 + top + pad };
		boxes.set(id, box);
		return box;
	};
	for (const c of f.clusters) boxOf(c.id);

	// The whole drawing's extent, its margin round it.
	let x0 = 0, y0 = 0, x1 = L.width, y1 = L.height;
	for (const b of boxes.values()) {
		x0 = Math.min(x0, b.x - b.w / 2);
		y0 = Math.min(y0, b.y - b.h / 2);
		x1 = Math.max(x1, b.x + b.w / 2);
		y1 = Math.max(y1, b.y + b.h / 2);
	}
	const b = new Builder(x1 - x0 + MARGIN * 2, y1 - y0 + MARGIN * 2);
	const dx = MARGIN - x0, dy = MARGIN - y0;
	b.ops.push((g) => {
		g.save();
		g.translate(dx, dy);
	});

	for (const c of f.clusters.slice().sort((a, b) => depth(a.parent) - depth(b.parent))) {
		const box = boxes.get(c.id);
		if (!box) continue;
		const d = depth(c.parent);
		b.rect(box.x - box.w / 2, box.y - box.h / 2, box.w, box.h, { fill: d % 2 ? "raised" : "hover", stroke: "divider", lineWidth: 1 }, 10);
		if (c.title) b.text(box.x - box.w / 2 + 12, box.y - box.h / 2 + 9, c.title, INK2, { size: LABEL, weight: 600 });
	}

	visible.forEach((e, i) => {
		const r = L.edges[i];
		if (!r || e.line === "invisible") return;
		edge(b, e, r.points, sized.get(e.from)!, sized.get(e.to)!, L.nodes.get(e.from)!, L.nodes.get(e.to)!, labels[i], r.label);
	});

	for (const s of sized.values()) node(b, s, L.nodes.get(s.node.id)!);
	b.ops.push((g) => g.restore());
	return b.scene();
}

function node(b: Builder, s: Sized, p: Placed) {
	const { x, y, w, h } = p;
	const l = x - w / 2, t = y - h / 2;
	const paint: CanvasPaint = { fill: NODE_FILL, stroke: NODE_STROKE, lineWidth: 1.25 };
	switch (s.node.shape) {
		case "start":
			b.circle(x, y, w / 2, INK);
			break;
		case "end":
			b.circle(x, y, w / 2, { stroke: INK, lineWidth: 1.5 });
			b.circle(x, y, w / 2 - 4, INK);
			break;
		case "fork":
			b.rect(l, t, w, h, INK, 3);
			break;
		case "choice":
		case "rhombus":
			b.poly([x, t, l + w, y, x, t + h, l, y], paint, true);
			break;
		case "circle":
			b.circle(x, y, w / 2, paint);
			break;
		case "doublecircle":
			b.circle(x, y, w / 2, paint);
			b.circle(x, y, w / 2 - 4, { stroke: NODE_STROKE, lineWidth: 1.25 });
			break;
		case "round":
			b.rect(l, t, w, h, paint, 12);
			break;
		case "stadium":
			b.rect(l, t, w, h, paint, h / 2);
			break;
		case "subroutine":
			b.rect(l, t, w, h, paint, 4);
			b.line(l + 8, t, l + 8, t + h, { stroke: NODE_STROKE, lineWidth: 1.25 });
			b.line(l + w - 8, t, l + w - 8, t + h, { stroke: NODE_STROKE, lineWidth: 1.25 });
			break;
		case "cylinder": {
			const ry = 6;
			b.path(`M${l} ${t + ry}A${w / 2} ${ry} 0 0 1 ${l + w} ${t + ry}V${t + h - ry}A${w / 2} ${ry} 0 0 1 ${l} ${t + h - ry}Z`, paint);
			b.path(`M${l} ${t + ry}A${w / 2} ${ry} 0 0 0 ${l + w} ${t + ry}`, { stroke: NODE_STROKE, lineWidth: 1.25 });
			break;
		}
		case "hexagon": {
			const k = h / 4;
			b.poly([l + k, t, l + w - k, t, l + w, y, l + w - k, t + h, l + k, t + h, l, y], paint, true);
			break;
		}
		case "lean-r":
		case "lean-l": {
			const k = h * 0.3 * (s.node.shape === "lean-r" ? 1 : -1);
			b.poly([l + Math.max(k, 0), t, l + w + Math.min(k, 0), t, l + w - Math.max(k, 0), t + h, l - Math.min(k, 0), t + h], paint, true);
			break;
		}
		case "trap-t":
		case "trap-b": {
			const k = h * 0.3;
			const pts = s.node.shape === "trap-b" ? [l + k, t, l + w - k, t, l + w, t + h, l, t + h] : [l, t, l + w, t, l + w - k, t + h, l + k, t + h];
			b.poly(pts, paint, true);
			break;
		}
		case "asym": {
			const k = h / 3;
			b.poly([l, t, l + w, t, l + w, t + h, l, t + h, l + k, y], paint, true);
			break;
		}
		default:
			b.rect(l, t, w, h, paint, 6);
	}
	if (!s.lines.length) return;
	const shift = s.node.shape === "asym" ? h / 6 : s.node.shape === "cylinder" ? 4 : 0;
	const ty = y + shift / 2 - (s.lines.length * LINE) / 2 + LINE / 2;
	s.lines.forEach((line, i) => b.text(x + (s.node.shape === "asym" ? shift : 0), ty + i * LINE, line, INK, { size: FONT, align: "center", baseline: "middle" }));
}

/** Where a line from p's centre toward q leaves p's shape. */
function boundary(s: Sized, p: Placed, q: { x: number; y: number }) {
	const dx = q.x - p.x, dy = q.y - p.y;
	if (!dx && !dy) return { x: p.x, y: p.y };
	const hw = p.w / 2, hh = p.h / 2;
	let k: number;
	switch (s.node.shape) {
		case "circle":
		case "doublecircle":
		case "start":
		case "end":
			k = hw / Math.hypot(dx, dy);
			break;
		case "rhombus":
		case "choice":
			k = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
			break;
		default:
			k = Math.min(Math.abs(dx) ? hw / Math.abs(dx) : Infinity, Math.abs(dy) ? hh / Math.abs(dy) : Infinity);
	}
	return { x: p.x + dx * k, y: p.y + dy * k };
}

/** Points along a Catmull-Rom curve through pts. */
export function smooth(pts: { x: number; y: number }[], steps = 10): number[] {
	if (pts.length < 3) return pts.flatMap((p) => [p.x, p.y]);
	const out: number[] = [pts[0].x, pts[0].y];
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
		for (let s = 1; s <= steps; s++) {
			const t = s / steps, t2 = t * t, t3 = t2 * t;
			out.push(
				0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
				0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
			);
		}
	}
	return out;
}

/** A polyline drawn in dashes of on, gaps of off. */
export function dashed(b: Builder, pts: number[], paint: CanvasPaint, on = 4, off = 4) {
	let draw = true, left = on;
	for (let i = 2; i < pts.length; i += 2) {
		let x = pts[i - 2], y = pts[i - 1];
		const tx = pts[i], ty = pts[i + 1];
		let seg = Math.hypot(tx - x, ty - y);
		while (seg > 0) {
			const step = Math.min(left, seg);
			const nx = x + ((tx - x) * step) / seg, ny = y + ((ty - y) * step) / seg;
			if (draw) b.line(x, y, nx, ny, paint);
			x = nx;
			y = ny;
			seg -= step;
			left -= step;
			if (left <= 0) {
				draw = !draw;
				left = draw ? on : off;
			}
		}
	}
}

/** An arrowhead (or a cross, or a circle) at (x, y), pointing along (ux, uy). */
export function mark(b: Builder, kind: FlowEdge["head"], x: number, y: number, ux: number, uy: number, paint: ColorValue) {
	const px = -uy, py = ux;
	if (kind === "arrow") {
		const l = 9, w = 4.5;
		b.poly([x, y, x - ux * l + px * w, y - uy * l + py * w, x - ux * l - px * w, y - uy * l - py * w], paint, true);
	} else if (kind === "cross") {
		const c = { x: x - ux * 5, y: y - uy * 5 }, s = 4;
		b.line(c.x - s, c.y - s, c.x + s, c.y + s, { stroke: paint, lineWidth: 1.75 });
		b.line(c.x - s, c.y + s, c.x + s, c.y - s, { stroke: paint, lineWidth: 1.75 });
	} else if (kind === "circle") {
		b.circle(x - ux * 4, y - uy * 4, 4, { fill: SURFACE, stroke: paint, lineWidth: 1.5 });
	}
}

function edge(b: Builder, e: FlowEdge, mid: { x: number; y: number }[], sa: Sized, sb: Sized, pa: Placed, pb: Placed, label: string[], at?: { x: number; y: number }) {
	let pts: { x: number; y: number }[];
	if (e.from === e.to) {
		// A loop out of the node's right side and back.
		const r = Math.min(pa.h / 2, 18);
		const x = pa.x + pa.w / 2, y = pa.y;
		pts = [{ x, y: y - r * 0.6 }, { x: x + r * 1.6, y: y - r }, { x: x + r * 1.6, y: y + r }, { x, y: y + r * 0.6 }];
		at = at ?? { x: x + r * 1.6 + 6 + textWidth(label[0] ?? "", LABEL) / 2, y };
	} else {
		pts = mid.slice();
		pts[0] = boundary(sa, pa, pts[1] ?? pb);
		pts[pts.length - 1] = boundary(sb, pb, pts[pts.length - 2] ?? pa);
	}
	const headGap = e.head === "none" ? 0 : 2;
	const tailGap = e.tail === "none" ? 0 : 2;
	let line = smooth(pts);
	const n = line.length;
	const unit = (ax: number, ay: number, bx: number, by: number) => {
		const d = Math.hypot(bx - ax, by - ay) || 1;
		return [(bx - ax) / d, (by - ay) / d];
	};
	const [hx, hy] = unit(line[n - 4], line[n - 3], line[n - 2], line[n - 1]);
	const [tx, ty] = unit(line[2], line[3], line[0], line[1]);
	// The line stops under its marks.
	if (headGap) {
		line[n - 2] -= hx * (e.head === "arrow" ? 8 : 6);
		line[n - 1] -= hy * (e.head === "arrow" ? 8 : 6);
	}
	if (tailGap) {
		line[0] -= tx * (e.tail === "arrow" ? 8 : 6);
		line[1] -= ty * (e.tail === "arrow" ? 8 : 6);
	}
	const paint: CanvasPaint = { stroke: EDGE_INK, lineWidth: e.line === "thick" ? 2.75 : 1.5 };
	if (e.line === "dotted") dashed(b, line, paint, 3, 3);
	else b.poly(line, paint);
	const end = pts[pts.length - 1], start = pts[0];
	mark(b, e.head, end.x - hx * headGap, end.y - hy * headGap, hx, hy, EDGE_INK);
	mark(b, e.tail, start.x - tx * tailGap, start.y - ty * tailGap, tx, ty, EDGE_INK);
	if (label.length) {
		const c = at ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
		const w = Math.max(...label.map((l) => textWidth(l, LABEL))) + 10, h = label.length * 15 + 4;
		b.rect(c.x - w / 2, c.y - h / 2, w, h, SURFACE, 4);
		label.forEach((l, i) => b.text(c.x, c.y - h / 2 + 2 + 7.5 + i * 15, l, INK2, { size: LABEL, align: "center", baseline: "middle" }));
	}
}
