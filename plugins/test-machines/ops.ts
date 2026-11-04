// What the agents and the user do with the machines, once: the tools
// (tools.ts) and the command line (cli.ts) both call these. thread is
// whose turn it takes: a thread's id, or USER for the user, who comes
// first and waits in no line.
import { discover, found, unusedLine } from "./discover";
import { call, fs } from "swarm";
import { DriverError, elementLines, type Check, type Machine, type Shot } from "./drivers";
import { carried, carriedRefusal, isTestApp, refusedApp, sensitive } from "./rules";
import { adb, drivers, forTurn, jobs, keep, machineNamed, message, recording, refresh, showLine, sleep, st, title, turns, turnsOf, waitMs, withMachine, type Job } from "./state";
import { USER } from "./turns";

/** What an action gives back: its words, a screenshot, and whether it failed (an exit code for a command's). */
export interface Out {
	text: string;
	shot?: Shot;
	code?: number;
}

/** A command's answer comes within this, else it goes on as a job. */
const ANSWER_MS = 9 * 60_000;

const clip = (s: string, n = 200_000) => (s.length > n ? "…" + s.slice(-n) : s);

// ---- What agents stay out of (rules.ts) ----

/** Refuses an agent on a phone the user carries. */
function notCarried(m: Machine, thread: string) {
	if (thread !== USER && carried(m.id)) throw new DriverError(carriedRefusal(m.name));
}

/**
 * The sensitive app in front, if one is, as "Mail (mail)". A driver that
 * tells which app is in front but fails to, now, counts as one: an agent
 * doesn't see a screen it can't vouch for.
 */
async function sensitiveFront(m: Machine): Promise<string> {
	if (!m.driver.frontmost) return "";
	let app;
	try {
		app = await m.driver.frontmost(m);
	} catch (e) {
		return `an app it can't tell (${message(e)})`;
	}
	if (!app) return "";
	const kind = sensitive(app.name, app.id);
	return kind ? `${app.name || app.id} (${kind})` : "";
}

/** Refuses an agent a look at a screen with a sensitive app in front. */
async function refuseSensitive(m: Machine, thread: string, what: string) {
	if (thread === USER) return;
	const app = await sensitiveFront(m);
	if (app) throw new DriverError(`${app} is in front on ${m.name}, an app agents stay out of: ${what}. Ask the user to put it away.`);
}

/** After an action: one that landed in a sensitive app is undone, and said so. */
async function leaveSensitive(m: Machine, thread: string): Promise<string> {
	if (thread === USER) return "";
	const app = await sensitiveFront(m);
	if (!app) return "";
	await m.driver.leave?.(m).catch(() => {});
	return `That opened ${app}, an app agents stay out of, so it was put away at once. Ask the user to do that part.`;
}

// ---- The machines ----

/** Who has each machine, who waits, and how to drive it. */
export function statusLine(m: Machine): string {
	const t = turnsOf(m);
	const h = t.holder;
	const holder = h ? `${title(h.thread)}'s turn${h.note ? ` (${h.note})` : ""}` : "free";
	const waiting = t.waiting.filter((w) => !w.kept).length;
	const steps = m.driver.steps(m.kind);
	const care = carried(m.id) ? "\n  The phone the user carries: test builds' installs, uninstalls and logs only." : "";
	const rec = recording.get(m.id);
	return `${m.id} — ${m.name}: ${holder}${waiting ? `, ${waiting} waiting` : ""}${rec ? `, ${title(rec.thread)} recording` : ""}.\n  ${m.about}${care}${steps && !care ? `\n  Input steps: ${steps}` : ""}`;
}

export async function status(machine?: string, live?: boolean): Promise<Out> {
	await refresh();
	const list = machine ? [await machineNamed(machine)] : st.machines;
	const lines: string[] = [];
	for (const m of list) {
		let line = statusLine(m);
		if (live) line += "\n  Now: " + (await m.driver.status(m).catch((e) => message(e)));
		lines.push(line);
	}
	if (st.driverProblems.length) lines.push(...st.driverProblems.map((p) => `(${p})`));
	// Phones plugged in and unused, from the last look: status never waits for a new one.
	if (!machine) {
		if (Date.now() - found.at > 5 * 60_000 && !found.busy) void discover().catch(() => {});
		const unused = unusedLine();
		if (unused) lines.push(unused);
	}
	return { text: lines.join("\n\n") || "No machines yet: the user adds them in Settings, Plugins, Test machines." };
}

