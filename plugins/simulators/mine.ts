// The user's own simulators, for the Simulator page: listed from simctl on
// the Mac and from the Android SDK where Android's run, booted as the user
// picks one, and made, erased, deleted, given a 120 Hz twin or switched
// between light and dark from the page. The agents' pool (pool.ts) is
// apart: its devices show on the page only to be watched.
import { settings, storage, ui } from "swarm";
export type { Device } from "./picker";
import { sdk as findSdk, type Sdk } from "./android";
import { mac, setting as iosSetting } from "./ios";
import { openURL as androidOpenURL, setting as androidSetting } from "./android";
import { pngSize, unbase64 } from "./devices";
import { chooseDevice, iosDevices, isAgentName, TWIN_SCRIPT, TWIN_SUFFIX, twinTypeId, type Device, type Used } from "./picker";
import { message, where } from "./state";
import type { Where } from "./where";

/** What the page shows: the devices as last listed, and where they are. */
export const page = ui.store({
	devices: [] as Device[],
	/** When they were last listed; 0 never. */
	at: 0,
	loading: false,
	/** Why iOS's couldn't be listed (no Mac, no Xcode, the Mac away). */
	problem: "",
	/** Where iOS's run, as said: "Anthony's Mac mini". */
	place: "",
	/** The machine ui.screen names for iOS's and Android's: "server" for Swarm's own computer; "" where Swarm can't show one live (over ssh). */
	machine: { ios: "", android: "" } as Record<Device["platform"], string>,
	/** What's under way on a device: id → "Booting", "Erasing"… */
	busy: {} as Record<string, string>,
	/** The last action's failure, said over the screen until the next. */
	error: "",
	query: "",
});

interface Saved {
	picked?: string;
	used: Used;
}
const SAVE = "page";
export const saved = (): Saved => storage.get<Saved>(SAVE) ?? { used: {} };
function save(patch: Partial<Saved>) {
	storage.set(SAVE, { ...saved(), ...patch });
}

/** The device the page shows now. */
export const current = (): Device | undefined => chooseDevice(page.devices, saved().picked, String(settings.get("defaultDevice") ?? ""));

const machineOf = (w: Where) => (w.ssh ? "" : (w.machine ?? "server"));

// ---- Listing ----

/** Lists them again where the last list is older than maxAge. */
export function refreshIfStale(maxAge = 30_000) {
	if (page.loading || Date.now() - page.at < maxAge) return;
	void refresh();
}

let listing: Promise<void> | null = null;

/** Lists every device again: iOS's on the Mac, Android's AVDs where Android's run. */
export function refresh(): Promise<void> {
	listing ??= (async () => {
		page.loading = true;
		try {
			const [ios, android] = await Promise.all([listIOS(), listAndroid()]);
			page.devices = [...ios, ...android];
		} finally {
			page.at = Date.now();
			page.loading = false;
			listing = null;
		}
	})();
	return listing;
}

async function listIOS(): Promise<Device[]> {
	const w = await where("ios");
	page.place = w.label;
	page.machine.ios = machineOf(w);
	if (!w.machine && !w.ssh && w.label === "no Mac") {
		page.problem = "No Mac is joined to Swarm: iOS simulators run on a Mac with Xcode.";
		return [];
	}
	if (w.offline) {
		page.problem = `${w.label} isn't connected to Swarm just now.`;
		return page.devices.filter((d) => d.platform === "ios");
	}
	try {
		const list = iosDevices(await mac(w, `xcrun simctl list devices available -j`));
		page.problem = "";
		return list;
	} catch (e) {
		page.problem = /xcrun|simctl|xcode-select/i.test(message(e)) ? `Xcode isn't set up on ${w.label}: install it, open it once, and choose its command line tools (xcode-select).` : message(e);
		return [];
	}
}

/** Android's SDK where they run, or null where there's none (Android is then left out, quietly). */
async function androidAt(): Promise<{ w: Where; s: Sdk } | null> {
	const w = await where("android");
	if (w.offline || (!w.machine && !w.ssh && w.label === "no Mac")) return null;
	try {
		return { w, s: await findSdk(w, String(settings.get("androidSdk") ?? ""), String(settings.get("androidImage") ?? "") || "-") };
	} catch {
		return null;
	}
}

