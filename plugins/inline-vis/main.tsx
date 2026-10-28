// Inline visualizations: an agent's ```chart, ```mermaid and ```svg fences,
// drawn in the reply, with Swarm's own canvas. src/ has how each is laid out.
import { ui, type Child, type IconName, type RenderContext } from "swarm";
import { type Chart, chartTable, DARK, describeChart, drawChart, LIGHT, parseChart } from "./src/chart";
import { FONTS, mathError, scene as mathScene, typeset } from "./src/math";
import { drawMermaid } from "./src/mermaid";
import type { Scene } from "./src/scene";
import { svgScene } from "./src/svgcanvas";

type View = "drawing" | "table" | "code";

interface Drawn {
	/** What it is, as its frame names it: "Chart", "Sequence diagram"… */
	kind: string;
	/** The scenes, light and dark (one, when the drawing is in Swarm's colours alone). */
	light: Scene;
	dark?: Scene;
	label: string;
	table?: { columns: string[]; rows: string[][] };
	svg?: { src: string; width: number; height: number };
}

const KIND: { [lang: string]: { title: string; icon: IconName } } = {
	chart: { title: "Chart", icon: "chart-bar" },
	mermaid: { title: "Diagram", icon: "sitemap" },
	svg: { title: "Picture", icon: "image" },
	math: { title: "Math", icon: "math-function" },
};

// A math fence's em, in pixels: KaTeX's 1.21em of a reply's text.
const MATH_EM = 18;

// What's drawn, by the fence's language and code, so a render that comes
// again (each frame the reply streams, each update) doesn't lay it out again.
const cache = new Map<string, Drawn | Error>();
const views = new Map<string, View>();

export function draw(language: string, code: string): Drawn | Error {
	const key = language + "\0" + code;
	const hit = cache.get(key);
	if (hit) return hit;
	let out: Drawn | Error;
	try {
		out = build(language, code);
	} catch (e) {
		out = e instanceof Error ? e : new Error(String(e));
	}
	if (cache.size > 200) cache.delete(cache.keys().next().value!);
	cache.set(key, out);
	return out;
}

function chartDrawn(c: Chart): Drawn {
	return { kind: "Chart", light: drawChart(c, LIGHT), dark: drawChart(c, DARK), label: describeChart(c), table: chartTable(c) };
}

function build(language: string, code: string): Drawn {
	if (language === "chart") return chartDrawn(parseChart(code));
	if (language === "mermaid") return drawMermaid(code, LIGHT, DARK);
	if (language === "math") return mathDrawn(code);
	return svgDrawn(code);
}

// What only Swarm's picture renderer draws of an SVG.
const PICTURE_ONLY = /<(linearGradient|radialGradient|use|symbol|clipPath|mask|pattern|filter|image|foreignObject|marker|style)\b|url\(/i;

function mathDrawn(code: string): Drawn {
	const tex = code.trim();
	if (!tex) throw new Error("The math is empty.");
	let t;
	try {
		t = typeset(tex, MATH_EM, true);
	} catch (e) {
		throw mathError(e);
	}
	return { kind: "Math", light: mathScene(t, 10), label: "Math: " + tex };
}

function svgDrawn(code: string): Drawn {
	const src = code.trim();
	if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(src)) throw new Error("An SVG starts with <svg.");
	if (!/<\/svg>\s*$/i.test(src)) throw new Error("The SVG isn't closed with </svg>.");
	const bytes = new TextEncoder().encode(src);
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	const open = /<svg\b[^>]*>/i.exec(src)![0];
	const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(open)?.[1];
	const vb = (attr("viewBox") ?? "").split(/[\s,]+/).map(Number);
	const width = parseFloat(attr("width") ?? "") || vb[2] || 300;
	const height = parseFloat(attr("height") ?? "") || vb[3] || 150;
	const title = /<title>([^<]*)<\/title>/i.exec(src)?.[1]?.trim();
	// Drawn with the canvas, its text and all, when it uses only what the canvas draws; else as a
	// picture, which has gradients, clips and masks but no text.
	if (!PICTURE_ONLY.test(src)) {
		const scene = svgScene(src, LIGHT);
		return { kind: "Picture", light: scene, label: title || scene.title || "A picture" };
	}
	const empty: Scene = { width: 1, height: 1, ops: [], texts: [] };
	return { kind: "Picture", light: empty, label: title || "A picture", svg: { src: "data:image/svg+xml;base64," + btoa(bin), width, height } };
}

