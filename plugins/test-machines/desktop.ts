// Desktops: the screen of this computer, and of the computers joined to
// Swarm (Settings, Machines), through swarm.process.run's machine. Each
// system with what it has, nothing to install:
//
// - macOS: screencapture, and JavaScript for Automation for the pointer
//   and keys (CoreGraphics' events) and the app in front. Swarm needs
//   Screen Recording and Accessibility in System Settings, Privacy.
// - Windows: PowerShell, .NET's Graphics.CopyFromScreen and user32's
//   SendInput, in the signed-in user's session.
// - Linux: GNOME's Mutter (RemoteDesktop and ScreenCast over D-Bus, as on
//   Wayland) through python3 and GStreamer; on X11, xdotool and ImageMagick.
//
// Steps are in screenshot pixels: click X Y, dclick X Y, rclick X Y,
// move X Y, drag X1 Y1 X2 Y2, scroll N, type TEXT, key CHORD (cmd+s,
// ctrl+shift+t, enter), wait MS.
import { call, process, settings } from "swarm";
import { DriverError, type App, type Check, type Element, type Driver, type Kind, type Machine, type Ran, type Recording, type Shot } from "./drivers";
import { LINUX_PY, MAC_AX, MAC_JXA, MAC_RECORDER, windowsScript } from "./desktop-scripts";

export const DESKTOP_STEPS = "steps in screenshot pixels: click X Y, dclick X Y, rclick X Y, move X Y, drag X1 Y1 X2 Y2, scroll N (down; -N up), type TEXT, key CHORD (cmd+s, ctrl+shift+t, enter, esc, tab, up…), wait MS";

/** A recording is read 6 MB at a time. */
const CHUNK = 6 << 20;

const KIND: Record<string, Kind> = { darwin: "mac", linux: "linux", windows: "windows" };

/** A machine's place: its Swarm machine ("" for this computer) and system. */
interface Place {
	machine: string;
	os: string;
}

const unbase64 = (text: string) => {
	const bin = atob(text.replace(/\s+/g, ""));
	const data = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
	return data;
};

const out = (r: { stdout: string; stderr: string }) => (r.stdout + (r.stderr ? (r.stdout ? "\n" : "") + r.stderr : "")).trim();

/** The helper's last line, a JSON answer: { ok, … } or { error }. */
function answer(r: { code: number; stdout: string; stderr: string }): any {
	const last = r.stdout.trim().split("\n").pop() ?? "";
	let a: any;
	try {
		a = JSON.parse(last);
	} catch {
		throw new DriverError(out(r) || `the desktop helper failed (${r.code})`);
	}
	if (a.error) throw new DriverError(a.error);
	return a;
}

export class Desktop implements Driver {
	readonly name = "desktop";
	private places = new Map<string, Place>();
	/** What each machine needs of the plugin's own programs: its system's alone (Windows' command line is 32K at most). */
	private forOs(m: Machine, mac: Record<string, unknown>, linux: Record<string, unknown> = {}): Record<string, unknown> {
		const os = this.places.get(m.id)?.os;
		return os === "darwin" ? mac : os === "linux" ? linux : {};
	}
	/** What each machine's agents launched, by app: the process it started. */
	private launched = new Map<string, Map<string, number>>();

	/** Runs the system's helper with an action, there; input is what it reads (a file's piece). */
	private async helper(m: Machine, action: string, arg: unknown = null, timeoutS = 60, input?: string): Promise<any> {
		const p = this.places.get(m.id);
		if (!p) throw new DriverError(`${m.name} is no longer one of the desktops.`);
		const payload = JSON.stringify({ action, arg });
		const o = { machine: p.machine || undefined, timeout: timeoutS * 1000, input };
		let r;
		switch (p.os) {
			case "darwin":
				r = await process.run("osascript", ["-l", "JavaScript", "-e", MAC_JXA, payload], o);
				break;
			case "windows":
				// Whole, as UTF-16 in base64: PowerShell reads a script on its input a line at a time.
				r = await process.run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", utf16Base64(`$Payload = @'\n${payload}\n'@\n${windowsScript(action)}`)], o);
				break;
			case "linux":
				r = await process.run("python3", ["-c", LINUX_PY, payload], o);
				break;
			default:
				throw new DriverError(`${m.name} runs ${p.os}, which the desktop driver doesn't drive.`);
		}
		return answer(r);
	}

