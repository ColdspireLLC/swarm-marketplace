// Android emulators: an AVD of the plugin's for each agent slot, in an
// AVD folder of its own (the user's AVDs are never touched), written as
// its two small files rather than with avdmanager (a Mac with Xcode has no
// Java), booted headless and driven through adb. Swarm's window shows a
// running one live, as it does any phone adb lists (scrcpy). All of it
// runs where the Android SDK is (where.ts), through Swarm.
import { MAX_ELEMENTS, parseUiAutomator, type Element } from "./elements";
import { avdFiles, pickImage, SimError, stepsScript, unbase64 } from "./devices";
import { mac } from "./ios";
import { SLIM_FLAGS, slimScript, slimmedPackages, STATE, unslimScript } from "./slimandroid";
import type { Where } from "./where";

/** The plugin's AVDs' folder, on the host. */
export const AVD_HOME = "$HOME/.swarm-simulators/avd";

/** An agent emulator's AVD name. */
export const avdName = (n: number) => `swarm_agent_${n}`;

export interface Sdk {
	root: string;
	adb: string;
	/** The newest system image installed: system-images;android-36;google_apis;arm64-v8a. */
	image: string;
	os: "darwin" | "linux";
	headless: boolean;
}

const sdkCache = new Map<string, Sdk>();

/**
 * The Android SDK on the host: the setting's, else $ANDROID_HOME, Android
 * Studio's, Homebrew's, or bb's Simulator plugin's, the first with an
 * emulator; its adb (the one on PATH where there is one, which Swarm's
 * window uses too, so that one adb server has them all), and the newest
 * Google APIs image of the host's architecture.
 */
export async function sdk(w: Where, setting: string, image: string): Promise<Sdk> {
	const key = `${w.machine ?? w.ssh ?? ""}|${setting}|${image}`;
	const have = sdkCache.get(key);
	if (have) return have;
	const o = await mac(
		w,
		`for r in "$1" "$ANDROID_HOME" "$ANDROID_SDK_ROOT" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" /opt/homebrew/share/android-commandlinetools $HOME/.bb-machines/*/plugins/xcode/host-data/android-sdk; do
  [ -n "$r" ] && [ -x "$r/emulator/emulator" ] && { root="$r"; break; }
done
[ -n "$root" ] || { echo "no Android SDK with an emulator here: install Android Studio, or set the Android SDK setting" >&2; exit 3; }
echo "root $root"
a=$(command -v adb); [ -n "$a" ] || a="$root/platform-tools/adb"; echo "adb $a"
echo "os $(uname -s)"; echo "arch $(uname -m)"
[ -n "$DISPLAY$WAYLAND_DISPLAY" ] || echo "headless"
ls -d "$root"/system-images/*/*/* 2>/dev/null | sed "s|^$root/||" | sed 's/^/image /'`,
		[setting],
	);
	const lines = o.split("\n").map((l) => l.trim());
	const val = (k: string) => lines.find((l) => l.startsWith(k + " "))?.slice(k.length + 1) ?? "";
	const os = val("os") === "Darwin" ? "darwin" : "linux";
	const arch = /arm|aarch/.test(val("arch")) ? "arm64-v8a" : "x86_64";
	const images = lines.filter((l) => l.startsWith("image ")).map((l) => l.slice(6).replace(/\/$/, "").split("/").join(";"));
	const chosen = image.trim() || pickImage(images, arch);
	if (!chosen) throw new SimError(`The Android SDK at ${val("root")} on ${w.label} has no system image for ${arch}: sdkmanager "system-images;android-36;google_apis;${arch}".`);
	const s: Sdk = { root: val("root"), adb: val("adb"), image: chosen, os, headless: lines.includes("headless") };
	sdkCache.set(key, s);
	return s;
}

const env = (s: Sdk) => `export ANDROID_HOME="${s.root}" ANDROID_SDK_ROOT="${s.root}" ANDROID_AVD_HOME="${AVD_HOME}"; adb="${s.adb}"`;

/**
 * Slot n's AVD, written where there's none, or where it's slim and
 * shouldn't be or the other way (its config written again, its data
 * kept). Says whether it was made.
 */
