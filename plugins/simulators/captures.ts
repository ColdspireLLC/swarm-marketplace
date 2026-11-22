// Captures: screenshots and recordings of a simulator, the user's (the
// page's Screenshot and Record) or an agent's it was asked to keep. The
// files stay where the simulator runs (the Mac's cache, or the Android
// host's), each with a small JPEG of it to show in the strip; the plugin
// keeps their index. Kept: the newest captureLimit, within captureBudget
// MB; older ones go, files and all.
import { settings, storage, ui } from "swarm";
import { sdk as findSdk } from "./android";
import { pngSize, unbase64 } from "./devices";
import { mac } from "./ios";
import type { Device } from "./picker";
import { message, where } from "./state";
import type { Where } from "./where";

export interface Capture {
	id: string;
	kind: "png" | "mp4";
	/** The device's id (UDID, or avd:NAME) and name as it was. */
	device: string;
	name: string;
	platform: Device["platform"];
	at: number;
	/** In bytes, once it's there; 0 while it records. */
	size: number;
	/** A recording's length in seconds. */
	secs?: number;
	/** Its picture's size in pixels, for its tile's shape. */
	w?: number;
	h?: number;
	/** The agent's thread that took it, if one did. */
	thread?: string;
	title?: string;
}

const SAVE = "captures";
export const caps = ui.store({ list: (storage.get<Capture[]>(SAVE) ?? []) as Capture[] });
const persist = () => storage.set(SAVE, caps.list);

/** The recording under way, if one is: one at a time. */
export const recording = ui.store({ now: null as null | { id: string; device: Device; at: number; pid: string; thread?: string; stopping?: boolean } });

/** The folder captures go in where the simulator runs. */
const DIR = `d="$HOME/Library/Caches"; [ -d "$d" ] || d="\${XDG_CACHE_HOME:-$HOME/.cache}"; d="$d/swarm-simulators/captures"; mkdir -p "$d"`;

/** Makes a JPEG of $1 at $2 (400 px on its longer side), as the host can: sips on a Mac, ffmpeg elsewhere; a video's first frame through qlmanage or ffmpeg. */
const THUMB = `thumb() { src="$1"; out="$2"
  case "$src" in
  *.mp4) if command -v qlmanage >/dev/null; then t=$(mktemp -d "\${TMPDIR:-/tmp}/swarm-thumb.XXXXXX"); qlmanage -t -s 400 -o "$t" "$src" >/dev/null 2>&1; p=$(ls "$t"/*.png 2>/dev/null | head -1); [ -n "$p" ] && sips -s format jpeg -s formatOptions 70 "$p" --out "$out" >/dev/null 2>&1; rm -rf "$t"
    elif command -v ffmpeg >/dev/null; then ffmpeg -loglevel error -y -i "$src" -frames:v 1 -vf "scale='if(gt(iw,ih),400,-2)':'if(gt(iw,ih),-2,400)'" "$out"; fi;;
  *) if command -v sips >/dev/null; then sips -Z 400 -s format jpeg -s formatOptions 70 "$src" --out "$out" >/dev/null 2>&1
    elif command -v ffmpeg >/dev/null; then ffmpeg -loglevel error -y -i "$src" -vf "scale='if(gt(iw,ih),400,-2)':'if(gt(iw,ih),-2,400)'" "$out"; else cp "$src" "$out"; fi;;
  esac; }`;

