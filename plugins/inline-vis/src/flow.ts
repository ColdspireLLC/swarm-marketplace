// Mermaid's flowcharts (flowchart, graph) and state diagrams (stateDiagram,
// stateDiagram-v2), read into one graph for the layout.

export type Dir = "TB" | "BT" | "LR" | "RL";

export type Shape =
	| "rect" | "round" | "stadium" | "subroutine" | "cylinder" | "circle" | "doublecircle"
	| "asym" | "rhombus" | "hexagon" | "lean-r" | "lean-l" | "trap-t" | "trap-b"
	| "start" | "end" | "fork" | "choice";

export interface FlowNode {
	id: string;
	label: string;
	shape: Shape;
}

export interface FlowEdge {
	from: string;
	to: string;
	label: string;
	/** solid, dotted, thick or invisible. */
	line: "solid" | "dotted" | "thick" | "invisible";
	/** The ends' marks: none, arrow, cross or circle. */
	head: "none" | "arrow" | "cross" | "circle";
	tail: "none" | "arrow" | "cross" | "circle";
}

export interface Cluster {
	id: string;
	title: string;
	/** Its nodes and the clusters in it, by ID. */
	nodes: string[];
	parent?: string;
}

export interface Flow {
	kind: "flowchart" | "state";
	dir: Dir;
	nodes: Map<string, FlowNode>;
	edges: FlowEdge[];
	clusters: Cluster[];
}

/** A label as Mermaid writes it, as text: quotes, <br>, entities, Markdown's ** and backticks gone. */
export function cleanLabel(s: string): string {
	s = s.trim();
	if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1);
	if (s.length >= 2 && s[0] === "`" && s[s.length - 1] === "`") s = s.slice(1, -1);
	return s
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/\\n/g, "\n")
		.replace(/<\/?[a-z][^>]*>/gi, "")
		.replace(/#quot;/g, '"')
		.replace(/#(\d+);/g, (_, n) => String.fromCodePoint(+n))
		.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, "$1$2")
		.split("\n").map((l) => l.trim()).join("\n");
}

// Openers of a node's shape, longest first, with each one's closer.
const SHAPES: [string, string, Shape][] = [
	["(((", ")))", "doublecircle"],
	["((", "))", "circle"],
	["([", "])", "stadium"],
	["[[", "]]", "subroutine"],
	["[(", ")]", "cylinder"],
	["[/", "/]", "lean-r"],
	["[\\", "\\]", "lean-l"],
	["{{", "}}", "hexagon"],
	["(", ")", "round"],
	["[", "]", "rect"],
	["{", "}", "rhombus"],
	[">", "]", "asym"],
];

const ID = /^[\p{L}\p{N}_$][\p{L}\p{N}_$.\-]*/u;