export async function ensureAvd(w: Where, s: Sdk, n: number, slim: boolean): Promise<boolean> {
	const name = avdName(n);
	const home = (await mac(w, `echo ${AVD_HOME}`)).trim();
	const f = avdFiles(home, name, n, s.image, s, slim);
	// What the plugin last wrote is kept beside the AVD (swarm-config.ini) and compared, not
	// config.ini: the emulator writes that again its own way. Changed, the config is written anew.
	const o = await mac(
		w,
		`mkdir -p "$1/$2.avd"; [ -f "$1/$2.avd/config.ini" ] || made=1
if [ "$(cat "$1/$2.avd/swarm-config.ini" 2>/dev/null)" != "$(printf '%s' "$3")" ]; then
  printf '%s' "$3" > "$1/$2.avd/config.ini"; printf '%s' "$3" > "$1/$2.avd/swarm-config.ini"
  rm -rf "$1/$2.avd/hardware-qemu.ini" "$1/$2.avd/hardware-qemu.ini.lock" "$1/$2.avd/snapshots"
fi
printf '%s' "$4" > "$1/$2.ini"; echo "\${made:-0}"`,
		[home, name, f.config.trimEnd(), f.pointer.trimEnd()],
	);
	return o.trim() === "1";
}

/** The running emulators: AVD name → adb serial. */
export async function running(w: Where, s: Sdk): Promise<Map<string, string>> {
	const o = await mac(w, `${env(s)}; for x in $("$adb" devices | awk '/^emulator-[0-9]+/ && $2=="device" {print $1}'); do echo "$x $("$adb" -s "$x" emu avd name 2>/dev/null | head -1 | tr -d '\\r')"; done`);
	const m = new Map<string, string>();
	for (const l of o.split("\n")) {
		const [serial, name] = l.trim().split(/\s+/);
		if (serial && name) m.set(name, serial);
	}
	return m;
}

/**
 * The emulator's GPU: headless it renders in software unless told, which
 * leaves Android 16 offline for minutes on a Mac; the Mac's GPU, Linux's
 * where it has a display, else SwiftShader.
 */
const gpu = (s: Sdk) => ["-gpu", s.os === "darwin" ? "host" : s.headless ? "swiftshader_indirect" : "auto"];

/**
 * Boots slot n's emulator, headless and cold, and waits until Android's
 * up (a minute or two, more on a busy Mac); its serial. Not from a
 * snapshot: one restored on a Mac's GPU draws nothing (seen on Android
 * 16, emulator 37.2).
 */
export async function boot(w: Where, s: Sdk, n: number, slim: boolean): Promise<string> {
	const have = (await running(w, s)).get(avdName(n));
	if (have) return have;
	const flags = ["-no-window", "-no-snapshot-save", "-no-snapshot-load", ...(slim ? SLIM_FLAGS : ["-no-audio", "-no-boot-anim"]), ...gpu(s)];
	const o = await mac(
		w,
		`${env(s)}; name="$1"; shift
used=$("$adb" devices | awk '/^emulator-/ {sub("emulator-","",$1); print $1}')
port=5554; while echo "$used" | grep -qx "$port" || nc -z 127.0.0.1 $port 2>/dev/null; do port=$((port+2)); done
mkdir -p "$ANDROID_AVD_HOME"; log="$ANDROID_AVD_HOME/$name.log"
nohup "$ANDROID_HOME/emulator/emulator" -avd "$name" -port $port "$@" < /dev/null > "$log" 2>&1 &
pid=$!; serial=emulator-$port
for i in $(seq 270); do
  kill -0 $pid 2>/dev/null || { tail -15 "$log" >&2; exit 1; }
  [ "$("$adb" -s $serial shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r')" = 1 ] && { echo $serial; exit 0; }
  sleep 2
done
echo "the emulator didn't boot in 9 minutes: $log on the host" >&2; exit 1`,
		[avdName(n), ...flags],
		{ timeout: 580_000 },
	);
	return o.trim().split("\n").pop()!;
}

/**
 * Wakes an emulator's screen, kept on from then, at its home screen,
 * without a dialog over it (Android's error dialogs are hidden: on a busy
 * Mac System UI is slow enough to be called not responding), and waits
 * until System UI is up (its status bar): Android says it's booted well
 * before, minutes before on a busy Mac.
 */
export async function wake(w: Where, s: Sdk, serial: string) {
	await shell(
		w,
		s,
		serial,
		`svc power stayon true; settings put system screen_off_timeout 1800000; settings put global hide_error_dialogs 1
for i in $(seq 120); do
  input keyevent KEYCODE_WAKEUP; am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1; input keyevent KEYCODE_HOME
  dumpsys window windows | grep -q ' StatusBar}' && exit 0
  sleep 2
done
echo "the emulator's System UI didn't come up in 4 minutes" >&2; exit 1`,
		300_000,
	);
}

/** Waits until a running emulator has finished booting (one started a moment ago). */
export async function waitBooted(w: Where, s: Sdk, serial: string) {
	await mac(w, `${env(s)}; for i in $(seq 270); do [ "$("$adb" -s "$1" shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r')" = 1 ] && exit 0; sleep 2; done; echo "the emulator didn't finish booting in 9 minutes" >&2; exit 1`, [serial], { timeout: 580_000 });
}

