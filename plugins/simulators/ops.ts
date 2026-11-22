// The actions, as the tools and the command line both run them: a thread
// takes a simulator of its own from the pool (made, slimmed and booted as
// it needs), then looks at it, drives it, runs its apps and changes its
// settings. Each acts on the thread's own simulator of the platform, taken
// in that call where it holds none.
import { call } from "swarm";
import * as android from "./android";
import * as access from "./access";
import { elementLines } from "./elements";
import { bring, copy, removeOn, samePlace, tempOn, threadInfo, threadPlace, threadWhere } from "./transfer";
import * as ios from "./ios";
import { SimError } from "./ios";
import { IDLE_MS, PoolError, type Platform, type Slot } from "./pool";
import { ANDROID_CATEGORIES, ANDROID_SETTINGS, androidMemory, androidPackagesOff, androidSettingsSet } from "./slimandroid";
import { IOS_CATEGORIES, iosLabelsOff, keptNote } from "./slimios";
import { info, keepAndroid, keepIOS, key, liveLink, message, pool, quoted, setInfo, shots, slimOn, title, where } from "./state";
import type { Where } from "./where";
import { settings } from "swarm";
import * as hw from "./hw";
import { pngSize } from "./devices";
import * as captures from "./captures";
import { borrow, checkDriving, isLoan, lentTo, loanNote, loans, sweepLoan, takenOver } from "./control";
import type { Device } from "./picker";

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
		const i = await threadInfo(thread);
		if (typeof i.turns === "number") return i.turns + (i.status === "idle" || i.status === "error" ? 1 : 0);
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
		if (w.offline) throw new SimError(`${w.label}, where the agents' ${s.platform === "ios" ? "iOS simulators" : "Android emulators"} run, isn't connected to Swarm just now: tell the user, who can start Swarm there (Settings, Machines says how it is). Don't try another way meanwhile.`);
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
	if (fresh) await access.unforward(s, w, null);
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
		const memory = androidMemory(settings.get("androidMemory"));
		if (await android.ensureAvd(w, sdk, s.n, slim, memory)) notes.push(`It's new, of ${sdk.image}: none of the user's apps or data. Install the app you test.`);
		setInfo(s, { busy: "booting" });
		serial = await android.boot(w, sdk, s.n, slim, memory);
		setInfo(s, { serial, busy: slim ? "slimming" : "booting" });
		const k = keepAndroid();
		if (slim) await android.slimGuest(w, sdk, serial, androidPackagesOff(k), androidSettingsSet(k));
		else await android.unslimGuest(w, sdk, serial);
	} else {
		setInfo(s, { busy: "booting" });
		await android.waitBooted(w, sdk, running);
	}
	setInfo(s, { serial, booted: true, slim });
	if (fresh) {
		// Another thread's: what it forwarded goes, as its apps do.
		await access.unforward(s, w, sdk);
	} else if (!running) await access.reforward(s, w, sdk);
	if (running && fresh) {
		setInfo(s, { busy: "clearing" });
		await android.clear(w, sdk, running);
	}
	setInfo(s, { busy: "waking" });
	await android.wake(w, sdk, serial!, !running || fresh);
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
	// The user's own simulator, where they lent it to this thread: in place of one of the pool's.
	const lent = lentTo(thread, p);
	if (lent) {
		const first = !loans.told;
		loans.told = true;
		return { slot: lent, w: await where(p), notes: first ? [loanNote()] : [], got: first };
	}
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
	if (isLoan(s)) return s.platform === "ios" ? `${i.name}, UDID ${i.udid}, on ${w.label}: the user's own, lent to you.` : `${i.name}, adb serial ${i.serial}, on ${w.label}: the user's own, lent to you.`;
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
		lines.push(`${p === "ios" ? "iOS simulators" : "Android emulators"}: ${cap} for agents, on ${w.label}${w.offline ? ", which isn't connected to Swarm just now" : ""}.${slimOn() ? " Slim." : ""}`);
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
	if (loans.now) lines.push(`The user's ${loans.now.device.name} is lent to ${quoted(loans.now.thread)}.`);
	if (takenOver.size) lines.push(`The user took over: ${[...takenOver].join(", ")}; the agents' calls on those wait until they hand them back.`);
	return { text: lines.join("\n") };
}

