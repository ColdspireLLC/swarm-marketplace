// The actions, as the tools and the command line both run them: a thread
// takes a simulator of its own from the pool (made, slimmed and booted as
// it needs), then looks at it, drives it, runs its apps and changes its
// settings. Each acts on the thread's own simulator of the platform, taken
// in that call where it holds none.
import { call } from "swarm";
import * as android from "./android";
import { elementLines } from "./elements";
import * as ios from "./ios";
import { SimError } from "./ios";
import { IDLE_MS, PoolError, type Platform, type Slot } from "./pool";
import { ANDROID_CATEGORIES, ANDROID_SETTINGS, androidPackagesOff, androidSettingsSet } from "./slimandroid";
import { IOS_CATEGORIES, iosLabelsOff, keptNote } from "./slimios";
import { info, keepAndroid, keepIOS, key, liveLink, message, pool, quoted, setInfo, shots, slimOn, title, where } from "./state";
import type { Where } from "./where";
import { settings } from "swarm";

export interface Out {
	text: string;
	shot?: { data: Uint8Array; mimeType: string };
	code?: number;
}

export const PLATFORM_NAME: Record<Platform, string> = { ios: "iOS simulator", android: "Android emulator" };

/** The platform a call means: the one named, else the one the thread holds (iOS where both or none). */
export function platformOf(thread: string, p?: string): Platform {
	const v = (p ?? "").trim().toLowerCase();
	if (v === "ios" || v === "iphone" || v === "simulator") return "ios";
	if (v === "android" || v === "emulator") return "android";
	if (v) throw new SimError(`No platform ${p}: ios or android.`);
	const held = pool.heldBy(thread);
	return held.length === 1 ? held[0]!.platform : "ios";
}

const waitMs = (wait?: number) => Math.min(30, Math.max(0, wait ?? 4)) * 60_000;

/** The thread's turn just now, for a hold that an end of an earlier turn, heard late, mustn't end. */
async function turnOf(thread: string): Promise<number | undefined> {
	try {
		const d = (await call("Thread", { thread })) as { info?: { turns?: number; status?: string } } | null;
		const i = d?.info;
		if (i && typeof i.turns === "number") return i.turns + (i.status === "idle" || i.status === "error" ? 1 : 0);
	} catch {}
	return undefined;
}

/** The most a call waits for a simulator to get ready before it answers that it's still booting. */
export const READY_WAIT = 45_000;

/** When each slot was last made ready. */
const readyAt = new Map<string, number>();

/** Each slot's getting ready, so that two calls don't boot it twice. */
const readying = new Map<string, Promise<void>>();

/**
 * Makes a slot's simulator ready for its holder: made where there's
 * none, slimmed to the setting while it's shut down, booted, and cleared
 * of the last thread's apps and settings where it changed hands.
 */
async function ready(s: Slot, fresh: boolean): Promise<string[]> {
	const k = key(s);
	const notes: string[] = [];
	if (readying.has(k)) {
		// Another call is making it ready: its result is this one's (a retry of a call that
		// answered it was still booting doesn't slim and save it all again).
		while (readying.has(k)) await readying.get(k);
		if (info(s).booted && !info(s).problem) return notes;
	}
	const run = (async () => {
		const w = await where(s.platform);
		if (!w.machine && !w.ssh && w.label === "no Mac") throw new SimError("iOS simulators need a Mac: join one to Swarm (swarm machine), or set the Simulators plugin's Mac.");
		try {
			if (s.platform === "ios") notes.push(...(await readyIOS(w, s, fresh)));
			else notes.push(...(await readyAndroid(w, s, fresh)));
			setInfo(s, { busy: "", problem: undefined });
		} catch (e) {
			setInfo(s, { busy: "", problem: message(e) });
			throw e;
		}
	})();
	readying.set(k, run.then(() => {}, () => {}));
	try {
		await run;
	} finally {
		readying.delete(k);
	}
	return notes;
}

async function readyIOS(w: Where, s: Slot, fresh: boolean): Promise<string[]> {
	const notes: string[] = [];
	const { device: d, created } = await ios.ensureAgent(w, s.n, String(settings.get("iosModel") ?? ""));
	setInfo(s, { udid: d.udid, name: d.name, booted: d.state === "Booted" });
	const off = slimOn() ? iosLabelsOff(keepIOS()) : [];
	if (d.state !== "Booted") {
		const had = await ios.slimmed(w, d.udid);
		if (had.join() !== [...off].sort().join()) {
			setInfo(s, { busy: off.length ? "slimming" : "unslimming" });
			const why = await ios.slim(w, d, off);
			if (why) notes.push(why);
		}
		setInfo(s, { busy: "booting" });
		await ios.boot(w, d.udid);
		setInfo(s, { booted: true, slim: off.length > 0 });
	} else if (fresh && !created) {
		setInfo(s, { busy: "clearing" });
		await ios.clear(w, d.udid);
	}
	if (created) notes.push(`It's new: none of the user's apps or data. Install the app you test.`);
	return notes;
}

