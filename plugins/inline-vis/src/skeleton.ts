import { Builder, type Scene } from "./scene";

// A drawing still on its way: the shape of what's coming, in the faint
// fills Swarm's own loading states have, the size the drawing will be, so
// the reply doesn't jump when it lands. What a chart is (bars, a line, a
// pie) is read from the code so far, as it streams.

const W = 640;
const FILL = "hover";
const LINE = "divider";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type SoFar = { type?: string; height?: number; horizontal?: boolean; labels?: number; title?: boolean; subtitle?: boolean };

/** What's been written of a chart's spec so far: what sizes it, as drawChart has it. */
export function chartSoFar(code: string): SoFar {
	const type = /"type"\s*:\s*"(\w+)"/.exec(code)?.[1]?.toLowerCase();
	const h = /"height"\s*:\s*(\d+(?:\.\d+)?)\s*[,}\n]/.exec(code)?.[1];
	// Its labels, once their list is closed: strings or numbers, apart by commas.
	const x = /"x"\s*:\s*\[((?:\s*(?:"(?:[^"\\]|\\.)*"|[-\d.eE+]+)\s*,?)*)\]/.exec(code)?.[1];
	const labels = x === undefined ? undefined : (x.match(/"(?:[^"\\]|\\.)*"|[-\d.eE+]+/g) ?? []).length;
	return {
		type,
		height: h ? Number(h) : undefined,
		horizontal: /"horizontal"\s*:\s*true/.test(code),
		labels,
		title: /"title"\s*:\s*"/.test(code),
		subtitle: /"subtitle"\s*:\s*"/.test(code),
	};
}

/** The skeleton of a fence's drawing, by its language and the code so far. */
export function skeleton(language: string, code: string): Scene {
	if (language === "chart") return chartSkeleton(chartSoFar(code));
	if (language === "mermaid") return diagramSkeleton(code);
	if (language === "math") return mathSkeleton();
	return pictureSkeleton();
}

function header(b: Builder, legend: number) {
	b.rect(24, 22, 180, 12, FILL, 6);
	for (let i = 0; i < legend; i++) b.rect(24 + i * 78, 46, 62, 8, FILL, 4);
}

function chartSkeleton(c: SoFar): Scene {
	const round = c.type === "pie" || c.type === "donut";
	// As tall as drawChart will make it, as far as the spec so far says.
	const n = c.labels ?? 5;
	const H = round
		? clamp(c.height ?? Math.max(220, (c.title ? 20 : 0) + (c.subtitle ? 17 : 0) + 28 + Math.min(n, 8) * 22 + 16), 180, 720)
		: clamp(c.height ?? (c.horizontal ? Math.max(200, n * 30 + 90) : 300), 160, 720);
	const b = new Builder(W, H);
	header(b, round ? 0 : 2);
	if (round) {
		const r = Math.min(H - 70, 170) / 2;
		const cx = 24 + r, cy = 52 + r;
		b.circle(cx, cy, r, FILL);
		if (c.type === "donut") b.circle(cx, cy, r * 0.58, "raised");
		for (let i = 0; i < 4; i++) {
			const y = 64 + i * 26;
			b.rect(cx + r + 40, y, 10, 10, FILL, 3);
			b.rect(cx + r + 58, y + 1, [120, 90, 140, 70][i], 8, FILL, 4);
		}
		return b.scene();
	}
	const plot = { x: 72, y: 74, w: W - 96, h: H - 74 - 36 };
	// The axis's labels and grid.
	for (let i = 0; i <= 4; i++) {
		const y = plot.y + (plot.h * i) / 4;
		b.rect(24, y - 4, 36, 8, FILL, 4);
		b.line(plot.x, y, plot.x + plot.w, y, LINE);
	}
	const heights = [0.55, 0.8, 0.4, 0.95, 0.65, 0.75, 0.5];
	if (c.type === "line" || c.type === "area" || c.type === "scatter") {
		const pts = heights.map((v, i) => [plot.x + (plot.w * i) / (heights.length - 1), plot.y + plot.h * (1 - v)] as [number, number]);
		if (c.type === "scatter") {
			for (const [x, y] of pts) b.circle(x, y, 5, FILL);
			pts.slice(1).forEach(([x, y], i) => b.circle(x - plot.w / 14, y + 26 - i * 3, 5, FILL));
		} else {
			if (c.type === "area") b.poly([plot.x, plot.y + plot.h, ...pts.flat(), plot.x + plot.w, plot.y + plot.h], FILL, true);
			b.poly(pts.flat(), { stroke: FILL, lineWidth: 4 });
		}
	} else if (c.horizontal) {
		const rows = Math.max(1, Math.min(n, 12)), band = plot.h / rows;
		for (let i = 0; i < rows; i++) b.rect(plot.x, plot.y + band * i + band * 0.2, plot.w * heights[i % heights.length], band * 0.6, FILL, 4);
	} else {
		const n = heights.length, band = plot.w / n;
		heights.forEach((v, i) => {
			const h = plot.h * v;
			b.rect(plot.x + band * i + band * 0.2, plot.y + plot.h - h, band * 0.6, h, FILL, 4);
		});
	}
	// The labels under it.
	for (let i = 0; i < 5; i++) b.rect(plot.x + (plot.w * (i + 0.5)) / 5 - 18, plot.y + plot.h + 14, 36, 8, FILL, 4);
	return b.scene();
}

function diagramSkeleton(code: string): Scene {
	const first = code.trim().split(/\s/)[0]?.toLowerCase() ?? "";
	if (first === "sequencediagram") {
		const b = new Builder(W, 260);
		const xs = [110, 320, 530];
		for (const x of xs) {
			b.rect(x - 60, 16, 120, 36, FILL, 8);
			b.line(x, 52, x, 244, LINE);
		}
		[[0, 1, 84], [1, 2, 126], [2, 1, 168], [1, 0, 210]].forEach(([a, z, y]) => {
			b.rect(Math.min(xs[a], xs[z]) + 30, y - 18, Math.abs(xs[z] - xs[a]) - 60, 8, FILL, 4);
			b.line(xs[a], y, xs[z], y, { stroke: FILL, lineWidth: 2 });
		});
		return b.scene();
	}
	// A flowchart, and what else Mermaid draws: boxes joined top to bottom.
	const b = new Builder(W, 280);
	const box = (x: number, y: number, w = 140) => b.rect(x - w / 2, y, w, 44, FILL, 8);
	const join = (x1: number, y1: number, x2: number, y2: number) => b.line(x1, y1, x2, y2, { stroke: FILL, lineWidth: 2 });
	box(320, 16);
	join(320, 60, 180, 112);
	join(320, 60, 460, 112);
	box(180, 112);
	box(460, 112);
	join(180, 156, 320, 208);
	join(460, 156, 320, 208);
	box(320, 208, 180);
	return b.scene();
}

function mathSkeleton(): Scene {
	const b = new Builder(W, 64);
	b.rect(W / 2 - 110, 26, 220, 14, FILL, 7);
	return b.scene();
}

function pictureSkeleton(): Scene {
	const b = new Builder(W, 240);
	b.rect(120, 16, W - 240, 208, FILL, 12);
	return b.scene();
}
