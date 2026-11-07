// Making and changing automations, the page's and the command line's
// alike, and what an agent may make. An agent's automation runs while
// nobody watches, so it may do no more than the agent itself: its runs'
// threads ask for what the agent would have to ask for, a script (which
// runs here, asking nobody) needs an agent at Full access, and it re-
// prompts only the agent's own thread or one the agent started. A thread
// an automation started, or one running an automation's turn, makes none,
// so automations can't breed. A command line Swarm can't vouch for counts
// as an agent's, of the least access.
import { call, threads, type ThreadInfo } from "swarm";
import { CronError, nextCron, parseCron, parseDuration } from "./cron";
import { APPROVALS, capApproval, nextTime } from "./plan";
import { META, projects, SCRIPT_TIMEOUT_MAX } from "./runner";
import { automations, newId, runOnThread, save, type Automation, type Interpreter, type Mode } from "./store";

export const INTERPRETERS: Interpreter[] = ["sh", "bash", "node", "python3"];
export const MAX_AUTOMATIONS = 100;

export class EditError extends Error {
	constructor(
		message: string,
		readonly code = "invalid",
		readonly hint?: string,
	) {
		super(message);
	}
}

/** Who makes or changes one: the user, or an agent (thread "" for a command line Swarm can't vouch for). */
export type Who = { user: true } | { user: false; thread: string };

/** What's asked: any field left out stays as it was (or its default, new). "" clears a text one. */
export interface Spec {
	name?: string;
	project?: string;
	mode?: Mode;
	cron?: string;
	/** A one-shot's time, as Date.parse reads it, or "in" a duration from now. */
	at?: string;
	in?: string;
	prompt?: string;
	provider?: string;
	model?: string;
	effort?: string;
	approval?: string;
	worktree?: boolean;
	branch?: string;
	target?: string;
	script?: string;
	interpreter?: string;
	timeout?: string | number;
	cwd?: string;
	enabled?: boolean;
}

async function threadInfo(id: string): Promise<ThreadInfo | null> {
	try {
		return (await call("Thread", { thread: id })).info;
	} catch {
		return null;
	}
}

/** The agent's thread, as far as it may make automations: refused where it may not. */
async function agentThread(who: Who): Promise<ThreadInfo | null> {
	if (who.user) return null;
	if (!who.thread) return { id: "", project: "", title: "", provider: "", approval: "ask", status: "", dir: "", turns: 0, created: "", updated: "" };
	const meta = await threads.metadata(who.thread).catch(() => ({}) as { [k: string]: unknown });
	if (meta[META]) throw new EditError("A thread an automation started can't make or change automations.", "forbidden", "Ask the user to, in Automations.");
	if (runOnThread(who.thread)) throw new EditError("This thread is running an automation's turn: it can make or change automations once that turn ends.", "forbidden");
	const info = await threadInfo(who.thread);
	if (!info) throw new EditError("Couldn't read this thread.", "forbidden");
	return info;
}

export async function resolveProject(ref: string | undefined, who: Who): Promise<string> {
	const list = await projects();
	if (ref) {
		const r = ref.toLowerCase();
		const p = list.find((x) => x.id === ref) ?? list.find((x) => x.name.toLowerCase() === r);
		if (!p) throw new EditError(`No project ${ref}.`, "not_found", `Projects: ${list.map((x) => x.name).join(", ") || "none"}.`);
		return p.id;
	}
	if (!who.user && who.thread) {
		const t = await threadInfo(who.thread);
		if (t?.project) return t.project;
	}
	if (list.length === 1) return list[0]!.id;
	throw new EditError("Which project? Say --project.", "missing", `Projects: ${list.map((x) => x.name).join(", ") || "none"}.`);
}

const text = (v: string | undefined, was: string | undefined) => (v === undefined ? was : v.trim() || undefined);