let sdkProblem = "";

async function sdkOf(w: Where) {
	try {
		const s = await android.sdk(w, String(settings.get("androidSdk") ?? ""), String(settings.get("androidImage") ?? ""));
		sdkProblem = "";
		return s;
	} catch (e) {
		sdkProblem = message(e);
		throw e;
	}
}

/**
 * Makes an emulator ready: one shut down boots (cold) and is slimmed; one
 * going to another thread is cleared of the last one's apps; either is
 * woken at its home screen.
 */
async function readyAndroid(w: Where, s: Slot, fresh: boolean): Promise<string[]> {
	const notes: string[] = [];
	const sdk = await sdkOf(w);
	const slim = slimOn();
	const running = (await android.running(w, sdk)).get(android.avdName(s.n));
	let serial = running;
	if (!running) {
		setInfo(s, { busy: "making", name: `Swarm agent ${s.n} (Android)` });
		if (await android.ensureAvd(w, sdk, s.n, slim)) notes.push(`It's new, of ${sdk.image}: none of the user's apps or data. Install the app you test.`);
		setInfo(s, { busy: "booting" });
		serial = await android.boot(w, sdk, s.n, slim);
		setInfo(s, { serial, busy: slim ? "slimming" : "booting" });
		const k = keepAndroid();
		if (slim) await android.slimGuest(w, sdk, serial, androidPackagesOff(k), androidSettingsSet(k));
		else await android.unslimGuest(w, sdk, serial);
	} else {
		setInfo(s, { busy: "booting" });
		await android.waitBooted(w, sdk, running);
	}
	setInfo(s, { serial, booted: true, slim });
	if (running && fresh) {
		setInfo(s, { busy: "clearing" });
		await android.clear(w, sdk, running);
	}
	setInfo(s, { busy: "waking" });
	await android.wake(w, sdk, serial!);
	return notes;
}

/** What slimming turned off and kept, for the agent. */
function slimNote(p: Platform): string {
	if (!slimOn()) return "";
	if (p === "ios") {
		const k = keepIOS();
		const off = Object.entries(IOS_CATEGORIES).filter(([id]) => !k.categories.includes(id)).map(([, c]) => c.what);
		return `It's slim: ${off.join(", ")} are off, to save memory; on are ${keptNote(k)}. If the app needs one of those, ask the user to keep it (the Simulators setting, Keep in iOS simulators).`;
	}
	const k = keepAndroid();
	const off = [...Object.entries(ANDROID_CATEGORIES), ...Object.entries(ANDROID_SETTINGS)].filter(([id]) => !k.categories.includes(id)).map(([, c]) => c.what);
	return `It's slim: ${off.join(", ")} are off or disabled, to save memory. If the app needs one, ask the user to keep it (the Simulators setting, Keep in Android emulators).`;
}

/** The thread's simulator of a platform: the one it holds, else one from the pool, ready. */
export async function mine(thread: string, p: Platform, o: { wait?: number; note?: string } = {}): Promise<{ slot: Slot; w: Where; notes: string[]; got: boolean }> {
	// A call answers within READY_WAIT, its time in line and the simulator's getting ready
	// together: the agent's client gives up on a tool after a minute.
	const start = Date.now();
	const { slot, fresh } = await pool.take(thread, p, { waitMs: Math.min(waitMs(o.wait), READY_WAIT), note: o.note, turn: await turnOf(thread) });
	const got = fresh || !info(slot).booted;
	let notes: string[] = [];
	const k = key(slot);
	// Looked at in the last 2 minutes and booted: it's as it was, no need to ask the Mac again.
	if (got || Date.now() - (readyAt.get(k) ?? 0) > 120_000) {
		const run = pool.using(slot, () => ready(slot, fresh)).then((n) => {
			readyAt.set(k, Date.now());
			return n;
		});
		let timer = 0;
		const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), Math.max(5_000, READY_WAIT - (Date.now() - start))) as unknown as number));
		let said: string[] | null;
		try {
			said = await Promise.race([run, late]);
		} catch (e) {
			pool.release(slot);
			throw e;
		} finally {
			clearTimeout(timer);
		}
		if (said === null) {
			// The agent's call would time out first (its client gives up after a minute or so): it
			// goes on here, the thread's still, and the next call finds it ready or waits again.
			run.catch(() => {});
			throw new SimError(`${info(slot).name} is still ${info(slot).busy || "getting ready"} (that can take minutes on a busy Mac): it's yours meanwhile. Call again in a minute.`);
		}
		notes = said;
	}
	return { slot, w: await where(p), notes, got };
}

