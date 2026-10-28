import type { ColorValue } from "swarm";
import { barPath, Builder, type Scene } from "./scene";
import { clip, textWidth } from "./text";

// ```chart: a chart from a JSON spec, laid out for a canvas.
//
// { "type": "bar", "title": "Runs a day", "x": ["Mon", "Tue"],
//   "series": [{ "name": "Passed", "data": [12, 9] }, { "name": "Failed", "data": [1, 3] }],
//   "stacked": true, "unit": "runs" }

export type ChartType = "bar" | "line" | "area" | "scatter" | "pie" | "donut";

export interface Series {
	name: string;
	/** A value per x; null for none. A scatter's are [x, y] pairs. */
	data: (number | null)[] | [number, number][];
}

export interface Chart {
	type: ChartType;
	title?: string;
	subtitle?: string;
	x: (string | number)[];
	series: Series[];
	stacked?: boolean;
	horizontal?: boolean;
	unit?: string;
	xLabel?: string;
	yLabel?: string;
	min?: number;
	max?: number;
	height?: number;
}

// The categorical palette: dataviz's reference eight, in their fixed order,
// with the dark theme's own steps. Validated against Swarm's raised surfaces
// (#fdfdfc light, #1e1e1d dark): adjacent CVD ΔE 9.1 and 8.4; three light
// slots under 3:1, which the tooltips and the table view relieve.
export const LIGHT: ColorValue[] = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const DARK: ColorValue[] = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const MAX_SERIES = 8;

const TYPES: ChartType[] = ["bar", "line", "area", "scatter", "pie", "donut"];

const W = 640;
const SURFACE = "raised";
const INK = "text";
const INK2 = "text2";
const INK3 = "text3";
const GRID = "divider";
const AXIS = "borderStrong";

/** Reads a chart's spec: JSON, with comments and trailing commas forgiven. Throws saying what's wrong. */
export function parseChart(code: string): Chart {
	let raw: any;
	try {
		raw = JSON.parse(looseJSON(code));
	} catch (e) {
		throw new Error("The chart isn't JSON: " + (e instanceof Error ? e.message : String(e)));
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A chart is a JSON object, with a type and its data.");
	const type = String(raw.type ?? (raw.series || raw.data ? "bar" : "")).toLowerCase() as ChartType;
	if (!TYPES.includes(type)) throw new Error(`"type" is one of ${TYPES.join(", ")}${raw.type ? `, not "${raw.type}"` : ""}.`);
	const c: Chart = {
		type,
		title: str(raw.title),
		subtitle: str(raw.subtitle ?? raw.description),
		x: [],
		series: [],
		stacked: !!raw.stacked,
		horizontal: !!raw.horizontal,
		unit: str(raw.unit),
		xLabel: str(raw.xLabel),
		yLabel: str(raw.yLabel),
		min: num(raw.min),
		max: num(raw.max),
		height: num(raw.height),
	};
	const x = raw.x ?? raw.labels ?? raw.categories;
	if (Array.isArray(x)) c.x = x.map((v: unknown) => (typeof v === "number" ? v : String(v)));

	if (type === "pie" || type === "donut") {
		// [{label, value}], or labels and one series.
		if (Array.isArray(raw.data) && raw.data.length && typeof raw.data[0] === "object" && raw.data[0] !== null && !Array.isArray(raw.data[0])) {
			c.x = raw.data.map((d: any) => String(d.label ?? d.name ?? ""));
			c.series = [{ name: c.title ?? "Value", data: raw.data.map((d: any) => num(d.value) ?? null) }];
		} else {
			c.series = seriesOf(raw).slice(0, 1);
		}
		if (!c.series.length) throw new Error(`A ${type} chart needs "data": [{ "label": …, "value": … }].`);
		const vals = c.series[0].data as (number | null)[];
		if (vals.some((v) => v != null && v < 0)) throw new Error(`A ${type} chart's values can't be negative.`);
		if (!vals.some((v) => v != null && v > 0)) throw new Error(`A ${type} chart needs a value above zero.`);
		return c;
	}

	c.series = seriesOf(raw);
	if (!c.series.length) throw new Error(`A chart needs "series": [{ "name": …, "data": [ … ] }].`);
	if (c.series.length > MAX_SERIES) throw new Error(`A chart shows ${MAX_SERIES} series at most; this one has ${c.series.length}. Fold the rest into "Other", or make two charts.`);
	if (type === "scatter") {
		for (const s of c.series) {
			if (!(s.data as unknown[]).every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && isFinite(v)))) {
				throw new Error(`A scatter's "data" is [x, y] pairs: ${s.name} has something else.`);
			}
		}
	} else {
		const n = Math.max(...c.series.map((s) => s.data.length));
		if (!c.x.length) c.x = Array.from({ length: n }, (_, i) => i + 1);
		for (const s of c.series) {
			if (!(s.data as unknown[]).every((v) => v === null || (typeof v === "number" && isFinite(v)))) {
				throw new Error(`"data" holds numbers (or null for none): ${s.name} has something else.`);
			}
		}
	}
	return c;
}

