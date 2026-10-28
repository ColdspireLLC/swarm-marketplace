import type { ColorValue } from "swarm";
import { detectType, render } from "../vendor/pele/pele.js";
import type { Scene } from "./scene";
import { svgScene } from "./svgcanvas";
import { textWidth } from "./text";

// ```mermaid: laid out and drawn by pele (Obsidian's Mermaid renderer,
// which t3code draws its diagrams with), its SVG then drawn with Swarm's
// canvas in Swarm's colours (svgcanvas.ts).

export const FONT = 14;

// pele's text styles, as its measurer is told them (pele's Style).
const BOLD = 1;

/** Names of pele's kinds, as a diagram's frame says them. */
const NAMES: { [type: string]: string } = {
	flowchart: "Flowchart", sequence: "Sequence diagram", class: "Class diagram", state: "State diagram", er: "Entity relationship diagram",
	pie: "Pie chart", gantt: "Gantt chart", gitGraph: "Git graph", mindmap: "Mind map", timeline: "Timeline", journey: "User journey",
	xychart: "XY chart", quadrantChart: "Quadrant chart", requirement: "Requirement diagram", c4: "C4 diagram", sankey: "Sankey diagram",
	block: "Block diagram", packet: "Packet diagram", kanban: "Kanban board", architecture: "Architecture diagram", radar: "Radar chart",
	treemap: "Treemap", info: "Info", agentflow: "Agent flow", usecase: "Use case diagram", railroad: "Railroad diagram",
	treeView: "Tree view", venn: "Venn diagram", cynefin: "Cynefin diagram", wardley: "Wardley map", swimlane: "Swimlane diagram",
	ishikawa: "Ishikawa diagram", eventmodeling: "Event model",
};

export interface Drawn {
	kind: string;
	light: Scene;
	/** The dark theme's, when its series colours differ. */
	dark?: Scene;
	label: string;
}

/** A Mermaid diagram drawn, light and dark. Throws saying what's wrong with it. */
export function drawMermaid(src: string, light: ColorValue[], dark: ColorValue[]): Drawn {
	const text = src.trim();
	if (!text) throw new Error("The diagram is empty.");
	const type = detectType(text);
	if (!type) {
		const first = text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("%%") && l !== "---") ?? "";
		throw new Error(`Swarm doesn't know this kind of Mermaid diagram: it starts with "${first.slice(0, 40)}".`);
	}
	const r = render(text, {
		measurer: { width: (t: string, size: number, style: number) => textWidth(t, size, style & BOLD ? 600 : 400) },
		fontSize: FONT,
		links: false,
		images: false,
		// The author's direction: a wide diagram scales down to fit rather than turning.
		autoDirection: false,
	});
	const kind = NAMES[r.type] ?? "Diagram";
	const lightScene = svgScene(r.svg, light);
	const series = /--pele-series-|--_s\d/.test(r.svg);
	const words = lightScene.texts.filter((t) => t.trim()).slice(0, 12).join(", ");
	return {
		kind,
		light: lightScene,
		dark: series ? svgScene(r.svg, dark) : undefined,
		label: lightScene.title || (words ? `${kind}: ${words}` : kind),
	};
}
