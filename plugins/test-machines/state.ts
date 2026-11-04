// What the plugin holds: the machines the drivers have, each machine's
// line (turns.ts), the threads' titles, the screenshots the panel shows,
// the recordings and the jobs running. Tracked (ui.store), so the panel
// renders as they change.
import { call, settings, ui } from "swarm";
import { Desktop } from "./desktop";
import { ADB, BB, Demo, DriverError, SSH, userHas, WDA, type Driver, type Machine, type Shot } from "./drivers";
import { base64 } from "./png";
import { KEEP_PLACE_MS, TurnError, Turns, USER } from "./turns";
import { joinedMachines } from "./where";

/** A tool call has 11 minutes in Swarm: what it waits in line, 4 at most by default. */
export const DEFAULT_WAIT_MIN = 4;
export const MAX_WAIT_MIN = 10;

export const bb = new BB();
export const ssh = new SSH();
export const adb = new ADB();
export const wda = new WDA();
export const demo = new Demo();
export const desktop = new Desktop();

/** The machines and the drivers' problems, replaced whole as a refresh finds them. */
export const st = ui.store({ machines: [] as Machine[], driverProblems: [] as string[], joined: [] as { id: string; name: string; os?: string }[] }, { shallow: true });
export const turns = ui.store(new Map<string, Turns>(), { shallow: true });
const titles = ui.store(new Map<string, string>());

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function drivers(): Driver[] {
	const d: Driver[] = [];
	if (settings.get("thisComputer") === true || settings.get("swarmMachines") !== false) d.push(desktop);
	if (settings.get("bb") === true) d.push(bb);
	if (String(settings.get("ssh") ?? "").trim()) d.push(ssh);
	if (settings.get("android") === true) d.push(adb);
	if (String(settings.get("iphones") ?? "").trim()) d.push(wda);
	if (settings.get("demo") === true) d.push(demo);
	return d;
}

/** The machines, as the drivers have them now. */
let refreshes = 0;
export async function refresh(): Promise<Machine[]> {
	// The latest refresh counts, as settings change while one runs.
	const n = ++refreshes;
	const found: Machine[] = [];
	const problems: string[] = [];
	for (const d of drivers()) {
		try {
			found.push(...(await d.machines()));
		} catch (e) {
			problems.push(`${d.name}: ${message(e)}`);
		}
	}
	if (n !== refreshes) return st.machines;
	for (const m of found) {
		if (turns.has(m.id)) continue;
		const t = new Turns(m.name, () => void m.driver.released(m).catch(() => {}));
		turns.set(m.id, t);
		// The user's claim outlasts the plugin's restart: agents don't take a machine back from under them.
		if (claimed().includes(claimKey(m))) t.claim();
	}
	st.machines = found;
	st.driverProblems = problems;
	st.joined = (await joinedMachines()).map((m) => ({ id: m.id, name: m.name, os: m.os }));
	return found;
}

export async function machineNamed(id: string): Promise<Machine> {
	const find = () => st.machines.find((m) => m.id.toLowerCase() === id.toLowerCase() || m.name.toLowerCase() === id.toLowerCase());
	const m = find() ?? (await refresh(), find());
	if (!m) throw new DriverError(`No machine ${JSON.stringify(id)}: ${st.machines.map((m) => m.id).join(", ") || "none yet"} (status lists them).`);
	return m;
}

export const turnsOf = (m: Machine) => turns.get(m.id)!;

// The drivers turn a phone's screen off when it's unused: not one the user has.
userHas.now = (id) => turns.get(id)?.holder?.thread === USER;

/** The machines the user took, kept in a setting of the plugin's own across its restarts. */
export function claimed(): string[] {
	return String(settings.get("claimed") ?? "").split(",").filter(Boolean);
}

/** What a claim is kept by: a joined machine's Swarm id, which a rename or another machine of its name doesn't change. */
const claimKey = (m: Machine) => m.where ?? m.id;

