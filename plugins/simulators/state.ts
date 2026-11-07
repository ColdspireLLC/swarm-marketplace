// What the plugin keeps: the pool of the agents' simulators (pool.ts), what
// each slot's simulator is, the last screenshot of each, the threads'
// titles, and where each platform's simulators run (the settings).
import { call, process, settings, storage, ui } from "swarm";
import { Pool, type Platform, type Slot } from "./pool";
import { parseKeep } from "./slimios";
import { IOS_CATEGORIES } from "./slimios";
import { ANDROID_KEEPABLE } from "./slimandroid";
import { joinedMachines, whereOf, type Where } from "./where";

/** A slot's simulator, as last seen. */
export interface SimInfo {
	/** iOS: its UDID. */
	udid?: string;
	/** Android: its adb serial while it runs. */
	serial?: string;
	name: string;
	/** Running, as far as the plugin knows. */
	booted: boolean;
	/** Slim, and what slimming kept. */
	slim: boolean;
	/** What it's doing: booting, slimming… "" for nothing. */
	busy: string;
	/** Why it last failed. */
	problem?: string;
}

/** The redraw: bumped as the pool changes. */
export const view = ui.store({ v: 0 });

const SAVE = "pool";

export const pool = new Pool(
	(p) => Math.max(0, Math.floor(Number(settings.get(p === "ios" ? "iosAgents" : "androidAgents") ?? 0))),
	() => {
		view.v++;
		storage.set(SAVE, pool.save());
	},
);

export const key = (s: Pick<Slot, "platform" | "n">) => `${s.platform}:${s.n}`;
export const infos = ui.store(new Map<string, SimInfo>(), { shallow: true });
export const info = (s: Slot): SimInfo => infos.get(key(s)) ?? { name: s.platform === "ios" ? `Swarm agent ${s.n}` : `Swarm agent ${s.n} (Android)`, booted: false, slim: false, busy: "" };
export function setInfo(s: Slot, patch: Partial<SimInfo>) {
	infos.set(key(s), { ...info(s), ...patch });
}

/** A slot's last screenshot, for the panel. */
export const shots = ui.store(new Map<string, { data: Uint8Array; at: number }>(), { shallow: true });

export function restore() {
	const saved = storage.get<ReturnType<Pool["save"]>>(SAVE);
	if (Array.isArray(saved)) pool.restore(saved);
}

// ---- Where ----

/**
 * Where a platform's simulators run: the setting's machine, else for iOS
 * this computer where it's a Mac and otherwise the first Mac joined to
 * Swarm; Android, where iOS's are unless set.
 */
export async function where(p: Platform): Promise<Where> {
	const w = await whereNow(p);
	placed.set(p, w);
	return w;
}

/** Where each platform's simulators were last found to run, for the panel to draw without asking. */
export const placed = ui.store(new Map<Platform, Where>(), { shallow: true });

async function whereNow(p: Platform): Promise<Where> {
	const set = (k: string) => String(settings.get(k) ?? "").trim();
	if (p === "android" && set("androidHost")) return whereOf(set("androidHost"));
	if (set("iosHost")) return whereOf(set("iosHost"));
	if (process.platform === "darwin") return whereOf("");
	// The Mac connected, else the one that's away: what's said is that it's away, not that
	// there's none (nor Android looked for here instead).
	const macs = (await joinedMachines()).filter((m) => m.os === "darwin");
	const mac = macs.find((m) => m.connected) ?? macs[0];
	if (mac) return { machine: mac.id, label: mac.name, offline: !mac.connected };
	if (p === "android") return whereOf("");
	return { label: "no Mac" };
}

/** The live view's link of a slot's simulator, where Swarm's window can show it. */
export function liveLink(w: Where, s: Slot, title: string): string {
	const i = info(s);
	if (w.ssh || !i.booted) return "";
	const q = s.platform === "android" ? (i.serial ? `phone=${encodeURIComponent(i.serial)}` : "") : i.udid ? `simulator=${encodeURIComponent(i.udid)}` : "";
	return q ? `swarm://screen/${w.machine ?? "server"}?${q}&watch=${encodeURIComponent(title)}` : "";
}

// ---- Settings ----

export const slimOn = () => settings.get("slim") !== false;
export const keepIOS = () => parseKeep(String(settings.get("keepIOS") ?? ""), IOS_CATEGORIES);
export const keepAndroid = () => parseKeep(String(settings.get("keepAndroid") ?? ""), ANDROID_KEEPABLE);

// ---- Titles ----

const titles = new Map<string, string>();

export async function learnTitles() {
	try {
		for (const t of await call("Threads", {})) titles.set(t.id, t.title);
	} catch {}
	view.v++;
}

export const title = (thread: string) => titles.get(thread) ?? `thread ${thread.slice(0, 6)}`;
/** A thread's title as a quote, for what's said: “Fix login”. */
export const quoted = (thread: string) => (titles.has(thread) ? `“${titles.get(thread)}”` : `thread ${thread.slice(0, 6)}`);

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