/** Android's version of an API level: 36 → 16. */
const androidVersion = (api: number) => (api >= 30 ? String(api - 20) : api >= 29 ? "10" : api >= 28 ? "9" : String(api));

/**
 * The user's own AVDs (in ~/.android/avd, or $ANDROID_AVD_HOME as they set
 * it), not the agents', each with its API level and its serial while it
 * runs.
 */
async function listAndroid(): Promise<Device[]> {
	const a = await androidAt();
	if (!a) return [];
	page.machine.android = machineOf(a.w);
	const o = await mac(
		a.w,
		`adb="$1"; home="\${ANDROID_AVD_HOME:-$HOME/.android/avd}"
for f in "$home"/*.ini; do [ -f "$f" ] || continue; n=$(basename "$f" .ini)
  p=$(sed -n 's/^path=//p' "$f" | head -1); [ -n "$p" ] || p="$home/$n.avd"
  api=$(sed -n 's|^image.sysdir.1=system-images/android-\\([0-9]*\\).*|\\1|p' "$p/config.ini" 2>/dev/null | head -1)
  dn=$(sed -n 's/^avd.ini.displayname=//p' "$p/config.ini" 2>/dev/null | head -1)
  echo "avd	$n	\${api:-0}	$dn"
done
for x in $("$adb" devices 2>/dev/null | awk '/^emulator-[0-9]+/ && $2=="device" {print $1}'); do echo "run	$x	$("$adb" -s "$x" emu avd name 2>/dev/null | head -1 | tr -d '\\r')"; done; exit 0`,
		[a.s.adb],
	).catch(() => "");
	const runningSerial = new Map<string, string>();
	const avds: Device[] = [];
	for (const l of o.split("\n")) {
		const [k, x, y, z] = l.split("\t");
		if (k === "run" && x && y) runningSerial.set(y.trim(), x);
		if (k === "avd" && x && !isAgentName(x)) avds.push({ id: "avd:" + x, platform: "android", name: z?.trim() || x.replace(/_/g, " "), state: "Shutdown", os: Number(y) ? `Android ${androidVersion(Number(y))}` : "Android" });
	}
	for (const d of avds) {
		const serial = runningSerial.get(d.id.slice(4));
		if (serial) Object.assign(d, { state: "Booted", serial });
	}
	return avds;
}

// ---- Acting ----

/** Runs what the user asked of a device, said as busy meanwhile; a failure said over the screen, and returned (null: done). */
async function doing(d: Device, what: string, fn: () => Promise<unknown>): Promise<string | null> {
	if (page.busy[d.id]) return `${d.name} is ${page.busy[d.id]!.toLowerCase()} already.`;
	page.busy = { ...page.busy, [d.id]: what };
	page.error = "";
	try {
		await fn();
		return null;
	} catch (e) {
		page.error = `${d.name}: ${message(e)}`;
		return message(e);
	} finally {
		const { [d.id]: _, ...rest } = page.busy;
		page.busy = rest;
		await refresh();
	}
}

const iosAt = () => where("ios");

/** Shows d on the page, booting it if it's shut down. */
export function pick(d: Device): Promise<string | null> {
	save({ picked: d.id, used: { ...saved().used, [d.id]: Date.now() } });
	page.error = "";
	return d.state === "Shutdown" && !d.agent ? boot(d) : Promise.resolve(null);
}

/** One of the devices, by its UDID, AVD name, or name (a whole one, else the start of one), the user's before agents'. */
export function find(q: string): Device | undefined {
	const l = q.trim().toLowerCase();
	const ds = [...page.devices].sort((a, b) => Number(!!a.agent) - Number(!!b.agent));
	return ds.find((d) => d.id.toLowerCase() === l || d.id.toLowerCase() === "avd:" + l) ?? ds.find((d) => d.name.toLowerCase() === l) ?? ds.find((d) => d.name.toLowerCase().startsWith(l));
}

export function boot(d: Device) {
	save({ used: { ...saved().used, [d.id]: Date.now() } });
	return doing(d, "Booting", async () => {
		if (d.platform === "ios") {
			const w = await iosAt();
			// A first boot takes a minute or more; it's said as booting meanwhile, the list showing it so.
			setTimeout(() => void refresh(), 1500);
			await mac(w, `xcrun simctl boot "$1" 2>&1 | grep -v 'current state: Booted' >&2; xcrun simctl bootstatus "$1" -b >/dev/null`, [d.id], { timeout: 300_000 });
			return;
		}
		const a = await androidAt();
		if (!a) throw new Error("no Android SDK with an emulator where Android's emulators run");
		await bootAvd(a.w, a.s, d.id.slice(4));
	});
}