/** Who the simulator is: its name, its UDID or serial, and how to build for it. */
function about(s: Slot, w: Where): string {
	const i = info(s);
	if (s.platform === "ios")
		return [
			`${i.name}, UDID ${i.udid}, on ${w.label}: yours alone until your turn ends.`,
			`Build and run on it there: xcodebuild … -destination id=${i.udid} -derivedDataPath <a folder of this thread's>, npx expo run:ios --device ${i.udid}, or xcrun simctl install ${i.udid} <app>.`,
		].join("\n");
	return [`${i.name}, adb serial ${i.serial}, on ${w.label}: yours alone until your turn ends.`, `Install on it there: adb -s ${i.serial} install -r <apk>, or npx expo run:android --device ${i.serial}.`].join("\n");
}

export async function take(thread: string, platform: string | undefined, o: { wait?: number; note?: string }): Promise<Out> {
	const p = platformOf(thread, platform);
	const { slot, w, notes } = await mine(thread, p, o);
	return { text: [about(slot, w), ...notes, slimNote(p)].filter(Boolean).join("\n") };
}

export function release(thread: string, platform?: string): Out {
	const p = platform ? platformOf(thread, platform) : undefined;
	const gave = pool.releaseAll(thread, p);
	return { text: gave.length ? `Gave back ${gave.map((s) => info(s).name).join(" and ")}.` : "You held no simulator." };
}

export function turnEnded(thread: string, turn?: number) {
	pool.turnEnded(thread, turn);
}

/** The pool: each simulator, who has it, who waits. */
export async function status(): Promise<Out> {
	const lines: string[] = [];
	for (const p of ["ios", "android"] as Platform[]) {
		const cap = Number(settings.get(p === "ios" ? "iosAgents" : "androidAgents") ?? 0);
		const w = await where(p);
		lines.push(`${p === "ios" ? "iOS simulators" : "Android emulators"}: ${cap} for agents, on ${w.label}.${slimOn() ? " Slim." : ""}`);
		for (const s of pool.slots.filter((x) => x.platform === p).sort((a, b) => a.n - b.n)) {
			const i = info(s);
			const who = s.holder ? `${quoted(s.holder.thread)}'s${s.holder.note ? ` (${s.holder.note})` : ""}` : "free";
			const state = i.busy || (i.booted ? "booted" : "shut down");
			lines.push(`  ${i.name}: ${who}, ${state}${i.udid ? `, ${i.udid}` : i.serial ? `, ${i.serial}` : ""}${i.problem ? `. Last problem: ${i.problem}` : ""}`);
		}
		const waiting = pool.waiting.filter((x) => x.platform === p);
		if (waiting.length) lines.push(`  Waiting: ${waiting.map((x) => quoted(x.thread)).join(", ")}`);
		if (p === "android" && sdkProblem) lines.push(`  ${sdkProblem}`);
	}
	return { text: lines.join("\n") };
}

/** Runs fn on the thread's simulator, which it holds while fn runs. */
async function withSim<T>(thread: string, platform: string | undefined, o: { wait?: number }, fn: (s: Slot, w: Where) => Promise<T>): Promise<{ v: T; slot: Slot; w: Where; intro: string }> {
	const p = platformOf(thread, platform);
	const { slot, w, notes, got } = await mine(thread, p, o);
	let v: T;
	try {
		v = await pool.using(slot, () => fn(slot, w));
	} catch (e) {
		// It may have died: the next call asks the Mac again.
		readyAt.delete(key(slot));
		throw e;
	}
	const intro = got ? [about(slot, w), ...notes, slimNote(p)].filter(Boolean).join("\n") : "";
	return { v, slot, w, intro };
}

async function shoot(s: Slot, w: Where): Promise<Uint8Array> {
	const i = info(s);
	const data = s.platform === "ios" ? await ios.screenshot(w, i.udid!) : await android.screenshot(w, await sdkOf(w), i.serial!);
	shots.set(key(s), { data, at: Date.now() });
	return data;
}

const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join("\n\n");

/** Keeps a picture with the thread, for its reply to show: the Markdown line. */
export async function showLine(thread: string, data: Uint8Array, caption: string): Promise<string> {
	let bin = "";
	for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
	const path = await call("KeepMedia", { thread, file: btoa(bin) });
	return `![${caption.replace(/[[\]]/g, "")}](<${path.replace(/\\/g, "/")}>)`;
}

