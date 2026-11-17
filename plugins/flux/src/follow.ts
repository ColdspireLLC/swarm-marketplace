// The issue's status follows the thread's merge request: opening or merging
// one moves the issue to In Review, and closing it without merging puts a
// review back to In Progress. Nothing here completes an issue: a merge is
// not a release (a branch merged may wait for a build, a deploy, or a
// hotpatch of the version that's out), so whoever knows it reached its
// users, the agent or you, says so.
import swarm, { call, on } from "swarm";
import type { Status } from "./flux";
import type { Hub } from "./hub";
import { requestStatus } from "./requeststatus";

/** What check reads of a thread: Flux's notes on it, and its request. */
interface Followed {
	meta: Record<string, unknown> | undefined;
	opened: boolean;
	state: string;
}

/**
 * A thread's notes and request, without its timeline: ThreadInfo and its
 * notes, or, from a Swarm before ThreadInfo, the whole thread, which can
 * be tens of MB.
 */
async function followed(thread: string): Promise<Followed> {
	let info: { request?: string; requestState?: string } | undefined;
	try {
		info = await (call as (method: string, args: unknown) => Promise<{ request?: string; requestState?: string }>)("ThreadInfo", { thread });
	} catch {
		info = undefined;
	}
	if (info) {
		const meta = await swarm.threads.metadata(thread);
		return { meta, opened: Boolean(info.request), state: info.requestState ?? "" };
	}
	const detail = await call("Thread", { thread });
	return { meta: detail.thread?.pluginMeta?.flux, opened: Boolean(detail.thread?.pr), state: detail.live?.mr?.State ?? "" };
}

export function watchMergeRequests(hub: Hub) {
	const pending = new Map<string, number>();
	const check = async (thread: string) => {
		let f: Followed;
		try {
			await call("RefreshMergeRequest", { thread });
			f = await followed(thread);
		} catch {
			return;
		}
		const meta = f.meta;
		const issueId = typeof meta?.issueId === "string" ? meta.issueId : "";
		const issueKey = typeof meta?.issueKey === "string" ? meta.issueKey : "";
		if (!issueId && !issueKey) return;
		let flux;
		try {
			flux = hub.get(typeof meta?.connectionId === "string" ? meta.connectionId : undefined);
		} catch {
			flux = hub.active;
		}
		const issue = (issueId && flux.issue(issueId)) || (issueKey && flux.findIssue(issueKey));
		if (!issue) return;
		const status = requestStatus(issue.status, f.state, f.opened) as Status;
		if (status !== issue.status) void flux.updateIssue(issue.id, { status }).catch(() => {});
	};
	on("event", (event) => {
		if (!event.thread) return;
		if (event.type !== "thread.pr" && event.type !== "turn.ended" && event.type !== "run.updated") return;
		const thread = event.thread;
		const timer = pending.get(thread);
		if (timer) clearTimeout(timer);
		pending.set(thread, setTimeout(() => {
			pending.delete(thread);
			void check(thread);
		}, 400));
	});
}