/** Runs fn on the thread's simulator, which it holds while fn runs. */
async function withSim<T>(thread: string, platform: string | undefined, o: { wait?: number }, fn: (s: Slot, w: Where) => Promise<T>): Promise<{ v: T; slot: Slot; w: Where; intro: string }> {
	const p = platformOf(thread, platform);
	const { slot, w, notes, got } = await mine(thread, p, o);
	checkDriving(slot, info(slot).name);
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
export async function showLine(thread: string, data: Uint8Array, caption: string, _kind: "png" | "mp4" = "png"): Promise<string> {
	let bin = "";
	for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
	const path = await call("KeepMedia", { thread, file: btoa(bin) });
	return `![${caption.replace(/[[\]]/g, "")}](<${path.replace(/\\/g, "/")}>)`;
}

export async function capture(thread: string, platform: string | undefined, o: { show?: boolean; keep?: boolean; settle?: number; label?: string; wait?: number }): Promise<Out> {
	const { v: data, slot, intro } = await withSim(thread, platform, o, async (s, w) => {
		// Let an animation finish first, where asked.
		if (o.settle) await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(0, o.settle!))));
		return shoot(s, w);
	});
	const notes = [`${info(slot).name}'s screen, at its pixels (what sim_drive takes).`];
	if (o.keep) {
		await captures.screenshot(deviceOf(slot), { thread, title: o.label });
		notes.push("Saved to the user's captures, on the Simulator page.");
	}
	if (o.show) notes.push(`Put this line in your reply, on a line of its own, to show it:\n${await showLine(thread, data, `Screenshot of ${info(slot).name}`)}`);
	return { text: join(intro, notes.join("\n")), shot: { data, mimeType: "image/png" } };
}

export async function describe(thread: string, platform: string | undefined, o: { wait?: number }): Promise<Out> {
	const { v: list, slot, intro } = await withSim(thread, platform, o, async (s, w) => (s.platform === "ios" ? ios.describe(w, s.n, info(s).udid!) : android.describe(w, await sdkOf(w), info(s).serial!)));
	if (!list.length) return { text: join(intro, `${info(slot).name} shows nothing named: look with sim_capture.`) };
	return { text: join(intro, `${info(slot).name}'s screen, ${list.length} element(s), at screenshot pixels (tap them with sim_drive):\n${elementLines(list)}`) };
}

/** Steps that name an element ("tap \"Sign in\""), with its middle's point in its place, as the screen says them now. */
async function placed(s: Slot, w: Where, steps: string[]): Promise<string[]> {
	const named = /^(tap|doubletap|long)\s+(?:"([^"]+)"|@(\S.*?))(\s+\d+)?\s*$/i;
	if (!steps.some((x) => named.test(x.trim()))) return steps;
	const list = s.platform === "ios" ? await ios.describe(w, s.n, info(s).udid!) : await android.describe(w, await sdkOf(w), info(s).serial!);
	return steps.map((x) => {
		const m = named.exec(x.trim());
		if (!m) return x;
		const want = (m[2] ?? m[3] ?? "").trim().toLowerCase();
		const e = list.find((el) => el.label.toLowerCase() === want) ?? list.find((el) => el.action && el.label.toLowerCase().includes(want)) ?? list.find((el) => el.label.toLowerCase().includes(want));
		if (!e) throw new SimError(`Nothing named “${m[2] ?? m[3]}” on the screen: sim_describe lists what is.`);
		return `${m[1]} ${Math.round(e.x + e.w / 2)} ${Math.round(e.y + e.h / 2)}${m[4] ?? ""}`;
	});
}

/**
 * Runs a step on Swarm's own input (swarm.machines.screen): every kind
 * sim_drive takes, in screenshot pixels (what sim_capture shows) made
 * fractions of the screen. False where it has no way (volume keys): the
 * driver's then.
 */