/**
 * The user takes a machine, or gives it back; kept. An agent's recording
 * there stops, and is thrown away: it would hold what the user did.
 * Returns the thread it cut off.
 */
export function claim(m: Machine, on: boolean): string | null | boolean {
	const t = turnsOf(m);
	const r = on ? t.claim() : t.giveBack();
	if (on && recording.has(m.id)) {
		recording.delete(m.id);
		void m.driver.recordStop?.(m).then((got) => got.cleanup?.()).catch(() => {});
	}
	// Given back: a phone's screen goes off soon, as no one uses it.
	if (!on) void m.driver.released(m).catch(() => {});
	const now = new Set(claimed());
	if (on) now.add(claimKey(m));
	else now.delete(claimKey(m));
	settings.set({ claimed: [...now].join(",") });
	return r;
}

export function waitMs(min: number | undefined) {
	return Math.min(min ?? DEFAULT_WAIT_MIN, MAX_WAIT_MIN) * 60_000;
}

/**
 * Runs work on a machine: in thread's turn, waiting in line for it, when
 * exclusive; beside whoever has it else. The user's runs at once, beside
 * whoever has it, as bb's: they come first. A driver whose own queue
 * (bb's) has the machine is asked again, until the wait runs out.
 */
/**
 * Says which turn of thread's a hold on t is for, before it's taken:
 * the one under way, or for an idle thread its next, as its last has
 * ended already (and that end may still be on its way to turnEnded).
 */
export async function forTurn(t: Turns, thread: string) {
	if (thread === USER) return;
	let turn: number | undefined;
	try {
		const d = (await call("Thread", { thread })) as { info?: { turns?: number; status?: string } } | null;
		const i = d?.info;
		if (i && typeof i.turns === "number") turn = i.turns + (i.status === "idle" || i.status === "error" ? 1 : 0);
	} catch {
		// Not known: any end of its turns ends the hold, as before.
	}
	t.forTurn(thread, turn);
}

/** What a thread does on a machine now, for the row above its composer and the pages: "tap 603 2166", "screenshot". */
export interface Op {
	thread: string;
	label: string;
	since: number;
}
export const doing = ui.store(new Map<string, Op[]>(), { shallow: true });

/** Runs work as op on m, seen in doing while it runs. */
async function doingOp<T>(m: Machine, thread: string, label: string, work: () => Promise<T>): Promise<T> {
	const op: Op = { thread, label, since: Date.now() };
	doing.set(m.id, [...(doing.get(m.id) ?? []), op]);
	try {
		return await work();
	} finally {
		const left = (doing.get(m.id) ?? []).filter((x) => x !== op);
		if (left.length) doing.set(m.id, left);
		else doing.delete(m.id);
	}
}

/** A machine as a thread is on it: using it (something runs), holding it between calls, waiting in line, or looking beside whoever has it. */
export interface Use {
	m: Machine;
	state: "using" | "holding" | "waiting" | "looking";
	/** Since it got it, joined the line, or began what it does. */
	since: number;
	ops: Op[];
	/** In line: its place, 1 = next, and who has it. */
	position?: number;
	holder?: string;
	/** Its place is kept for its next call, no call waiting on it. */
	kept?: boolean;
	recording?: boolean;
}

/** What a thread uses, holds or waits for, machine by machine. */
export function usesOf(thread: string): Use[] {
	const out: Use[] = [];
	for (const m of st.machines) {
		const t = turns.get(m.id);
		if (!t) continue;
		const ops = (doing.get(m.id) ?? []).filter((o) => o.thread === thread);
		const rec = recording.get(m.id)?.thread === thread;
		const h = t.holder;
		if (h?.thread === thread) {
			out.push({ m, state: ops.length ? "using" : "holding", since: ops.length ? Math.min(...ops.map((o) => o.since)) : h.since, ops, recording: rec });
			continue;
		}
		const at = t.waiting.findIndex((w) => w.thread === thread);
		if (at >= 0) {
			out.push({ m, state: "waiting", since: t.waiting[at]!.since, ops, position: at + 1, holder: h?.thread, kept: t.waiting[at]!.kept });
			continue;
		}
		if (ops.length) out.push({ m, state: "looking", since: Math.min(...ops.map((o) => o.since)), ops });
	}
	return out;
}

