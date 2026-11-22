// The doctor: every prerequisite of the simulators, checked where they
// run, each with how it stands and what fixes it. The page's More opens
// it; swarm simulators doctor prints it.
import { call, settings, ui } from "swarm";
import { sdk as findSdk } from "./android";
import { mac } from "./ios";
import { message, where } from "./state";
import type { Where } from "./where";

export interface Check {
	what: string;
	ok: boolean | "warn";
	said: string;
	fix?: string;
}

export const doctor = ui.store({ at: 0, busy: false, checks: [] as Check[] });

const IOS_SCRIPT = `p=$(xcode-select -p 2>/dev/null); echo "select $p"
v=$(xcodebuild -version 2>/dev/null | head -1); echo "xcode $v"
xcrun simctl help >/dev/null 2>&1 && echo "simctl ok"
xcrun simctl list runtimes available 2>/dev/null | grep -c '^iOS' | sed 's/^/runtimes /'
df -Pk "$HOME" | awk 'NR==2 {print "free " int($4/1024)}'
sw_vers -productVersion 2>/dev/null | sed 's/^/macos /'
uname -m | sed 's/^/arch /'
[ -d "$HOME/Library/Caches/swarm-simulators/wda" ] && echo "wda built"; exit 0`;

async function iosChecks(w: Where): Promise<Check[]> {
	const out: Check[] = [];
	if (!w.machine && !w.ssh && w.label === "no Mac") return [{ what: "A Mac", ok: false, said: "No Mac is joined to Swarm.", fix: "iOS simulators run on a Mac with Xcode: join one (Settings, Machines, Add), or set the Simulators plugin's Mac." }];
	if (w.offline) return [{ what: "The Mac", ok: false, said: `${w.label} isn't connected to Swarm.`, fix: `Start Swarm on ${w.label}, or wake it.` }];
	out.push({ what: "The Mac", ok: true, said: `${w.label}${w.ssh ? ", over ssh" : ""}` });
	let o = "";
	try {
		o = await mac(w, IOS_SCRIPT, [], { timeout: 60_000 });
	} catch (e) {
		return [...out, { what: "Running there", ok: false, said: message(e), fix: w.ssh ? "Check that the ssh target takes this computer's key (ssh BatchMode)." : "Check Settings, Machines." }];
	}
	const v = (k: string) => o.split("\n").find((l) => l.startsWith(k + " "))?.slice(k.length + 1).trim() ?? "";
	const arch = v("arch");
	out.push({ what: "macOS", ok: arch === "arm64" ? true : "warn", said: `${v("macos") || "?"} on ${arch === "arm64" ? "Apple silicon" : arch || "?"}`, fix: arch === "arm64" ? undefined : "Simulators run best on Apple silicon; on Intel the live view may be slow." });
	const sel = v("select");
	const xcode = v("xcode");
	out.push(!sel || !xcode || /CommandLineTools/.test(sel) ? { what: "Xcode", ok: false, said: sel ? `xcode-select points at ${sel}` : "Not installed", fix: "Install Xcode from the App Store, open it once, then: sudo xcode-select -s /Applications/Xcode.app" } : { what: "Xcode", ok: true, said: `${xcode} (${sel})` });
	out.push(o.includes("simctl ok") ? { what: "simctl", ok: true, said: "Works" } : { what: "simctl", ok: false, said: "xcrun simctl doesn't run", fix: "Open Xcode once to finish installing it, and accept its licence: sudo xcodebuild -license accept" });
	const rts = Number(v("runtimes")) || 0;
	out.push(rts ? { what: "iOS runtimes", ok: true, said: `${rts} installed` } : { what: "iOS runtimes", ok: false, said: "None", fix: "Xcode, Settings, Components: install an iOS simulator runtime." });
	const free = Number(v("free")) || 0;
	out.push({ what: "Disk", ok: free > 20_000 ? true : free > 8_000 ? "warn" : false, said: `${(free / 1024).toFixed(1)} GB free`, fix: free > 20_000 ? undefined : "Each simulator takes a few GB, and a boot fails on a full disk: free some space (xcrun simctl delete unavailable clears old ones)." });
	out.push(o.includes("wda built") ? { what: "WebDriverAgent", ok: true, said: "Built, for agents' taps and reading the screen" } : { what: "WebDriverAgent", ok: "warn", said: "Not built yet", fix: "Built the first time an agent drives a simulator (a few minutes, once)." });
	return out;
}

async function androidChecks(): Promise<Check[]> {
	const w = await where("android");
	if (w.offline) return [{ what: "Android", ok: "warn", said: `${w.label} isn't connected to Swarm.` }];
	try {
		const s = await findSdk(w, String(settings.get("androidSdk") ?? ""), String(settings.get("androidImage") ?? "") || "-");
		const o = await mac(w, `"$1/emulator/emulator" -version 2>/dev/null | head -1; "$2" version 2>/dev/null | head -1; ls -d "$1"/system-images/*/*/* 2>/dev/null | wc -l | tr -d ' '`, [s.root, s.adb]).catch(() => "");
		const [emu = "", adb = "", images = "0"] = o.split("\n");
		return [
			{ what: "Android SDK", ok: true, said: `${s.root} on ${w.label}` },
			{ what: "Emulator", ok: !!emu, said: emu.replace(/^Android emulator version /i, "") || "Doesn't run", fix: emu ? undefined : "sdkmanager emulator" },
			{ what: "adb", ok: !!adb, said: adb || "Not found", fix: adb ? undefined : "sdkmanager platform-tools" },
			{ what: "System images", ok: Number(images) > 0, said: `${images} installed`, fix: Number(images) > 0 ? undefined : `sdkmanager "system-images;android-36;google_apis;arm64-v8a"` },
		];
	} catch (e) {
		return [{ what: "Android SDK", ok: "warn", said: /no Android SDK/.test(message(e)) ? `Not found on ${w.label}` : message(e), fix: "Only needed for Android emulators: install Android Studio there, or set the Android SDK setting." }];
	}
}

/** Whether Swarm's window can show a machine's simulators live: it reports a screen. */
async function liveCheck(w: Where): Promise<Check> {
	if (w.ssh) return { what: "Live view", ok: "warn", said: "Over ssh, Swarm can't show the screen live.", fix: "Join the Mac to Swarm instead (Settings, Machines)." };
	try {
		const ms = (await call("Machines", {})) as { id: string; server?: boolean; screen?: boolean }[];
		const m = ms.find((x) => (w.machine ? x.id === w.machine : x.server));
		return m?.screen ? { what: "Live view", ok: true, said: "Swarm shows its simulators live" } : { what: "Live view", ok: false, said: "That machine doesn't show its screen to Swarm.", fix: "Update Swarm there, and give it Screen Recording and Accessibility (System Settings, Privacy)." };
	} catch {
		return { what: "Live view", ok: "warn", said: "Couldn't ask." };
	}
}

/** Checks everything again. */
export async function examine(): Promise<Check[]> {
	if (doctor.busy) return doctor.checks;
	doctor.busy = true;
	try {
		const w = await where("ios");
		const [ios, android, live] = await Promise.all([iosChecks(w), androidChecks(), liveCheck(w)]);
		doctor.checks = [...ios, live, ...android];
		return doctor.checks;
	} finally {
		doctor.at = Date.now();
		doctor.busy = false;
	}
}

export function said(checks: Check[]): string {
	return checks.map((c) => `${c.ok === true ? "✓" : c.ok === "warn" ? "!" : "✗"} ${c.what}: ${c.said}${c.fix && c.ok !== true ? `\n    ${c.fix}` : ""}`).join("\n");
}
