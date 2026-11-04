// Finding the phones: those plugged into this computer or a computer
// joined to Swarm, through adb and devicectl there, whether the plugin
// uses them yet or not. The Settings page turns one on with a button, the
// Machines panel says when one's plugged in and unused, and agents see
// it in status and `discover`: so a phone isn't left out for want of the
// settings' formats.
import { settings, ui } from "swarm";
import { parseDevices, phoneModels } from "./drivers";
import { joinedMachines, runAt, whereOf, type Where } from "./where";

export interface Found {
	kind: "android" | "ios";
	/** adb's serial, or the iPhone's UDID. */
	serial: string;
	/** What it is: "Pixel 10 Pro", "iPhone 17". */
	model: string;
	/** Where it's plugged in, as the host settings take it: a joined computer's name, "" for this one. */
	place: string;
	placeLabel: string;
	/** Why it can't be used as it is, where it can't: unauthorized, not paired, Developer Mode off. */
	problem?: string;
	/** The plugin uses it: its machine id. */
	id?: string;
}

/** The last look, kept for the page, the panel and status. */
export const found = ui.store({ busy: false, at: 0, phones: [] as Found[], problems: [] as string[] }, { shallow: true });

/** A setting's list: comma, semicolon or newline between. */
export function list(key: string): string[] {
	return String(settings.get(key) ?? "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The places phones may be plugged into: this computer, and the joined computers connected now. */
async function places(): Promise<{ place: string; where: Where; os?: string }[]> {
	const joined = (await joinedMachines()).filter((m) => m.connected);
	return [{ place: "", where: { label: "this computer" }, os: undefined }, ...joined.map((m) => ({ place: m.name, where: { machine: m.id, label: m.name } as Where, os: m.os }))];
}

/** Two host settings name the same place: by the joined computer they resolve to, or as written. */
async function samePlace(a: string, b: string) {
	const [x, y] = await Promise.all([whereOf(a), whereOf(b)]);
	return (x.machine ?? x.ssh ?? "") === (y.machine ?? y.ssh ?? "");
}

const ADB_PROBLEM: Record<string, string> = {
	unauthorized: "the phone hasn't allowed this computer: unlock it and allow USB debugging",
	offline: "adb has it offline: unplug it and plug it back in",
	"no permissions": "adb can't open it on this computer (udev rules)",
};

/** adb devices -l, with each device's state, which parseDevices leaves out. */
async function androidAt(p: { place: string; where: Where }): Promise<Found[]> {
	const r = await runAt(p.where, "adb", ["devices", "-l"], { timeout: 20_000 });
	if (r.code !== 0) return [];
	const ok = new Set(parseDevices(r.stdout).map((d) => d.serial));
	const out: Found[] = [];
	for (const line of r.stdout.split("\n").slice(1)) {
		const [serial, state = ""] = line.trim().split(/\s+/);
		if (!serial || serial.startsWith("*")) continue;
		const model = /model:(\S+)/.exec(line)?.[1]?.replace(/_/g, " ") ?? (serial.startsWith("emulator-") ? "Android emulator" : "Android phone");
		const problem = ok.has(serial) ? undefined : (ADB_PROBLEM[state] ?? Object.entries(ADB_PROBLEM).find(([k]) => line.includes(k))?.[1] ?? `adb says ${state}`);
		out.push({ kind: "android", serial, model, place: p.place, placeLabel: p.where.label, problem });
	}
	return out;
}

/** The iPhones and iPads devicectl knows on a Mac: real ones, not simulators. */
async function iosAt(p: { place: string; where: Where }): Promise<Found[]> {
	const r = await runAt(p.where, "sh", ["-c", 'f=$(mktemp); xcrun devicectl list devices --json-output "$f" >/dev/null 2>&1; cat "$f"; rm -f "$f"'], { timeout: 30_000 });
	let devices: any[] = [];
	try {
		devices = JSON.parse(r.stdout)?.result?.devices ?? [];
	} catch {
		return [];
	}
	const out: Found[] = [];
	for (const d of devices) {
		const hw = d.hardwareProperties ?? {};
		if (hw.reality !== "physical" || !hw.udid) continue;
		const cp = d.connectionProperties ?? {};
		const dp = d.deviceProperties ?? {};
		const problem = cp.pairingState !== "paired" ? "not paired with this Mac: unlock it and tap Trust" : dp.developerModeStatus && dp.developerModeStatus !== "enabled" ? "Developer Mode is off (Settings, Privacy & Security, Developer Mode)" : undefined;
		out.push({ kind: "ios", serial: hw.udid, model: hw.marketingName || dp.name || hw.deviceType || "iPhone", place: p.place, placeLabel: p.where.label, problem });
	}
	return out;
}

/** The iPhones setting's ids by UDID, for those the plugin runs WebDriverAgent for or is told the UDID of. */
function iphoneIds(): Map<string, string> {
	const out = new Map<string, string>();
	for (const part of String(settings.get("iphones") ?? "").split(/[,;\n\s]+/)) {
		const m = /^([^:]+):(?:https?:\/\/[^@\s]+@)?([0-9A-Fa-f-]{20,})$/.exec(part.trim());
		if (m) out.set(m[2]!.toUpperCase(), m[1]!);
	}
	return out;
}

/** The phones setting's ids by serial. */
function phoneNames(): Map<string, string> {
	const out = new Map<string, string>();
	for (const part of list("phones")) {
		const at = part.indexOf(":");
		if (at > 0) out.set(part.slice(at + 1).trim(), part.slice(0, at).trim());
	}
	return out;
}

/** Which found phones the plugin uses, and by what id. */
async function markUsed(phones: Found[]) {
	const skipped = new Set(list("skipPhones"));
	const names = phoneNames();
	const iphones = iphoneIds();
	const adbHere = new Map<string, boolean>();
	const iosHere = new Map<string, boolean>();
	for (const f of phones) {
		if (f.kind === "android") {
			if (!adbHere.has(f.place)) adbHere.set(f.place, settings.get("android") === true && (await samePlace(String(settings.get("adbHost") ?? ""), f.place)));
			if (adbHere.get(f.place) && !skipped.has(f.serial)) f.id = names.get(f.serial) ?? f.serial;
		} else {
			if (!iosHere.has(f.place)) iosHere.set(f.place, await samePlace(String(settings.get("iosHost") ?? ""), f.place));
			const id = iphones.get(f.serial.toUpperCase());
			if (id && iosHere.get(f.place)) f.id = id;
		}
	}
}

/** Looks for phones everywhere they may be plugged in. */
let looks = 0;
export async function discover(): Promise<Found[]> {
	const n = ++looks;
	found.busy = true;
	const phones: Found[] = [];
	const problems: string[] = [];
	try {
		await Promise.all(
			(await places()).map(async (p) => {
				const [a, i] = await Promise.all([
					androidAt(p).catch(() => [] as Found[]),
					// devicectl is a Mac's alone; this computer's OS isn't known here, so it's asked and its failing is no phone.
					p.os && p.os !== "darwin" ? Promise.resolve([] as Found[]) : iosAt(p).catch(() => [] as Found[]),
				]);
				phones.push(...a, ...i);
			}),
		);
		await markUsed(phones);
		for (const f of phones) phoneModels.set(f.serial.toUpperCase(), f.model);
	} catch (e) {
		problems.push(e instanceof Error ? e.message : String(e));
	}
	if (n === looks) {
		phones.sort((a, b) => a.placeLabel.localeCompare(b.placeLabel) || a.kind.localeCompare(b.kind) || a.model.localeCompare(b.model));
		found.phones = phones;
		found.problems = problems;
		found.at = Date.now();
		found.busy = false;
	}
	return phones;
}

/** An id for a phone that no machine has yet: its model's, as "pixel-10-pro". */
function freshId(f: Found, taken: Set<string>) {
	const base = slug(f.model) || (f.kind === "ios" ? "iphone" : "android");
	let id = base;
	for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
	return id;
}

/** The ids phones already go by, in any setting. */
function idsTaken(): Set<string> {
	return new Set([...phoneNames().values(), ...iphoneIds().values(), ...list("ssh").map((s) => s.split(":")[0]!)].map((s) => s.toLowerCase()));
}

/**
 * The plugin uses a phone it found: Android's adb runs where it's
 * plugged in, an iPhone's WebDriverAgent on its Mac. carry: the user
 * carries it, so agents only install their test builds there. Returns
 * its machine id.
 */
export async function use(f: Found, carry: boolean): Promise<string> {
	const set: Record<string, string | boolean> = {};
	let id: string;
	if (f.kind === "android") {
		const names = phoneNames();
		id = names.get(f.serial) ?? freshId(f, idsTaken());
		if (!names.has(f.serial)) set.phones = [...list("phones"), `${id}:${f.serial}`].join(", ");
		set.android = true;
		set.adbHost = f.place;
		set.skipPhones = list("skipPhones").filter((s) => s !== f.serial).join(", ");
	} else {
		const have = iphoneIds();
		id = have.get(f.serial.toUpperCase()) ?? freshId(f, idsTaken());
		if (!have.has(f.serial.toUpperCase())) set.iphones = [...list("iphones"), `${id}:${f.serial}`].join(", ");
		set.iosHost = f.place;
	}
	const carried = list("carried").filter((c) => c.toLowerCase() !== id.toLowerCase());
	set.carried = (carry ? [...carried, id] : carried).join(", ");
	settings.set(set);
	await discover();
	return id;
}

/** The plugin stops using a phone: an iPhone leaves the setting, an Android phone is skipped (adb lists them all). */
export async function stopUsing(f: Found) {
	if (f.kind === "android") settings.set({ skipPhones: [...new Set([...list("skipPhones"), f.serial])].join(", ") });
	else settings.set({ iphones: list("iphones").filter((p) => !p.toUpperCase().endsWith(":" + f.serial.toUpperCase()) && !p.toUpperCase().endsWith("@" + f.serial.toUpperCase())).join(", ") });
	await discover();
}

/** Where using f moves a driver from: the Android phones or iPhones the plugin uses somewhere else, which it'd stop using. */
export function movesFrom(f: Found): string | null {
	const others = found.phones.filter((o) => o.kind === f.kind && o.id && o.place !== f.place);
	return others.length ? others[0]!.placeLabel : null;
}

/** For status: the phones plugged in that the plugin doesn't use, from the last look. */
export function unusedLine(): string {
	const unused = found.phones.filter((f) => !f.id);
	if (!unused.length) return "";
	const each = unused.map((f) => `${f.model} (${f.kind === "ios" ? "iPhone" : "Android"}, on ${f.placeLabel}${f.problem ? `: ${f.problem}` : ""})`);
	return `Plugged in but not turned on: ${each.join(", ")}. Only the user turns a phone on (Settings, Plugins, Test machines): ask them, rather than testing on a simulator or emulator instead.`;
}