async function hidStep(scr: hw.DeviceScreen, step: string, size: () => Promise<{ width: number; height: number }>): Promise<boolean> {
	const [op = "", ...rest] = step.trim().split(/\s+/);
	const n = rest.map(Number);
	const at = async (x: number, y: number) => {
		const { width, height } = await size();
		return { x: Math.min(1, Math.max(0, x / width)), y: Math.min(1, Math.max(0, y / height)) };
	};
	const need = (k: number) => {
		if (n.length < k || n.slice(0, k).some((v) => !Number.isFinite(v))) throw new SimError(`${step}: ${hw.STEPS}`);
	};
	switch (op.toLowerCase()) {
		case "tap": {
			need(2);
			const p = await at(n[0]!, n[1]!);
			await scr.tap(p.x, p.y);
			return true;
		}
		case "doubletap": {
			need(2);
			const p = await at(n[0]!, n[1]!);
			await scr.tap(p.x, p.y);
			await scr.tap(p.x, p.y);
			return true;
		}
		case "long": {
			need(2);
			const p = await at(n[0]!, n[1]!);
			await scr.swipe(p, p, n[2] || 800);
			return true;
		}
		case "swipe": {
			need(4);
			await scr.swipe(await at(n[0]!, n[1]!), await at(n[2]!, n[3]!), n[4] || 300);
			return true;
		}
		case "scroll": {
			const d = { up: [0, 1 / 3], down: [0, -1 / 3], left: [1 / 3, 0], right: [-1 / 3, 0] }[(rest[0] ?? "").toLowerCase()];
			if (!d) throw new SimError(`${step}: scroll up|down|left|right [X Y]`);
			const from = Number.isFinite(n[1]) && Number.isFinite(n[2]) ? await at(n[1]!, n[2]!) : { x: 0.5, y: 0.5 };
			await scr.swipe(from, { x: Math.min(1, Math.max(0, from.x + d[0]!)), y: Math.min(1, Math.max(0, from.y + d[1]!)) }, 150);
			return true;
		}
		case "pinch": {
			need(3);
			if (!(n[2]! > 0)) throw new SimError(`${step}: pinch X Y SCALE (2 zooms in, 0.5 out)`);
			await scr.pinch(await at(n[0]!, n[1]!), n[2]!);
			return true;
		}
		case "type":
			await scr.type(step.trim().slice(4).trimStart());
			return true;
		case "rotate":
			await scr.rotate();
			return true;
		case "key": {
			const k = (rest[0] ?? "").toLowerCase();
			if (/^(home|apps|lock|keyboard|swipe-home|back|recents|power)$/.test(k)) await scr.press(k === "recents" ? "recents" : k);
			else if (/^(enter|return|delete|backspace|tab|escape|space|up|down|left|right)$/.test(k)) await scr.key(k === "return" ? "enter" : k === "delete" ? "backspace" : k);
			else return false;
			return true;
		}
		case "wait":
			await new Promise((r) => setTimeout(r, Math.min(n[0] || 500, 10_000)));
			return true;
	}
	throw new SimError(`no step ${op}: ${hw.STEPS}`);
}

