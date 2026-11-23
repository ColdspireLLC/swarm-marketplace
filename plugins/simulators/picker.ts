// The user's own simulators, as the Simulator page shows them, decided away
// from the window so the rules are tested: what simctl and the Android SDK
// list, as one kind of device; the picker's shelves (booted first, then
// what was used lately, then the rest by runtime, newest first); the
// device the page opens on; and 120 Hz twins, after bb's Simulator: a
// copy of a ProMotion model's device type whose main display says 120 Hz,
// and a "… (120 Hz)" simulator of it.

/** A device of the user's on the page: an iOS (or iPadOS, tvOS…) simulator, or an Android AVD. */
export interface Device {
	/** iOS: the UDID. Android: "avd:" and the AVD's name. */
	id: string;
	platform: "ios" | "android";
	name: string;
	/** "Booted", "Booting", "Shutdown", "Shutting Down". */
	state: string;
	/** What it runs: "iOS 26.5", "watchOS 26.0", "Android 16". */
	os: string;
	/** iOS: the device type's identifier. */
	type?: string;
	runtime?: string;
	/** Android: its adb serial while it runs. */
	serial?: string;
	/** An agent's (the plugin's own pool, or bb's), not the user's: shown apart, watched. */
	agent?: boolean;
}

/** The OS a simctl runtime identifier names: com.apple.CoreSimulator.SimRuntime.iOS-26-5 → iOS 26.5. */
export function osOf(runtime: string): string {
	const m = /SimRuntime\.([A-Za-z]+)-(\d+(?:-\d+)*)$/.exec(runtime);
	if (!m) return runtime;
	return `${m[1]!.replace(/^xrOS$/, "visionOS")} ${m[2]!.split("-").join(".")}`;
}

/** Agents' simulators, by name: Swarm's pool, and bb's. */
export const isAgentName = (name: string) => /^(Swarm|bb) agent \d+ · /.test(name) || /^(swarm|bb)_agent(_android)?_\d+$/.test(name);

/** simctl list devices -j, as devices: the available ones. */
export function iosDevices(listJSON: string): Device[] {
	const j = JSON.parse(listJSON) as { devices?: Record<string, { udid: string; name: string; state: string; isAvailable?: boolean; deviceTypeIdentifier?: string }[]> };
	const out: Device[] = [];
	for (const [runtime, ds] of Object.entries(j.devices ?? {})) {
		for (const d of ds) {
			if (d.isAvailable === false) continue;
			out.push({ id: d.udid, platform: "ios", name: d.name, state: d.state, os: osOf(runtime), type: d.deviceTypeIdentifier, runtime, agent: isAgentName(d.name) || undefined });
		}
	}
	return out;
}

/** What booted and was picked last: device id → when. */
export type Used = Record<string, number>;

export interface Shelf {
	title: string;
	devices: Device[];
}

/** Lately: used in the last week, five at most. */
export const RECENT_MS = 7 * 24 * 3600_000;
export const RECENT_MAX = 5;

const PLATFORMS = ["iOS", "iPadOS", "watchOS", "tvOS", "visionOS", "Android"];

/** Newest hardware first: "iPhone 17 Pro" over "iPhone 16 Pro", by number. */
const byName = (a: Device, b: Device) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" });

export function matches(d: Device, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const hay = `${d.name} ${d.os}`.toLowerCase();
	return q.split(/\s+/).every((w) => hay.includes(w));
}

const running = (d: Device) => d.state === "Booted" || d.state === "Booting";

/**
 * The picker's shelves: running, used lately, then by OS, newest first
 * (iOS, then the other Apple platforms, Android last). Agents' simulators
 * aren't the user's: a shelf of their own, last.
 */
export function shelves(devices: Device[], used: Used, query: string, now: number): Shelf[] {
	const all = devices.filter((d) => matches(d, query));
	const mine = all.filter((d) => !d.agent);
	const booted = mine.filter(running).sort(byName);
	const recent = mine
		.filter((d) => !running(d) && used[d.id] && now - used[d.id]! < RECENT_MS)
		.sort((a, b) => used[b.id]! - used[a.id]!)
		.slice(0, RECENT_MAX);
	const shown = new Set([...booted, ...recent].map((d) => d.id));
	const byOS = new Map<string, Device[]>();
	for (const d of mine) {
		if (shown.has(d.id)) continue;
		byOS.set(d.os, [...(byOS.get(d.os) ?? []), d]);
	}
	const groups = [...byOS.entries()].sort(([a], [b]) => {
		const [pa = "", va = ""] = a.split(" ");
		const [pb = "", vb = ""] = b.split(" ");
		const ia = PLATFORMS.indexOf(pa);
		const ib = PLATFORMS.indexOf(pb);
		if (pa !== pb) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		return vb.localeCompare(va, undefined, { numeric: true });
	});
	const out: Shelf[] = [];
	if (booted.length) out.push({ title: "Running", devices: booted });
	if (recent.length) out.push({ title: "Recent", devices: recent });
	for (const [os, ds] of groups) out.push({ title: os, devices: ds.sort(byName) });
	const agents = all.filter((d) => d.agent).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	if (agents.length) out.push({ title: "Agents'", devices: agents });
	return out;
}