function seriesOf(raw: any): Series[] {
	if (Array.isArray(raw.series)) {
		return raw.series.map((s: any, i: number) => ({
			name: str(s?.name ?? s?.label) ?? `Series ${i + 1}`,
			data: Array.isArray(s?.data) ? s.data.map(cell) : Array.isArray(s?.values) ? s.values.map(cell) : [],
		}));
	}
	if (Array.isArray(raw.data)) return [{ name: str(raw.name ?? raw.yLabel) ?? str(raw.title) ?? "Value", data: raw.data.map(cell) }];
	return [];
}

function cell(v: unknown): any {
	if (Array.isArray(v)) return v.map((n) => (typeof n === "string" && n.trim() !== "" && isFinite(+n) ? +n : n));
	if (v === null || v === undefined) return null;
	if (typeof v === "string" && v.trim() !== "" && isFinite(+v)) return +v;
	return v;
}

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
	return typeof v === "number" && isFinite(v) ? v : undefined;
}

/** JSON with // and /* comments and trailing commas taken out, outside strings. */
export function looseJSON(s: string): string {
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === '"') {
			let j = i + 1;
			while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
			out += s.slice(i, j + 1);
			i = j;
		} else if (ch === "/" && s[i + 1] === "/") {
			while (i < s.length && s[i] !== "\n") i++;
			out += "\n";
		} else if (ch === "/" && s[i + 1] === "*") {
			const end = s.indexOf("*/", i + 2);
			i = end < 0 ? s.length : end + 1;
		} else {
			out += ch;
		}
	}
	return out.replace(/,(\s*[\]}])/g, "$1");
}

// ---- Numbers ----

/** A number as a chart writes it: 1.2k, 3.4M, at most two decimals. */
export function fmt(v: number): string {
	const a = Math.abs(v);
	const trim = (n: number, d: number) => {
		const t = n.toFixed(d);
		return t.includes(".") ? t.replace(/\.?0+$/, "") : t;
	};
	if (a >= 1e9) return trim(v / 1e9, 1) + "B";
	if (a >= 1e6) return trim(v / 1e6, 1) + "M";
	if (a >= 1e4) return trim(v / 1e3, 1) + "k";
	if (a >= 100 || Number.isInteger(v)) return trim(v, 0);
	if (a >= 1) return trim(v, 1);
	return trim(v, 2);
}

/** The unit as a tick shows it: a short one on each tick, a long one ("k lines") only in values. */
function tickUnit(unit?: string): string | undefined {
	return unit && (unit === "%" || unit === "$" || (unit.length <= 4 && !unit.includes(" "))) ? unit : undefined;
}

function withUnit(v: number, unit?: string): string {
	if (!unit) return fmt(v);
	if (unit === "%") return fmt(v) + "%";
	if (unit === "$") return "$" + fmt(v);
	return fmt(v) + " " + unit;
}

