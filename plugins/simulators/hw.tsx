// What the page asks of Swarm past what every window has: a simulator's
// hardware keys pressed from the plugin, the live view without its bar and
// told the device's size, and captures saved, copied, added to a message
// and played. Each is looked for, and the page goes without it on a Swarm
// that hasn't it yet.
import * as swarm from "swarm";
import { call, settings, ui, type Child, type IconName } from "swarm";
import type { Device } from "./picker";
import { pngSize } from "./devices";
import type { Element } from "./elements";

/** Swarm's API, as its default export has it (machines is there, not a named export). */
const api = ((swarm as any).default ?? swarm) as any;
const UI = ui as any;

// ---- Hardware keys ----

export interface Key {
	name: string;
	label: string;
	icon: IconName;
	tip: string;
}

const IOS_KEYS: Key[] = [
	{ name: "home", label: "Home", icon: "house", tip: "Home" },
	{ name: "apps", label: "Apps", icon: "app-stack", tip: "The app switcher" },
	{ name: "rotate", label: "Rotate", icon: "redo", tip: "Turn it between portrait and landscape" },
	{ name: "keyboard", label: "Keyboard", icon: "keyboard", tip: "Show or hide its on-screen keyboard" },
	{ name: "lock", label: "Lock", icon: "lock", tip: "The side button: lock it, or wake it" },
];
const ANDROID_KEYS: Key[] = [
	{ name: "back", label: "Back", icon: "arrow-right", tip: "Back" },
	{ name: "home", label: "Home", icon: "house", tip: "Home" },
	{ name: "recents", label: "Apps", icon: "app-stack", tip: "Recent apps" },
	{ name: "rotate", label: "Rotate", icon: "redo", tip: "Turn it between portrait and landscape" },
];

/** sim_drive's steps, for what's said of one it can't take. */
export const STEPS = "tap X Y, doubletap X Y, long X Y [MS], swipe X1 Y1 X2 Y2 [MS], scroll up|down|left|right [X Y], pinch X Y SCALE, type TEXT, key NAME, rotate, wait MS (screenshot pixels)";

/** A device's screen as Swarm drives it from the plugin (swarm.machines.screen), where this Swarm can. */
export interface DeviceScreen {
	press(name: string): Promise<void>;
	rotate(): Promise<void>;
	tap(x: number, y: number): Promise<void>;
	swipe(from: { x: number; y: number }, to: { x: number; y: number }, ms?: number): Promise<void>;
	pinch(at: { x: number; y: number }, scale: number): Promise<void>;
	type(text: string): Promise<void>;
	key(name: string): Promise<void>;
	shot(): Promise<Uint8Array>;
	/** A Swarm with it reads the screen as accessibility elements. */
	describe?(): Promise<unknown[]>;
}

/** The device's screen, through Swarm, or null on a Swarm that can't. machine: the id ui.screen takes ("server" for its own). */
export function screenOf(machine: string, target: { simulator?: string; phone?: string }): DeviceScreen | null {
	const m = api.machines as undefined | { screen?: (machine: string, device: object) => DeviceScreen };
	if (typeof m?.screen !== "function" || (!target.simulator && !target.phone)) return null;
	return m.screen(machine === "server" ? "" : machine, target);
}

/** Whether this Swarm reads a device's screen as elements. */
export const canDescribe = (scr: DeviceScreen) => typeof scr.describe === "function";

/**
 * The screen's elements as Swarm reads them, as describe and named taps
 * take them: kind, name, box in screenshot pixels, and whether it takes a
 * tap. Swarm's frames are in the screen's pixels or fractions of it; the
 * latter are scaled to the screenshot the agent sees.
 */
