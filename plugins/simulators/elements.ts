// A screen as elements (machine_describe): what each driver reads, and how it's said.
// No Swarm here, for the tests to read it as it is.

/** An element of a screen, as describe gives it: its kind, its name, its box in screenshot pixels. */
export interface Element {
	role: string;
	label: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/** Whether it takes a click or a tap. */
	action?: boolean;
}

/** Elements as describe says them: a line each, its kind, its name and the point to click. */
export function elementLines(list: Element[]): string {
	return list.map((e) => `- ${e.role}${e.label ? ` "${e.label.replace(/\s+/g, " ").slice(0, 120)}"` : ""} at ${Math.round(e.x + e.w / 2)},${Math.round(e.y + e.h / 2)}${e.action ? "" : " (not clickable)"}`).join("\n");
}

/** The most elements describe gives: enough for a screen, not a page of thousands. */
export const MAX_ELEMENTS = 300;

/**
 * uiautomator's dump as elements: what takes a tap, named by its own
 * text or else its children's ("Apps: Assistant, recent apps…"), and
 * named text outside those; scrollable lists by their id.
 */
export function parseUiAutomator(xml: string): Element[] {
	interface Node {
		attrs: string;
		kids: Node[];
	}
	const root: Node = { attrs: "", kids: [] };
	const stack = [root];
	for (const m of xml.matchAll(/<(\/?)node\b([^>]*?)(\/?)>/g)) {
		if (m[1]) {
			if (stack.length > 1) stack.pop();
			continue;
		}
		const n: Node = { attrs: m[2]!, kids: [] };
		stack.at(-1)!.kids.push(n);
		if (!m[3]) stack.push(n);
	}
	const unescape = (v: string) => v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, " ").replace(/&amp;/g, "&");
	const attr = (n: Node, k: string) => unescape(new RegExp(`\\b${k}="([^"]*)"`).exec(n.attrs)?.[1] ?? "");
	const own = (n: Node) => (attr(n, "text") || attr(n, "content-desc")).trim();
	const texts = (n: Node): string[] => n.kids.flatMap((k) => [own(k), ...texts(k)]).filter(Boolean);
	const out: Element[] = [];
	const walk = (n: Node, inTap: boolean) => {
		if (out.length >= MAX_ELEMENTS) return;
		const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attr(n, "bounds"));
		const tap = attr(n, "clickable") === "true" || attr(n, "long-clickable") === "true" || attr(n, "checkable") === "true";
		const scroll = attr(n, "scrollable") === "true";
		if (b) {
			const [x1, y1, x2, y2] = b.slice(1).map(Number) as [number, number, number, number];
			const role = attr(n, "class").replace(/^.*\./, "").toLowerCase();
			const id = attr(n, "resource-id").replace(/^.*:id\//, "");
			let label = own(n);
			if (tap && !label) label = [...new Set(texts(n))].slice(0, 3).join(": ") || id;
			if (scroll && !label) label = id;
			const show = x2 > x1 && y2 > y1 && label && (tap || scroll || !inTap);
			if (show) out.push({ role, label, x: x1, y: y1, w: x2 - x1, h: y2 - y1, action: tap });
		}
		for (const k of n.kids) walk(k, inTap || tap);
	};
	for (const k of root.kids) walk(k, false);
	return out;
}