/** Round ticks covering lo to hi, about count of them. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
	if (lo === hi) {
		const d = lo === 0 ? 1 : Math.abs(lo) * 0.5;
		lo -= d;
		hi += d;
	}
	const raw = (hi - lo) / count;
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
	const start = Math.floor(lo / step + 1e-9) * step;
	const end = Math.ceil(hi / step - 1e-9) * step;
	const out: number[] = [];
	const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + 1);
	for (let i = 0; start + i * step <= end + step / 2; i++) out.push(+(start + i * step).toFixed(decimals));
	return out;
}

// ---- Layout ----

/** The chart drawn, in palette's colors. */
export function drawChart(c: Chart, palette: ColorValue[]): Scene {
	if (c.type === "pie" || c.type === "donut") return drawPie(c, palette);
	const H = clamp(c.height ?? (c.horizontal ? Math.max(200, c.x.length * 30 + 90) : 300), 160, 720);
	const b = new Builder(W, H);
	let top = 14;
	if (c.title) {
		b.text(16, top, clip(c.title, 14, W - 32, 600), INK, { size: 14, weight: 600 });
		top += 20;
	}
	if (c.subtitle) {
		b.text(16, top, clip(c.subtitle, 12, W - 32), INK2, { size: 12 });
		top += 17;
	}
	if (c.series.length > 1 || (c.type === "scatter" && c.series.length > 0 && c.series[0].name !== "Value")) {
		top += 4;
		top = legend(b, c.series.map((s) => s.name), palette, 16, top, W - 32) + 4;
	}
	top += 8;
	const plot = { x: 16, y: top, w: W - 32, h: H - top - 14 };
	if (c.type === "scatter") scatter(b, c, palette, plot);
	else if (c.type === "bar" && c.horizontal) hbars(b, c, palette, plot);
	else cartesian(b, c, palette, plot);
	return b.scene();
}

function clamp(v: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, v));
}

/** A row of swatches and names, wrapping; returns the y under it. */
function legend(b: Builder, names: string[], palette: ColorValue[], x0: number, y: number, w: number): number {
	let x = x0;
	for (let i = 0; i < names.length; i++) {
		const name = clip(names[i], 12, 180);
		const iw = 10 + 6 + textWidth(name, 12) + 16;
		if (x > x0 && x + iw > x0 + w) {
			x = x0;
			y += 20;
		}
		b.rect(x, y + 3, 10, 10, palette[i % palette.length], 3);
		b.text(x + 16, y + 8, name, INK2, { size: 12, baseline: "middle" });
		x += iw;
	}
	return y + 18;
}

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

function values(c: Chart): (number | null)[][] {
	return c.series.map((s) => s.data as (number | null)[]);
}

/** The extent of the value axis: with zero for bars and areas, stacked sums when stacked. */
function extent(c: Chart, zero: boolean): [number, number] {
	const vs = values(c);
	let lo = Infinity, hi = -Infinity;
	if (c.stacked) {
		for (let i = 0; i < c.x.length; i++) {
			let pos = 0, neg = 0;
			for (const s of vs) {
				const v = s[i] ?? 0;
				if (v >= 0) pos += v;
				else neg += v;
			}
			hi = Math.max(hi, pos);
			lo = Math.min(lo, neg);
		}
	} else {
		for (const s of vs) for (const v of s) if (v != null) {
			lo = Math.min(lo, v);
			hi = Math.max(hi, v);
		}
	}
	if (!isFinite(lo)) lo = hi = 0;
	if (zero) {
		lo = Math.min(lo, 0);
		hi = Math.max(hi, 0);
	}
	if (c.min !== undefined) lo = c.min;
	if (c.max !== undefined) hi = c.max;
	return [lo, hi];
}

/** Y ticks, gridlines and labels at the plot's left; returns the plot inside them and its scale. */
function yAxis(b: Builder, c: Chart, plot: Box, lo: number, hi: number, bottom: number) {
	const ticks = niceTicks(lo, hi, Math.max(2, Math.round(plot.h / 56)));
	const t0 = c.min !== undefined ? lo : ticks[0];
	const t1 = c.max !== undefined ? hi : ticks[ticks.length - 1];
	const shown = ticks.filter((t) => t >= t0 - 1e-9 && t <= t1 + 1e-9);
	const labels = shown.map((t) => withUnit(t, tickUnit(c.unit)));
	const lw = Math.max(...labels.map((l) => textWidth(l, 11))) + 8;
	let x = plot.x;
	const yLabel = c.yLabel ?? (c.unit && !tickUnit(c.unit) ? c.unit : undefined);
	if (yLabel) {
		b.ops.push((g) => {
			g.save();
			g.translate(plot.x + 6, plot.y + (plot.h - bottom) / 2);
			g.rotate(-90);
			g.text(0, 0, yLabel, INK3, { size: 11, align: "center", baseline: "middle" });
			g.restore();
		});
		b.texts.push(yLabel);
		x += 18;
	}
	const inner = { x: x + lw, y: plot.y + 6, w: plot.x + plot.w - x - lw, h: plot.h - bottom - 6 };
	const y = (v: number) => inner.y + inner.h - ((v - t0) / (t1 - t0 || 1)) * inner.h;
	shown.forEach((t, i) => {
		const ty = y(t);
		b.line(inner.x, ty, inner.x + inner.w, ty, { stroke: t === 0 ? AXIS : GRID, lineWidth: 1 });
		b.text(inner.x - 8, ty, labels[i], INK3, { size: 11, align: "end", baseline: "middle" });
	});
	return { inner, y, base: y(Math.max(t0, Math.min(t1, 0))) };
}