export async function capture(thread: string, platform: string | undefined, o: { show?: boolean; wait?: number }): Promise<Out> {
	const { v: data, slot, intro } = await withSim(thread, platform, o, shoot);
	const notes = [`${info(slot).name}'s screen, at its pixels (what sim_drive takes).`];
	if (o.show) notes.push(`Put this line in your reply, on a line of its own, to show it:\n${await showLine(thread, data, `Screenshot of ${info(slot).name}`)}`);
	return { text: join(intro, notes.join("\n")), shot: { data, mimeType: "image/png" } };
}

export async function describe(thread: string, platform: string | undefined, o: { wait?: number }): Promise<Out> {
	const { v: list, slot, intro } = await withSim(thread, platform, o, async (s, w) => (s.platform === "ios" ? ios.describe(w, s.n, info(s).udid!) : android.describe(w, await sdkOf(w), info(s).serial!)));
	if (!list.length) return { text: join(intro, `${info(slot).name} shows nothing named: look with sim_capture.`) };
	return { text: join(intro, `${info(slot).name}'s screen, ${list.length} element(s), at screenshot pixels (tap them with sim_drive):\n${elementLines(list)}`) };
}

export async function drive(thread: string, platform: string | undefined, steps: string[], o: { capture?: boolean; wait?: number }): Promise<Out> {
	const { v: data, slot, intro } = await withSim(thread, platform, o, async (s, w) => {
		if (s.platform === "ios") await ios.drive(w, s.n, info(s).udid!, steps);
		else await android.drive(w, await sdkOf(w), info(s).serial!, steps);
		return o.capture ? shoot(s, w) : undefined;
	});
	return { text: join(intro, `Done on ${info(slot).name}: ${steps.join("; ")}.`), shot: data ? { data, mimeType: "image/png" } : undefined };
}

export async function app(thread: string, platform: string | undefined, action: string, target: string | undefined, o: { args?: string[]; wait?: number }): Promise<Out> {
	const need = () => {
		if (!target) throw new SimError(`${action} needs a target: the app's bundle id or package, a path, or a URL.`);
		return target;
	};
	const { v, intro } = await withSim(thread, platform, o, async (s, w) => {
		const i = info(s);
		if (s.platform === "ios") {
			const u = i.udid!;
			switch (action) {
				case "list":
					return (await ios.apps(w, u)).filter((a) => a.user).map((a) => `${a.id} (${a.name})`).join("\n") || "No apps installed but iOS's own.";
				case "launch":
					return (await ios.launch(w, u, need(), o.args)).trim() || `Launched ${target}.`;
				case "terminate":
					await ios.terminate(w, u, need());
					return `Quit ${target}.`;
				case "install":
					await ios.install(w, u, need());
					return `Installed ${target}.`;
				case "uninstall":
					await ios.uninstall(w, u, need());
					return `Uninstalled ${target}.`;
				case "openurl":
					await ios.openURL(w, u, need());
					return `Opened ${target}.`;
				case "logs":
					return (await ios.logs(w, u, need())).trim() || "No log lines in the last 3 minutes.";
			}
		} else {
			const sdk = await sdkOf(w);
			const serial = i.serial!;
			switch (action) {
				case "list":
					return (await android.apps(w, sdk, serial)).map((a) => a.id).join("\n") || "No apps installed but Android's own.";
				case "launch":
					await android.launch(w, sdk, serial, need());
					return `Launched ${target}.`;
				case "terminate":
					await android.terminate(w, sdk, serial, need());
					return `Stopped ${target}.`;
				case "install":
					return (await android.install(w, sdk, serial, need())).trim() || `Installed ${target}.`;
				case "uninstall":
					return (await android.uninstall(w, sdk, serial, need())).trim() || `Uninstalled ${target}.`;
				case "openurl":
					await android.openURL(w, sdk, serial, need());
					return `Opened ${target}.`;
				case "logs":
					return (await android.logs(w, sdk, serial, need())).trim() || "No log lines.";
			}
		}
		throw new SimError(`No app action ${action}: list, launch, terminate, install, uninstall, openurl, logs.`);
	});
	return { text: join(intro, v) };
}