export async function describe(scr: DeviceScreen, shot: () => Promise<Uint8Array>): Promise<Element[]> {
	const raw = (await scr.describe!()) as any[];
	let size: { width: number; height: number } | null = null;
	const out: Element[] = [];
	for (const e of raw) {
		const f = e.frame ?? e.rect ?? e;
		let x = Number(f.x), y = Number(f.y), w = Number(f.width ?? f.w), h = Number(f.height ?? f.h);
		if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
		if (x <= 1 && y <= 1 && w <= 1 && h <= 1) {
			size ??= pngSize(await shot());
			[x, y, w, h] = [x * size.width, y * size.height, w * size.width, h * size.height];
		}
		// Swarm's: its label, else its value (a field's text), else its id.
		const label = String(e.label || e.title || e.value || e.id || "").trim();
		if (!label) continue;
		const role = String(e.role ?? e.type ?? "").replace(/^(AX|XCUIElementType)/, "").toLowerCase();
		// A disabled one is listed, as not taking a tap.
		out.push({ role, label, x, y, w, h, action: e.enabled === false ? false : typeof e.actionable === "boolean" ? e.actionable : typeof e.action === "boolean" ? e.action : /button|cell|link|switch|textfield|searchfield|tab|key|slider|picker|icon|menuitem/.test(role) });
	}
	return out;
}

const canDrive = () => typeof (api.machines as any)?.screen === "function";

/** The keys the pill shows for a device: where Swarm can press them from here. */
export function keysFor(d: Device): Key[] {
	if (!canDrive()) return [];
	return d.platform === "ios" ? IOS_KEYS : ANDROID_KEYS;
}

/** Presses one of its keys (rotate turns it); why not, or null. */
export async function press(d: Device, name: string): Promise<string | null> {
	const machine = (await import("./mine")).page.machine[d.platform] || "server";
	const s = screenOf(machine, d.platform === "ios" ? { simulator: d.id } : { phone: d.serial });
	if (!s) return "This Swarm can't press a simulator's keys from here: update it.";
	try {
		if (name === "rotate") await s.rotate();
		else await s.press(name);
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

// ---- The live view ----

/** The device's frame as Swarm last said it (a rotation changes it). */
const sizes = ui.store(new Map<string, { w: number; h: number }>(), { shallow: true });
export const sizeOf = (d: Device) => sizes.get(d.id);

/** Whether the live view draws without its bar, and says the device's size. */
/** UI format 21 brought ui.screen's bare, keep and onSize, and the file asks and ui.video. */
const MEDIA_FORMAT = 21;
export const canBare = () => (ui.format ?? 0) >= MEDIA_FORMAT;

export function screen(props: Record<string, unknown>, d: Device): Child {
	return (
		<ui.screen
			key={d.id}
			{...(props as any)}
			{...({
				bare: true,
				keep: settings.get("instantReopen") === true ? 3600 : undefined,
				onSize: ({ width: w, height: h }: { width: number; height: number }) => {
					const was = sizes.get(d.id);
					if (w > 0 && h > 0 && (was?.w !== w || was?.h !== h)) sizes.set(d.id, { w, h });
				},
			} as any)}
		/>
	);
}

// ---- Captures ----

const hasMedia = () => (ui.format ?? 0) >= MEDIA_FORMAT;
/** The most a file ask or a picture takes (Swarm's asset limit). */
export const MAX_BYTES = 32 * 1024 * 1024;

export const canPlay = () => hasMedia() && typeof UI.video === "function";
export const video = (data: Uint8Array, _poster?: Uint8Array): Child => UI.video(data, { alt: "The recording", style: { width: "100%", height: "100%" } });

export const canCopyImage = () => hasMedia() && typeof UI.copyImage === "function";
export const copyImage = (data: Uint8Array) => UI.copyImage(data);

export const canSaveBytes = () => hasMedia();
export const saveBytes = (name: string, data: Uint8Array) => UI.saveFile(name, data);

export const canAttach = () => hasMedia() && typeof UI.attach === "function";
export const attach = (thread: string, name: string, data: Uint8Array) => UI.attach(thread, { name, data });

/** The user's threads, newest first, for Add to message. */
export async function recentThreads(): Promise<{ id: string; title: string }[]> {
	try {
		const all = (await call("Threads", {})) as { id: string; title: string; updated?: string; archived?: boolean }[];
		return all
			.filter((t) => !t.archived)
			.sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")))
			.map((t) => ({ id: t.id, title: t.title || "Untitled" }));
	} catch {
		return [];
	}
}