export async function shutdown(w: Where, s: Sdk, n: number) {
	const serial = (await running(w, s)).get(avdName(n));
	if (serial) await mac(w, `${env(s)}; "$adb" -s "$1" emu kill >/dev/null 2>&1; for i in $(seq 30); do "$adb" devices | grep -q "^$1\\s" || exit 0; sleep 1; done`, [serial], { timeout: 45_000 }).catch(() => {});
	// One adb doesn't list as up (stuck booting, offline): its process, by its AVD.
	await mac(w, `pkill -f "[q]emu-system.*-avd $1( |$)"; for i in $(seq 15); do pgrep -f "[q]emu-system.*-avd $1( |$)" >/dev/null || exit 0; sleep 1; done; pkill -9 -f "[q]emu-system.*-avd $1( |$)"; exit 0`, [avdName(n)], { timeout: 30_000 });
}

/** Erases slot n's emulator: shut down, its data gone (it boots as new). */
export async function erase(w: Where, s: Sdk, n: number) {
	await shutdown(w, s, n);
	await mac(w, `cd "${AVD_HOME}/$1.avd" && rm -rf userdata-qemu.img* cache.img* snapshots encryptionkey.img* sdcard.img*`, [avdName(n)]);
}

export async function remove(w: Where, s: Sdk, n: number) {
	await shutdown(w, s, n);
	await mac(w, `rm -rf "${AVD_HOME}/$1.avd" "${AVD_HOME}/$1.ini" "${AVD_HOME}/$1.log"`, [avdName(n)]);
}

/** adb on the host, for one emulator. */
export const adb = (w: Where, s: Sdk, serial: string, args: string[], o: { timeout?: number; input?: string } = {}) => mac(w, `${env(s)}; s="$1"; shift; "$adb" -s "$s" "$@"`, [serial, ...args], o);
const shell = (w: Where, s: Sdk, serial: string, script: string, timeout = 60_000) => adb(w, s, serial, ["shell", "sh"], { input: script, timeout });

/** Slims the guest (avdslim's packages and settings); what it disabled. */
export async function slimGuest(w: Where, s: Sdk, serial: string, packages: string[], settings: [string, string, string][]): Promise<string[]> {
	const o = await shell(w, s, serial, slimScript(packages, settings), 300_000);
	return o.split("\n").flatMap((l) => /^disabled (\S+)/.exec(l.trim())?.slice(1) ?? []);
}

/** Puts back what slimming changed on the guest. */
export async function unslimGuest(w: Where, s: Sdk, serial: string): Promise<string> {
	return shell(w, s, serial, unslimScript(), 180_000);
}

/** What slimming has disabled on the guest. */
export async function slimmedGuest(w: Where, s: Sdk, serial: string): Promise<string[]> {
	return slimmedPackages(await shell(w, s, serial, `cat ${STATE} 2>/dev/null; exit 0`));
}

/** Its memory: the emulator's qemu process, resident MB. */
export async function measure(w: Where, s: Sdk, serial: string): Promise<{ mb: number }> {
	const port = serial.replace("emulator-", "");
	// A Mac's footprint, as Activity Monitor's Memory says (resident leaves out what's compressed); Linux's resident size.
	const o = await mac(w, `p=$(pgrep -f "[q]emu-system.*-ports? $1( |$)" | head -1); [ -n "$p" ] || { echo 0; exit 0; }; if command -v footprint >/dev/null; then footprint -p $p 2>/dev/null | awk '/phys_footprint:/ {v = $2; u = $3; print (u == "GB" ? v * 1048576 : u == "MB" ? v * 1024 : v); exit}'; else ps -o rss= -p $p; fi`, [port]);
	return { mb: Math.round(Number(o.trim() || 0) / 1024) };
}

export async function screenshot(w: Where, s: Sdk, serial: string): Promise<Uint8Array> {
	return unbase64(await mac(w, `${env(s)}; "$adb" -s "$1" exec-out screencap -p | base64`, [serial], { timeout: 60_000 }));
}

export async function drive(w: Where, s: Sdk, serial: string, steps: string[]) {
	await shell(w, s, serial, stepsScript(steps), 120_000);
}

export async function describe(w: Where, s: Sdk, serial: string): Promise<Element[]> {
	const dump = () => shell(w, s, serial, `uiautomator dump /data/local/tmp/swarm-ui.xml >/dev/null 2>&1 && cat /data/local/tmp/swarm-ui.xml`, 90_000);
	// Slim, Android's low-memory killer can stop uiautomator as it starts, just after a boot: once more.
	const xml = await dump().catch(() => dump());
	return parseUiAutomator(xml).slice(0, MAX_ELEMENTS);
}