export async function take(thread: string, machine: string, note?: string, wait?: number): Promise<Out> {
	const m = await machineNamed(machine);
	notCarried(m, thread);
	const t = turnsOf(m);
	await forTurn(t, thread);
	await t.acquire(thread, waitMs(wait));
	if (note) t.holder!.note = note;
	return { text: `${m.name} is yours until your turn ends or you release it.\n${m.about}` };
}

export async function release(thread: string, machine?: string): Promise<Out> {
	const list = machine ? [await machineNamed(machine)] : st.machines;
	const lines = list.map((m) => {
		switch (turnsOf(m).release(thread)) {
			case "released":
				return `Released ${m.name}.`;
			case "after":
				return `${m.name} goes back as soon as your command still running there finishes.`;
			case "left-line":
				return `Gave up your place in line for ${m.name}.`;
		}
		return machine ? `You don't hold ${m.name}.` : "";
	});
	return { text: lines.filter(Boolean).join("\n") || "You hold no machine." };
}

// ---- Looking and driving ----

/** A screenshot: with show, kept with the thread and the line that shows it in a reply. */
export async function capture(thread: string, machine: string, o: { show?: boolean; wait?: number }): Promise<Out & { line?: string }> {
	const m = await machineNamed(machine);
	notCarried(m, thread);
	const s = await withMachine(thread, m, { exclusive: false, wait: o.wait, label: "screenshot" }, async () => {
		await refuseSensitive(m, thread, "no screenshot");
		return m.driver.capture(m);
	});
	keep(m, s, thread);
	const h = turnsOf(m).holder;
	const notes = [`${m.name}'s screen.`];
	if (h && h.thread !== thread) notes.push(`It's ${title(h.thread)}'s turn just now: this is their screen. Look, but take your turn before you touch it.`);
	let line: string | undefined;
	if (o.show) {
		line = await showLine(thread, s.data, `Screenshot of ${m.name}`);
		notes.push(`Put this line in your reply, on a line of its own, to show it:\n${line}`);
	}
	return { text: notes.join("\n"), shot: s, line };
}

/** What's on a screen, as named elements and where to click them: no turn needed, and cheaper than a screenshot. */
export async function describe(thread: string, machine: string, wait?: number): Promise<Out> {
	const m = await machineNamed(machine);
	notCarried(m, thread);
	if (!m.driver.describe) throw new DriverError(`${m.name} can't be read as elements: the ${m.driver.name} driver only looks (machine_capture).`);
	const list = await withMachine(thread, m, { exclusive: false, wait, label: "reading the screen" }, async () => {
		await refuseSensitive(m, thread, "nothing read");
		return m.driver.describe!(m);
	});
	if (!list.length) return { text: `${m.name} shows nothing named: look with machine_capture.` };
	return { text: `${m.name}'s screen, ${list.length} element(s), at screenshot pixels (click them with machine_drive):\n${elementLines(list)}` };
}

export async function drive(thread: string, machine: string, steps: string[], o: { capture?: boolean; wait?: number }): Promise<Out> {
	const m = await machineNamed(machine);
	notCarried(m, thread);
	return withMachine(thread, m, { exclusive: true, wait: o.wait, label: stepsLabel(steps) }, async () => {
		const said = await m.driver.drive(m, steps);
		const left = await leaveSensitive(m, thread);
		if (left) return { text: left, code: 1 };
		const text = `Done on ${m.name}.${said ? "\n" + said : ""}`;
		if (!o.capture) return { text };
		const s = await m.driver.capture(m);
		keep(m, s, thread);
		return { text, shot: s };
	});
}

/** A label of what's done, short enough for a row: its first 48 characters. */
const clipLabel = (s: string) => (s.length > 48 ? s.slice(0, 47) + "…" : s);

/** Steps, as the row above the composer says them: the first two, and how many more. */
export function stepsLabel(steps: string[]): string {
	const shown = steps.filter((x) => !/^wait\b/i.test(x)).slice(0, 2);
	const more = steps.filter((x) => !/^wait\b/i.test(x)).length - shown.length;
	return clipLabel((shown.length ? shown.join(", ") : steps[0] ?? "") + (more > 0 ? ` +${more}` : ""));
}

// ---- Commands and jobs ----

