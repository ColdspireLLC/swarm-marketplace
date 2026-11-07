// What Automations keeps: each automation and its runs, in the plugin's
// SQLite database, mirrored in tracked stores the page renders from. An
// automation's settings are one JSON column, so a field added later needs
// no migration; what the scheduler queries has columns of its own.
import { storage, ui } from "swarm";

export type Mode = "agent" | "script";
export type Interpreter = "sh" | "bash" | "node" | "python3";
export type RunStatus = "running" | "ok" | "failed" | "skipped";
export type Trigger = "schedule" | "retry" | "manual";

export interface Automation {
	id: string;
	name: string;
	project: string;
	mode: Mode;
	/** A 5-field cron in local time; or at, once. */
	cron?: string;
	at?: number;
	enabled: boolean;
	/** Agent mode's prompt; in script mode, what an agent is told along with the script's output, when it prints something (none: no agent). */
	prompt?: string;
	provider?: string;
	model?: string;
	effort?: string;
	approval?: string;
	worktree?: boolean;
	branch?: string;
	/** Re-prompt this thread rather than start one each run. */
	target?: string;
	script?: string;
	interpreter?: Interpreter;
	timeoutMs?: number;
	cwd?: string;
	/** Who made it: the user, or the agent of creator. */
	origin: "user" | "agent";
	creator?: string;
	/** The next time it comes due, and when a failed run is tried again. */
	nextAt: number | null;
	retryAt: number | null;
	failures: number;
	lastError?: string;
	created: number;
	updated: number;
}

export interface Run {
	id: number;
	automation: string;
	trigger: Trigger;
	status: RunStatus;
	started: number;
	ended?: number;
	/** The thread it started or told. */
	thread?: string;
	/** Turns of its thread to let end before its own: one that ran as it was told. */
	skipTurns?: number;
	summary?: string;
	code?: number;
	stdout?: string;
	stderr?: string;
}

/** The runs each automation keeps; older ones go. */
export const KEEP_RUNS = 50;
/** What a script's output keeps of each stream. */
export const OUTPUT_MAX = 64 * 1024;

export const automations = ui.store(new Map<string, Automation>());
/** Each automation's latest runs, newest first. */
export const runs = ui.store(new Map<string, Run[]>());

const db = () => storage.database();

/** Told after each change to what's kept: the sidebar's rows follow it. */
export const listeners: Array<() => void> = [];
const changed = () => listeners.forEach((f) => f());

export async function load() {
	await db().migrate([
		`CREATE TABLE automations (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
		`CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, automation TEXT NOT NULL, status TEXT NOT NULL, started INTEGER NOT NULL, data TEXT NOT NULL)`,
		`CREATE INDEX runs_by_automation ON runs (automation, id)`,
	]);
	automations.clear();
	runs.clear();
	for (const row of await db().all(`SELECT data FROM automations`)) {
		const a = JSON.parse(String(row.data)) as Automation;
		automations.set(a.id, a);
	}
	for (const a of automations.values()) {
		const rows = await db().all(`SELECT id, data FROM runs WHERE automation = ? ORDER BY id DESC LIMIT ?`, [a.id, KEEP_RUNS]);
		runs.set(
			a.id,
			rows.map((r) => ({ ...(JSON.parse(String(r.data)) as Run), id: Number(r.id) })),
		);
	}
}

export async function save(a: Automation) {
	automations.set(a.id, { ...a });
	changed();
	await db().exec(`INSERT INTO automations (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [a.id, JSON.stringify(a)]);
}

export async function remove(id: string) {
	automations.delete(id);
	runs.delete(id);
	changed();
	await db().exec(`DELETE FROM automations WHERE id = ?`, [id]);
	await db().exec(`DELETE FROM runs WHERE automation = ?`, [id]);
}

function clip(text: string | undefined): string | undefined {
	if (!text) return text;
	return text.length > OUTPUT_MAX ? text.slice(0, OUTPUT_MAX) + "\n… (cut short)" : text;
}

export async function addRun(r: Omit<Run, "id">): Promise<Run> {
	const data = { ...r, stdout: clip(r.stdout), stderr: clip(r.stderr) };
	const res = await db().exec(`INSERT INTO runs (automation, status, started, data) VALUES (?, ?, ?, ?)`, [r.automation, r.status, r.started, JSON.stringify(data)]);
	const run = { ...data, id: res.lastInsertId };
	const list = [run, ...(runs.get(r.automation) ?? [])];
	const gone = list.splice(KEEP_RUNS);
	runs.set(r.automation, list);
	changed();
	if (gone.length) await db().exec(`DELETE FROM runs WHERE automation = ? AND id <= ?`, [r.automation, gone[0]!.id]);
	return run;
}

export async function updateRun(run: Run, change: Partial<Run>) {
	const next: Run = { ...run, ...change, stdout: clip(change.stdout ?? run.stdout), stderr: clip(change.stderr ?? run.stderr) };
	const list = runs.get(run.automation);
	if (list) {
		const i = list.findIndex((x) => x.id === run.id);
		if (i >= 0) list[i] = next;
	}
	changed();
	await db().exec(`UPDATE runs SET status = ?, data = ? WHERE id = ?`, [next.status, JSON.stringify(next), run.id]);
	return next;
}

/** The run of a's still going, if any. */
export function activeRun(id: string): Run | undefined {
	return runs.get(id)?.find((r) => r.status === "running");
}

/** The running run that a thread's turn belongs to. */
export function runOnThread(thread: string): Run | undefined {
	for (const list of runs.values()) for (const r of list) if (r.status === "running" && r.thread === thread) return r;
	return undefined;
}

export function newId(): string {
	const chars = "abcdefghijkmnpqrstuvwxyz23456789";
	for (;;) {
		let s = "auto_";
		for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
		if (!automations.has(s)) return s;
	}
}

/** An automation by id, or by name (case aside), or by a unique start of either. */
export function find(ref: string): Automation | undefined {
	const all = [...automations.values()];
	const r = ref.toLowerCase();
	return (
		automations.get(ref) ??
		all.find((a) => a.name.toLowerCase() === r) ??
		(() => {
			const hits = all.filter((a) => a.id.startsWith(ref) || a.name.toLowerCase().startsWith(r));
			return hits.length === 1 ? hits[0] : undefined;
		})()
	);
}
