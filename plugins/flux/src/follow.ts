// The issue's status follows the thread's merge request: opening or merging
// one moves the issue to In Review, and closing it without merging puts a
// review back to In Progress. Nothing here completes an issue: a merge is
// not a release (a branch merged may wait for a build, a deploy, or a
// hotpatch of the version that's out), so whoever knows it reached its
// users, the agent or you, says so.
import { call, on } from "swarm";
import type { Hub } from "./hub";
import { requestStatus } from "./requeststatus";

export function watchMergeRequests(hub: Hub) {
	const pending = new Map<string, number>();
	const check = async (thread: string) => {
		let detail;
		try {
			await call("RefreshMergeRequest", { thread });
			detail = await call("Thread", { thread });
		} catch {
			return;
		}
		const meta = detail.thread?.pluginMeta?.flux;
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
		const state = detail.live?.mr?.State ?? "";
		const opened = Boolean(detail.thread?.pr);
		const status = requestStatus(issue.status, state, opened);
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