let jobN = 0;

export function jobText(j: Job): string {
	const took = Math.round((Date.now() - j.started) / 1000);
	if (!j.done) return `Job ${j.id} on ${j.machine}, running ${took} s: ${j.command}`;
	if ("error" in j.done) return `Job ${j.id} on ${j.machine} failed: ${j.done.error}`;
	const head = j.done.timedOut ? "Stopped at its time limit." : `Exit code ${j.done.code}.`;
	return `${head}\n${clip(j.done.output)}`;
}

/** Runs a command; one that outlasts the answer goes on as a job. exclusive takes the turn, for what's on the screen. */
export async function run(thread: string, machine: string, command: string, o: { timeout?: number; background?: boolean; exclusive?: boolean; wait?: number }): Promise<Out> {
	const m = await machineNamed(machine);
	notCarried(m, thread);
	const timeoutS = o.timeout ?? 600;
	const t = turnsOf(m);
	const exclusive = !!o.exclusive && thread !== USER;
	if (exclusive) {
		await forTurn(t, thread);
		await t.acquire(thread, waitMs(o.wait));
	}
	const job: Job = { id: `j${++jobN}`, thread, machine: m.id, command, started: Date.now(), promise: Promise.resolve() };
	// What runs on the screen is held to the same apps as a click.
	const work = async () => {
		const r = await m.driver.run(m, command, { timeoutS, exclusive });
		// Any command, in the turn or beside it, is held to the apps agents may use.
		const left = await leaveSensitive(m, thread);
		return left ? { ...r, code: r.code || 1, output: `${left}\n${r.output}` } : r;
	};
	const label = `running ${clipLabel(command)}`;
	job.promise = (exclusive ? t.run(thread, () => withMachine(null, m, { exclusive: false, wait: o.wait, label, by: thread }, work)) : withMachine(thread, m, { exclusive: false, wait: o.wait, label }, work)).then(
		(r) => {
			job.done = r;
		},
		(e) => {
			job.done = { error: message(e) };
		},
	);
	jobs.set(job.id, job);
	const answered = await Promise.race([job.promise.then(() => true), sleep(o.background ? 0 : ANSWER_MS).then(() => false)]);
	if (!answered) return { text: `Still running as job ${job.id}${exclusive ? ", holding your turn on " + m.name : ""}: check on it, wait for it or stop it with its id.` };
	jobs.delete(job.id);
	const d = job.done!;
	if ("error" in d) throw new DriverError(d.error);
	return { text: `${d.timedOut ? "Stopped after " + timeoutS + " s (the time limit)." : "Exit code " + d.code + "."}\n${clip(d.output)}`, code: d.timedOut ? 124 : d.code };
}

export async function job(thread: string, id: string | undefined, action: "status" | "wait" | "stop" = "status", waitMin?: number): Promise<Out> {
	if (!id) {
		const mine = [...jobs.values()].filter((j) => j.thread === thread);
		return { text: mine.length ? mine.map(jobText).join("\n") : "You have no jobs." };
	}
	const j = jobs.get(id);
	if (!j || j.thread !== thread) throw new DriverError(`No job ${id} of yours.`);
	if (action === "wait" && !j.done) await Promise.race([j.promise, sleep(Math.min(waitMin ?? 4, 10) * 60_000)]);
	if (action === "stop" && !j.done) return { text: `Job ${j.id} can't be stopped from here: it ends at its time limit.` };
	if (j.done) jobs.delete(j.id);
	const code = j.done && !("error" in j.done) ? (j.done.timedOut ? 124 : j.done.code) : j.done ? 1 : undefined;
	return { text: jobText(j), code };
}

/** adb, for a phone of the adb driver, in thread's turn: what it opens is held to the same apps as a tap. */
/** adb's commands of one phone an agent may give: none that picks another device, or acts on them all. */
const ADB_ALLOWED = new Set(["shell", "exec-out", "install", "install-multiple", "uninstall", "push", "pull", "logcat", "forward", "reverse", "reboot", "get-state", "get-serialno", "wait-for-device", "emu"]);

