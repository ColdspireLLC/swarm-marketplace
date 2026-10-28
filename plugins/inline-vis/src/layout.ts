import type { Dir } from "./flow";

// A layered drawing of a directed graph (Sugiyama's way, as dagre lays out
// Mermaid's): cycles broken, nodes ranked, edges longer than a rank given
// a point in each one they cross, ranks ordered to cross fewer edges, and
// each node placed over its neighbours. TB is laid out; the others are it
// turned.

export interface LNode {
	id: string;
	w: number;
	h: number;
	/** The cluster it's in, innermost, if any. */
	cluster?: string;
}

export interface LEdge {
	from: string;
	to: string;
	/** A label's size, when it has one. */
	lw?: number;
	lh?: number;
}

export interface Placed {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Routed {
	/** From the edge's source to its target, through the ranks between. */
	points: { x: number; y: number }[];
	/** The label's centre. */
	label?: { x: number; y: number };
}

export interface Layout {
	nodes: Map<string, Placed>;
	edges: Routed[];
	width: number;
	height: number;
}

interface V {
	id: string;
	w: number;
	h: number;
	rank: number;
	order: number;
	x: number;
	y: number;
	cluster?: string;
	dummy: boolean;
}

export interface Gaps {
	node: number;
	rank: number;
	/** Between nodes of different clusters, for the clusters' boxes. */
	cluster: number;
}

/** parents names each cluster's own cluster, for clusters in clusters. */
export function layout(nodes: LNode[], edges: LEdge[], dir: Dir, gaps: Gaps = { node: 28, rank: 44, cluster: 28 }, parents = new Map<string, string | undefined>()): Layout {
	const across = dir === "LR" || dir === "RL";
	// Laid out top to bottom: across, a node's width is its height.
	const vs = new Map<string, V>();
	for (const n of nodes) vs.set(n.id, { id: n.id, w: across ? n.h : n.w, h: across ? n.w : n.h, rank: 0, order: 0, x: 0, y: 0, cluster: n.cluster, dummy: false });
	const es = edges.filter((e) => vs.has(e.from) && vs.has(e.to));

	// 1. Break cycles: an edge back to a node on the walk's stack turns round.
	const out = new Map<string, number[]>();
	es.forEach((e, i) => {
		if (!out.has(e.from)) out.set(e.from, []);
		out.get(e.from)!.push(i);
	});
	const reversed = new Set<number>();
	const state = new Map<string, number>();
	const walk = (v: string) => {
		state.set(v, 1);
		for (const i of out.get(v) ?? []) {
			const t = es[i].to;
			if (t === v) continue;
			if (state.get(t) === 1) reversed.add(i);
			else if (!state.has(t)) walk(t);
		}
		state.set(v, 2);
	};
	for (const n of nodes) if (!state.has(n.id)) walk(n.id);
	const dag = es
		.map((e, i) => ({ i, from: reversed.has(i) ? e.to : e.from, to: reversed.has(i) ? e.from : e.to, e }))
		.filter((d) => d.from !== d.to);

	// 2. Ranks: the longest path from a source; a labelled graph's edges take two ranks, their labels in the middle one.
	const labelled = es.some((e) => e.lw);
	const minlen = labelled ? 2 : 1;
	const preds = new Map<string, typeof dag>();
	const succs = new Map<string, typeof dag>();
	for (const d of dag) {
		(preds.get(d.to) ?? preds.set(d.to, []).get(d.to)!).push(d);
		(succs.get(d.from) ?? succs.set(d.from, []).get(d.from)!).push(d);
	}
	const ranked = new Map<string, number>();
	const rankOf = (v: string, seen = new Set<string>()): number => {
		if (ranked.has(v)) return ranked.get(v)!;
		if (seen.has(v)) return 0;
		seen.add(v);
		let r = 0;
		for (const d of preds.get(v) ?? []) r = Math.max(r, rankOf(d.from, seen) + minlen);
		ranked.set(v, r);
		return r;
	};
	for (const v of vs.values()) v.rank = rankOf(v.id);
	// A source sits just above the first node it leads to.
	for (const v of vs.values()) {
		if ((preds.get(v.id) ?? []).length) continue;
		const s = succs.get(v.id) ?? [];
		if (s.length) v.rank = Math.max(v.rank, Math.min(...s.map((d) => vs.get(d.to)!.rank)) - minlen);
	}

	// 3. Long edges get a point in each rank they cross.
	interface Seg { from: string; to: string }
	const chains: { edge: number; reversed: boolean; ids: string[]; labelAt?: string }[] = [];
	const segs: Seg[] = [];
	let dn = 0;
	for (const d of dag) {
		const a = vs.get(d.from)!, b = vs.get(d.to)!;
		const ids = [a.id];
		const mid = Math.floor((a.rank + b.rank) / 2);
		let labelAt: string | undefined;
		for (let r = a.rank + 1; r < b.rank; r++) {
			const id = `\0d${dn++}`;
			const isLabel = !!d.e.lw && r === mid;
			const w = isLabel ? d.e.lw! : 2, h = isLabel ? d.e.lh! : 2;
			vs.set(id, { id, w: across ? h : w, h: across ? w : h, rank: r, order: 0, x: 0, y: 0, dummy: true, cluster: sameCluster(a, b) });
			if (isLabel) labelAt = id;
			ids.push(id);
		}
		ids.push(b.id);
		for (let k = 1; k < ids.length; k++) segs.push({ from: ids[k - 1], to: ids[k] });
		chains.push({ edge: d.i, reversed: reversed.has(d.i), ids, labelAt });
	}
	for (const [i, e] of es.entries()) {
		if (e.from === e.to) chains.push({ edge: i, reversed: false, ids: [e.from, e.to] });
	}

	// 4. Order each rank to cross fewer edges: barycentres, down and up, a cluster's nodes kept together.
	const maxRank = Math.max(0, ...[...vs.values()].map((v) => v.rank));
	const ranks: V[][] = Array.from({ length: maxRank + 1 }, () => []);
	// First as a walk from the sources finds them, so the source's order shows.
	const seen = new Set<string>();
	const segOut = new Map<string, string[]>();
	const segIn = new Map<string, string[]>();
	for (const s of segs) {
		(segOut.get(s.from) ?? segOut.set(s.from, []).get(s.from)!).push(s.to);
		(segIn.get(s.to) ?? segIn.set(s.to, []).get(s.to)!).push(s.from);
	}
	const visit = (id: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		ranks[vs.get(id)!.rank].push(vs.get(id)!);
		for (const t of segOut.get(id) ?? []) visit(t);
	};
	for (const n of nodes) if (!(segIn.get(n.id) ?? []).length) visit(n.id);
	for (const v of vs.values()) visit(v.id);
	const number = () => ranks.forEach((r) => r.forEach((v, i) => (v.order = i)));
	number();
	const crossings = () => {
		let n = 0;
		for (let r = 0; r < maxRank; r++) {
			const pairs: [number, number][] = [];
			for (const v of ranks[r]) for (const t of segOut.get(v.id) ?? []) pairs.push([v.order, vs.get(t)!.order]);
			for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
				if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) n++;
			}
		}
		return n;
	};
	let best = ranks.map((r) => r.slice());
	let bestN = crossings();
	for (let it = 0; it < 16 && bestN > 0; it++) {
		const down = it % 2 === 0;
		const order = down ? ranks.map((_, i) => i).slice(1) : ranks.map((_, i) => i).reverse().slice(1);
		for (const r of order) {
			const nb = down ? segIn : segOut;
			const bary = new Map<string, number>();
			for (const v of ranks[r]) {
				const ns = (nb.get(v.id) ?? []).map((n) => vs.get(n)!.order);
				bary.set(v.id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : v.order);
			}
			// A cluster's nodes sort by their cluster's mean, so they stay side by side.
			const groups = new Map<string, number[]>();
			for (const v of ranks[r]) if (v.cluster) (groups.get(v.cluster) ?? groups.set(v.cluster, []).get(v.cluster)!).push(bary.get(v.id)!);
			const key = (v: V) => (v.cluster ? avg(groups.get(v.cluster)!) : bary.get(v.id)!);
			ranks[r].sort((a, b) => key(a) - key(b) || (a.cluster ?? "").localeCompare(b.cluster ?? "") || bary.get(a.id)! - bary.get(b.id)! || a.order - b.order);
			ranks[r].forEach((v, i) => (v.order = i));
		}
		const n = crossings();
		if (n < bestN) {
			bestN = n;
			best = ranks.map((r) => r.slice());
		}
	}
	best.forEach((r, i) => (ranks[i] = r));
	number();

	// 5. Places: each rank packed, then each node pulled over its neighbours, a few times down and up.
	const sep = (a: V, b: V) => (a.w + b.w) / 2 + (a.dummy && b.dummy ? 8 : a.cluster !== b.cluster ? gaps.cluster : gaps.node);
	for (const r of ranks) {
		let x = 0;
		r.forEach((v, i) => {
			if (i) x += sep(r[i - 1], v);
			v.x = x;
		});
	}
	const place = (r: V[], want: (v: V) => number | undefined) => {
		const desired = r.map((v) => want(v) ?? v.x);
		// Each as near its wish as the ones before it allow, then the same from the right, and the mean of the two.
		const left = desired.slice();
		for (let i = 1; i < r.length; i++) left[i] = Math.max(left[i], left[i - 1] + sep(r[i - 1], r[i]));
		const right = desired.slice();
		for (let i = r.length - 2; i >= 0; i--) right[i] = Math.min(right[i], right[i + 1] - sep(r[i], r[i + 1]));
		const xs = r.map((_, i) => (left[i] + right[i]) / 2);
		for (let i = 1; i < r.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + sep(r[i - 1], r[i]));
		r.forEach((v, i) => (v.x = xs[i]));
	};
	for (let it = 0; it < 8; it++) {
		const down = it % 2 === 0;
		const order = down ? ranks.slice(1) : ranks.slice(0, -1).reverse();
		for (const r of order) {
			place(r, (v) => {
				const ns = ((down ? segIn : segOut).get(v.id) ?? []).map((n) => vs.get(n)!.x);
				if (!ns.length) return undefined;
				ns.sort((a, b) => a - b);
				const m = ns.length >> 1;
				return ns.length % 2 ? ns[m] : (ns[m - 1] + ns[m]) / 2;
			});
		}
	}

	// A cluster's box is drawn round its nodes across all its ranks: what isn't in it moves out of that span,
	// to the side its order puts it, and what's beyond it moves along.
	const inside = (v: V, c: string) => {
		for (let k = v.cluster; k; k = parents.get(k)) if (k === c) return true;
		return false;
	};
	const clusterIds = [...new Set([...vs.values()].flatMap((v) => {
		const out: string[] = [];
		for (let k = v.cluster; k; k = parents.get(k)) out.push(k);
		return out;
	}))];
	for (let it = 0; it < 4; it++) {
		let moved = false;
		for (const c of clusterIds) {
			const members = [...vs.values()].filter((v) => !v.dummy && inside(v, c));
			if (!members.length) continue;
			const lo = Math.min(...members.map((v) => v.x - v.w / 2)) - gaps.cluster / 2;
			const hi = Math.max(...members.map((v) => v.x + v.w / 2)) + gaps.cluster / 2;
			const r0 = Math.min(...members.map((v) => v.rank)), r1 = Math.max(...members.map((v) => v.rank));
			for (let r = r0; r <= r1; r++) {
				const row = ranks[r];
				const firstIn = row.findIndex((v) => inside(v, c));
				let fromRight = row.length, fromLeft = -1;
				for (let i = 0; i < row.length; i++) {
					const v = row[i];
					if (inside(v, c) || (v.dummy && v.w <= 2)) continue;
					if (v.x + v.w / 2 <= lo || v.x - v.w / 2 >= hi) continue;
					const right = firstIn >= 0 ? i > firstIn : v.x >= (lo + hi) / 2;
					v.x = right ? hi + v.w / 2 : lo - v.w / 2;
					if (right) fromRight = Math.min(fromRight, i);
					else fromLeft = Math.max(fromLeft, i);
					moved = true;
				}
				// What's beyond a moved node moves along, outward, in its order.
				for (let i = fromRight + 1; i < row.length; i++) row[i].x = Math.max(row[i].x, row[i - 1].x + sep(row[i - 1], row[i]));
				for (let i = fromLeft - 1; i >= 0; i--) row[i].x = Math.min(row[i].x, row[i + 1].x - sep(row[i], row[i + 1]));
			}
		}
		if (!moved) break;
	}

	// Rank depths: each as tall as its tallest, a gap between.
	let y = 0;
	for (const r of ranks) {
		if (!r.length) continue;
		const h = Math.max(0, ...r.map((v) => v.h));
		for (const v of r) v.y = y + h / 2;
		y += h + (labelled ? gaps.rank / 2 : gaps.rank);
	}
	const all = [...vs.values()];
	const minX = Math.min(...all.map((v) => v.x - v.w / 2));
	const maxX = Math.max(...all.map((v) => v.x + v.w / 2));
	const minY = Math.min(...all.map((v) => v.y - v.h / 2));
	const maxY = Math.max(...all.map((v) => v.y + v.h / 2));
	for (const v of all) {
		v.x -= minX;
		v.y -= minY;
	}
	let width = maxX - minX, height = maxY - minY;

	// Turned for the other directions.
	const turn = (x: number, y: number) => {
		switch (dir) {
			case "BT": return { x, y: height - y };
			case "LR": return { x: y, y: x };
			case "RL": return { x: height - y, y: x };
			default: return { x, y };
		}
	};
	const placed = new Map<string, Placed>();
	for (const n of nodes) {
		const v = vs.get(n.id)!;
		const p = turn(v.x, v.y);
		placed.set(n.id, { x: p.x, y: p.y, w: n.w, h: n.h });
	}
	const routed: Routed[] = new Array(es.length);
	for (const ch of chains) {
		let pts = ch.ids.map((id) => turn(vs.get(id)!.x, vs.get(id)!.y));
		if (ch.reversed) pts = pts.reverse();
		const label = ch.labelAt ? turn(vs.get(ch.labelAt)!.x, vs.get(ch.labelAt)!.y) : undefined;
		routed[ch.edge] = { points: pts, label };
	}
	if (across) [width, height] = [height, width];
	return { nodes: placed, edges: routed, width, height };
}

function avg(xs: number[]) {
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sameCluster(a: V, b: V): string | undefined {
	return a.cluster && a.cluster === b.cluster ? a.cluster : undefined;
}