/**
 * The device the page shows: the one picked last while it's still there;
 * else the default setting's (a name or UDID); else one running; else the
 * newest iPhone on the newest iOS, a 120 Hz twin over its stock model.
 */
export function chooseDevice(devices: Device[], picked: string | undefined, preferred: string): Device | undefined {
	const mine = devices.filter((d) => !d.agent);
	if (picked) {
		const d = devices.find((x) => x.id === picked);
		if (d) return d;
	}
	const p = preferred.trim().toLowerCase();
	if (p) {
		const d = mine.find((x) => x.id.toLowerCase() === p) ?? mine.find((x) => x.name.toLowerCase() === p) ?? mine.find((x) => x.name.toLowerCase().startsWith(p));
		if (d) return d;
	}
	const on = mine.filter((d) => d.state === "Booted").sort(byName)[0];
	if (on) return on;
	const phones = mine.filter((d) => d.platform === "ios" && /^iOS /.test(d.os) && /^iPhone/.test(d.name));
	phones.sort((a, b) => b.os.localeCompare(a.os, undefined, { numeric: true }) || Number(isTwinName(b.name)) - Number(isTwinName(a.name)) || byName(a, b));
	return phones[0] ?? mine[0];
}

// ---- 120 Hz twins ----

export const TWIN_SUFFIX = " (120 Hz)";
/** A twin's device type's identifier: Swarm's, or bb's, whose types Swarm uses as they are (the same folder, the same names). */
export const TWIN_PREFIX = "com.coldspire.swarm.SimDeviceType.120Hz.";
const TWIN_PREFIXES = [TWIN_PREFIX, "dev.bb.simulator.SimDeviceType.120Hz."];

export const isTwinName = (name: string) => name.endsWith(TWIN_SUFFIX);
export const isTwinType = (type: string | undefined) => !!type && TWIN_PREFIXES.some((p) => type.startsWith(p));
export const twinTypeId = (stock: string) => TWIN_PREFIX + (stock.split(".").pop() ?? stock);

/**
 * Whether the hardware a device type stands for has a 120 Hz display, by
 * its identifier (the types don't say): iPhone 13 Pro and later Pros,
 * iPhone 17 and later, iPhone Air, iPad Pro but the first two.
 */
export function proMotion(type: string | undefined): boolean {
	if (!type || isTwinType(type)) return false;
	const t = type.split(".").pop() ?? "";
	const pro = /^iPhone-(\d+)-Pro(?:-Max)?$/.exec(t);
	if (pro) return Number(pro[1]) >= 13;
	const base = /^iPhone-(\d+)$/.exec(t);
	if (base) return Number(base[1]) >= 17;
	if (/^iPhone-Air/.test(t)) return true;
	if (/^iPad-Pro/.test(t)) return !/9-7-inch/.test(t) && !/12-9-inch.*1st-generation/.test(t);
	return false;
}

/** A 120 Hz twin of d, on its runtime, if one's there already. */
export function twinOf(d: Device, all: Device[]): Device | undefined {
	const tail = d.type?.split(".").pop();
	return all.find((x) => x.runtime === d.runtime && isTwinType(x.type) && x.type!.split(".").pop() === tail && !x.agent);
}

/** Whether d can have a 120 Hz twin made: a ProMotion model on an iOS runtime, with none yet. */
export const canTwin = (d: Device, all: Device[]) => !d.agent && d.platform === "ios" && !!d.runtime?.includes(".iOS-") && proMotion(d.type) && !twinOf(d, all);

/**
 * The shell script that writes a twin's device type into the user's
 * DeviceTypes folder where it isn't there yet (a copy of the stock
 * bundle, its identifier and name changed and its main display at 120
 * Hz, built aside and moved in whole), then makes a simulator of it on
 * the runtime; prints the new UDID. $1 stock bundle path, $2 twin type
 * id, $3 twin name, $4 runtime. One that's there already (bb's, or one
 * made before) is used as it is, its identifier read from it.
 */
export const TWIN_SCRIPT = `set -e
dir="$HOME/Library/Developer/CoreSimulator/Profiles/DeviceTypes"; to="$dir/$3.simdevicetype"
mkdir -p "$dir"
if [ ! -d "$to" ]; then
  tmp="$dir/.swarm-$$.partial"; rm -rf "$tmp"; trap 'rm -rf "$tmp"' EXIT
  cp -R "$1" "$tmp"
  plutil -replace CFBundleIdentifier -string "$2" "$tmp/Contents/Info.plist"
  plutil -replace CFBundleName -string "$3" "$tmp/Contents/Info.plist"
  caps="$tmp/Contents/Resources/capabilities.plist"
  i=0; main=""
  while t=$(plutil -extract "capabilities.displays.$i.displayType" raw -o - "$caps" 2>/dev/null); do
    [ "$t" = integrated ] && { main=$i; break; }; i=$((i+1))
  done
  [ -n "$main" ] || { echo "$3's device type describes no built-in display" >&2; exit 1; }
  plutil -replace "capabilities.displays.$main.refreshRate" -integer 120 "$caps"
  mv "$tmp" "$to"
fi
id=$(plutil -extract CFBundleIdentifier raw -o - "$to/Contents/Info.plist")
xcrun simctl create "$3" "$id" "$4"`;