/**
 * Boots one of the user's AVDs headless, on the host's GPU, and waits
 * until Android's up. Cold, as the agents' are: one restored from a
 * snapshot on a Mac's GPU draws nothing headless.
 */
async function bootAvd(w: Where, s: Sdk, name: string) {
	const gpu = s.os === "darwin" ? "host" : s.headless ? "swiftshader_indirect" : "auto";
	await mac(
		w,
		`adb="$1"; root="$2"; name="$3"; gpu="$4"
used=$("$adb" devices | awk '/^emulator-/ {sub("emulator-","",$1); print $1}')
port=5554; while echo "$used" | grep -qx "$port" || nc -z 127.0.0.1 $port 2>/dev/null; do port=$((port+2)); done
log="\${TMPDIR:-/tmp}/swarm-avd-$name.log"
ANDROID_HOME="$root" ANDROID_SDK_ROOT="$root" nohup "$root/emulator/emulator" -avd "$name" -port $port -no-window -no-snapshot-load -no-boot-anim -gpu "$gpu" < /dev/null > "$log" 2>&1 &
pid=$!; serial=emulator-$port
for i in $(seq 270); do
  kill -0 $pid 2>/dev/null || { tail -15 "$log" >&2; exit 1; }
  [ "$("$adb" -s $serial shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r')" = 1 ] && exit 0
  sleep 2
done
echo "it didn't boot in 9 minutes: $log there says why" >&2; exit 1`,
		[s.adb, s.root, name, gpu],
		{ timeout: 580_000 },
	);
}

export function shutdown(d: Device) {
	return doing(d, "Shutting down", async () => {
		if (d.platform === "ios") {
			await mac(await iosAt(), `xcrun simctl shutdown "$1" 2>&1 | grep -v 'current state: Shutdown' >&2; exit 0`, [d.id]);
			return;
		}
		const a = await androidAt();
		if (a && d.serial) await mac(a.w, `"$1" -s "$2" emu kill >/dev/null 2>&1; for i in $(seq 30); do "$1" devices | grep -q "^$2\\b" || exit 0; sleep 1; done`, [a.s.adb, d.serial], { timeout: 60_000 });
	});
}

/** The AVD's folder there, from its .ini. */
const AVD_DIR = `home="\${ANDROID_AVD_HOME:-$HOME/.android/avd}"; dir=$(sed -n 's/^path=//p' "$home/$1.ini" | head -1); [ -n "$dir" ] || dir="$home/$1.avd"`;

/** Erases it: shut down, its apps, data and settings gone, as new. */
export function erase(d: Device) {
	return doing(d, "Erasing", async () => {
		if (d.platform === "ios") {
			const w = await iosAt();
			await mac(w, `xcrun simctl shutdown "$1" >/dev/null 2>&1; xcrun simctl erase "$1"`, [d.id], { timeout: 120_000 });
			return;
		}
		const a = await androidAt();
		if (!a) throw new Error("no Android SDK there");
		if (d.serial) await mac(a.w, `"$1" -s "$2" emu kill >/dev/null 2>&1; sleep 3; exit 0`, [a.s.adb, d.serial]);
		await mac(a.w, `${AVD_DIR}; rm -rf "$dir"/userdata-qemu.img* "$dir"/cache.img* "$dir"/snapshots "$dir"/*.lock`, [d.id.slice(4)]);
	});
}

/** Deletes it from the Mac for good (erasing only clears it). */
export function remove(d: Device) {
	return doing(d, "Deleting", async () => {
		if (d.platform === "ios") {
			const w = await iosAt();
			await mac(w, `xcrun simctl shutdown "$1" >/dev/null 2>&1; xcrun simctl delete "$1"`, [d.id], { timeout: 120_000 });
		} else {
			const a = await androidAt();
			if (!a) throw new Error("no Android SDK there");
			if (d.serial) await mac(a.w, `"$1" -s "$2" emu kill >/dev/null 2>&1; sleep 3; exit 0`, [a.s.adb, d.serial]);
			await mac(a.w, `${AVD_DIR}; rm -rf "$dir" "$home/$1.ini"`, [d.id.slice(4)]);
		}
		if (saved().picked === d.id) save({ picked: undefined });
	});
}