// ---- Apps and settings ----

export async function apps(w: Where, s: Sdk, serial: string): Promise<{ id: string; name: string; user: boolean }[]> {
	const o = await shell(w, s, serial, `pm list packages -3 | sed 's/^package://'`);
	return o.split("\n").map((l) => l.trim()).filter(Boolean).map((id) => ({ id, name: id, user: true }));
}

export const launch = (w: Where, s: Sdk, serial: string, id: string) => shell(w, s, serial, `monkey -p '${id.replace(/'/g, "")}' -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || { echo "no launcher activity in ${id.replace(/['"$`\\]/g, "")}" >&2; exit 1; }`);
export const terminate = (w: Where, s: Sdk, serial: string, id: string) => adb(w, s, serial, ["shell", "am", "force-stop", id]);
export const install = (w: Where, s: Sdk, serial: string, path: string) => adb(w, s, serial, ["install", "-r", "-g", path], { timeout: 300_000 });
export const uninstall = (w: Where, s: Sdk, serial: string, id: string) => adb(w, s, serial, ["uninstall", id]);
export const openURL = (w: Where, s: Sdk, serial: string, url: string) => adb(w, s, serial, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${url.replace(/'/g, "'\\''")}'`]);
export const logs = (w: Where, s: Sdk, serial: string, id: string) =>
	shell(w, s, serial, `p=$(pidof '${id.replace(/'/g, "")}'); if [ -n "$p" ]; then logcat -d -t 300 --pid=$p; else logcat -d -t 200; fi`, 60_000);

export async function setting(w: Where, s: Sdk, serial: string, what: string, value: string, app?: string): Promise<string> {
	const safe = (v: string) => {
		if (!/^[\w.,: -]+$/.test(v)) throw new SimError(`${v}: letters, digits and . , : - only.`);
		return v;
	};
	switch (what) {
		case "appearance":
			if (!/^(dark|light)$/.test(value)) throw new SimError("appearance is dark or light.");
			await shell(w, s, serial, `cmd uimode night ${value === "dark" ? "yes" : "no"}`);
			return `Appearance: ${value}.`;
		case "text-size":
			await shell(w, s, serial, `settings put system font_scale ${safe(value)}`);
			return `Font scale: ${value}.`;
		case "location": {
			if (value === "clear" || value === "none") return "An emulator has no location to clear: set one.";
			const m = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(value);
			if (!m) throw new SimError("location is LAT,LON.");
			await adb(w, s, serial, ["emu", "geo", "fix", m[2]!, m[1]!]);
			return `Location: ${value}.`;
		}
		case "permission": {
			const [action, perm] = value.split(/\s+/);
			if (!/^(grant|revoke|reset)$/.test(action ?? "") || !app) throw new SimError("permission is grant|revoke PERMISSION (android.permission.CAMERA…), or reset, with the app.");
			if (action === "reset") await shell(w, s, serial, `pm reset-permissions -p ${safe(app)}`);
			else await shell(w, s, serial, `pm ${action} ${safe(app)} ${safe(perm ?? "")}`);
			return `${action} ${perm ?? "all"} for ${app}.`;
		}
		case "status-bar":
			if (value === "clear") await shell(w, s, serial, `am broadcast -a com.android.systemui.demo -e command exit >/dev/null; settings put global sysui_demo_allowed 0`);
			else await shell(w, s, serial, `settings put global sysui_demo_allowed 1; for c in "-e command clock -e hhmm 0941" "-e command battery -e level 100 -e plugged false" "-e command network -e wifi show -e level 4 -e mobile show -e level 4" "-e command notifications -e visible false"; do am broadcast -a com.android.systemui.demo $c >/dev/null; done`);
			return value === "clear" ? "Status bar as it is." : "Status bar: 09:41, full bars and battery.";
	}
	throw new SimError(`No setting ${what} on Android: appearance, text-size, location, permission, status-bar.`);
}

/** What an emulator changing hands is cleared of: its apps stopped, light mode, the status bar as it is. */
export async function clear(w: Where, s: Sdk, serial: string) {
	await shell(w, s, serial, `for p in $(pm list packages -3 | sed 's/^package://'); do am force-stop "$p"; done; cmd uimode night no; am broadcast -a com.android.systemui.demo -e command exit >/dev/null 2>&1; am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1; input keyevent KEYCODE_HOME; exit 0`, 120_000);
}