/** Where a device's captures are, and how its commands run there. */
async function hostOf(platform: Device["platform"]): Promise<{ w: Where; adb?: string }> {
	const w = await where(platform);
	if (platform === "ios") return { w };
	const s = await findSdk(w, String(settings.get("androidSdk") ?? ""), String(settings.get("androidImage") ?? "") || "-");
	return { w, adb: s.adb };
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The thumbnails as fetched, a bounded few; and the full files as the viewer opens them. */
const thumbs = ui.store(new Map<string, Uint8Array>(), { shallow: true });
const fulls = new Map<string, Uint8Array>();
const fetching = new Set<string>();

function remember<T>(m: Map<string, T>, k: string, v: T, max: number) {
	m.delete(k);
	m.set(k, v);
	while (m.size > max) m.delete(m.keys().next().value!);
}

/** A capture's thumbnail, fetched the first time it's asked for; undefined meanwhile. */
export function thumbOf(c: Capture): Uint8Array | undefined {
	const t = thumbs.get(c.id);
	if (t || fetching.has(c.id) || !c.size) return t;
	fetching.add(c.id);
	void (async () => {
		try {
			const { w } = await hostOf(c.platform);
			const b = unbase64(await mac(w, `${DIR}; base64 < "$d/$1.thumb.jpg" 2>/dev/null || base64 < "$d/$1.$2"`, [c.id, c.kind], { timeout: 30_000 }));
			if (b.length) remember(thumbs, c.id, b, 80);
		} catch {
		} finally {
			fetching.delete(c.id);
		}
	})();
	return undefined;
}

/** A capture's whole file, for the viewer, saving and sending: a few kept. */
export async function bytesOf(c: Capture): Promise<Uint8Array> {
	const have = fulls.get(c.id);
	if (have) return have;
	const { w } = await hostOf(c.platform);
	// A command's output holds 16 MB: a long recording comes in pieces.
	const parts: Uint8Array[] = [];
	const piece = 8 * 1024 * 1024;
	for (let off = 0; off < Math.max(c.size, 1); off += piece) {
		const b = unbase64(await mac(w, `${DIR}; dd if="$d/$1.$2" bs=1048576 skip=$3 count=8 2>/dev/null | base64`, [c.id, c.kind, String(off / 1048576)], { timeout: 120_000 }));
		parts.push(b);
		if (b.length < piece) break;
	}
	const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		all.set(p, at);
		at += p.length;
	}
	remember(fulls, c.id, all, c.kind === "mp4" ? 1 : 4);
	return all;
}

function add(c: Capture) {
	caps.list = [c, ...caps.list.filter((x) => x.id !== c.id)];
	persist();
}

/** Takes a screenshot of a running device into the captures; its record. */
export async function screenshot(d: Device, o: { thread?: string; title?: string } = {}): Promise<Capture> {
	const { w, adb } = await hostOf(d.platform);
	const id = newId();
	const take = d.platform === "ios" ? `xcrun simctl io "$2" screenshot --type=png "$f" >/dev/null 2>&1 || { echo "it isn't running" >&2; exit 3; }` : `"$3" -s "$2" exec-out screencap -p > "$f" || exit 3`;
	const o2 = await mac(w, `${DIR}; ${THUMB}; f="$d/$1.png"; ${take}; thumb "$f" "$d/$1.thumb.jpg"; wc -c < "$f" | tr -d ' '; head -c 32 "$f" | base64 | tr -d '\\n'; echo; base64 < "$d/$1.thumb.jpg" 2>/dev/null`, [id, d.platform === "ios" ? d.id : d.serial ?? "", adb ?? ""], { timeout: 60_000 });
	const [size = "0", head = "", ...rest] = o2.split("\n");
	const { width, height } = pngSize(unbase64(head));
	const thumb = unbase64(rest.join(""));
	if (thumb.length) remember(thumbs, id, thumb, 80);
	const c: Capture = { id, kind: "png", device: d.id, name: d.name, platform: d.platform, at: Date.now(), size: Number(size) || 1, w: width || undefined, h: height || undefined, thread: o.thread, title: o.title };
	add(c);
	void prune();
	return c;
}

/** The longest a recording runs: it stops itself then. */
export const RECORD_MAX_MS = 3 * 60_000;
let stopTimer: ReturnType<typeof setTimeout> | undefined;

