// Slim Android emulators, after avdslim (kdbhalala/avdslim, MIT): an AVD
// tuned for less memory (its config.ini), and apps and services agents
// rarely need disabled in the guest (pm disable-user), with background
// limits and sync off. It measured a Pixel 10 Pro's emulator at 8.5 GB
// stock and 2.5 GB slim.
//
// What the guest's slimming changed is written on the guest before it's
// changed (STATE), so that unslim puts each back as it was: the packages
// enabled again, each setting its old value or none. No Swarm here, for
// the tests.

const G = (names: string) => names.split(/\s+/).filter(Boolean).map((n) => (n.startsWith("com.") ? n : `com.google.android.${n}`));

/** The categories of what's disabled: what each is, as the agent's note says it, and its packages. */
export const ANDROID_CATEGORIES: Record<string, { what: string; packages: string[] }> = {
	assistant: { what: "the Google app and Assistant", packages: G("googlequicksearchbox as as.oss") },
	privacy: { what: "the Privacy Sandbox", packages: G("adservices.api com.google.mainline.adservices") },
	wellbeing: {
		what: "Digital Wellbeing, Gemini and on-device intelligence",
		packages: G(
			"apps.wellbeing settings.intelligence com.android.emulator.multidisplay apps.bard apps.restore apps.pulse configupdater projection.gearhead com.android.imsserviceentitlement com.android.carrierdefaultapp ondevicepersonalization.services federatedcompute glasses.companion glasses.core apps.safetyhub markup",
		),
	},
	media: {
		what: "Photos, YouTube, Maps, Gmail, Drive and the camera",
		packages: G("apps.photos youtube videos music apps.youtube.music apps.maps gm apps.docs com.android.gallery3d com.android.music com.android.camera2 com.android.cameraextensions com.android.DeviceAsWebcam"),
	},
	telephony: {
		what: "Phone, Messages, Contacts and cell broadcasts",
		packages: G("apps.messaging dialer contacts com.android.contacts com.android.dialer com.android.mms cellbroadcastservice com.android.cellbroadcastservice com.android.cellbroadcastreceiver telephony.satellite com.android.stk com.android.bluetoothmidiservice"),
	},
	accessibility: { what: "TalkBack, Voice Access and text-to-speech", packages: G("tts marvin.talkback apps.accessibility.voiceaccess") },
	printing: { what: "printing", packages: G("com.android.printspooler com.android.bips printservice.recommendation") },
	extras: {
		what: "Calendar, Clock, Calculator, wallpapers, screen savers and feedback",
		packages: G(
			"feedback com.android.traceur com.android.dreams.basic com.android.dreams.phototable com.android.wallpaper.livepicker apps.wallpaper com.android.emergency calendar com.android.calendar deskclock com.android.deskclock calculator com.android.calculator2",
		),
	},
};

/** Settings slimming changes, by category: namespace, name, value. */
export const ANDROID_SETTINGS: Record<string, { what: string; set: [ns: "global" | "secure" | "system", name: string, value: string][] }> = {
	bglimit: {
		what: "the limit of 4 cached background processes",
		set: [
			["global", "background_process_limit", "4"],
			["global", "activity_manager_constants", "max_cached_processes=4"],
		],
	},
	sync: { what: "account sync", set: [["global", "auto_sync", "0"]] },
	location: { what: "location", set: [["secure", "location_mode", "0"]] },
	setup: {
		what: "setup marked done",
		set: [
			["secure", "user_setup_complete", "1"],
			["global", "device_provisioned", "1"],
		],
	},
	bluetooth: { what: "Bluetooth", set: [["global", "bluetooth_on", "0"]] },
};

/**
 * Never disabled: Bluetooth's stack (Android 16 doesn't boot without it),
 * Play services and the WebView, which most apps need.
 */
export const ANDROID_NEVER = new Set(["com.google.android.bluetooth", "com.android.bluetooth", "com.google.android.gms", "com.google.android.gsf", "com.google.android.webview", "com.android.webview", "com.google.android.trichromelibrary"]);

/** Every category id, packages' and settings'. */
export const ANDROID_KEEPABLE: Record<string, unknown> = { ...ANDROID_CATEGORIES, ...ANDROID_SETTINGS };

/** The packages to disable, keeping the categories and packages kept. */
export function androidPackagesOff(keep: { categories: string[]; labels: string[] }): string[] {
	const kept = new Set([...ANDROID_NEVER, ...keep.labels, ...keep.categories.flatMap((c) => ANDROID_CATEGORIES[c]?.packages ?? [])]);
	const off = new Set<string>();
	for (const c of Object.values(ANDROID_CATEGORIES)) for (const p of c.packages) if (!kept.has(p)) off.add(p);
	return [...off].sort();
}

/** The settings to change, keeping the categories kept. */
export function androidSettingsSet(keep: { categories: string[] }) {
	return Object.entries(ANDROID_SETTINGS)
		.filter(([id]) => !keep.categories.includes(id))
		.flatMap(([, c]) => c.set);
}

/** Where the guest keeps what slimming changed, to put it back. */
export const STATE = "/data/local/tmp/swarm-slim-state";

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const SAFE = /^[\w.:=,-]+$/;

