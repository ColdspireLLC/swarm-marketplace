// requestStatus is the status an issue takes from its thread's merge
// request: opened or merged, an open issue goes to In Review; closed
// without merging, a review goes back to In Progress. It never completes
// an issue: merged isn't released, so whoever knows it's out says so.
export function requestStatus(status: string, state: string, opened: boolean): string {
	if (status === "canceled" || status === "complete") return status;
	if (state === "closed") return status === "review" ? "progress" : status;
	const open = status === "backlog" || status === "todo" || status === "progress";
	if ((state === "merged" || opened) && open) return "review";
	return status;
}
