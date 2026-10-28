import { expect, test } from "swarm/testing";
import { DARK, drawChart, fmt, LIGHT, looseJSON, niceTicks, parseChart, slices } from "./src/chart";
import { drawMermaid } from "./src/mermaid";
import { colorOf, dashes, flatten, parseXML, svgScene } from "./src/svgcanvas";
import { clip, textWidth, wrap } from "./src/text";

// ---- Charts ----

test("numbers read as a chart writes them", () => {
	expect([0, 5, 60, 100, 250, 1.5, 0.25, 12000, 3.4e6, 2e9, -40].map(fmt)).toEqual(["0", "5", "60", "100", "250", "1.5", "0.25", "12k", "3.4M", "2B", "-40"]);
});

test("ticks are round, and cover the data", () => {
	expect(niceTicks(0, 58)).toEqual([0, 20, 40, 60]);
	expect(niceTicks(0, 58, 6)).toEqual([0, 10, 20, 30, 40, 50, 60]);
	expect(niceTicks(0.2, 0.9, 4)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
	expect(niceTicks(5, 5).length).toBeGreaterThan(1);
});

test("a chart's JSON forgives comments and trailing commas", () => {
	expect(JSON.parse(looseJSON('{ "a": [1, 2,], // two\n "b": "x // not a comment", /* c */ }'))).toEqual({ a: [1, 2], b: "x // not a comment" });
});

test("a chart says what's wrong with it", () => {
	expect(() => parseChart("{")).toThrow("The chart isn't JSON");
	expect(() => parseChart('{ "type": "radar" }')).toThrow('"type" is one of bar, line, area, scatter, pie, donut, not "radar".');
	expect(() => parseChart('{ "type": "bar" }')).toThrow('A chart needs "series"');
	expect(() => parseChart('{ "type": "bar", "series": [{ "name": "a", "data": [1, "two"] }] }')).toThrow("a has something else");
	expect(() => parseChart('{ "type": "scatter", "series": [{ "name": "a", "data": [1, 2] }] }')).toThrow("[x, y] pairs");
	expect(() => parseChart('{ "type": "pie", "data": [{ "label": "a", "value": -1 }] }')).toThrow("can't be negative");
	const nine = JSON.stringify({ type: "line", series: Array.from({ length: 9 }, (_, i) => ({ name: "s" + i, data: [1] })) });
	expect(() => parseChart(nine)).toThrow("8 series at most");
});

test("one data array is one series; numbers in strings are numbers", () => {
	const c = parseChart('{ "type": "bar", "labels": ["a", "b"], "data": ["3", 4], "title": "T" }');
	expect(c.x).toEqual(["a", "b"]);
	expect(c.series).toEqual([{ name: "T", data: [3, 4] }]);
});

test("a pie past eight slices folds the smallest into Other", () => {
	const c = parseChart(JSON.stringify({ type: "pie", data: Array.from({ length: 10 }, (_, i) => ({ label: "s" + i, value: 10 - i })) }));
	const s = slices(c);
	expect(s).toHaveLength(8);
	expect(s[7]).toEqual({ label: "Other", value: 3 + 2 + 1 });
});

test("every kind lays out inside its canvas, with its labels", () => {
	for (const type of ["bar", "line", "area"]) {
		const s = drawChart(parseChart(JSON.stringify({ type, title: "Runs", x: ["Mon", "Tue"], series: [{ name: "A", data: [3, -2] }, { name: "B", data: [null, 5] }], stacked: type !== "line" })), LIGHT);
		expect(s.width).toBe(640);
		expect(s.texts).toContain("Runs");
		expect(s.texts).toContain("Mon");
		expect(s.texts).toContain("B");
	}
	const h = drawChart(parseChart('{ "type": "bar", "horizontal": true, "x": ["a long label"], "data": [4], "unit": "k lines" }'), LIGHT);
	expect(h.texts).toContain("a long label");
	expect(h.texts).toContain("k lines");
	expect(h.texts).not.toContain("4 k lines");
});

// ---- Text ----

test("text widths are Inter's", () => {
	expect(Math.round(textWidth("Hello", 13))).toBe(31);
	expect(textWidth("WWW", 13, 600)).toBeGreaterThan(textWidth("WWW", 13));
	expect(wrap("one two three four", 13, 64)).toEqual(["one two", "three four"]);
	expect(wrap("a\nb", 13, 600)).toEqual(["a", "b"]);
	expect(clip("internal/plugins/sdk", 12, 60).endsWith("…")).toBe(true);
});

// ---- Mermaid, through pele ----

const KINDS: { [kind: string]: string } = {
	"Flowchart": "flowchart TD\n  A[Start] --> B{Is it?}\n  B -->|Yes| C(Rounded)\n  B -.-> D[(Database)]",
	"Sequence diagram": "sequenceDiagram\n  autonumber\n  actor U as User\n  U->>+S: POST /pay\n  S-->>-U: 200\n  Note over U,S: Both see it\n  loop Every second\n    U->>S: poll\n  end",
	"Class diagram": "classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  Animal <|-- Duck",
	"State diagram": "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : go\n  Busy --> [*]",
	"Entity relationship diagram": "erDiagram\n  CUSTOMER ||--o{ ORDER : places",
	"Pie chart": 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85',
	"Gantt chart": "gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2024-01-01, 3d\n  Next :after a1, 2d",
	"Git graph": "gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev",
	"Mind map": "mindmap\n  root((Swarm))\n    Plugins\n    Threads",
	"Timeline": "timeline\n  title History\n  2020 : One\n  2021 : Two",
	"XY chart": 'xychart-beta\n  title "Sales"\n  x-axis [jan, feb, mar]\n  y-axis "Revenue" 0 --> 100\n  bar [50, 60, 75]\n  line [40, 55, 80]',
	"Quadrant chart": "quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]",
	"Sankey diagram": "sankey-beta\n  A,B,10\n  A,C,5",
	"User journey": "journey\n  title My day\n  section Work\n    Code: 5: Me",
	"Kanban board": "kanban\n  Todo\n    [Write tests]\n  Done\n    [Ship]",
	"Block diagram": "block-beta\n  columns 3\n  a[\"Parse\"] b[\"Lay out\"] c[\"Draw\"]\n  a --> b\n  b --> c",
	"Packet diagram": "packet-beta\n  0-15: \"Source port\"\n  16-31: \"Destination port\"",
	"Architecture diagram": "architecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service server(server)[Server] in api\n  db:L -- R:server",
	"Radar chart": "radar-beta\n  axis a[\"Speed\"], b[\"Size\"], c[\"Cost\"]\n  curve x[\"Swarm\"]{4, 3, 5}",
	"Treemap": "treemap-beta\n\"Code\"\n    \"gui\": 48\n    \"core\": 31",
	"Requirement diagram": "requirementDiagram\n  requirement fast {\n    id: 1\n    text: Starts fast\n    risk: low\n    verifymethod: test\n  }\n  element app {\n    type: app\n  }\n  app - satisfies -> fast",
	"C4 diagram": "C4Context\n  Person(user, \"User\")\n  System(swarm, \"Swarm\")\n  Rel(user, swarm, \"Uses\")",
};

test("each kind of Mermaid diagram is drawn, named and labelled", () => {
	for (const [kind, src] of Object.entries(KINDS)) {
		let d;
		try {
			d = drawMermaid(src, LIGHT, LIGHT);
		} catch (e) {
			throw new Error(kind + ": " + e);
		}
		expect([kind, d.kind]).toEqual([kind, kind]);
		expect(d.light.width).toBeGreaterThan(40);
		expect(d.light.ops.length).toBeGreaterThan(3);
	}
	const seq = drawMermaid(KINDS["Sequence diagram"], LIGHT, LIGHT);
	expect(seq.light.texts).toContain("Both see it");
	expect(seq.light.texts).toContain("User");
});

test("a diagram that isn't Mermaid, or is wrong, says why", () => {
	expect(() => drawMermaid("", LIGHT, LIGHT)).toThrow("The diagram is empty.");
	expect(() => drawMermaid("hello there", LIGHT, LIGHT)).toThrow('Swarm doesn\'t know this kind of Mermaid diagram: it starts with "hello there".');
	expect(() => drawMermaid("sequenceDiagram\n  A->>", LIGHT, LIGHT)).toThrow();
});

test("a series' colours are the theme's", () => {
	const d = drawMermaid(KINDS["Pie chart"], LIGHT, DARK);
	expect(d.dark).toBeTruthy();
	expect(drawMermaid(KINDS["Flowchart"], LIGHT, DARK).dark).toBe(undefined);
});

test("a big flowchart is drawn quickly", () => {
	const lines = ["flowchart TD"];
	for (let i = 0; i < 120; i++) lines.push(`  n${i}[Node ${i}] --> n${(i * 7 + 3) % 120}[Node ${(i * 7 + 3) % 120}]`);
	const t0 = Date.now();
	expect(drawMermaid(lines.join("\n"), LIGHT, LIGHT).light.width).toBeGreaterThan(0);
	expect(Date.now() - t0).toBeLessThan(5000);
});

// ---- SVG to canvas ----

test("SVG is read: attributes either quoted, entities, comments, self-closing", () => {
	const doc = parseXML(`<?xml version="1.0"?><!-- c --><svg viewBox='0 0 10 10'><g fill="red"><rect x="1" width="2"/><text>a &amp; b &lt;c&gt;</text></g></svg>`);
	const svg = doc.children[0] as any;
	expect(svg.tag).toBe("svg");
	expect(svg.attrs.viewBox).toBe("0 0 10 10");
	expect(svg.children[0].children[0]).toEqual({ tag: "rect", attrs: { x: "1", width: "2" }, children: [] });
	expect(svg.children[0].children[1].children).toEqual(["a & b <c>"]);
});

test("pele's colours are Swarm's", () => {
	expect(colorOf("var(--_fg)", LIGHT)).toBe("text");
	expect(colorOf("var(--pele-line,#1f1f1f)", LIGHT)).toBe("text2");
	expect(colorOf("var(--_s)", LIGHT)).toBe("field");
	expect(colorOf("var(--pele-series-2)", DARK)).toBe(DARK[1]);
	expect(colorOf("var(--nope, #123456)", LIGHT)).toBe("#123456");
	expect(colorOf("none", LIGHT)).toBe(null);
	expect(colorOf(undefined, LIGHT)).toBe(undefined);
});

test("paths flatten, arcs and curves included, and dash", () => {
	const [line] = flatten("M0,0L10,0H20V10");
	expect(line).toEqual([0, 0, 10, 0, 20, 0, 20, 10]);
	const [curve] = flatten("M0,0C0,10 10,10 10,0");
	expect(Math.round(curve[curve.length - 2])).toBe(10);
	const [arc] = flatten("M0,0A5,5 0 0 1 10,0");
	expect(Math.round(arc[arc.length - 2])).toBe(10);
	expect(Math.min(...arc.filter((_, i) => i % 2 === 1))).toBeLessThan(-4.9);
	const rel = flatten("m5,5l5,0z");
	expect(rel[0]).toEqual([5, 5, 10, 5, 5, 5]);
	const d = dashes([0, 0, 20, 0], [4, 4]);
	expect(d.map((s) => [s[0], s[s.length - 2]])).toEqual([[0, 4], [8, 12], [16, 20]]);
});

test("an SVG's text is laid at its baseline, anchored as a line", () => {
	const s = svgScene(`<svg width="100" height="40"><text x="50" y="20" text-anchor="middle" font-size="10"><tspan x="50" y="20">one</tspan><tspan x="50" y="32">two</tspan></text></svg>`, LIGHT);
	expect(s.texts).toEqual(["one", "two"]);
	expect(s.width).toBe(100);
});