export async function drive(thread: string, platform: string | undefined, steps: string[], o: { capture?: boolean; wait?: number }): Promise<Out> {
	const { v: data, slot, intro } = await withSim(thread, platform, o, async (s, w) => {
		steps = await placed(s, w, steps);
		const scr = w.ssh ? null : hw.screenOf(w.machine ?? "server", s.platform === "ios" ? { simulator: info(s).udid } : { phone: info(s).serial });
		// The screenshot's size the agent's points are in: the last one taken, else one now; again after a turn.
		const known: { size: { width: number; height: number } | null } = { size: null };
		const sizeOf = async () => {
			if (known.size) return known.size;
			const last = shots.get(key(s));
			known.size = pngSize(last && Date.now() - last.at < 60_000 ? last.data : await shoot(s, w));
			return known.size;
		};
		// In order: Swarm's own input where it has it (each step the user's Take over stops), the driver's otherwise.
		let run: string[] = [];
		const flush = async () => {
			if (!run.length) return;
			if (s.platform === "ios") await ios.drive(w, s.n, info(s).udid!, run);
			else await android.drive(w, await sdkOf(w), info(s).serial!, run);
			run = [];
		};
		let own = !!scr;
		for (const step of steps) {
			checkDriving(s, info(s).name);
			if (own) {
				try {
					if (await hidStep(scr!, step, sizeOf)) {
						if (/^rotate\b/i.test(step.trim()) && known.size) known.size = { width: known.size.height, height: known.size.width };
						continue;
					}
				} catch (e) {
					if (e instanceof SimError) throw e;
					// The machine's Swarm can't (older than the window's): the driver for the rest.
					if (/^(rotate|pinch|key\s+(apps|keyboard|swipe-home))/i.test(step.trim())) throw e;
					own = false;
				}
			} else if (/^pinch\s/i.test(step.trim())) throw new SimError("A pinch needs a newer Swarm, which drives the simulator's own input.");
			run.push(step);
			await flush();
		}
		await flush();
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
				case "install": {
					const f = await bring(thread, need(), w);
					try {
						await ios.install(w, u, f.path);
					} finally {
						await f.done();
					}
					return `Installed ${target}${f.copied ? `, copied from the thread's computer` : ""}.`;
				}
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
				case "install": {
					const f = await bring(thread, need(), w);
					try {
						return (await android.install(w, sdk, serial, f.path)).trim() || `Installed ${target}${f.copied ? `, copied from the thread's computer` : ""}.`;
					} finally {
						await f.done();
					}
				}
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
	if (action === "borrow") {
		const p = platformOf(thread, platform);
		const { current: shown, page, refresh } = await import("./mine");
		await refresh();
		const d = [shown(), ...page.devices].find((x) => x && !x.agent && x.platform === p && x.state === "Booted");
		if (!d) throw new SimError(`The user has no ${p === "ios" ? "iOS simulator" : "Android emulator"} of their own running to lend: ask them in your reply.`);
		return { text: borrow(thread, d, value ?? "") };
	}
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
	if (lentTo(thread, p)) throw new SimError(`${loans.now!.device.name} is the user's own, lent to you: you can't ${action === "erase" ? "erase" : action === "reboot" ? "reboot" : "shut down"} it.`);
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

/** Runs a command on the thread's device (Android's shell, root through su; an iOS simulator's Mac, in its data folder). */
export async function shell(thread: string, platform: string | undefined, command: string, o: { root?: boolean; timeout?: number; wait?: number }): Promise<Out> {
	const { v, intro } = await withSim(thread, platform, o, async (s, w) => access.shell(s, w, s.platform === "android" ? await sdkOf(w) : null, command, !!o.root, o.timeout ?? 120));
	return { text: join(intro, `Exit code ${v.code}.${v.output ? "\n" + v.output : ""}`), code: v.code };
}

/** Copies a file between the thread's computer and its device. */
export async function files(thread: string, platform: string | undefined, action: "put" | "get", local: string, remote: string, o: { wait?: number }): Promise<Out> {
	const { v, intro } = await withSim(thread, platform, o, async (s, w) => access.files(thread, s, w, s.platform === "android" ? await sdkOf(w) : null, action, local, remote));
	return { text: join(intro, v) };
}

/** Makes the device's localhost:port reach the thread's dev server, or undoes it. */
export async function forward(thread: string, platform: string | undefined, port: number | undefined, o: { to?: string; remove?: boolean; wait?: number }): Promise<Out> {
	const { v, intro } = await withSim(thread, platform, o, async (s, w) => {
		const sdk = s.platform === "android" ? await sdkOf(w) : null;
		if (o.remove) {
			await access.unforward(s, w, sdk, port);
			return port ? `${info(s).name}'s port ${port} isn't forwarded any more.` : `${info(s).name}'s forwards are gone.`;
		}
		if (port === undefined) {
			const list = access.forwardsOf(s);
			return list.length ? list.map((f) => `localhost:${f.device} → ${f.to}`).join("\n") : "No forwards.";
		}
		return access.forward(thread, s, w, sdk, port, o.to);
	});
	return { text: join(intro, v) };
}

/**
 * Each minute: holders unused IDLE_MS while another waits give theirs
 * back; free simulators unused that long are shut down (each holds a
 * couple of GB while it runs).
 */
export async function sweep() {
	sweepLoan();
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

/** A slot's simulator as the page's devices are, for captures. */
function deviceOf(s: Slot): Device {
	const i = info(s);
	return { id: s.platform === "ios" ? i.udid! : `avd:${android.avdName(s.n)}`, platform: s.platform, name: i.name, state: "Booted", os: "", serial: i.serial };
}

/**
 * Records the thread's simulator for the user: start (a title for the
 * clip), then stop, which gives the line that shows the clip in the reply;
 * keep saves it to the user's captures too. Up to 3 minutes.
 */
export async function record(thread: string, platform: string | undefined, action: string, o: { title?: string; keep?: boolean; wait?: number }): Promise<Out> {
	if (action === "start") {
		if (!o.title?.trim()) throw new SimError("A recording needs a title: what it shows, for the user.");
		const { v, slot, intro } = await withSim(thread, platform, o, async (s) => captures.startRecording(deviceOf(s), { thread, title: o.title!.trim() }));
		if (v) throw new SimError(v);
		return { text: join(intro, `Recording ${info(slot).name} (up to 3 minutes): do what it should show, then sim_record stop.`) };
	}
	if (action === "stop") {
		const r = captures.recording.now;
		if (!r || r.thread !== thread) throw new SimError("You're not recording: sim_record start first.");
		const c = await captures.stopRecording();
		if (typeof c === "string") throw new SimError(c);
		const data = await captures.bytesOf(c);
		const line = await showLine(thread, data, c.title || `Recording of ${c.name}`, "mp4");
		if (!o.keep) await captures.remove([c.id]);
		return { text: `Recorded ${c.secs ?? 0} s of ${c.name}${o.keep ? ", saved to the user's captures" : ""}. Put this line in your reply, on a line of its own, to show it:\n${line}` };
	}
	throw new SimError("start (with a title) or stop.");
}

/** A screenshot of the thread's simulator written to a file on the thread's computer (relative to its folder); its path. */
export async function captureTo(thread: string, platform: string | undefined, out: string, o: { settle?: number; keep?: boolean; label?: string; wait?: number }): Promise<Out> {
	const { v: dest, slot, intro } = await withSim(thread, platform, o, async (s, w) => {
		if (o.settle) await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(0, o.settle!))));
		const tmp = await tempOn(w, "screenshot.png");
		try {
			if (s.platform === "ios") await ios.mac(w, `xcrun simctl io "$1" screenshot --type=png "$2" >/dev/null 2>&1 || { echo "it isn't running" >&2; exit 3; }`, [info(s).udid!, tmp]);
			else await ios.mac(w, `"$1" -s "$2" exec-out screencap -p > "$3"`, [(await sdkOf(w)).adb, info(s).serial!, tmp]);
			const t = await threadPlace(thread);
			const { dir } = await threadWhere(thread);
			const dest = /^(\/|[A-Za-z]:[\\/]|~)/.test(out) ? out : `${dir.replace(/[\\/]$/, "")}/${out}`;
			if (samePlace(t, w)) await ios.mac(w, `mkdir -p "$(dirname "$2")" && cp "$1" "$2"`, [tmp, dest]);
			else await copy(w, tmp, t, dest);
			return dest;
		} finally {
			await removeOn(w, tmp);
		}
	});
	if (o.keep) await captures.screenshot(deviceOf(slot), { thread, title: o.label });
	return { text: join(intro, `Wrote ${info(slot).name}'s screen to ${dest}${o.keep ? ", and saved it to the user's captures" : ""}.`) };
}
