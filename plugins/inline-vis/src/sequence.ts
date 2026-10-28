import { cleanLabel } from "./flow";
import { Builder, type Scene } from "./scene";
import { textWidth, wrap } from "./text";
import { dashed, mark, NODE_FILL, NODE_STROKE, INK, INK2, SURFACE } from "./diagram";

// Mermaid's sequenceDiagram.

export interface Participant {
	id: string;
	label: string;
	actor: boolean;
}

export type Event =
	| { kind: "message"; from: string; to: string; text: string; dotted: boolean; head: "arrow" | "open" | "cross" | "async"; activate?: "+" | "-"; n?: number }
	| { kind: "note"; side: "left" | "right" | "over"; who: string[]; text: string }
	| { kind: "open"; block: string; text: string }
	| { kind: "else"; text: string }
	| { kind: "close" }
	| { kind: "activate" | "deactivate"; who: string };

export interface Sequence {
	title?: string;
	participants: Participant[];
	events: Event[];
}

const ARROW = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]+?)\s*:\s*(.*)$/;
const ARROW_BARE = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]+?)\s*$/;
const BLOCKS = ["loop", "alt", "opt", "par", "critical", "break", "rect"];

export function parseSequence(src: string): Sequence {
	const ls = src.split("\n").map((l) => l.replace(/%%.*$/, "").trim()).filter(Boolean);
	if (ls[0] !== "sequenceDiagram") throw new Error("A sequence diagram starts with sequenceDiagram.");
	const seq: Sequence = { participants: [], events: [] };
	const byId = new Map<string, Participant>();
	const who = (id: string, label?: string, actor = false) => {
		id = id.trim();
		let p = byId.get(id);
		if (!p) {
			p = { id, label: cleanLabel(label ?? id), actor };
			byId.set(id, p);
			seq.participants.push(p);
		} else if (label !== undefined) {
			p.label = cleanLabel(label);
			p.actor ||= actor;
		}
		return id;
	};
	let number = 0;
	let open = 0;
	const boxes: number[] = [];
	for (const l of ls.slice(1)) {
		let m: RegExpExecArray | null;
		if ((m = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(l)) || (m = /^create\s+(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(l))) {
			who(m[2], m[3] ?? m[2], m[1] === "actor");
			continue;
		}
		if ((m = /^title\s*:?\s*(.+)$/.exec(l))) {
			seq.title = cleanLabel(m[1]);
			continue;
		}
		if (/^autonumber\b/.test(l)) {
			number = 1;
			continue;
		}
		if (/^box\b/.test(l)) {
			boxes.push(open);
			continue;
		}
		if ((m = /^(activate|deactivate)\s+(.+)$/.exec(l))) {
			seq.events.push({ kind: m[1] as "activate" | "deactivate", who: who(m[2]) });
			continue;
		}
		if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(l))) {
			const side = m[1].toLowerCase().startsWith("left") ? "left" : m[1].toLowerCase().startsWith("right") ? "right" : "over";
			seq.events.push({ kind: "note", side, who: m[2].split(",").map((s) => who(s)), text: cleanLabel(m[3]) });
			continue;
		}
		if ((m = /^(\w+)\b\s*(.*)$/.exec(l)) && BLOCKS.includes(m[1])) {
			open++;
			seq.events.push({ kind: "open", block: m[1], text: cleanLabel(m[2]) });
			continue;
		}
		if ((m = /^(else|and|option)\b\s*(.*)$/.exec(l))) {
			seq.events.push({ kind: "else", text: cleanLabel(m[2]) });
			continue;
		}
		if (l === "end") {
			if (boxes.length && boxes[boxes.length - 1] === open) boxes.pop();
			else if (open > 0) {
				open--;
				seq.events.push({ kind: "close" });
			}
			continue;
		}
		if (/^(destroy|links?|properties|details)\b/.test(l)) continue;
		m = ARROW.exec(l) ?? ARROW_BARE.exec(l);
		if (m) {
			const a = m[2];
			const from = who(m[1].replace(/[+-]$/, ""));
			const to = who(m[4]);
			seq.events.push({
				kind: "message",
				from,
				to,
				text: cleanLabel(m[5] ?? ""),
				dotted: a.startsWith("--") || a.startsWith("<<--"),
				head: a.endsWith(">>") ? "arrow" : a.endsWith("x") ? "cross" : a.endsWith(")") ? "async" : "open",
				activate: (m[3] || undefined) as "+" | "-" | undefined,
				n: number ? number++ : undefined,
			});
			continue;
		}
		throw new Error(`Can't read "${l}".`);
	}
	while (open-- > 0) seq.events.push({ kind: "close" });
	if (!seq.participants.length) throw new Error("The sequence diagram has no participants.");
	return seq;
}