// An edge's text form, `A -- text --> B`, then its plain one.
const EDGE_TEXT = /^(<|x|o)?(--|==|-\.)(?![->=.ox])\s*(.+?)\s*(-{2,}>|={2,}>|\.-+>|-{3,}|={3,}|\.-+|-{2,}[xo]|={2,}[xo])(?=[\s\p{L}\p{N}_"]|$)/u;
const EDGE = /^(<|x(?=-)|o(?=-))?(-{2,}|={2,}|-\.+-|~{3,})(>|[xo](?=[\s|]|$))?/;

function stripEnd(s: string) {
	// "A:::class", and Mermaid's newer A@{ … }.
	return s.replace(/:::[\w-]+$/, "");
}

class FlowReader {
	flow: Flow;
	stack: Cluster[] = [];
	constructor(kind: Flow["kind"], dir: Dir) {
		this.flow = { kind, dir, nodes: new Map(), edges: [], clusters: [] };
	}

	node(id: string, label?: string, shape?: Shape): string {
		let n = this.flow.nodes.get(id);
		if (!n) {
			n = { id, label: id, shape: "rect" };
			this.flow.nodes.set(id, n);
			const c = this.stack[this.stack.length - 1];
			if (c && !c.nodes.includes(id)) c.nodes.push(id);
		}
		if (label !== undefined) n.label = cleanLabel(label);
		if (shape) n.shape = shape;
		return id;
	}

	/** One node at s[i], its shape and label if it has them: its ID and where it ends. */
	readNode(s: string, i: number): [string, number] | null {
		const m = ID.exec(s.slice(i));
		if (!m) return null;
		let id = m[0];
		// An ID can't end in what starts an edge: A-->B, A---B, A-.->B.
		const cut = id.search(/(--|-\.|==|-$|\.$)/);
		if (cut > 0) id = id.slice(0, cut);
		let j = i + id.length;
		for (const [open, close, shape] of SHAPES) {
			if (!s.startsWith(open, j)) continue;
			let k = j + open.length;
			while (s[k] === " ") k++;
			let end: number;
			if (s[k] === '"') {
				const q = s.indexOf('"', k + 1);
				end = q < 0 ? -1 : s.indexOf(close, q + 1);
			} else {
				end = s.indexOf(close, k);
			}
			if (end < 0) throw new Error(`${id}'s ${open}…${close} isn't closed.`);
			this.node(id, s.slice(j + open.length, end), shape);
			j = end + close.length;
			break;
		}
		if (j === i + id.length) this.node(id);
		const cls = /^:::[\w-]+/.exec(s.slice(j));
		if (cls) j += cls[0].length;
		if (s[j] === "@" && s[j + 1] === "{") {
			const end = s.indexOf("}", j);
			j = end < 0 ? s.length : end + 1;
		}
		return [id, j];
	}

	/** A & B & C at s[i]. */
	readGroup(s: string, i: number): [string[], number] | null {
		const ids: string[] = [];
		for (;;) {
			while (s[i] === " ") i++;
			const r = this.readNode(s, i);
			if (!r) return ids.length ? [ids, i] : null;
			ids.push(r[0]);
			i = r[1];
			let k = i;
			while (s[k] === " ") k++;
			if (s[k] !== "&") return [ids, i];
			i = k + 1;
		}
	}

	readEdge(s: string, i: number): [Omit<FlowEdge, "from" | "to">, number] | null {
		while (s[i] === " ") i++;
		const rest = s.slice(i);
		let label = "";
		let body: string, open: string | undefined, close: string | undefined, len: number;
		const t = EDGE_TEXT.exec(rest);
		if (t) {
			open = t[1];
			label = t[3];
			body = t[2] + t[4];
			close = /[>xo]$/.test(t[4]) ? t[4].slice(-1) : undefined;
			len = t[0].length;
		} else {
			const e = EDGE.exec(rest);
			if (!e) return null;
			open = e[1];
			body = e[2];
			close = e[3];
			len = e[0].length;
		}
		let j = i + len;
		const pipe = /^\s*\|([^|]*)\|/.exec(s.slice(j));
		if (pipe) {
			label = pipe[1];
			j += pipe[0].length;
		}
		const mark = (c?: string): FlowEdge["head"] => (c === ">" || c === "<" ? "arrow" : c === "x" ? "cross" : c === "o" ? "circle" : "none");
		return [{
			label: cleanLabel(label),
			line: body.includes("~") ? "invisible" : body.includes(".") ? "dotted" : body.includes("=") ? "thick" : "solid",
			head: mark(close),
			tail: mark(open),
		}, j];
	}

	statement(s: string) {
		let r = this.readGroup(s, 0);
		if (!r) throw new Error(`Can't read "${s}".`);
		let [from, i] = r;
		for (;;) {
			while (s[i] === " ") i++;
			if (i >= s.length) return;
			const e = this.readEdge(s, i);
			if (!e) throw new Error(`Can't read "${s.slice(i)}" in "${s}".`);
			const g = this.readGroup(s, e[1]);
			if (!g) throw new Error(`An edge needs a node after it: "${s}".`);
			for (const a of from) for (const b of g[0]) this.flow.edges.push({ from: a, to: b, ...e[0] });
			from = g[0];
			i = g[1];
		}
	}

	open(id: string, title: string) {
		const c: Cluster = { id, title: cleanLabel(title), nodes: [], parent: this.stack[this.stack.length - 1]?.id };
		const parent = this.stack[this.stack.length - 1];
		if (parent) parent.nodes.push(id);
		this.flow.clusters.push(c);
		this.stack.push(c);
	}

	close() {
		this.stack.pop();
	}
}

function lines(src: string): string[] {
	return src
		.split("\n")
		.flatMap((l) => (l.includes("%%") ? [l.replace(/%%.*$/, "")] : l.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)))
		.map((l) => l.trim())
		.filter(Boolean);
}

const SKIP = /^(classDef|class|style|linkStyle|click|accTitle|accDescr|direction)\b/;

export function parseFlowchart(src: string): Flow {
	const ls = lines(src);
	const head = /^(flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?\s*$/i.exec(ls[0] ?? "");
	if (!head) throw new Error("A flowchart starts with flowchart TD (or LR, BT, RL).");
	const d = (head[2] ?? "TB").toUpperCase();
	const r = new FlowReader("flowchart", (d === "TD" ? "TB" : d) as Dir);
	for (const l of ls.slice(1)) {
		if (SKIP.test(l)) continue;
		const sub = /^subgraph\s+(.*)$/.exec(l);
		if (sub) {
			const m = /^([^\s\[]+)\s*\[(.*)\]\s*$/.exec(sub[1]);
			if (m) r.open(m[1], m[2]);
			else if (/^"/.test(sub[1])) r.open("sg" + r.flow.clusters.length, sub[1]);
			else r.open(sub[1].split(/\s+/)[0], sub[1]);
			continue;
		}
		if (l === "end") {
			r.close();
			continue;
		}
		r.statement(l);
	}
	redirectClusters(r.flow);
	if (!r.flow.nodes.size) throw new Error("The flowchart has no nodes.");
	return r.flow;
}

/** An edge to a subgraph goes to the first node in it. */
function redirectClusters(f: Flow) {
	const first = (id: string): string | undefined => {
		const c = f.clusters.find((c) => c.id === id);
		if (!c) return id;
		for (const n of c.nodes) {
			const r = first(n);
			if (r && f.nodes.has(r) && !f.clusters.some((k) => k.id === r)) return r;
		}
		return undefined;
	};
	for (const c of f.clusters) {
		if (!f.nodes.has(c.id)) continue;
		// A node made of the subgraph's own ID, by an edge to it.
		if (!c.nodes.length) continue;
		f.nodes.delete(c.id);
		for (const k of f.clusters) k.nodes = k.nodes.filter((n) => n !== c.id || k.id === c.parent);
	}
	f.edges = f.edges.flatMap((e) => {
		const from = first(e.from), to = first(e.to);
		return from && to ? [{ ...e, from, to }] : [];
	});
}

// ---- State diagrams ----

export function parseState(src: string): Flow {
	const ls = lines(src);
	if (!/^stateDiagram(-v2)?\s*$/.test(ls[0] ?? "")) throw new Error("A state diagram starts with stateDiagram-v2.");
	const r = new FlowReader("state", "TB");
	let scope = "";
	const scopes: string[] = [];
	const start = () => r.node(`[*]start${scope}`, "", "start");
	const end = () => r.node(`[*]end${scope}`, "", "end");
	const state = (name: string) => {
		const n = name.trim();
		const special = /^(.*?)\s*<<(fork|join|choice)>>$/.exec(n);
		if (special) return r.node(special[1], "", special[2] === "choice" ? "choice" : "fork");
		const id = r.node(n);
		const node = r.flow.nodes.get(id)!;
		if (node.shape === "rect") node.shape = "round";
		return id;
	};
	let inNote = false;
	for (const l of ls.slice(1)) {
		if (inNote) {
			if (/^end note$/i.test(l)) inNote = false;
			continue;
		}
		if (/^note\s/i.test(l)) {
			if (!l.includes(":")) inNote = true;
			continue;
		}
		const dir = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(l);
		if (dir) {
			if (!scopes.length) r.flow.dir = (dir[1].toUpperCase() === "TD" ? "TB" : dir[1].toUpperCase()) as Dir;
			continue;
		}
		if (SKIP.test(l) || l === "--" || /^hide empty description$/.test(l)) continue;
		const as = /^state\s+"([^"]*)"\s+as\s+([\w$.-]+)\s*(\{)?$/.exec(l);
		if (as) {
			const id = state(as[2]);
			r.flow.nodes.get(id)!.label = cleanLabel(as[1]);
			if (as[3]) {
				r.open(id, as[1]);
				scopes.push(scope);
				scope = id;
			}
			continue;
		}
		const comp = /^state\s+([\w$.-]+)\s*(<<\w+>>)?\s*(\{)?$/.exec(l);
		if (comp) {
			if (comp[3]) {
				r.open(comp[1], comp[1]);
				scopes.push(scope);
				scope = comp[1];
			} else {
				state(comp[1] + (comp[2] ? " " + comp[2] : ""));
			}
			continue;
		}
		if (l === "}") {
			r.close();
			scope = scopes.pop() ?? "";
			continue;
		}
		const tr = /^(.+?)\s*-->\s*(.+?)\s*(?::\s*(.*))?$/.exec(l);
		if (tr) {
			const from = tr[1] === "[*]" ? start() : state(tr[1]);
			const to = tr[2] === "[*]" ? end() : state(tr[2]);
			r.flow.edges.push({ from, to, label: cleanLabel(tr[3] ?? ""), line: "solid", head: "arrow", tail: "none" });
			continue;
		}
		const desc = /^([\w$.-]+)\s*:\s*(.*)$/.exec(l);
		if (desc) {
			const id = state(desc[1]);
			const n = r.flow.nodes.get(id)!;
			n.label = n.label === id ? cleanLabel(desc[2]) : n.label + "\n" + cleanLabel(desc[2]);
			continue;
		}
		state(l);
	}
	redirectClusters(r.flow);
	if (!r.flow.nodes.size) throw new Error("The state diagram has no states.");
	return r.flow;
}