/** Light or dark, as it is now: iOS's appearance, Android's night mode; null where it can't say (shut down). */
export const looks = ui.store(new Map<string, "light" | "dark">(), { shallow: true });

export async function readLook(d: Device) {
	try {
		const o =
			d.platform === "ios"
				? await mac(await iosAt(), `xcrun simctl ui "$1" appearance`, [d.id])
				: await (async () => {
						const a = await androidAt();
						return a && d.serial ? mac(a.w, `"$1" -s "$2" shell cmd uimode night`, [a.s.adb, d.serial]) : "";
					})();
		const v = /dark|yes/i.test(o) ? "dark" : /light|no/i.test(o) ? "light" : null;
		if (v && looks.get(d.id) !== v) looks.set(d.id, v);
	} catch {}
}

/** Switches it between light and dark. */
export function toggleLook(d: Device) {
	const next = looks.get(d.id) === "dark" ? "light" : "dark";
	looks.set(d.id, next);
	return doing(d, next === "dark" ? "Going dark" : "Going light", async () => {
		if (d.platform === "ios") await mac(await iosAt(), `xcrun simctl ui "$1" appearance "$2"`, [d.id, next]);
		else {
			const a = await androidAt();
			if (a && d.serial) await mac(a.w, `"$1" -s "$2" shell cmd uimode night "$3"`, [a.s.adb, d.serial, next === "dark" ? "yes" : "no"]);
		}
	});
}

/** A device setting, as the agents' tools change theirs: text-size, location, status-bar… */
export function deviceSetting(d: Device, what: string, value: string, busy = "Changing it") {
	return doing(d, busy, async () => {
		if (d.platform === "ios") await iosSetting(await iosAt(), d.id, what, value);
		else {
			const a = await androidAt();
			if (!a || !d.serial) throw new Error("it isn't running");
			await androidSetting(a.w, a.s, d.serial, what, value);
		}
		if (what === "status-bar") cleanBars.set(d.id, value !== "clear");
	});
}

/** Devices whose status bar shows 9:41 and full bars, as set from the page. */
export const cleanBars = ui.store(new Map<string, boolean>(), { shallow: true });

/** Opens a URL or deep link on it, as tapping a link would. */
export function openURL(d: Device, url: string) {
	return doing(d, "Opening it", async () => {
		if (d.platform === "ios") await mac(await iosAt(), `xcrun simctl openurl "$1" "$2"`, [d.id, url]);
		else {
			const a = await androidAt();
			if (!a || !d.serial) throw new Error("it isn't running");
			await androidOpenURL(a.w, a.s, d.serial, url);
		}
	});
}

// ---- Unused ----

/** When each device was last on screen live (the page, a thread's panel). */
const watched = new Map<string, number>();
export const markWatched = (id: string) => void watched.set(id, Date.now());

/** How long a device the user watched may go unwatched before Shut down when unused shuts it down. */
export const UNUSED_MS = 30 * 60_000;

/**
 * Each minute, with Shut down when unused on: the user's own simulators
 * the page showed, unwatched for UNUSED_MS, shut down (not one lent, nor
 * one recording). Only those the page showed: one used in Simulator.app
 * alone is the user's business.
 */
export async function sweepUnused(busy: (d: Device) => boolean, now = Date.now()) {
	if (settings.get("shutdownUnused") !== true) return;
	for (const d of page.devices) {
		const at = watched.get(d.id);
		if (d.agent || d.state !== "Booted" || at === undefined || now - at < UNUSED_MS || busy(d)) continue;
		watched.delete(d.id);
		await shutdown(d);
	}
}

// ---- Its shape ----

/** Each device's screen in pixels, as it stands: for the page to give its live view the same shape. Kept: it doesn't change. */
export const dims = ui.store(new Map<string, { w: number; h: number }>(Object.entries(storage.get<Record<string, { w: number; h: number }>>("dims") ?? {})), { shallow: true });
const measuring = new Set<string>();