const FONT = 13;
const SMALL = 12;
const BOX_H = 36;
const PAD = 14;

export function drawSequence(seq: Sequence): Scene {
	const ps = seq.participants;
	const idx = new Map(ps.map((p, i) => [p.id, i]));
	const boxW = ps.map((p) => Math.max(88, Math.max(...wrap(p.label, FONT, 180).map((l) => textWidth(l, FONT, 500))) + 28));
	// Gaps between neighbours' centres, wide enough for what passes between them.
	const gap = ps.map((_, i) => (i ? (boxW[i - 1] + boxW[i]) / 2 + 28 : 0));
	let leftNeed = 0, rightNeed = 0;
	const msgLines = (t: string) => (t ? wrap(t, SMALL, 260) : []);
	for (const e of seq.events) {
		if (e.kind === "message") {
			const a = idx.get(e.from)!, b = idx.get(e.to)!;
			const lines = msgLines((e.n ? e.n + ". " : "") + e.text);
			const w = Math.max(0, ...lines.map((l) => textWidth(l, SMALL))) + 24;
			if (a === b) {
				if (a + 1 < ps.length) gap[a + 1] = Math.max(gap[a + 1], w + 40);
				else rightNeed = Math.max(rightNeed, w + 40);
			} else {
				const lo = Math.min(a, b), hi = Math.max(a, b);
				const have = gap.slice(lo + 1, hi + 1).reduce((s, g) => s + g, 0);
				if (have < w) gap[hi] += w - have;
			}
		} else if (e.kind === "note") {
			const w = noteWidth(e);
			const i = idx.get(e.who[0])!;
			if (e.side === "left") {
				if (i > 0) gap[i] = Math.max(gap[i], w + 16 + boxW[i - 1] / 2);
				else leftNeed = Math.max(leftNeed, w + 10 - boxW[0] / 2);
			} else if (e.side === "right") {
				if (i + 1 < ps.length) gap[i + 1] = Math.max(gap[i + 1], w + 16 + boxW[i + 1] / 2);
				else rightNeed = Math.max(rightNeed, w + 10 - boxW[i] / 2);
			}
		}
	}
	const cx: number[] = [];
	let x = PAD + Math.max(0, leftNeed) + boxW[0] / 2;
	ps.forEach((_, i) => {
		x += gap[i];
		cx.push(x);
	});
	let width = cx[cx.length - 1] + boxW[boxW.length - 1] / 2 + Math.max(0, rightNeed) + PAD;

	// The rows, top to bottom; what each draws comes after, once the height is known.
	const draws: ((b: Builder) => void)[] = [];
	let y = PAD + (seq.title ? 26 : 0) + BOX_H + 18;
	const active = ps.map(() => [] as number[]);
	const bars: { i: number; y0: number; y1: number; depth: number }[] = [];
	const activate = (i: number, at: number) => active[i].push(at);
	const deactivate = (i: number, at: number) => {
		const y0 = active[i].pop();
		if (y0 !== undefined) bars.push({ i, y0, y1: at, depth: active[i].length });
	};
	const offset = (i: number) => (active[i].length ? 5 * active[i].length : 0);
	interface Frame { block: string; text: string; y0: number; lo: number; hi: number; elses: { y: number; text: string }[] }
	const frames: Frame[] = [];
	const done: (Frame & { y1: number; depth: number })[] = [];
	const touch = (...is: number[]) => {
		for (const f of frames) for (const i of is) {
			f.lo = Math.min(f.lo, i);
			f.hi = Math.max(f.hi, i);
		}
	};
	for (const e of seq.events) {
		switch (e.kind) {
			case "message": {
				const a = idx.get(e.from)!, b = idx.get(e.to)!;
				touch(a, b);
				const lines = msgLines((e.n ? e.n + ". " : "") + e.text);
				const top = y;
				y += lines.length * 15 + 6;
				if (a === b) {
					const ly = y;
					const xo = cx[a] + offset(a);
					draws.push((bd) => {
						lines.forEach((l, k) => bd.text(xo + 12, top + k * 15, l, INK, { size: SMALL }));
						const pts = [xo, ly, xo + 34, ly, xo + 34, ly + 22, xo + 2, ly + 22];
						if (e.dotted) dashed(bd, pts, { stroke: INK, lineWidth: 1.25 }, 4, 3);
						else bd.poly(pts, { stroke: INK, lineWidth: 1.25 });
						head(bd, e.head, xo + 2, ly + 22, -1, 0);
					});
					y += 30;
				} else {
					const ly = y;
					if (e.activate === "+") activate(b, ly);
					const x1 = cx[a] + (b > a ? offset(a) : -offset(a));
					const x2 = cx[b] + (b > a ? -offset(b) : offset(b));
					draws.push((bd) => {
						const mid = (cx[a] + cx[b]) / 2;
						lines.forEach((l, k) => bd.text(mid, top + k * 15, l, INK, { size: SMALL, align: "center" }));
						const dir = Math.sign(x2 - x1);
						const end = x2 - dir * (e.head === "open" ? 0 : 1);
						if (e.dotted) dashed(bd, [x1, ly, end, ly], { stroke: INK, lineWidth: 1.25 }, 4, 3);
						else bd.line(x1, ly, end, ly, { stroke: INK, lineWidth: 1.25 });
						head(bd, e.head, x2, ly, dir, 0);
					});
					if (e.activate === "-") deactivate(a, ly);
					y += 14;
				}
				break;
			}
			case "note": {
				const is = e.who.map((w) => idx.get(w)!);
				touch(...is);
				const lines = wrap(e.text, SMALL, 220);
				const h = lines.length * 15 + 12;
				const w = noteWidth(e);
				let left: number, nw = w;
				const i = is[0];
				if (e.side === "left") left = cx[i] - offset(i) - 10 - w;
				else if (e.side === "right") left = cx[i] + offset(i) + 10;
				else {
					const lo = Math.min(...is.map((k) => cx[k])), hi = Math.max(...is.map((k) => cx[k]));
					nw = Math.max(w, hi - lo + 40);
					left = (lo + hi) / 2 - nw / 2;
				}
				const top = y;
				draws.push((bd) => {
					bd.rect(left, top, nw, h, { fill: "amberSoft", stroke: "amber", lineWidth: 1 }, 4);
					lines.forEach((l, k) => bd.text(left + nw / 2, top + 6 + 7.5 + k * 15, l, INK, { size: SMALL, align: "center", baseline: "middle" }));
				});
				width = Math.max(width, left + nw + PAD);
				y += h + 12;
				break;
			}
			case "open":
				y += 6;
				frames.push({ block: e.block, text: e.text, y0: y, lo: Infinity, hi: -Infinity, elses: [] });
				y += 30;
				break;
			case "else": {
				const f = frames[frames.length - 1];
				if (f) {
					y += 4;
					f.elses.push({ y, text: e.text });
					y += 26;
				}
				break;
			}
			case "close": {
				const f = frames.pop();
				if (f) {
					y += 2;
					done.push({ ...f, y1: y, depth: frames.length });
					y += 12;
				}
				break;
			}
			case "activate":
				activate(idx.get(e.who)!, y - 8);
				break;
			case "deactivate":
				deactivate(idx.get(e.who)!, y - 8);
				break;
		}
	}
	y += 8;
	ps.forEach((_, i) => {
		while (active[i].length) deactivate(i, y);
	});
	const bottom = y;
	const height = bottom + BOX_H + PAD;

	const bd = new Builder(width, height);
	if (seq.title) bd.text(width / 2, PAD, seq.title, INK, { size: 14, weight: 600, align: "center" });
	const boxTop = PAD + (seq.title ? 26 : 0);
	// Frames behind everything, outermost first.
	for (const f of done.sort((a, b) => a.depth - b.depth)) {
		const lo = isFinite(f.lo) ? f.lo : 0, hi = isFinite(f.hi) ? f.hi : ps.length - 1;
		const inset = f.depth * 8;
		const fx = cx[lo] - boxW[lo] / 2 + 4 + inset, fw = cx[hi] + boxW[hi] / 2 - 4 - inset - fx;
		if (f.block === "rect") {
			bd.rect(fx, f.y0, fw, f.y1 - f.y0, { fill: "accentSoft" }, 6);
			continue;
		}
		bd.rect(fx, f.y0, fw, f.y1 - f.y0, { stroke: NODE_STROKE, lineWidth: 1 }, 6);
		const tag = f.block;
		const tw = textWidth(tag, SMALL - 1, 600) + 16;
		bd.path(`M${fx + 6} ${f.y0}H${fx + tw}V${f.y0 + 14}L${fx + tw - 6} ${f.y0 + 20}H${fx}V${f.y0 + 6}Q${fx} ${f.y0} ${fx + 6} ${f.y0}Z`, { fill: "selected" });
		bd.text(fx + 8, f.y0 + 10, tag, INK2, { size: SMALL - 1, weight: 600, baseline: "middle" });
		if (f.text) bd.text(fx + tw + 10, f.y0 + 10, `[${f.text}]`, INK2, { size: SMALL, baseline: "middle" });
		for (const e of f.elses) {
			dashed(bd, [fx, e.y, fx + fw, e.y], { stroke: NODE_STROKE, lineWidth: 1 }, 4, 4);
			if (e.text) bd.text(fx + 10, e.y + 12, `[${e.text}]`, INK2, { size: SMALL, baseline: "middle" });
		}
	}
	// Lifelines, and the activations on them.
	ps.forEach((_, i) => dashed(bd, [cx[i], boxTop + BOX_H, cx[i], bottom], { stroke: NODE_STROKE, lineWidth: 1 }, 5, 4));
	for (const a of bars.sort((p, q) => p.depth - q.depth)) {
		bd.rect(cx[a.i] - 5 + a.depth * 5, a.y0, 10, Math.max(8, a.y1 - a.y0), { fill: "selected", stroke: NODE_STROKE, lineWidth: 1 }, 2);
	}
	for (const d of draws) d(bd);
	// The participants, at the top and again at the foot.
	ps.forEach((p, i) => {
		for (const top of [boxTop, bottom]) {
			const l = cx[i] - boxW[i] / 2;
			if (p.actor) {
				const fy = top + 2;
				bd.circle(cx[i], fy + 5, 5, { stroke: INK, lineWidth: 1.25 });
				bd.line(cx[i], fy + 10, cx[i], fy + 20, { stroke: INK, lineWidth: 1.25 });
				bd.line(cx[i] - 7, fy + 14, cx[i] + 7, fy + 14, { stroke: INK, lineWidth: 1.25 });
				bd.line(cx[i], fy + 20, cx[i] - 6, fy + 27, { stroke: INK, lineWidth: 1.25 });
				bd.line(cx[i], fy + 20, cx[i] + 6, fy + 27, { stroke: INK, lineWidth: 1.25 });
				bd.rect(l, top + 30, boxW[i], 16, SURFACE);
				bd.text(cx[i], top + 38, p.label, INK, { size: SMALL, weight: 500, align: "center", baseline: "middle" });
			} else {
				bd.rect(l, top, boxW[i], BOX_H, { fill: NODE_FILL, stroke: NODE_STROKE, lineWidth: 1.25 }, 6);
				const lines = wrap(p.label, FONT, 180);
				lines.forEach((ln, k) => bd.text(cx[i], top + BOX_H / 2 + (k - (lines.length - 1) / 2) * 15, ln, INK, { size: FONT, weight: 500, align: "center", baseline: "middle" }));
			}
		}
	});
	return bd.scene();
}

function noteWidth(e: { text: string }) {
	return Math.max(60, ...wrap(e.text, SMALL, 220).map((l) => textWidth(l, SMALL))) + 20;
}

function head(b: Builder, kind: "arrow" | "open" | "cross" | "async", x: number, y: number, ux: number, uy: number) {
	if (kind === "arrow") mark(b, "arrow", x, y, ux, uy, INK);
	else if (kind === "cross") mark(b, "cross", x, y, ux, uy, INK);
	else if (kind === "async") {
		b.line(x, y, x - ux * 8 - uy * 5, y - uy * 8 + ux * 5, { stroke: INK, lineWidth: 1.25 });
	}
}