/** Category labels under the plot, every nth when they'd crowd. */
function xLabels(b: Builder, labels: string[], at: (i: number) => number, band: number, y: number) {
	const widest = Math.max(...labels.map((l) => textWidth(l, 11)));
	const every = Math.max(1, Math.ceil((widest + 10) / Math.max(band, 1)));
	labels.forEach((l, i) => {
		if (i % every) return;
		b.text(at(i), y, clip(l, 11, band * every - 6), INK3, { size: 11, align: "center", baseline: "top" });
	});
}

function cartesian(b: Builder, c: Chart, palette: ColorValue[], plot: Box) {
	const bars = c.type === "bar";
	const [lo, hi] = extent(c, bars || c.type === "area");
	const bottom = 22 + (c.xLabel ? 16 : 0);
	const { inner, y, base } = yAxis(b, c, plot, lo, hi, bottom);
	const n = c.x.length;
	const labels = c.x.map(String);
	const band = inner.w / Math.max(n, 1);
	const cx = bars ? (i: number) => inner.x + band * (i + 0.5) : (i: number) => inner.x + (n > 1 ? (inner.w * i) / (n - 1) : inner.w / 2);
	xLabels(b, labels, cx, bars ? band : inner.w / Math.max(n - 1, 1), inner.y + inner.h + 8);
	if (c.xLabel) b.text(inner.x + inner.w / 2, inner.y + inner.h + 26, c.xLabel, INK3, { size: 11, align: "center", baseline: "top" });
	const vs = values(c);
	const tip = (i: number) =>
		[labels[i], ...c.series.map((s, k) => (vs[k][i] == null ? null : `${s.name}: ${withUnit(vs[k][i]!, c.unit)}`)).filter(Boolean)].join("\n");

	if (bars) {
		const group = Math.min(band * 0.72, 64 * (c.stacked ? 1 : c.series.length));
		const per = c.stacked ? group : group / c.series.length;
		for (let i = 0; i < n; i++) {
			const gx = cx(i) - group / 2;
			let pos = base, neg = base;
			c.series.forEach((s, k) => {
				const v = vs[k][i];
				if (v == null) return;
				const color = palette[k % palette.length];
				const h = Math.abs(y(v) - base);
				let bx = gx + (c.stacked ? 0 : per * k), by: number;
				const bw = Math.max(1, per - (c.stacked || c.series.length === 1 ? 0 : 2));
				if (c.stacked) {
					if (v >= 0) {
						pos -= h;
						by = pos;
					} else {
						by = neg;
						neg += h;
					}
				} else {
					by = v >= 0 ? base - h : base;
				}
				// A 2px gap of the surface between stacked segments.
				const gap = c.stacked && k > 0 ? 2 : 0;
				const last = !c.stacked || k === lastIn(vs, i, v >= 0);
				const top = v >= 0;
				const hh = Math.max(0, h - gap);
				const yy = top ? by : by + gap;
				if (last) b.path(barPath(bx, yy, bw, hh, 4, top ? "bottom" : "top"), color);
				else b.rect(bx, yy, bw, hh, color);
				b.hit(`bar:${i}:${k}`, bx, Math.min(yy, base - 4), bw, Math.max(hh, 8), `${labels[i]}\n${s.name}: ${withUnit(v, c.unit)}`);
			});
		}
		return;
	}

	// Lines and areas.
	const area = c.type === "area";
	const stackBase = new Array(n).fill(0);
	c.series.forEach((s, k) => {
		const color = palette[k % palette.length];
		const pts: [number, number][] = [];
		const lows: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const v = vs[k][i];
			if (v == null) {
				segment(b, pts, lows, color, area);
				pts.length = 0;
				lows.length = 0;
				continue;
			}
			const low = c.stacked ? stackBase[i] : 0;
			const high = c.stacked ? low + v : v;
			if (c.stacked) stackBase[i] = high;
			pts.push([cx(i), y(high)]);
			lows.push([cx(i), area ? y(low) : 0]);
		}
		segment(b, pts, lows, color, area);
	});
	// Markers where there's room, ringed with the surface.
	if (n <= 24) {
		c.series.forEach((s, k) => {
			const acc = c.stacked ? values(c).slice(0, k + 1) : [vs[k]];
			for (let i = 0; i < n; i++) {
				if (vs[k][i] == null) continue;
				const v = c.stacked ? acc.reduce((a, r) => a + (r[i] ?? 0), 0) : vs[k][i]!;
				b.circle(cx(i), y(v), 4.5, SURFACE);
				b.circle(cx(i), y(v), 3, palette[k % palette.length]);
			}
		});
	}
	// A column a value each, its tooltip all the series there.
	const col = n > 1 ? inner.w / (n - 1) : inner.w;
	for (let i = 0; i < n; i++) b.hit(`x:${i}`, cx(i) - col / 2, inner.y, col, inner.h, tip(i));
}