/** Starts recording a running device's screen, at its own frame rate; one recording at a time. */
export async function startRecording(d: Device, o: { thread?: string; title?: string } = {}): Promise<string | null> {
	if (recording.now) return `${recording.now.device.name} is being recorded already.`;
	try {
		const { w, adb } = await hostOf(d.platform);
		const id = newId();
		const start =
			d.platform === "ios"
				? `nohup xcrun simctl io "$2" recordVideo --codec=h264 --force "$f" >"$d/$1.log" 2>&1 </dev/null & echo $!`
				: `nohup "$3" -s "$2" shell screenrecord --time-limit 180 /sdcard/swarm-$1.mp4 >"$d/$1.log" 2>&1 </dev/null & echo $!`;
		const pid = (await mac(w, `${DIR}; f="$d/$1.mp4"; ${start}`, [id, d.platform === "ios" ? d.id : d.serial ?? "", adb ?? ""])).trim();
		recording.now = { id, device: d, at: Date.now(), pid, thread: o.thread };
		add({ id, kind: "mp4", device: d.id, name: d.name, platform: d.platform, at: Date.now(), size: 0, thread: o.thread, title: o.title });
		clearTimeout(stopTimer);
		stopTimer = setTimeout(() => void stopRecording(), RECORD_MAX_MS);
		return null;
	} catch (e) {
		return message(e);
	}
}

/** Stops the recording and keeps its clip; the capture, or why not. */
export async function stopRecording(): Promise<Capture | string> {
	const r = recording.now;
	if (!r) return "Nothing is being recorded.";
	if (r.stopping) return "It's stopping already.";
	recording.now = { ...r, stopping: true };
	clearTimeout(stopTimer);
	try {
		const { w, adb } = await hostOf(r.device.platform);
		// SIGINT, as Ctrl+C: simctl and screenrecord finish the file then.
		const stop =
			r.device.platform === "ios"
				? `kill -INT "$2" 2>/dev/null; for i in $(seq 100); do kill -0 "$2" 2>/dev/null || break; sleep 0.1; done; kill -TERM "$2" 2>/dev/null`
				: `"$4" -s "$3" shell pkill -INT screenrecord; for i in $(seq 100); do kill -0 "$2" 2>/dev/null || break; sleep 0.1; done; sleep 0.5; "$4" -s "$3" pull /sdcard/swarm-$1.mp4 "$f" >/dev/null && "$4" -s "$3" shell rm -f /sdcard/swarm-$1.mp4`;
		const o = await mac(
			w,
			`${DIR}; ${THUMB}; f="$d/$1.mp4"; ${stop}; rm -f "$d/$1.log"; [ -s "$f" ] || { echo "the recording made no clip" >&2; exit 3; }; thumb "$f" "$d/$1.thumb.jpg"; wc -c < "$f" | tr -d ' '`,
			[r.id, r.pid, r.device.serial ?? "", adb ?? ""],
			{ timeout: 60_000 },
		);
		const c = caps.list.find((x) => x.id === r.id);
		const done: Capture = { ...(c ?? { id: r.id, kind: "mp4", device: r.device.id, name: r.device.name, platform: r.device.platform, at: r.at }), size: Number(o.trim().split("\n").pop()) || 1, secs: Math.round((Date.now() - r.at) / 1000) } as Capture;
		add(done);
		void prune();
		return done;
	} catch (e) {
		caps.list = caps.list.filter((x) => x.id !== r.id);
		persist();
		return message(e);
	} finally {
		recording.now = null;
	}
}

/** Deletes captures, files and all. */
export async function remove(ids: string[]) {
	const gone = caps.list.filter((c) => ids.includes(c.id));
	caps.list = caps.list.filter((c) => !ids.includes(c.id));
	persist();
	for (const p of ["ios", "android"] as const) {
		const mine = gone.filter((c) => c.platform === p);
		if (!mine.length) continue;
		try {
			const { w } = await hostOf(p);
			await mac(w, `${DIR}; for id; do rm -f "$d/$id".*; done`, mine.map((c) => c.id));
		} catch {}
	}
	for (const c of gone) {
		thumbs.delete(c.id);
		fulls.delete(c.id);
	}
}

/** Keeps the newest captureLimit within captureBudget MB; the rest go. */
export async function prune() {
	const limit = Math.max(1, Number(settings.get("captureLimit") ?? 100));
	const budget = Math.max(64, Number(settings.get("captureBudget") ?? 2048)) * 1024 * 1024;
	let total = 0;
	const drop: string[] = [];
	caps.list.forEach((c, i) => {
		if (!c.size) return; // recording
		total += c.size;
		if (i >= limit || total > budget) drop.push(c.id);
	});
	if (drop.length) await remove(drop);
}
