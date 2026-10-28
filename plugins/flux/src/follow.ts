// The issue's status follows the thread's merge request: opening one moves
// the issue to In Review, merging it completes the issue, and closing it
// without merging puts a review back to In Progress.
import { call, on } from "swarm";
import type { Hub } from "./hub";

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
		let status = issue.status;
		if (state === "merged") status = "complete";
		else if (state === "closed" && issue.status === "review") status = "progress";
		else if (opened && (issue.status === "backlog" || issue.status === "todo" || issue.status === "progress")) status = "review";
		if (status !== issue.status && issue.status !== "canceled") void flux.updateIssue(issue.id, { status }).catch(() => {});
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