function lastIn(vs: (number | null)[][], i: number, positive: boolean): number {
	let last = -1;
	vs.forEach((s, k) => {
		const v = s[i];
		if (v != null && (v >= 0) === positive) last = k;
	});
	return last;
}

function segment(b: Builder, pts: [number, number][], lows: [number, number][], color: ColorValue, area: boolean) {
	if (!pts.length) return;
	if (area && pts.length > 1) {
		const ring = [...pts, ...lows.slice().reverse()].flat();
		b.poly(ring, { fill: color, opacity: 0.22 }, true);
	}
	if (pts.length === 1) {
		b.circle(pts[0][0], pts[0][1], 3, color);
		return;
	}
	b.poly(pts.flat(), { stroke: color, lineWidth: 2 });
}

function hbars(b: Builder, c: Chart, palette: ColorValue[], plot: Box) {
	const labels = c.x.map(String);
	const lw = Math.min(Math.max(...labels.map((l) => textWidth(l, 12))) + 10, plot.w * 0.35);
	const [lo, hi] = extent(c, true);
	const ticks = niceTicks(lo, hi, 5);
	const t0 = c.min ?? ticks[0], t1 = c.max ?? ticks[ticks.length - 1];
	const titled = !!(c.xLabel || (c.unit && !tickUnit(c.unit)));
	const inner = { x: plot.x + lw, y: plot.y, w: plot.w - lw - 8, h: plot.h - 20 - (titled ? 16 : 0) };
	const x = (v: number) => inner.x + ((v - t0) / (t1 - t0 || 1)) * inner.w;
	const base = x(Math.max(t0, Math.min(t1, 0)));
	for (const t of ticks) {
		if (t < t0 - 1e-9 || t > t1 + 1e-9) continue;
		b.line(x(t), inner.y, x(t), inner.y + inner.h, { stroke: t === 0 ? AXIS : GRID, lineWidth: 1 });
		b.text(x(t), inner.y + inner.h + 6, withUnit(t, tickUnit(c.unit)), INK3, { size: 11, align: "center", baseline: "top" });
	}
	const xTitle = c.xLabel ?? (c.unit && !tickUnit(c.unit) ? c.unit : undefined);
	if (xTitle) b.text(inner.x + inner.w / 2, inner.y + inner.h + 24, xTitle, INK3, { size: 11, align: "center", baseline: "top" });
	const n = labels.length;
	const band = inner.h / Math.max(n, 1);
	const vs = values(c);
	const group = Math.min(band * 0.72, 28 * (c.stacked ? 1 : c.series.length));
	const per = c.stacked ? group : group / c.series.length;
	for (let i = 0; i < n; i++) {
		const cy = inner.y + band * (i + 0.5);
		b.text(inner.x - 10, cy, clip(labels[i], 12, lw - 10), INK2, { size: 12, align: "end", baseline: "middle" });
		let pos = base, neg = base;
		c.series.forEach((s, k) => {
			const v = vs[k][i];
			if (v == null) return;
			const w = Math.abs(x(v) - base);
			const by = cy - group / 2 + (c.stacked ? 0 : per * k);
			const bh = Math.max(1, per - (c.stacked || c.series.length === 1 ? 0 : 2));
			let bx: number;
			if (c.stacked) {
				if (v >= 0) {
					bx = pos;
					pos += w;
				} else {
					neg -= w;
					bx = neg;
				}
			} else {
				bx = v >= 0 ? base : base - w;
			}
			const gap = c.stacked && k > 0 ? 2 : 0;
			const ww = Math.max(0, w - gap);
			const xx = v >= 0 ? bx + gap : bx;
			const last = !c.stacked || k === lastIn(vs, i, v >= 0);
			if (last) b.path(barPath(xx, by, ww, bh, 4, v >= 0 ? "left" : "right"), palette[k % palette.length]);
			else b.rect(xx, by, ww, bh, palette[k % palette.length]);
			b.hit(`bar:${i}:${k}`, xx, by, Math.max(ww, 8), bh, `${labels[i]}\n${s.name}: ${withUnit(v, c.unit)}`);
		});
	}
}