function canvas(s: Scene, label: string, maxWidth: number, extra?: object): Child {
	return (
		<ui.canvas
			label={label}
			width={s.width}
			height={s.height}
			draw={(g) => {
				for (const op of s.ops) op(g);
			}}
			maxWidth={maxWidth}
			{...extra}
		/>
	);
}

/** The drawing, at most maxWidth wide: its own width in a reply, larger expanded. */
function drawing(d: Drawn, maxWidth?: number): Child {
	if (d.svg) {
		const w = maxWidth ?? d.svg.width;
		return <ui.image src={d.svg.src} alt={d.label} width={w} height={(w * d.svg.height) / d.svg.width} />;
	}
	const w = maxWidth ?? d.light.width;
	if (!d.dark) return canvas(d.light, d.label, w);
	// The palette has its own steps for each theme: one canvas a theme, the other hidden.
	return (
		<ui.column align="stretch" grow={1} maxWidth={w}>
			{canvas(d.light, d.label, w, { key: "light", style: { dark: { display: "none" } } })}
			{canvas(d.dark, d.label, w, { key: "dark", style: { display: "none", dark: { display: "flex" } } })}
		</ui.column>
	);
}

function table(t: { columns: string[]; rows: string[][] }): Child {
	const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
	const md = [
		"| " + t.columns.map(cell).join(" | ") + " |",
		"| " + t.columns.map((_, i) => (i ? "---:" : "---")).join(" | ") + " |",
		...t.rows.slice(0, 500).map((r) => "| " + r.map(cell).join(" | ") + " |"),
	].join("\n");
	return <ui.markdown text={md} />;
}

function viewButton(key: string, view: View, current: View, icon: IconName, label: string): Child {
	return (
		<ui.iconButton
			key={view}
			icon={icon}
			label={label}
			tooltip={label}
			background={view === current ? "selected" : undefined}
			radius="control"
			onClick={() => {
				views.set(key, view);
			}}
		/>
	);
}

function sourceLanguage(language: string) {
	return language === "chart" ? "json" : language === "svg" ? "xml" : language === "math" ? "latex" : language;
}

// ---- Expanded ----

// The overlay's width, and the most of the window's height a drawing takes in it.
const EXPANDED_WIDTH = 1200;
const EXPANDED_HEIGHT = 720;

let expanded: Drawn | null = null;

function expand(d: Drawn) {
	expanded = d;
	ui.showOverlay("expanded");
}

/** The drawing as large as the overlay lets it be: twice its size at most, and no taller than the window's room. */
function renderExpanded(): Child {
	const d = expanded;
	if (!d) return null;
	const w = d.svg ? d.svg.width : d.light.width;
	const h = d.svg ? d.svg.height : d.light.height;
	const fit = Math.max(160, Math.min(w * 2, EXPANDED_WIDTH - 64, (w * EXPANDED_HEIGHT) / h));
	return (
		<ui.column align="stretch">
			<ui.row align="center" gap="s2" padding="s3 s3 s3 s5" style={{ borderBottom: "1px solid divider" }}>
				<ui.text weight={600} grow={1} shrink={1} maxLines={1}>
					{d.kind}
				</ui.text>
				<ui.iconButton icon="x" label="Close the drawing" tooltip="Close (Esc)" onClick={() => ui.hideOverlay("expanded")} />
			</ui.row>
			<ui.scroll maxHeight={EXPANDED_HEIGHT + 48}>
				<ui.column align="center" padding="s5">
					<ui.row justify="center" align="center" width={fit} maxWidth={EXPANDED_WIDTH - 64}>
						{drawing(d, fit)}
					</ui.row>
				</ui.column>
			</ui.scroll>
		</ui.column>
	);
}

