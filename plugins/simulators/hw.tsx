// What the page asks of Swarm past what every window has: a simulator's
// hardware keys pressed from the plugin, the live view without its bar and
// told the device's size, and captures saved, copied, added to a message
// and played. Each is looked for, and the page goes without it on a Swarm
// that hasn't it yet.
import * as swarm from "swarm";
import { call, settings, ui, type Child, type IconName } from "swarm";
import type { Device } from "./picker";

const api = swarm as any;
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

/** Swarm's API for a screen's input, where it has one. */
const screenApi = () => api.screen as undefined | { press?: Function; rotate?: Function };

/** The keys the pill shows for a device: where Swarm can press them from here. */
export function keysFor(d: Device): Key[] {
	const s = screenApi();
	if (!s?.press) return [];
	return d.platform === "ios" ? IOS_KEYS : ANDROID_KEYS;
}

/** Presses one of its keys; why not, or null. */
export async function press(d: Device, name: string): Promise<string | null> {
	const s = screenApi();
	if (!s?.press) return "This Swarm can't press a simulator's keys from here: update it.";
	try {
		const target = d.platform === "ios" ? { simulator: d.id } : { phone: d.serial };
		const machine = (await import("./mine")).page.machine[d.platform] || "server";
		if (name === "rotate" && s.rotate) await s.rotate({ machine, ...target });
		else await s.press({ machine, ...target }, name);
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
export const canBare = () => typeof BARE_FORMAT === "number" && (ui.format ?? 0) >= BARE_FORMAT;
let BARE_FORMAT: number | undefined;

export function screen(props: Record<string, unknown>, d: Device): Child {
	return (
		<ui.screen
			key={d.id}
			{...(props as any)}
			{...({
				bare: true,
				keep: settings.get("instantReopen") === true ? 3600 : undefined,
				onSize: (w: number, h: number) => {
					const was = sizes.get(d.id);
					if (w > 0 && h > 0 && (was?.w !== w || was?.h !== h)) sizes.set(d.id, { w, h });
				},
			} as any)}
		/>
	);
}

// ---- Captures ----

let MEDIA_FORMAT: number | undefined;
const hasMedia = () => typeof MEDIA_FORMAT === "number" && (ui.format ?? 0) >= MEDIA_FORMAT;

export const canPlay = () => hasMedia() && typeof UI.video === "function";
export const video = (data: Uint8Array, poster?: Uint8Array): Child => UI.video({ src: data, poster, style: { width: "100%", height: "100%" } });

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