	async machines(): Promise<Machine[]> {
		// A new map, swapped in whole: a copy or a recording running beside a refresh keeps its machine.
		const places = new Map<string, Place>();
		const found: Machine[] = [];
		if (settings.get("thisComputer") === true) {
			const id = "this-computer";
			places.set(id, { machine: "", os: process.platform });
			found.push({ id, name: "This computer", kind: KIND[process.platform] ?? "linux", about: "The computer Swarm runs on, its own screen.", driver: this });
		}
		if (settings.get("swarmMachines") !== false) {
			let list: { id: string; name: string; os?: string; server?: boolean; connected: boolean; pairing?: string; screen?: boolean }[] = [];
			try {
				list = await call("Machines", {});
			} catch {}
			list = list.filter((x) => x.id && !x.server && !x.pairing && x.connected && x.os && KIND[x.os]);
			// Named for the machine, with its Swarm id's end where two share a name: whichever is connected, each keeps its id.
			const named = new Map<string, number>();
			for (const x of list) named.set(slug(x.name || x.id), (named.get(slug(x.name || x.id)) ?? 0) + 1);
			for (const x of list) {
				let id = slug(x.name || x.id);
				if (named.get(id)! > 1) id = `${id}-${x.id.slice(-4)}`;
				places.set(id, { machine: x.id, os: x.os! });
				found.push({ id, name: x.name || x.id, kind: KIND[x.os!]!, about: `${x.os === "darwin" ? "macOS" : x.os === "windows" ? "Windows" : "Linux"}, joined to Swarm (${x.id}).`, driver: this, where: x.id, screen: x.screen ? `swarm://screen/${encodeURIComponent(x.id)}` : undefined });
			}
		}
		this.places = places;
		return found;
	}

	async status(m: Machine): Promise<string> {
		const a = await this.helper(m, "status", null, 30);
		return `desktop: ${a.summary}`;
	}

	async capture(m: Machine): Promise<Shot> {
		const a = await this.helper(m, "capture", null, 60);
		// Windows saves it to a file, read in a second step.
		const data = a.path ? await this.fetch(m, String(a.path), Number(a.size) || 0) : unbase64(String(a.png ?? ""));
		if (data.length < 8) throw new DriverError(`the screenshot of ${m.name} came back empty.`);
		return { data, mimeType: data[0] === 0xff ? "image/jpeg" : "image/png" };
	}

	async drive(m: Machine, steps: string[]): Promise<string> {
		const a = await this.helper(m, "drive", steps, 120);
		return a.said ?? `did ${steps.length} step(s)`;
	}