/**
 * The guest's script that slims it: each package still enabled disabled,
 * each it disabled before and no longer should enabled again,
 * each setting not yet changed changed, both written to STATE first; then
 * Bluetooth off and the caches dropped. Run again, it changes only what
 * isn't yet, and keeps the first originals. It prints what it disabled.
 */
export function slimScript(packages: string[], settings: [string, string, string][]): string {
	for (const v of [...packages, ...settings.flat()]) if (!SAFE.test(v)) throw new Error(`not a package or setting: ${v}`);
	return [
		`touch ${STATE}`,
		// What it disabled before that it no longer should (a package kept since, or taken off its
		// lists), enabled again and forgotten.
		`keep=" ${packages.join(" ")} "`,
		`for p in $(sed -n 's/^pkg //p' ${STATE}); do`,
		`  case "$keep" in *" $p "*) ;; *) pm enable --user 0 "$p" >/dev/null 2>&1 && echo "enabled $p"; grep -v -x "pkg $p" ${STATE} > ${STATE}.new; mv ${STATE}.new ${STATE} ;; esac`,
		`done`,
		`enabled=$(pm list packages -e 2>/dev/null | sed 's/^package://')`,
		`for p in ${packages.join(" ")}; do`,
		`  echo "$enabled" | grep -qx "$p" || continue`,
		`  echo "pkg $p" >> ${STATE}`,
		`  pm disable-user --user 0 "$p" >/dev/null 2>&1 && echo "disabled $p"`,
		`done`,
		...settings.map(
			([ns, name, value]) =>
				`grep -q '^set ${ns} ${name} ' ${STATE} || echo "set ${ns} ${name} $(settings get ${ns} ${name})" >> ${STATE}; settings put ${ns} ${name} ${q(value)}`,
		),
		`am kill-all >/dev/null 2>&1`,
		`am trim-memory --all COMPLETE >/dev/null 2>&1 || true`,
		`su 0 sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches' >/dev/null 2>&1 || true`,
		`echo slim`,
	].join("\n");
}

/** The guest's script that puts back what slimming changed, from STATE, and forgets it. */
export function unslimScript(): string {
	return [
		`[ -f ${STATE} ] || { echo "not slim"; exit 0; }`,
		`while read kind a b c; do`,
		`  case "$kind" in`,
		`    pkg) pm enable --user 0 "$a" >/dev/null 2>&1 && echo "enabled $a" ;;`,
		`    set) if [ "$c" = null ] || [ -z "$c" ]; then settings delete "$a" "$b" >/dev/null 2>&1; else settings put "$a" "$b" "$c"; fi ;;`,
		`  esac`,
		`done < ${STATE}`,
		`rm -f ${STATE}`,
		`echo unslim`,
	].join("\n");
}

/** What the guest's STATE says slimming disabled. */
export function slimmedPackages(state: string): string[] {
	return [...new Set(state.split("\n").flatMap((l) => /^pkg (\S+)$/.exec(l.trim())?.slice(1) ?? []))];
}

/** An AVD's config.ini as key → value. */
export function parseIni(text: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const line of text.split(/\r?\n/)) {
		const i = line.indexOf("=");
		if (i > 0) out.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
	}
	return out;
}

export const ini = (m: Map<string, string>) => [...m].map(([k, v]) => `${k}=${v}`).join("\n") + "\n";

/**
 * An AVD's config tuned after avdslim's: the RAM set (3 GB) and four cores, the
 * host's GPU (SwiftShader where Linux has no display), cold boots, and no
 * audio, cameras or d-pad. headless: Linux without a display.
 */
export function slimConfig(config: Map<string, string>, host: { os: "darwin" | "linux" | "windows"; headless: boolean; memory: number }): Map<string, string> {
	const out = new Map(config);
	const set: Record<string, string> = {
		"hw.ramSize": String(host.memory),
		"vm.heapSize": "256",
		"hw.gpu.enabled": "yes",
		"hw.gpu.mode": host.os === "darwin" ? "host" : host.headless ? "swiftshader_indirect" : "auto",
		"hw.keyboard": "yes",
		"hw.cpu.ncore": "4", // avdslim's 2: System UI never finishes starting on a busy Mac, killed and started again
		"fastboot.forceColdBoot": "yes",
		"fastboot.forceFastBoot": "no",
		"hw.audioInput": "no",
		"hw.audioOutput": "no",
		"hw.camera.back": "none",
		"hw.camera.front": "none",
		"hw.dPad": "no",
	};
	for (const [k, v] of Object.entries(set)) out.set(k, v);
	return out;
}

/** The emulator's flags for a slim AVD, after avdslim's: its RAM, low-RAM mode, no audio or cameras, no boot animation. */
export const SLIM_FLAGS = ["-no-audio", "-camera-back", "none", "-camera-front", "none", "-no-boot-anim"];

/**
 * The emulator's RAM in MB: the setting's, 3 GB by default. avdslim's 1.5
 * GB with Android's low-RAM mode boots, but an app under test (a debug
 * React Native build, half a gigabyte) is killed by the low-memory killer
 * there, and System UI stops responding.
 */
export const androidMemory = (setting: unknown) => Math.min(8192, Math.max(1536, Math.round(Number(setting) || 3072)));
