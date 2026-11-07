// Running automations: the tick that starts what's due, a run of each
// mode, and settling it. An agent run starts a thread (or tells the
// target thread) and ends as that thread's turn ends; a script run runs
// the script here and ends with it, handing what it printed to an agent
// where the automation has a prompt. One run of an automation at a time.
import { call, process, threads, type Project } from "swarm";
import { afterRun, afterStart, dueNow, silent, soonest } from "./plan";
import { activeRun, addRun, automations, runOnThread, save, updateRun, type Automation, type Run, type RunStatus, type Trigger } from "./store";

/** The most a script may run: process.run's own limit. */
export const SCRIPT_TIMEOUT_MAX = 10 * 60_000;
export const SCRIPT_TIMEOUT_DEFAULT = 2 * 60_000;

/** Metadata put on the threads automations start, which keeps them from making automations. */
export const META = "automation";

async function change(a: Automation, c: Partial<Automation>) {
	const now = automations.get(a.id) ?? a;
	await save({ ...now, ...c, updated: Date.now() });
}

const firstLine = (s: string) =>
	s
		.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
		.split("\n")
		.map((l) => l.trim())
		.find(Boolean) ?? "";

/** Ends a run, and settles its automation's failures and retry. */
export async function finish(run: Run, status: RunStatus, summary: string, extra: Partial<Run> = {}) {
	const now = Date.now();
	await updateRun(run, { status, summary, ended: now, ...extra });
	const a = automations.get(run.automation);
	if (a) await change(a, afterRun(a, run.trigger, status, status === "failed" ? summary : undefined, now));
	arm();
}

let projectsCache: { at: number; list: Project[] } | null = null;
export async function projects(): Promise<Project[]> {
	if (!projectsCache || Date.now() - projectsCache.at > 30_000) projectsCache = { at: Date.now(), list: await call("Projects", {}) };
	return projectsCache.list;
}

/** Where a script runs: its own folder, else its project's, where that is on this computer. */
export async function scriptDir(a: Automation): Promise<string | undefined> {
	if (a.cwd) return a.cwd;
	const p = (await projects()).find((x) => x.id === a.project);
	return p && !p.machine ? p.path : undefined;
}

/** Whether a thread can be told: there, and not archived. */
async function threadThere(id: string): Promise<boolean> {
	try {
		const d = await call("Thread", { thread: id });
		return !!d.info && !d.info.archived;
	} catch {
		return false;
	}
}

