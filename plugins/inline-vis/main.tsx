// Inline visualizations: an agent's ```chart, ```mermaid and ```svg fences,
// drawn in the reply, with Swarm's own canvas. src/ has how each is laid out.
import { ui, type Child, type IconName, type RenderContext } from "swarm";
import { type Chart, chartTable, DARK, describeChart, drawChart, LIGHT, parseChart } from "./src/chart";
import { type Diagram, drawMermaid, parseMermaid } from "./src/diagram";
import type { Scene } from "./src/scene";

type View = "drawing" | "table" | "code";

interface Drawn {
	/** The scenes, light and dark (one, when the drawing is in Swarm's colours alone). */
	light: Scene;
	dark?: Scene;
	label: string;
	table?: { columns: string[]; rows: string[][] };
	svg?: string;
}

const KIND: { [lang: string]: { title: string; icon: IconName } } = {
	chart: { title: "Chart", icon: "chart-bar" },
	mermaid: { title: "Diagram", icon: "sitemap" },
	svg: { title: "SVG", icon: "image" },
};

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
	return { light: drawChart(c, LIGHT), dark: drawChart(c, DARK), label: describeChart(c), table: chartTable(c) };
}

function build(language: string, code: string): Drawn {
	if (language === "chart") return chartDrawn(parseChart(code));
	if (language === "mermaid") {
		const d: Diagram = parseMermaid(code);
		if (d.kind === "pie") return chartDrawn(d.chart);
		const what = d.kind === "sequence" ? "Sequence diagram" : d.kind === "state" ? "State diagram" : "Flowchart";
		const scene = drawMermaid(d);
		return { light: scene, label: `${what}: ${scene.texts.filter(Boolean).slice(0, 12).join(", ")}` };
	}
	return svgDrawn(code);
}

function svgDrawn(code: string): Drawn {
	const src = code.trim();
	if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(src)) throw new Error("An SVG starts with <svg.");
	if (!/<\/svg>\s*$/i.test(src)) throw new Error("The SVG isn't closed with </svg>.");
	const bytes = new TextEncoder().encode(src);
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	const empty: Scene = { width: 1, height: 1, ops: [], texts: [] };
	const title = /<title>([^<]*)<\/title>/i.exec(src)?.[1]?.trim();
	return { light: empty, label: title || "A picture", svg: "data:image/svg+xml;base64," + btoa(bin) };
}

function canvas(s: Scene, label: string, extra?: object): Child {
	return (
		<ui.canvas
			label={label}
			width={s.width}
			height={s.height}
			draw={(g) => {
				for (const op of s.ops) op(g);
			}}
			maxWidth={s.width}
			{...extra}
		/>
	);
}

function drawing(d: Drawn): Child {
	if (d.svg) return <ui.image src={d.svg} alt={d.label} />;
	if (!d.dark) return canvas(d.light, d.label);
	// The palette has its own steps for each theme: one canvas a theme, the other hidden.
	return (
		<ui.column align="stretch" grow={1} maxWidth={d.light.width}>
			{canvas(d.light, d.label, { key: "light", style: { dark: { display: "none" } } })}
			{canvas(d.dark, d.label, { key: "dark", style: { display: "none", dark: { display: "flex" } } })}
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
	return language === "chart" ? "json" : language === "svg" ? "xml" : language;
}

/** A fence's frame, as Swarm draws a code block's: its kind, its views, Copy, and what it shows. */
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
			<ui.row justify="center" padding="s2 s3 s3">
				{drawing(drawn!)}
			</ui.row>
		);
	}

	return (
		<ui.column align="stretch" border="border" radius="card" background="raised" clip>
			<ui.row align="center" gap="s1" padding="s1 s2 s1 s3" style={{ borderBottom: "1px solid divider" }}>
				<ui.icon icon={kind.icon} tone="faint" size="sm" margin="s0 s1 s0 s0" />
				<ui.text tone="muted" size="sm" grow={1} shrink={1} maxLines={1}>
					{streaming ? `Drawing the ${what}…` : failed ? `Couldn't draw this ${what}` : kind.title}
				</ui.text>
				{streaming ? <ui.spinner /> : null}
				{drawn ? viewButton(key, "drawing", view, kind.icon, language === "chart" ? "Show the chart" : language === "svg" ? "Show the picture" : "Show the diagram") : null}
				{drawn?.table ? viewButton(key, "table", view, "rows", "Show the data") : null}
				{drawn ? viewButton(key, "code", view, "code", "Show the source") : null}
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
	ui.codeFence({ id: "inline-vis", languages: ["chart", "mermaid", "svg"], render: renderFence });
}
