import type { Canvas, CanvasPaint } from "swarm";

// A scene is a drawing laid out once and drawn as often as the window asks:
// what a canvas's draw(g) replays. Its texts are kept too, for the canvas's
// label and the tests.

export type Op = (g: Canvas) => void;

export interface Scene {
	width: number;
	height: number;
	ops: Op[];
	texts: string[];
}

export class Builder {
	ops: Op[] = [];
	texts: string[] = [];
	constructor(public width: number, public height: number) {}

	rect(x: number, y: number, w: number, h: number, paint: CanvasPaint, radius = 0) {
		this.ops.push((g) => g.rect(x, y, w, h, paint, radius ? { radius } : undefined));
	}
	circle(cx: number, cy: number, r: number, paint: CanvasPaint) {
		this.ops.push((g) => g.circle(cx, cy, r, paint));
	}
	line(x1: number, y1: number, x2: number, y2: number, paint: CanvasPaint) {
		this.ops.push((g) => g.line(x1, y1, x2, y2, paint));
	}
	poly(points: number[], paint: CanvasPaint, closed = false) {
		this.ops.push((g) => g.poly(points, paint, closed));
	}
	path(d: string, paint: CanvasPaint) {
		this.ops.push((g) => g.path(d, paint));
	}
	arc(cx: number, cy: number, r: number, start: number, end: number, paint: CanvasPaint) {
		this.ops.push((g) => g.arc(cx, cy, r, start, end, paint));
	}
	text(x: number, y: number, text: string, paint: CanvasPaint, options: { size?: number; weight?: number; align?: "start" | "center" | "end"; baseline?: "top" | "middle" | "bottom" } = {}) {
		this.texts.push(text);
		this.ops.push((g) => g.text(x, y, text, paint, options));
	}
	hit(id: string, x: number, y: number, w: number, h: number, tooltip?: string) {
		this.ops.push((g) => g.hit(id, x, y, w, h, tooltip));
	}
	scene(): Scene {
		return { width: Math.ceil(this.width), height: Math.ceil(this.height), ops: this.ops, texts: this.texts };
	}
}

/** A rectangle with its two corners at the far end of from rounded: a bar's data end. from is where the bar starts: bottom, top, left or right. */
export function barPath(x: number, y: number, w: number, h: number, r: number, from: "bottom" | "top" | "left" | "right"): string {
	r = Math.max(0, Math.min(r, w / 2, h / 2));
	const R = (n: number) => Math.round(n * 100) / 100;
	const x2 = x + w, y2 = y + h;
	switch (from) {
		case "bottom": // rounded on top
			return `M${R(x)} ${R(y2)}V${R(y + r)}Q${R(x)} ${R(y)} ${R(x + r)} ${R(y)}H${R(x2 - r)}Q${R(x2)} ${R(y)} ${R(x2)} ${R(y + r)}V${R(y2)}Z`;
		case "top": // rounded below
			return `M${R(x)} ${R(y)}V${R(y2 - r)}Q${R(x)} ${R(y2)} ${R(x + r)} ${R(y2)}H${R(x2 - r)}Q${R(x2)} ${R(y2)} ${R(x2)} ${R(y2 - r)}V${R(y)}Z`;
		case "left": // rounded on the right
			return `M${R(x)} ${R(y)}H${R(x2 - r)}Q${R(x2)} ${R(y)} ${R(x2)} ${R(y + r)}V${R(y2 - r)}Q${R(x2)} ${R(y2)} ${R(x2 - r)} ${R(y2)}H${R(x)}Z`;
		case "right": // rounded on the left
			return `M${R(x2)} ${R(y)}H${R(x + r)}Q${R(x)} ${R(y)} ${R(x)} ${R(y + r)}V${R(y2 - r)}Q${R(x)} ${R(y2)} ${R(x + r)} ${R(y2)}H${R(x2)}Z`;
	}
}
