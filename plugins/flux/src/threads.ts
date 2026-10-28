// The Swarm threads issues are attached to, as the core last listed them:
// their titles for the Agents rail and whether an agent works in them now.
export interface ThreadState {
	title: string;
	working: boolean;
}

let known = new Map<string, ThreadState>();

/** A thread's title and state, or undefined for one Swarm doesn't list (archived, or no read scope). */
export function threadInfo(id: string): ThreadState | undefined {
	return known.get(id);
}

/** Replaces what's known; true when anything changed. */
export function setThreads(list: { id: string; title: string; status: string }[]): boolean {
	const next = new Map(list.map((t) => [t.id, { title: t.title, working: t.status === "running" }]));
	const same = next.size === known.size && [...next].every(([id, t]) => {
		const had = known.get(id);
		return had && had.title === t.title && had.working === t.working;
	});
	known = next;
	return !same;
}