export async function adbRaw(thread: string, machine: string, args: string[], wait?: number): Promise<Out> {
	const m = await machineNamed(machine);
	if (m.kind !== "android" || !m.driver.raw) throw new DriverError(`${m.name} isn't a phone of the adb driver.`);
	if (thread !== USER && carried(m.id)) throw new DriverError(`${carriedRefusal(m.name)} Not adb.`);
	// The phone is the one named: its -s is the plugin's, and the command one of that phone's.
	if (thread !== USER && !ADB_ALLOWED.has(args[0] ?? "")) {
		throw new DriverError(`adb ${args[0] ?? ""} isn't one an agent gives here: ${[...ADB_ALLOWED].join(", ")}, for ${m.name} alone (no -s, -d, -e or -t: the plugin names the phone).`);
	}
	return withMachine(thread, m, { exclusive: true, wait, label: `adb ${clipLabel(args.join(" "))}` }, async () => {
		const r = await m.driver.raw!(m, args);
		const left = await leaveSensitive(m, thread);
		return { text: left ? `${left}\n${r.output}` : r.output, code: left ? r.code || 1 : r.code };
	});
}

// ---- Apps, files, power ----

export async function app(thread: string, machine: string, action: string, target: string, o: { args?: string[]; env?: Record<string, string>; cwd?: string; wait?: number }): Promise<Out> {
	const m = await machineNamed(machine);
	const carriedHere = thread !== USER && carried(m.id);
	if (carriedHere && action !== "install" && !((action === "uninstall" || action === "logs") && isTestApp(target))) throw new DriverError(carriedRefusal(m.name));
	if (thread !== USER && (action === "launch" || action === "focus")) {
		const kind = sensitive(target);
		if (kind) throw new DriverError(refusedApp(target, kind));
	}
	const exclusive = ["launch", "focus", "kill", "install"].includes(action);
	return withMachine(thread, m, { exclusive, wait: o.wait, label: `${action} ${clipLabel(target)}` }, async () => {
		if (carriedHere && action === "install") {
			// A test build's, as the driver reads its file: here, in the turn, right before it's installed.
			const id = await m.driver.packageOf?.(m, target).catch(() => "");
			if (!id) throw new DriverError(`${m.name} is the phone the user carries, and the ${m.driver.name} driver can't tell whose build ${target} is: ask the user to install it.`);
			if (!isTestApp(id)) throw new DriverError(carriedRefusal(m.name));
		}
		const said = await m.driver.app(m, action, target, { args: o.args ?? [], env: o.env ?? {}, cwd: o.cwd });
		const left = exclusive ? await leaveSensitive(m, thread) : "";
		if (left) throw new DriverError(left);
		return { text: said };
	});
}

