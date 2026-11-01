// The Swarm threads issues are attached to, as the core last listed them:
// their titles for the Agents rail and whether an agent works in them now.
import { ui } from "swarm";

export interface ThreadState {
	title: string;
	working: boolean;
}

const known = ui.state(new Map<string, ThreadState>());

/** A thread's title and state, or undefined for one Swarm doesn't list (archived, or no read scope). */
export function threadInfo(id: string): ThreadState | undefined {
	return known.value.get(id);
}

/** Replaces what's known; true when anything changed. */
export function setThreads(list: { id: string; title: string; status: string }[]): boolean {
	const next = new Map(list.map((t) => [t.id, { title: t.title, working: t.status === "running" }]));
	const had = known.peek();
	const same = next.size === had.size && [...next].every(([id, t]) => {
		const was = had.get(id);
		return was && was.title === t.title && was.working === t.working;
	});
	if (!same) known.value = next;
	return !same;
}