/** Learns a running device's screen size: an iOS screenshot's header, Android's wm size. */
export async function measureScreen(d: Device) {
	if (dims.has(d.id) || measuring.has(d.id)) return;
	measuring.add(d.id);
	try {
		let w = 0;
		let h = 0;
		if (d.platform === "ios") {
			const head = unbase64(await mac(await iosAt(), `f=$(mktemp "\${TMPDIR:-/tmp}/swarm-sim.XXXXXX"); xcrun simctl io "$1" screenshot --type=png "$f" >/dev/null 2>&1 || exit 3; head -c 32 "$f" | base64; rm -f "$f"`, [d.id], { timeout: 30_000 }));
			({ width: w, height: h } = pngSize(head));
		} else {
			const a = await androidAt();
			const o = a && d.serial ? await mac(a.w, `"$1" -s "$2" shell wm size`, [a.s.adb, d.serial]) : "";
			const m = /(\d+)x(\d+)\s*$/.exec(o.trim());
			if (m) [w, h] = [Number(m[1]), Number(m[2])];
		}
		if (w > 0 && h > 0) {
			dims.set(d.id, { w, h });
			storage.set("dims", Object.fromEntries([...dims].slice(-100)));
		}
	} catch {
	} finally {
		measuring.delete(d.id);
	}
}

// ---- Making them ----

export interface Catalog {
	runtimes: { id: string; name: string; types: { id: string; name: string; family: string }[] }[];
}
export const catalog = ui.store({ at: 0, value: null as Catalog | null, problem: "" });

/** The models each installed runtime can run, for New simulator. */
export async function loadCatalog() {
	if (catalog.at && Date.now() - catalog.at < 60_000) return;
	catalog.at = Date.now();
	try {
		const j = JSON.parse(await mac(await iosAt(), `xcrun simctl list runtimes available -j`));
		const runtimes = (j.runtimes ?? [])
			.filter((r: any) => r.isAvailable !== false)
			.map((r: any) => ({ id: r.identifier, name: r.name, types: (r.supportedDeviceTypes ?? []).filter((t: any) => !/120Hz/.test(t.identifier)).map((t: any) => ({ id: t.identifier, name: t.name, family: t.productFamily ?? "" })) }))
			.sort((a: any, b: any) => (a.name.split(" ")[0] === "iOS" ? -1 : 0) - (b.name.split(" ")[0] === "iOS" ? -1 : 0) || b.name.localeCompare(a.name, undefined, { numeric: true }));
		catalog.value = { runtimes };
		catalog.problem = "";
	} catch (e) {
		catalog.problem = message(e);
	}
}

/** Makes a simulator of a model on a runtime (simctl create), picks it and boots it. */
export async function create(name: string, type: string, runtime: string): Promise<string | null> {
	page.error = "";
	try {
		const udid = (await mac(await iosAt(), `xcrun simctl create "$1" "$2" "$3"`, [name, type, runtime], { timeout: 120_000 })).trim();
		await refresh();
		const d = page.devices.find((x) => x.id === udid);
		if (d) void pick(d);
		return null;
	} catch (e) {
		return message(e);
	}
}

/**
 * Makes d's 120 Hz twin: its device type copied with the main display at
 * 120 Hz (once a model; bb's, if it made one, used as it is), and a
 * simulator of it on d's runtime, which the page then shows. Apple's own
 * types and d are left as they are, so what names them (Xcode schemes,
 * expo run:ios) still finds them.
 */
export async function makeTwin(d: Device): Promise<string | null> {
	let udid = "";
	const err = await doing(d, "Making a 120 Hz copy", async () => {
		if (!d.type || !d.runtime) throw new Error("its model isn't known");
		const w = await iosAt();
		const j = JSON.parse(await mac(w, `xcrun simctl list devicetypes -j`));
		const stock = (j.devicetypes ?? []).find((t: any) => t.identifier === d.type);
		if (!stock?.bundlePath) throw new Error("its device type isn't installed");
		udid = (await mac(w, TWIN_SCRIPT, [stock.bundlePath, twinTypeId(d.type), stock.name + TWIN_SUFFIX, d.runtime], { timeout: 120_000 })).trim().split("\n").pop()!;
		save({ picked: udid, used: { ...saved().used, [udid]: Date.now() } });
	});
	if (err) return err;
	const twin = page.devices.find((x) => x.id === udid);
	return twin ? boot(twin) : null;
}