	async run(m: Machine, command: string, o: { timeoutS: number }): Promise<Ran> {
		const p = this.places.get(m.id);
		if (!p) throw new DriverError(`${m.name} is no longer one of the desktops.`);
		const opts = { machine: p.machine || undefined, timeout: Math.min(o.timeoutS, 600) * 1000 };
		const r = p.os === "windows" ? await process.run("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], opts) : await process.run("sh", ["-c", command], opts);
		return { code: r.code, output: out(r), timedOut: !!r.timedOut };
	}

	async app(m: Machine, action: string, target: string, o: { args: string[] }): Promise<string> {
		const mine = this.launched.get(m.id) ?? new Map<string, number>();
		this.launched.set(m.id, mine);
		switch (action) {
			case "launch":
			case "focus": {
				const a = await this.helper(m, action, { app: target, args: o.args }, 60);
				if (action === "launch" && Number(a.pid) > 0) mine.set(target, Number(a.pid));
				return a.said ?? `${action === "launch" ? "Launched" : "Brought forward"} ${target}.`;
			}
			case "kill": {
				const pid = mine.get(target);
				if (!pid) throw new DriverError(`You didn't launch ${target}, or it was open already: only what you started is stopped.`);
				const a = await this.helper(m, "kill", { app: target, pid }, 60);
				mine.delete(target);
				return a.said ?? `Stopped ${target}.`;
			}
		}
		throw new DriverError(`A desktop's apps launch, focus and kill; ${action} is a phone's. Install with machine_run.`);
	}

	async put(m: Machine, locals: string[], remote: string): Promise<string> {
		const sep = this.places.get(m.id)?.os === "windows" ? "\\" : "/";
		// Into a folder: several files, a path ending in a separator, or a folder there (it has no size).
		let toDir = locals.length > 1 || /[\\/]$/.test(remote);
		if (!toDir) {
			const there = await this.helper(m, "size", { path: remote }, 20);
			toDir = there.exists === true && !there.size;
		}
		let total = 0;
		for (const l of locals) {
			const name = l.split(/[\\/]/).pop()!;
			const dest = toDir ? remote.replace(/[\\/]+$/, "") + sep + name : remote;
			const size = await localSize(l);
			let at = 0;
			do {
				const piece = await localRead(l, at, CHUNK);
				await this.helper(m, "write", { path: dest, append: at > 0 }, 120, piece);
				at += CHUNK;
			} while (at < size);
			total += size;
		}
		return `Copied ${locals.length} file(s), ${Math.round(total / 1024)} KB, to ${remote} on ${m.name}.`;
	}

	async get(m: Machine, remote: string, local: string): Promise<string> {
		const { size, exists } = await this.helper(m, "size", { path: remote }, 20);
		if (!exists) throw new DriverError(`No file ${remote} on ${m.name}.`);
		for (let at = 0; at < size || at === 0; at += CHUNK) {
			const data = String((await this.helper(m, "read", { path: remote, offset: at, length: CHUNK }, 120)).data ?? "");
			await localWrite(local, data, at > 0);
			if (!size) break;
		}
		return `Copied ${remote} from ${m.name} to ${local}, ${Math.round(size / 1024)} KB.`;
	}

	async power(m: Machine, action: string): Promise<string> {
		if (action === "status") return this.status(m);
		throw new DriverError(`${m.name}'s power is its own: status only.`);
	}

	async released() {}

	async describe(m: Machine): Promise<Element[]> {
		// A Mac compiles its reader the first time.
		const a = await this.helper(m, "describe", this.forOs(m, { swift: MAC_AX }), 120);
		if (a.relative) throw new DriverError(`${m.name} runs GNOME on Wayland, whose windows don't say where they are on the screen: look with machine_capture instead.`);
		return (a.elements ?? []) as Element[];
	}

	async doctor(): Promise<Check[]> {
		const checks: Check[] = [];
		const list = await this.machines();
		if (!list.length) checks.push({ what: "Swarm's machines", ok: false, detail: "none connected: join a computer in Settings, Machines" });
		for (const m of list) {
			try {
				const a = await this.helper(m, "status", null, 30);
				const ok = a.accessibility !== false;
				checks.push({ what: m.name, ok, detail: String(a.summary ?? "") + (ok ? "" : ": the user turns on Accessibility for Swarm in System Settings, Privacy & Security") });
			} catch (e) {
				checks.push({ what: m.name, ok: false, detail: e instanceof Error ? e.message : String(e) });
			}
		}
		return checks;
	}

	steps(): string {
		return DESKTOP_STEPS;
	}

	async frontmost(m: Machine): Promise<App | null> {
		const a = await this.helper(m, "front", null, 20);
		return a.id || a.name ? { id: String(a.id ?? ""), name: String(a.name ?? "") } : null;
	}

	async leave(m: Machine): Promise<void> {
		await this.helper(m, "leave", null, 20);
	}

	async recordStart(m: Machine, o: { seconds: number }): Promise<void> {
		// A Mac compiles its recorder the first time: a minute, at most.
		await this.helper(m, "recordStart", { seconds: o.seconds, ...this.forOs(m, { swift: MAC_RECORDER }, { script: LINUX_PY }) }, 120);
	}

	async recordStop(m: Machine): Promise<Recording> {
		const a = await this.helper(m, "recordStop", null, 120);
		const size = Number(a.size) || 0;
		if (!size) throw new DriverError(`${m.name} recorded nothing.`);
		const path = String(a.path);
		return { data: await this.fetch(m, path, size, false), ext: String(a.ext ?? "mp4"), cleanup: async () => void (await this.helper(m, "remove", { path }, 20).catch(() => {})) };
	}

	/** A file the helper left, read in pieces (what a program prints is 16 MB at most), then removed. */
	private async fetch(m: Machine, path: string, size: number, remove = true): Promise<Uint8Array> {
		const parts: Uint8Array[] = [];
		for (let at = 0; at < size; at += CHUNK) parts.push(unbase64(String((await this.helper(m, "read", { path, offset: at, length: CHUNK }, 120)).data ?? "")));
		if (remove) await this.helper(m, "remove", { path }, 20).catch(() => {});
		const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let at = 0;
		for (const p of parts) data.set(p, (at += p.length) - p.length);
		return data;
	}
}

// ---- Files on the computer Swarm runs on, through its shell (the plugin reads only its own folder) ----

/**
 * A script on the computer Swarm runs on, its arguments apart from its
 * text: sh's $1…, PowerShell's $env:SWARM_A1… (PowerShell reads what
 * follows -Command as more of the script).
 */
const local = (sh: string, ps: string, args: string[], input?: string) =>
	process.platform === "windows"
		? process.run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { input, timeout: 120_000, env: Object.fromEntries(args.map((a, i) => [`SWARM_A${i + 1}`, a])) })
		: process.run("sh", ["-c", sh, "sh", ...args], { input, timeout: 120_000 });