/** A path, its . and .. resolved, in /'s or \\'s as it came. */
export function normalPath(p: string): string {
	const win = /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
	const sep = win ? "\\" : "/";
	const head = win ? p.slice(0, 2) : "";
	const out: string[] = [];
	for (const part of (win ? p.slice(2) : p).split(/[\\/]+/)) {
		if (part === "" || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return head + sep + out.join(sep);
}

/**
 * The files an agent copies here: its thread's own, in its folder, as a
 * relative path or one under it, never the rest of this computer (the
 * plugin's shell reaches all of it). A thread on another computer has
 * none here. The user's go as given, ~/ their home.
 */
async function localPaths(thread: string, paths: string[]): Promise<string[]> {
	if (thread === USER) return paths;
	const t = ((await call("Thread", { thread })) as { thread?: { dir?: string; machine?: string } | null }).thread;
	if (t?.machine) throw new DriverError("Your thread runs on another computer: its files aren't on the one Swarm runs on. Copy them with machine_run there, or with your own tools.");
	const dir = t?.dir ? normalPath(t.dir) : "";
	if (!dir) throw new DriverError("Your thread has no folder to copy files from or to.");
	const abs = (p: string) => /^([A-Za-z]:)?[\\/]/.test(p);
	return paths.map((p) => {
		const full = normalPath(abs(p) ? p : `${dir}/${p}`);
		const inside = full === dir || full.toLowerCase().startsWith((dir + (dir.endsWith("/") || dir.endsWith("\\") ? "" : dir.includes("\\") ? "\\" : "/")).toLowerCase());
		if (!inside) throw new DriverError(`${p} isn't in your thread's folder (${dir}): copy only what's in it.`);
		return full;
	});
}

export async function files(thread: string, machine: string, action: "put" | "get", given: string[], remote: string, wait?: number): Promise<Out> {
	const m = await machineNamed(machine);
	notCarried(m, thread);
	const locals = await localPaths(thread, given);
	return { text: await withMachine(thread, m, { exclusive: false, wait, label: action === "put" ? "copying files to it" : "copying files from it" }, () => (action === "put" ? m.driver.put(m, locals, remote) : m.driver.get(m, remote, locals[0]!))) };
}

export async function power(thread: string, machine: string, action: string, wait?: number): Promise<Out> {
	const m = await machineNamed(machine);
	notCarried(m, thread);
	return { text: await withMachine(thread, m, { exclusive: action !== "status", wait, label: `power ${action}` }, () => m.driver.power(m, action)) };
}

// ---- Recordings ----

export async function record(thread: string, machine: string, action: "start" | "stop", o: { title?: string; seconds?: number; wait?: number }): Promise<Out & { line?: string }> {
	const m = await machineNamed(machine);
	notCarried(m, thread);
	if (!m.driver.recordStart || !m.driver.recordStop) throw new DriverError(`${m.name} can't be recorded yet: the ${m.driver.name} driver takes no video.`);
	const rec = recording.get(m.id);
	if (action === "stop") {
		if (!rec || rec.thread !== thread) throw new DriverError(`You aren't recording ${m.name}.`);
		const line = await withMachine(thread, m, { exclusive: true, wait: o.wait, label: "saving the recording" }, async () => {
			recording.delete(m.id);
			const got = await m.driver.recordStop!(m);
			const data = got.data ?? (await fs.readBytes(got.path!));
			// What's left of it on the machine goes once Swarm has it, not before.
			let line;
			try {
				line = await showLine(thread, data, rec.title || `Recording of ${m.name}`);
			} catch (e) {
				throw new DriverError(`Swarm couldn't keep the recording (${Math.round(data.length / 1048576)} MB): ${message(e)}. Record a shorter flow.`);
			} finally {
				await got.cleanup?.().catch(() => {});
			}
			return line;
		});
		return { text: `Saved. Put this line in your reply, on a line of its own, to show it:\n${line}`, line };
	}
	if (rec) throw new DriverError(rec.thread === thread ? `You're recording ${m.name} already: stop it first.` : `${title(rec.thread)} is recording ${m.name}.`);
	const seconds = Math.max(5, Math.min(180, o.seconds ?? 120));
	await refuseSensitive(m, thread, "no recording");
	await withMachine(thread, m, { exclusive: true, wait: o.wait, label: "starting a recording" }, () => m.driver.recordStart!(m, { seconds, title: o.title ?? "" }));
	recording.set(m.id, { thread, title: o.title ?? "", since: Date.now() });
	return { text: `Recording ${m.name}, ${seconds} s at most: do the flow, then stop the recording. It's your turn on ${m.name} until then.` };
}

/** A thread's turn ended: its recordings stop, unkept, and its turns end. */
export function turnEnded(thread: string, turn?: number) {
	for (const [id, rec] of recording) {
		const m = st.machines.find((x) => x.id === id);
		if (rec.thread === thread && m) void m.driver.recordStop!(m).then((got) => got.cleanup?.()).catch(() => {}).finally(() => recording.delete(id));
	}
	for (const t of turns.values()) t.turnEnded(thread, turn);
}


// ---- Doctor ----

/** Everything the turned-on drivers need, checked. */
export async function doctor(): Promise<Check[]> {
	const checks: Check[] = [];
	const on = drivers();
	if (!on.length) return [{ what: "Test machines", ok: false, detail: "nothing turned on: Settings, Plugins, Test machines" }];
	for (const d of on) {
		if (d.doctor) {
			checks.push(...(await d.doctor().catch((e) => [{ what: d.name, ok: false, detail: message(e) }])));
			continue;
		}
		try {
			const list = await d.machines();
			checks.push({ what: d.name === "bb" ? "bb's test machines" : d.name, ok: list.length > 0, detail: list.length ? list.map((m) => m.name).join(", ") : "no machines" });
		} catch (e) {
			checks.push({ what: d.name, ok: false, detail: message(e) });
		}
	}
	return checks;
}

export const doctorText = (checks: Check[]) => checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.what}: ${c.detail}`).join("\n");

/** Reaches an Android phone over wireless debugging, pairing it first where given. */
export async function connect(addr: string, pair?: { addr: string; code: string }): Promise<Out> {
	const said = await adb.connect(addr, pair);
	await refresh();
	return { text: said };
}