function scatter(b: Builder, c: Chart, palette: ColorValue[], plot: Box) {
	const pts = c.series.map((s) => s.data as [number, number][]);
	const xs = pts.flat().map((p) => p[0]);
	const ys = pts.flat().map((p) => p[1]);
	const ylo = c.min ?? Math.min(...ys), yhi = c.max ?? Math.max(...ys);
	const bottom = 22 + (c.xLabel ? 16 : 0);
	const { inner, y } = yAxis(b, { ...c, min: undefined, max: undefined }, plot, ylo, yhi, bottom);
	const xt = niceTicks(Math.min(...xs), Math.max(...xs), Math.max(2, Math.round(inner.w / 90)));
	const x0 = xt[0], x1 = xt[xt.length - 1];
	const x = (v: number) => inner.x + ((v - x0) / (x1 - x0 || 1)) * inner.w;
	for (const t of xt) b.text(x(t), inner.y + inner.h + 8, fmt(t), INK3, { size: 11, align: "center", baseline: "top" });
	if (c.xLabel) b.text(inner.x + inner.w / 2, inner.y + inner.h + 26, c.xLabel, INK3, { size: 11, align: "center", baseline: "top" });
	pts.forEach((ps, k) => {
		for (const [px, py] of ps) {
			b.circle(x(px), y(py), 5.5, SURFACE);
			b.circle(x(px), y(py), 4, { fill: palette[k % palette.length], opacity: 0.9 });
		}
	});
	pts.forEach((ps, k) => {
		ps.forEach(([px, py], i) => {
			b.hit(`pt:${k}:${i}`, x(px) - 7, y(py) - 7, 14, 14, `${c.series[k].name}\n${c.xLabel ?? "x"}: ${fmt(px)}, ${c.yLabel ?? "y"}: ${withUnit(py, c.unit)}`);
		});
	});
}

/** Slices largest first, past seven folded into Other, so no slice repeats a color. */
export function slices(c: Chart): { label: string; value: number }[] {
	const vals = c.series[0].data as (number | null)[];
	let items = c.x.map((l, i) => ({ label: String(l), value: vals[i] ?? 0 })).filter((d) => d.value > 0);
	if (items.length > MAX_SERIES) {
		const sorted = items.slice().sort((a, b) => b.value - a.value);
		const keep = sorted.slice(0, MAX_SERIES - 1);
		const rest = sorted.slice(MAX_SERIES - 1).reduce((a, d) => a + d.value, 0);
		items = [...keep, { label: "Other", value: rest }];
	}
	return items;
}