/** The device itself: its settings, and shut down, reboot, erase, slim. */
export async function device(thread: string, platform: string | undefined, action: string, value: string | undefined, o: { app?: string; wait?: number }): Promise<Out> {
	if (action === "shutdown" || action === "reboot" || action === "erase") return power(thread, platform, action, o);
	const { v, intro } = await withSim(thread, platform, o, async (s, w) => {
		const i = info(s);
		if (action === "measure") {
			const m = s.platform === "ios" ? await ios.measure(w, i.udid!) : await android.measure(w, await sdkOf(w), i.serial!);
			return "processes" in m ? `${i.name}: ${m.processes} processes, ${m.mb} MB.` : `${i.name}'s emulator: ${m.mb} MB.`;
		}
		if (!value) throw new SimError(`${action} needs a value.`);
		return s.platform === "ios" ? ios.setting(w, i.udid!, action, value, o.app) : android.setting(w, await sdkOf(w), i.serial!, action, value, o.app);
	});
	return { text: join(intro, v) };
}

/**
 * Shuts the thread's simulator down, erased or not, without making it
 * ready first (one stuck booting is what's shut down): the next call
 * boots it, so a reboot is a shutdown and that call.
 */
async function power(thread: string, platform: string | undefined, action: "shutdown" | "reboot" | "erase", o: { wait?: number }): Promise<Out> {
	const p = platformOf(thread, platform);
	const { slot: s } = await pool.take(thread, p, { waitMs: Math.min(waitMs(o.wait), READY_WAIT), turn: await turnOf(thread) });
	const w = await where(p);
	return pool.using(s, async () => {
		setInfo(s, { busy: action === "erase" ? "erasing" : "shutting down" });
		try {
			if (s.platform === "ios") {
				const udid = info(s).udid ?? (await ios.devices(w)).find((d) => d.name.startsWith(ios.agentPrefix(s.n)))?.udid;
				if (udid) {
					await ios.stopWDA(w, udid);
					await (action === "erase" ? ios.erase(w, udid) : ios.shutdown(w, udid));
				}
			} else {
				const sdk = await sdkOf(w);
				await (action === "erase" ? android.erase(w, sdk, s.n) : android.shutdown(w, sdk, s.n));
			}
		} finally {
			readyAt.delete(key(s));
			setInfo(s, { booted: false, serial: undefined, busy: "", problem: undefined });
		}
		const name = info(s).name;
		return { text: action === "erase" ? `${name} is erased: no apps, no data. Your next call boots it.` : `${name} is shut down. Your next call boots it${action === "reboot" ? ", which is the reboot" : " again"}.` };
	});
}

/**
 * Each minute: holders unused IDLE_MS while another waits give theirs
 * back; free simulators unused that long are shut down (each holds a
 * couple of GB while it runs).
 */
export async function sweep() {
	const { idle } = pool.sweep();
	for (const s of idle) {
		const i = info(s);
		if (!i.booted || i.busy) continue;
		setInfo(s, { busy: "shutting down" });
		try {
			const w = await where(s.platform);
			if (s.platform === "ios") {
				await ios.stopWDA(w, i.udid!);
				await ios.shutdown(w, i.udid!);
			} else await android.shutdown(w, await sdkOf(w), s.n);
			setInfo(s, { booted: false, serial: undefined });
			readyAt.delete(key(s));
		} catch (e) {
			setInfo(s, { problem: message(e) });
		} finally {
			setInfo(s, { busy: "" });
		}
	}
}

/** What the plugin's simulators are, as the Macs list them, for the panel after a restart. */
export async function look() {
	for (const p of ["ios", "android"] as Platform[]) {
		try {
			const w = await where(p);
			if (p === "ios") {
				if (w.label === "no Mac") continue;
				const list = await ios.devices(w);
				for (const s of pool.slots.filter((x) => x.platform === "ios")) {
					const d = list.find((x) => x.name.startsWith(ios.agentPrefix(s.n)));
					if (d) setInfo(s, { udid: d.udid, name: d.name, booted: d.state === "Booted" });
				}
			} else {
				if (!pool.slots.some((x) => x.platform === "android")) continue;
				const run = await android.running(w, await sdkOf(w));
				for (const s of pool.slots.filter((x) => x.platform === "android")) {
					const serial = run.get(android.avdName(s.n));
					setInfo(s, { name: `Swarm agent ${s.n} (Android)`, serial, booted: !!serial });
				}
			}
		} catch {}
	}
}

/** Looks at a slot's simulator for the user, without taking it. */
export async function lookAt(s: Slot) {
	const i = info(s);
	if (!i.booted) return;
	try {
		await shoot(s, await where(s.platform));
	} catch (e) {
		setInfo(s, { problem: message(e) });
	}
}

/** The user lets go of a slot's simulator: its holder's turn on it ends. */
export function endTurn(s: Slot) {
	pool.release(s);
}

export { IDLE_MS, PoolError, liveLink, title };