/** A fence's frame, as Swarm draws a code block's: its kind, its views, Expand, Copy, and what it shows. */
export function renderFence({ thread, args }: RenderContext): Child {
	const language = (args.language || "").toLowerCase();
	const code = args.code || "";
	const kind = KIND[language] ?? KIND.chart;
	const key = thread + "\0" + language + "\0" + code;
	const streaming = args.status === "streaming";
	const d = streaming ? undefined : draw(language, code);
	const failed = d instanceof Error ? d : undefined;
	const drawn = d && !(d instanceof Error) ? d : undefined;
	let view = views.get(key) ?? "drawing";
	if (view === "table" && !drawn?.table) view = "drawing";
	if (!drawn) view = "code";
	const what = kind.title.toLowerCase();

	let body: Child;
	if (view === "code") {
		body = <ui.source text={code} language={sourceLanguage(language)} />;
	} else if (view === "table") {
		body = <ui.column padding="s3 s4">{table(drawn!.table!)}</ui.column>;
	} else {
		body = (
			// The whole drawing is a button: a click expands it. As wide as the frame, so the canvas has its width.
			<ui.pressable label={"Expand: " + drawn!.label} tooltip="Expand" onClick={() => expand(drawn!)} style={{ cursor: "zoom-in", alignSelf: "stretch", width: "100%", display: "flex", flexDirection: "column" }}>
				<ui.row justify="center" padding="s3 s3 s4" style={{ width: "100%" }}>
					{drawing(drawn!)}
				</ui.row>
			</ui.pressable>
		);
	}

	return (
		<ui.column align="stretch" border="border" radius="card" background="raised" clip>
			<ui.row align="center" gap="s1" padding="s1 s2 s1 s3" style={{ borderBottom: "1px solid divider" }}>
				<ui.icon icon={kind.icon} tone="faint" size="sm" margin="s0 s1 s0 s0" />
				<ui.text tone="muted" size="sm" grow={1} shrink={1} maxLines={1}>
					{streaming ? `Drawing the ${what}…` : failed ? `Couldn't draw this ${what}` : drawn!.kind}
				</ui.text>
				{streaming ? <ui.spinner /> : null}
				{drawn ? viewButton(key, "drawing", view, kind.icon, language === "chart" ? "Show the chart" : language === "svg" ? "Show the picture" : language === "math" ? "Show the math" : "Show the diagram") : null}
				{drawn?.table ? viewButton(key, "table", view, "rows", "Show the data") : null}
				{drawn ? viewButton(key, "code", view, "code", "Show the source") : null}
				{drawn ? <ui.iconButton icon="maximize" label="Expand" tooltip="Expand" onClick={() => expand(drawn)} /> : null}
				{streaming ? null : <ui.iconButton icon="copy" label="Copy the source" tooltip="Copy the source" onClick={() => ui.copy(code)} />}
			</ui.row>
			{failed ? (
				<ui.row gap="s2" align="start" padding="s2 s4" background="redSoft">
					<ui.icon icon="alert-circle" tone="red" size="sm" />
					<ui.text tone="red" size="sm" grow={1} shrink={1} selectable>
						{failed.message}
					</ui.text>
				</ui.row>
			) : null}
			{body}
		</ui.column>
	);
}

export function activate() {
	for (const [family, src] of Object.entries(FONTS)) ui.font({ family, src });
	ui.codeFence({ id: "inline-vis", languages: ["chart", "mermaid", "svg", "math"], render: renderFence });
	ui.overlay({ id: "expanded", width: EXPANDED_WIDTH, bare: true, render: () => renderExpanded() });
}