function drawPie(c: Chart, palette: ColorValue[]): Scene {
	const items = slices(c);
	const total = items.reduce((a, d) => a + d.value, 0);
	const rowH = 22;
	const head = (c.title ? 20 : 0) + (c.subtitle ? 17 : 0);
	const H = clamp(c.height ?? Math.max(220, head + 28 + items.length * rowH + 16), 180, 720);
	const b = new Builder(W, H);
	let top = 14;
	if (c.title) {
		b.text(16, top, clip(c.title, 14, W - 32, 600), INK, { size: 14, weight: 600 });
		top += 20;
	}
	if (c.subtitle) {
		b.text(16, top, clip(c.subtitle, 12, W - 32), INK2, { size: 12 });
		top += 17;
	}
	top += 8;
	const r = Math.min((H - top - 14) / 2, 120);
	const cx = 16 + r + 8, cy = top + r;
	let a = -90;
	const pct = (v: number) => {
		const p = (v / total) * 100;
		return (p >= 10 ? p.toFixed(0) : p.toFixed(1).replace(/\.0$/, "")) + "%";
	};
	items.forEach((d, i) => {
		const sweep = (d.value / total) * 360;
		const color = palette[i % palette.length];
		if (items.length === 1) b.circle(cx, cy, r, color);
		else b.arc(cx, cy, r, a, a + sweep, color);
		a += sweep;
	});
	// The 2px gaps between slices, in the surface.
	if (items.length > 1) {
		a = -90;
		for (const d of items) {
			const rad = (a * Math.PI) / 180;
			b.line(cx, cy, cx + Math.cos(rad) * (r + 1), cy + Math.sin(rad) * (r + 1), { stroke: SURFACE, lineWidth: 2.5 });
			a += (d.value / total) * 360;
		}
	}
	if (c.type === "donut") {
		b.circle(cx, cy, r * 0.58, SURFACE);
		b.text(cx, cy - 8, withUnit(total, c.unit), INK, { size: 18, weight: 600, align: "center", baseline: "middle" });
		b.text(cx, cy + 12, "Total", INK3, { size: 11, align: "center", baseline: "middle" });
	}
	// A legend with each value and its share.
	const lx = cx + r + 40;
	const lw = Math.min(W - 16 - lx, 300);
	const ly = cy - (items.length * rowH) / 2;
	items.forEach((d, i) => {
		const y = ly + i * rowH;
		const val = `${withUnit(d.value, c.unit)}  ${pct(d.value)}`;
		const vw = textWidth(val, 12);
		b.rect(lx, y + 5, 10, 10, palette[i % palette.length], 3);
		b.text(lx + 18, y + 10, clip(d.label, 12, lw - vw - 34), INK2, { size: 12, baseline: "middle" });
		b.text(lx + lw, y + 10, val, INK3, { size: 12, align: "end", baseline: "middle" });
		b.hit(`slice:${i}`, lx, y, lw, rowH, `${d.label}: ${withUnit(d.value, c.unit)} (${pct(d.value)})`);
	});
	return b.scene();
}

/** The chart as a table: a row per x (or per slice, or per point), a column per series. */
export function chartTable(c: Chart): { columns: string[]; rows: string[][] } {
	if (c.type === "pie" || c.type === "donut") {
		const items = slices(c);
		const total = items.reduce((a, d) => a + d.value, 0);
		return { columns: ["", "Value", "Share"], rows: items.map((d) => [d.label, withUnit(d.value, c.unit), ((d.value / total) * 100).toFixed(1) + "%"]) };
	}
	if (c.type === "scatter") {
		return {
			columns: ["Series", c.xLabel ?? "x", c.yLabel ?? "y"],
			rows: c.series.flatMap((s) => (s.data as [number, number][]).map(([x, y]) => [s.name, fmt(x), withUnit(y, c.unit)])),
		};
	}
	return {
		columns: [c.xLabel ?? "", ...c.series.map((s) => s.name)],
		rows: c.x.map((x, i) => [String(x), ...c.series.map((s) => {
			const v = (s.data as (number | null)[])[i];
			return v == null ? "–" : withUnit(v, c.unit);
		})]),
	};
}

/** What the chart says, for a screen reader: its title and what it shows. */
export function describeChart(c: Chart): string {
	const what = c.type === "bar" && c.horizontal ? "Horizontal bar" : c.type[0].toUpperCase() + c.type.slice(1);
	const series = c.type === "pie" || c.type === "donut" ? `${slices(c).length} slices` : c.series.length === 1 ? c.series[0].name : `${c.series.length} series: ${c.series.map((s) => s.name).join(", ")}`;
	return `${what} chart${c.title ? ", " + c.title : ""}. ${series}.`;
}
