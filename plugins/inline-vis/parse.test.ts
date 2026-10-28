import { expect, test } from "swarm/testing";
import { drawChart, fmt, LIGHT, looseJSON, niceTicks, parseChart, slices } from "./src/chart";
import { drawMermaid, parseMermaid } from "./src/diagram";
import { parseFlowchart } from "./src/flow";
import { layout } from "./src/layout";
import { parseSequence } from "./src/sequence";
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

// ---- Mermaid ----

test("a flowchart's nodes, shapes, edges and labels", () => {
	const f = parseFlowchart(`flowchart LR
  A[Start] --> B{Is it?}
  B -->|Yes| C(Rounded) --- D([Stadium])
  B -- No --> E[(Database)]
  C -.-> F((Circle)) ==> G[["Sub (routine)"]]
  A & B --> H{{Hex}}
  H --x I>Flag] --o J[/Lean/]
  J <--> K["Quoted [brackets]"]
  K ~~~ A
  click A "https://example.com"
  classDef red fill:#f00
  A:::red`);
	expect(f.dir).toBe("LR");
	expect([...f.nodes.values()].map((n) => [n.id, n.shape, n.label])).toEqual([
		["A", "rect", "Start"], ["B", "rhombus", "Is it?"], ["C", "round", "Rounded"], ["D", "stadium", "Stadium"],
		["E", "cylinder", "Database"], ["F", "circle", "Circle"], ["G", "subroutine", "Sub (routine)"], ["H", "hexagon", "Hex"],
		["I", "asym", "Flag"], ["J", "lean-r", "Lean"], ["K", "rect", "Quoted [brackets]"],
	]);
	const e = (from: string, to: string) => f.edges.find((x) => x.from === from && x.to === to)!;
	expect(e("B", "C")).toMatchObject({ label: "Yes", head: "arrow", line: "solid" });
	expect(e("C", "D")).toMatchObject({ head: "none" });
	expect(e("B", "E")).toMatchObject({ label: "No", head: "arrow" });
	expect(e("C", "F")).toMatchObject({ line: "dotted" });
	expect(e("F", "G")).toMatchObject({ line: "thick" });
	expect(e("A", "H")).toBeTruthy();
	expect(e("B", "H")).toBeTruthy();
	expect(e("H", "I")).toMatchObject({ head: "cross" });
	expect(e("I", "J")).toMatchObject({ head: "circle" });
	expect(e("J", "K")).toMatchObject({ head: "arrow", tail: "arrow" });
	expect(e("K", "A")).toMatchObject({ line: "invisible" });
});

test("ids with dashes, and edges with no spaces", () => {
	const f = parseFlowchart("graph TD\n  my-node-->other_node\n  other_node-->|go|last;last---my-node");
	expect([...f.nodes.keys()]).toEqual(["my-node", "other_node", "last"]);
	expect(f.edges.map((e) => `${e.from}>${e.to}:${e.label}`)).toEqual(["my-node>other_node:", "other_node>last:go", "last>my-node:"]);
});

test("subgraphs hold their nodes; an edge to one goes to its first node", () => {
	const f = parseFlowchart(`flowchart TB
  subgraph one [The first]
    a1 --> a2
  end
  subgraph two
    b1
  end
  c --> one
  two --> c`);
	expect(f.clusters.map((c) => [c.id, c.title, c.nodes])).toEqual([["one", "The first", ["a1", "a2"]], ["two", "two", ["b1"]]]);
	expect(f.edges.map((e) => e.from + ">" + e.to)).toEqual(["a1>a2", "c>a1", "b1>c"]);
	expect(f.nodes.has("one")).toBe(false);
});

test("labels lose Mermaid's markup", () => {
	const f = parseFlowchart('flowchart TD\n  A["**Bold** line<br/>next #quot;quoted#quot;"]');
	expect(f.nodes.get("A")!.label).toBe('Bold line\nnext "quoted"');
});