export async function withMachine<T>(thread: string | null, m: Machine, o: { exclusive: boolean; wait?: number; label?: string; by?: string }, work: () => Promise<T>): Promise<T> {
	const who = thread ?? o.by;
	if (o.label && who) {
		const inner = work;
		work = () => doingOp(m, who, o.label!, inner);
	}
	const t = turnsOf(m);
	const deadline = Date.now() + waitMs(o.wait);
	const inLine = o.exclusive && thread && thread !== USER;
	// What the user took is theirs alone: not even a look for an agent.
	if (!inLine && thread && thread !== USER && t.holder?.thread === USER) {
		throw new TurnError("busy", `The user took ${m.name}: it's theirs until they give it back. Stop, and tell them what you were doing there.`);
	}
	if (inLine) {
		await forTurn(t, thread);
		await t.acquire(thread, Math.max(0, deadline - Date.now()), KEEP_PLACE_MS);
	}
	const attempt = async (): Promise<T> => {
		for (;;) {
			try {
				return await work();
			} catch (e) {
				if (!(e instanceof DriverError) || !e.busy || Date.now() > deadline) throw e;
				await sleep(3000);
			}
		}
	};
	return inLine ? t.run(thread, attempt) : attempt();
}

// ---- Threads' titles, for who has what ----

export function title(thread: string) {
	return thread === USER ? "the user" : titles.has(thread) ? `“${titles.get(thread)}”` : `thread ${thread}`;
}

/** A thread's title alone, as a line names it: "Fix the login form". */
export function plainTitle(thread: string) {
	return thread === USER ? "You" : titles.get(thread) || `Thread ${thread}`;
}

export async function learnTitles() {
	try {
		for (const t of await call("Threads", {})) titles.set(t.id, t.title);
	} catch {}
}

// ---- Screenshots, kept for the panel ----

export interface Kept {
	machine: string;
	data: Uint8Array;
	at: number;
	by: string;
}
export const shots = ui.store(new Map<string, Kept>(), { shallow: true });

/** Keeps a machine's latest screenshot, for the panel. */
export function keep(m: Machine, s: Shot, by: string) {
	shots.set(m.id, { machine: m.id, data: s.data, at: Date.now(), by });
}

/**
 * Keeps a screenshot or a recording with the thread, for its reply to
 * show: Swarm writes it in the thread's attachments (wherever its agent
 * runs), and the reply names it as a Markdown image.
 */
export async function showLine(thread: string, data: Uint8Array, caption: string): Promise<string> {
	const path = await call("KeepMedia", { thread, file: base64(data) });
	// Forward slashes on Windows too, and in angle brackets: a Mac's data folder has a space
	// ("Application Support"), which ends a bare Markdown destination.
	return `![${caption.replace(/[[\]]/g, "")}](<${path.replace(/\\/g, "/")}>)`;
}

/** The path of a line showLine made. */
export function pathOfLine(line: string): string {
	return /\]\(<?([^>)]+)>?\)$/.exec(line)?.[1] ?? "";
}

// ---- Recordings and jobs ----

/** The recording running on a machine, and whose. */
export const recording = ui.store(new Map<string, { thread: string; title: string; since: number }>(), { shallow: true });

export interface Job {
	id: string;
	thread: string;
	machine: string;
	command: string;
	started: number;
	done?: { code: number; output: string; timedOut: boolean } | { error: string };
	promise: Promise<void>;
}
export const jobs = new Map<string, Job>();
