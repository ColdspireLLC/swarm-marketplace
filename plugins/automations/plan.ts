// When an automation runs: its next time, which come due on a tick, and
// what a failed run does to it. Pure: the runner (runner.ts) acts on it.
import { nextCron, parseCron } from "./cron";
import type { Automation, RunStatus, Trigger } from "./store";

/** Failed scheduled runs of a recurring automation are tried again after these, never past its next time. */
export const RETRY_AFTER = [30_000, 60_000];

/** The next time a comes due after now, from its schedule alone: null for a one-shot that ran, or a cron that never comes. */
export function nextTime(a: Pick<Automation, "cron" | "at">, now: number): number | null {
	if (a.cron) return nextCron(parseCron(a.cron), now);
	if (a.at !== undefined) return a.at;
	return null;
}

/** Why a is due at now, or null: its schedule's time, or its retry's. Paused ones never are. */
export function dueNow(a: Automation, now: number): Trigger | null {
	if (!a.enabled) return null;
	if (a.nextAt !== null && a.nextAt <= now) return "schedule";
	if (a.retryAt !== null && a.retryAt <= now) return "retry";
	return null;
}

/** What starting a run of trigger does to a's schedule: a cron moves on to its next time, a one-shot is done (and paused). */
export function afterStart(a: Automation, trigger: Trigger, now: number): Partial<Automation> {
	if (trigger === "retry") return { retryAt: null };
	if (trigger === "manual") return {};
	if (a.cron) return { nextAt: nextTime(a, now), retryAt: null };
	return { nextAt: null, retryAt: null, enabled: false };
}

/**
 * What a finished run does to a: a success or a silent run clears its
 * failures; a failed scheduled run of a recurring one is tried again
 * (RETRY_AFTER), at most twice, and never past its next time. A failure
 * never pauses it; its error stays until a run succeeds.
 */
export function afterRun(a: Automation, trigger: Trigger, status: RunStatus, error: string | undefined, now: number): Partial<Automation> {
	if (status === "ok" || status === "skipped") return { failures: 0, retryAt: null, lastError: undefined };
	if (status !== "failed") return {};
	const failures = trigger === "manual" ? a.failures : a.failures + 1;
	let retryAt: number | null = null;
	if (a.cron && trigger !== "manual" && failures <= RETRY_AFTER.length) {
		const at = now + RETRY_AFTER[failures - 1]!;
		if (a.nextAt === null || at < a.nextAt) retryAt = at;
	}
	return { failures, retryAt, lastError: error };
}

/** The soonest time any of these comes due, for the timer between ticks. */
export function soonest(list: Iterable<Automation>): number | null {
	let best: number | null = null;
	for (const a of list) {
		if (!a.enabled) continue;
		for (const t of [a.nextAt, a.retryAt]) if (t !== null && (best === null || t < best)) best = t;
	}
	return best;
}

export const APPROVALS = ["ask", "edits", "auto", "all"];

/**
 * The most an agent's automation may let its runs' agents do: no more
 * than the agent that made it may do unasked. Another agent's Auto may let
 * everything through, so across agents an Auto parent gives Auto-accept
 * edits (core's ChildApproval holds threads it starts to this too).
 */
export function capApproval(want: string | undefined, parent: { approval: string; provider: string }, provider: string | undefined): string {
	let most = APPROVALS.indexOf(parent.approval);
	if (most < 0) most = 0;
	if (parent.approval === "auto" && provider && provider !== parent.provider) most = APPROVALS.indexOf("edits");
	const w = want ? APPROVALS.indexOf(want) : most;
	return APPROVALS[Math.min(w < 0 ? most : w, most)]!;
}

/** Whether a script printed nothing to report: no output, or a last line of {"wakeAgent": false}. */
export function silent(stdout: string, stderr: string): boolean {
	if (!stdout.trim() && !stderr.trim()) return true;
	const last = stdout.trim().split("\n").pop()!.trim();
	try {
		const v = JSON.parse(last);
		return !!v && typeof v === "object" && v.wakeAgent === false && !stderr.trim();
	} catch {
		return false;
	}
}