function stamp(now: number) {
	const d = new Date(now);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Hands prompt to an agent: the target thread, else a thread of its own. The run goes on until that turn ends. */
async function wake(a: Automation, run: Run, prompt: string): Promise<Run> {
	if (a.target) {
		if (!(await threadThere(a.target))) {
			// A target that's gone pauses every automation that tells it: none of their runs could.
			for (const b of [...automations.values()]) if (b.target === a.target && b.enabled) await change(b, { enabled: false, lastError: "Its thread was archived or deleted: paused." });
			await finish(run, "failed", "Its thread was archived or deleted: paused.");
			return run;
		}
		const told = await call("Tell", { thread: a.target, text: prompt });
		// Told while a turn runs, it waits for that turn: the run is the turn after.
		return updateRun(run, { thread: a.target, skipTurns: told.queued ? 1 : 0 });
	}
	const t = await threads.spawn({
		project: a.project,
		provider: a.provider || undefined,
		model: a.model || undefined,
		effort: a.effort || undefined,
		approval: a.approval || undefined,
		worktree: a.worktree || undefined,
		branch: a.worktree ? a.branch || undefined : undefined,
		title: `${a.name} · ${stamp(run.started)}`,
		prompt,
		metadata: { [META]: a.id, run: run.id },
	});
	const r = await updateRun(run, { thread: t.id });
	const early = endedEarly.get(t.id);
	if (early) (endedEarly.delete(t.id), await turnEnded(t.id, early.reason, early.error));
	return r;
}

/** Turns that ended on a thread before its run knew it (a quick agent's first), for a moment. */
const endedEarly = new Map<string, { reason: string; error?: string }>();

async function runScript(a: Automation, run: Run) {
	const program = a.interpreter ?? "sh";
	const flag = program === "node" ? "-e" : "-c";
	const res = await process.run(program, [flag, a.script ?? ""], {
		cwd: await scriptDir(a),
		timeout: Math.min(a.timeoutMs ?? SCRIPT_TIMEOUT_DEFAULT, SCRIPT_TIMEOUT_MAX),
		env: { SWARM_AUTOMATION_ID: a.id, SWARM_AUTOMATION_RUN: String(run.id), SWARM_PROJECT: a.project },
	});
	const out = { code: res.code, stdout: res.stdout, stderr: res.stderr };
	if (res.timedOut) return finish(run, "failed", `Timed out after ${Math.round((a.timeoutMs ?? SCRIPT_TIMEOUT_DEFAULT) / 1000)}s`, out);
	if (res.code !== 0) return finish(run, "failed", `Exited ${res.code}${firstLine(res.stderr) ? `: ${firstLine(res.stderr)}` : ""}`, out);
	if (silent(res.stdout, res.stderr)) return finish(run, "skipped", "Nothing to report", out);
	if (!a.prompt) return finish(run, "ok", firstLine(res.stdout) || "Done", out);
	const text = `${a.prompt}\n\nThe automation's script (${a.name}) printed:\n\n\`\`\`\n${(res.stdout + (res.stderr ? `\n${res.stderr}` : "")).trim().slice(0, 20_000)}\n\`\`\``;
	const r = await updateRun(run, { ...out, summary: "Handed its output to an agent" });
	await wake(a, r, text);
}

/** Starts a run of a now: one at a time, so while one runs, a scheduled one is noted as skipped, a manual one is that run. */
export async function start(a: Automation, trigger: Trigger): Promise<Run> {
	const now = Date.now();
	if (trigger !== "manual") await change(a, afterStart(a, trigger, now));
	const active = activeRun(a.id);
	if (active) {
		if (trigger === "manual") return active;
		return addRun({ automation: a.id, trigger, status: "skipped", started: now, ended: now, summary: `Its run from ${stamp(active.started)} was still going` });
	}
	let run = await addRun({ automation: a.id, trigger, status: "running", started: now });
	try {
		if (a.mode === "script") await runScript(a, run);
		else run = await wake(a, run, a.prompt ?? "");
	} catch (e) {
		await finish(run, "failed", e instanceof Error ? e.message : String(e));
	}
	arm();
	return run;
}

/**
 * Starts what's due, each run on its own: a long script holds up no other
 * automation. start moves an automation's schedule on before its first
 * wait, so the next tick doesn't start it again.
 */
export function tick() {
	const now = Date.now();
	for (const a of [...automations.values()]) {
		const t = dueNow(a, now);
		if (t) void start(a, t).catch((e) => console.error(`${a.name}: ${e instanceof Error ? e.message : e}`));
	}
	arm();
}

let timer: number | undefined;
/** Between the minute's ticks, a timer for the soonest due within the minute: an automation "in 30s" runs then. */
export function arm() {
	if (timer !== undefined) clearTimeout(timer);
	timer = undefined;
	const at = soonest(automations.values());
	if (at === null) return;
	const wait = at - Date.now();
	if (wait < 65_000) timer = setTimeout(() => tick(), Math.max(0, wait) + 50);
}

/** A thread's turn ended: the run it was for is over. */
export async function turnEnded(thread: string, reason: string, error?: string) {
	const run = runOnThread(thread);
	if (!run) {
		endedEarly.set(thread, { reason, error });
		setTimeout(() => endedEarly.delete(thread), 10_000);
		return;
	}
	if (run.skipTurns) return void (await updateRun(run, { skipTurns: run.skipTurns - 1 }));
	if (reason === "end_turn") return finish(run, "ok", run.summary === "Handed its output to an agent" ? "An agent took its output" : "The agent finished");
	if (reason === "cancelled") return finish(run, "skipped", "Stopped");
	return finish(run, "failed", error || `The agent's turn ended: ${reason.replace(/_/g, " ")}`);
}

/** As the plugin starts: runs a restart cut off. A script's is over; an agent's ends with its thread's turn, unless that's already done. */
export async function settle() {
	for (const a of automations.values()) {
		const run = activeRun(a.id);
		if (!run) continue;
		if (!run.thread) {
			await finish(run, "skipped", "Interrupted: Swarm or the plugin stopped");
			continue;
		}
		try {
			const d = await call("Thread", { thread: run.thread });
			const s = d.info.status;
			if (d.info.archived) await finish(run, "skipped", "Its thread was archived");
			else if (s === "error") await finish(run, "failed", d.info.error || "The agent failed");
			else if (s === "idle" && !d.info.queued) await finish(run, "ok", "The agent finished");
		} catch {
			await finish(run, "skipped", "Its thread is gone");
		}
	}
}