/** Makes an automation of spec, or changes `was` by it; saved, and its next time set. */
export async function apply(spec: Spec, who: Who, was?: Automation): Promise<Automation> {
	const creator = await agentThread(who);
	if (!was && automations.size >= MAX_AUTOMATIONS) throw new EditError(`There are ${MAX_AUTOMATIONS} automations already: delete one first.`, "limit");
	if (was) touchable(was, who);
	const now = Date.now();
	const a: Automation = was
		? { ...was }
		: { id: newId(), name: "", project: "", mode: "agent", enabled: true, origin: who.user ? "user" : "agent", creator: who.user ? undefined : who.thread || undefined, nextAt: null, retryAt: null, failures: 0, created: now, updated: now };

	if (spec.name !== undefined) a.name = spec.name.trim();
	if (!a.name) throw new EditError("An automation needs a name: --name.", "missing");
	if (a.name.length > 80) throw new EditError("A name of 80 characters at most.");
	if (spec.project !== undefined || !was) a.project = await resolveProject(spec.project, who);
	if (spec.mode) {
		if (spec.mode !== "agent" && spec.mode !== "script") throw new EditError(`No mode ${spec.mode}: agent or script.`);
		a.mode = spec.mode;
	} else if (!was && spec.script !== undefined) a.mode = "script";

	// The schedule: a cron, or once.
	const given = [spec.cron, spec.at, spec.in].filter((x) => x !== undefined && x !== "");
	if (given.length > 1) throw new EditError("One schedule: --cron, --at or --in.");
	let rescheduled = false;
	if (spec.cron) {
		try {
			const c = parseCron(spec.cron);
			if (nextCron(c, now) === null) throw new CronError("it never comes due");
		} catch (e) {
			throw new EditError(`That cron won't do: ${(e as Error).message}.`, "invalid", "Five fields in this computer's time: 30 9 * * 1-5 is 9:30 on weekdays.");
		}
		a.cron = spec.cron.trim();
		a.at = undefined;
		rescheduled = true;
	} else if (spec.at || spec.in) {
		let at: number;
		if (spec.in) {
			const ms = parseDuration(spec.in, "m");
			if (ms === null || ms < 0) throw new EditError(`"${spec.in}" isn't a duration: 30s, 5m, 2h, 1d.`);
			at = now + ms;
		} else {
			at = Date.parse(spec.at!);
			if (Number.isNaN(at)) throw new EditError(`"${spec.at}" isn't a time: 2026-11-08T09:00, as ISO 8601 has it.`);
			if (at < now - 60_000) throw new EditError(`${spec.at} has passed.`);
		}
		a.at = at;
		a.cron = undefined;
		rescheduled = true;
	}
	if (!a.cron && a.at === undefined) throw new EditError("When should it run? --cron for a repeat, --at or --in for once.", "missing");

	a.prompt = text(spec.prompt, a.prompt);
	a.provider = text(spec.provider, a.provider);
	a.model = text(spec.model, a.model);
	a.effort = text(spec.effort, a.effort);
	a.branch = text(spec.branch, a.branch);
	if (spec.worktree !== undefined) a.worktree = spec.worktree;
	if (spec.approval !== undefined) {
		if (spec.approval && !APPROVALS.includes(spec.approval)) throw new EditError(`No approval ${spec.approval}: ${APPROVALS.join(", ")}.`);
		a.approval = spec.approval || undefined;
	}
	if (spec.target !== undefined) {
		a.target = spec.target.trim() || undefined;
		if (a.target) {
			const t = await threadInfo(a.target);
			if (!t || t.archived) throw new EditError(`No thread ${a.target} to tell.`, "not_found");
			a.target = t.id;
			if (creator && t.id !== creator.id && t.parent !== creator.id) throw new EditError("An agent's automation re-prompts its own thread, or one it started.", "forbidden", "Leave --target-thread out to start a thread each run.");
		}
	}
	a.script = spec.script !== undefined ? spec.script || undefined : a.script;
	if (spec.interpreter !== undefined) {
		if (!INTERPRETERS.includes(spec.interpreter as Interpreter)) throw new EditError(`No interpreter ${spec.interpreter}: ${INTERPRETERS.join(", ")}.`);
		a.interpreter = spec.interpreter as Interpreter;
	}
	if (spec.timeout !== undefined) {
		const ms = typeof spec.timeout === "number" ? spec.timeout : parseDuration(spec.timeout, "ms");
		if (ms === null || ms < 1000 || ms > SCRIPT_TIMEOUT_MAX) throw new EditError("A timeout from 1s to 10m.");
		a.timeoutMs = ms;
	}
	a.cwd = text(spec.cwd, a.cwd);
	if (a.cwd && !/^(\/|[A-Za-z]:[\\/]|~)/.test(a.cwd)) throw new EditError("--cwd takes an absolute folder.");

	if (a.mode === "agent" && !a.prompt) throw new EditError("An agent automation needs a prompt: --prompt.", "missing");
	if (a.mode === "script" && !a.script) throw new EditError("A script automation needs its script: --script, or --script-file.", "missing");
	if (a.mode === "script") a.interpreter ??= "sh";

	// An agent's: no more than it may do itself.
	if (creator) {
		if (a.mode === "script" && creator.approval !== "all")
			throw new EditError("A script runs on this computer without asking anyone, so only an agent at Full access may make one.", "forbidden", "Use agent mode, or ask the user to make it in Automations.");
		if (a.mode === "agent" || a.prompt) a.approval = capApproval(a.approval, creator, a.provider || creator.provider);
		if (!was) a.creator = creator.id || undefined;
	} else if (!a.approval && !was) a.approval = "auto";

	if (spec.enabled !== undefined) a.enabled = spec.enabled;
	if (rescheduled || !was) {
		a.nextAt = nextTime(a, now);
		a.retryAt = null;
		if (a.at !== undefined && spec.enabled === undefined) a.enabled = true;
	}
	a.updated = now;
	await save(a);
	return a;
}

/** Pauses or resumes a; resuming a cron starts again from now, its failures forgotten. */
export async function setEnabled(a: Automation, on: boolean, who: Who): Promise<Automation> {
	await mayTouch(a, who);
	const now = Date.now();
	const next: Automation = { ...a, enabled: on, updated: now };
	if (on) {
		next.failures = 0;
		next.retryAt = null;
		if (a.cron) next.nextAt = nextTime(a, now);
		else if (a.nextAt === null) throw new EditError("It ran once already: give it a new time (--at or --in).", "invalid");
	}
	await save(next);
	return next;
}

/** The user's automations are theirs: an agent reads them, and changes, runs, pauses or deletes only an agent's. */
function touchable(a: Automation, who: Who) {
	if (!who.user && a.origin === "user") throw new EditError(`${a.name} is the user's: an agent may read it but not change, run or delete it.`, "forbidden", "Ask the user to, in Automations.");
}

/** That who may act on a: run, pause, resume or delete it. */
export async function mayTouch(a: Automation, who: Who) {
	touchable(a, who);
	const creator = await agentThread(who);
	if (creator && a.mode === "script" && creator.approval !== "all") throw new EditError("A script runs on this computer without asking anyone, so only an agent at Full access may run or change one.", "forbidden");
}