test("a sequence diagram's participants, messages, notes and blocks", () => {
	const s = parseSequence(`sequenceDiagram
  title Checkout
  actor U as User
  participant S as Server
  autonumber
  U->>+S: POST /pay
  S-->>-U: 200
  S-)U: webhook
  S-xU: gone
  Note over U,S: Both see it
  loop Every second
    U->>S: poll
  end
  alt ok
    S->>S: retry
  else failed
    S--)U: error
  end`);
	expect(s.title).toBe("Checkout");
	expect(s.participants).toEqual([{ id: "U", label: "User", actor: true }, { id: "S", label: "Server", actor: false }]);
	const msgs = s.events.filter((e) => e.kind === "message") as any[];
	expect(msgs.map((m) => [m.from, m.to, m.text, m.dotted, m.head, m.activate ?? "", m.n])).toEqual([
		["U", "S", "POST /pay", false, "arrow", "+", 1],
		["S", "U", "200", true, "arrow", "-", 2],
		["S", "U", "webhook", false, "async", "", 3],
		["S", "U", "gone", false, "cross", "", 4],
		["U", "S", "poll", false, "arrow", "", 5],
		["S", "S", "retry", false, "arrow", "", 6],
		["S", "U", "error", true, "async", "", 7],
	]);
	expect(s.events.filter((e) => e.kind === "open" || e.kind === "else" || e.kind === "close").map((e) => e.kind)).toEqual(["open", "close", "open", "else", "close"]);
	expect(drawMermaid({ kind: "sequence", seq: s }).texts).toContain("Both see it");
});

test("a state diagram's start, end, composites and transitions", () => {
	const d = parseMermaid(`stateDiagram-v2
  direction LR
  [*] --> Idle
  state "Waiting for input" as Idle
  Idle --> Busy : go
  state Busy {
    [*] --> Working
    Working --> [*]
  }
  Busy --> [*]
  Idle : Nothing to do`);
	if (d.kind !== "state") throw new Error("not a state diagram");
	expect(d.flow.dir).toBe("LR");
	expect(d.flow.nodes.get("Idle")!.label).toBe("Waiting for input\nNothing to do");
	expect(d.flow.clusters.map((c) => c.id)).toEqual(["Busy"]);
	// The transition into Busy goes to its start.
	expect(d.flow.edges.find((e) => e.from === "Idle")!.to).toBe("[*]startBusy");
	expect(drawMermaid(d).width).toBeGreaterThan(100);
});

test("a pie is a chart; other kinds say which Swarm draws", () => {
	const d = parseMermaid('pie showData\n  title Pets\n  "Dogs" : 386\n  "Cats" : 85.5');
	expect(d.kind).toBe("pie");
	if (d.kind === "pie") expect(d.chart).toMatchObject({ type: "pie", title: "Pets", x: ["Dogs", "Cats"] });
	expect(() => parseMermaid("gantt\n  title x")).toThrow("Swarm draws Mermaid's flowchart, sequenceDiagram, stateDiagram-v2, pie; not gantt.");
	expect(() => parseMermaid("---\ntitle: x\n---\nflowchart TD\n  A --> B")).not.toThrow();
	expect(() => parseMermaid("%%{init: {'theme': 'dark'}}%%\ngraph LR\n  A --> B")).not.toThrow();
	expect(() => parseMermaid("flowchart TD\n  A[open --> B")).toThrow("isn't closed");
});

// ---- Layout ----

test("a layout ranks, keeps nodes apart, and survives cycles and self loops", () => {
	const nodes = ["a", "b", "c", "d"].map((id) => ({ id, w: 60, h: 30 }));
	const L = layout(nodes, [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }, { from: "a", to: "d" }, { from: "d", to: "d" }], "TB");
	const p = (id: string) => L.nodes.get(id)!;
	expect(p("a").y).toBeLessThan(p("b").y);
	expect(p("b").y).toBeLessThan(p("c").y);
	for (const x of nodes) for (const y of nodes) {
		if (x === y) continue;
		const A = p(x.id), B = p(y.id);
		const apart = Math.abs(A.x - B.x) >= (A.w + B.w) / 2 || Math.abs(A.y - B.y) >= (A.h + B.h) / 2;
		expect(apart).toBe(true);
	}
	// The cycle's back edge still runs from c to a.
	const back = L.edges[2].points;
	expect(back[0]).toEqual({ x: p("c").x, y: p("c").y });
	expect(back[back.length - 1]).toEqual({ x: p("a").x, y: p("a").y });
	expect(L.edges[4].points).toHaveLength(2);
});

test("LR turns the layout", () => {
	const L = layout([{ id: "a", w: 80, h: 30 }, { id: "b", w: 80, h: 30 }], [{ from: "a", to: "b" }], "LR");
	expect(L.nodes.get("a")!.x).toBeLessThan(L.nodes.get("b")!.x);
	expect(L.nodes.get("a")!.y).toBe(L.nodes.get("b")!.y);
});

test("a big flowchart lays out quickly", () => {
	const lines = ["flowchart TD"];
	for (let i = 0; i < 120; i++) lines.push(`  n${i}[Node ${i}] --> n${(i * 7 + 3) % 120}[Node ${(i * 7 + 3) % 120}]`);
	const t0 = Date.now();
	const s = drawMermaid(parseMermaid(lines.join("\n")));
	expect(s.width).toBeGreaterThan(0);
	expect(Date.now() - t0).toBeLessThan(2000);
});