async function localSize(path: string): Promise<number> {
	const r = await local('wc -c < "$1"', "(Get-Item -LiteralPath $env:SWARM_A1).Length", [path]);
	if (r.code !== 0) throw new DriverError(`can't read ${path}: ${out(r)}`);
	return Number(r.stdout.trim()) || 0;
}

/** A piece of a file here, as base64. */
async function localRead(path: string, offset: number, length: number): Promise<string> {
	const r = await local(
		'dd if="$1" bs=1048576 skip="$2" count="$3" 2>/dev/null | base64 | tr -d "\\n"',
		"$f=[IO.File]::OpenRead($env:SWARM_A1); try { $f.Seek([long]$env:SWARM_A2*1MB,'Begin')|Out-Null; $b=New-Object byte[] ([int]$env:SWARM_A3*1MB); $n=$f.Read($b,0,$b.Length); [Convert]::ToBase64String($b,0,$n) } finally { $f.Close() }",
		[path, String(offset / 1048576), String(length / 1048576)],
	);
	if (r.code !== 0) throw new DriverError(`can't read ${path}: ${out(r)}`);
	return r.stdout.trim();
}

/** Writes a piece of a file here, from base64: appended, or the file begun. */
async function localWrite(path: string, data: string, append: boolean) {
	const r = await local(
		append ? 'base64 -d >> "$1"' : 'mkdir -p "$(dirname "$1")" && base64 -d > "$1"',
		`$b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $f=[IO.File]::Open($env:SWARM_A1, '${append ? "Append" : "Create"}'); try { $f.Write($b,0,$b.Length) } finally { $f.Close() }`,
		[path],
		data,
	);
	if (r.code !== 0) throw new DriverError(`can't write ${path}: ${out(r)}`);
}

/** Text as PowerShell's -EncodedCommand takes it: UTF-16LE, in base64. */
export function utf16Base64(text: string): string {
	let bin = "";
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		bin += String.fromCharCode(c & 0xff, c >> 8);
	}
	return btoa(bin);
}

/** A machine's id from its name: "Anthonys-Mac-mini" as "anthonys-mac-mini". */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "machine";
