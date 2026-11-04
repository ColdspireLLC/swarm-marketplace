// How the plugin reaches the machines: a driver of each.
//
// - bb: bb's own test-machines plugin, through its command line
//   (`bb test-machines …`), where bb runs: the Mac mini, the Linux desktop,
//   the Windows VM and the phones as bb has them, in bb's queue as well as
//   this one's. In a bb thread (BB_THREAD_ID) that's its turn; elsewhere
//   the plugin doesn't cut in: it waits while bb's queue has the machine.
// - ssh: machines reached over ssh, as `id:kind:user@host` in the ssh
//   setting: commands, files, and on a Mac screenshots and input
//   (screencapture, cliclick).
// - demo: a machine of the plugin's own, a screen in memory, which needs
//   none: for trying the tools and for its tests.
import { fs, process, settings } from "swarm";
import { MAX_ELEMENTS, parseUiAutomator, type Element } from "./elements";
import { parseTeams } from "./teams";
import { Screen } from "./png";
import { runAt, whereOf } from "./where";

export { elementLines, type Element } from "./elements";

export type Kind = "mac" | "linux" | "windows" | "android" | "ios" | "demo";

export interface Machine {
	id: string;
	name: string;
	kind: Kind;
	about: string;
	driver: Driver;
	/** The computer joined to Swarm it's on, where it's one. */
	where?: string;
	/** The link that opens its screen in Swarm's window, live (swarm://screen/…), where Swarm can show it. */
	screen?: string;
}

export interface Shot {
	data: Uint8Array;
	mimeType: string;
	path?: string;
}

export interface Ran {
	code: number;
	output: string;
	timedOut: boolean;
}

export interface Driver {
	readonly name: string;
	/** Its machines, as it has them now. */
	machines(): Promise<Machine[]>;
	/** What it says of a machine beside the plugin's queue. */
	status(m: Machine): Promise<string>;
	capture(m: Machine): Promise<Shot>;
	drive(m: Machine, steps: string[]): Promise<string>;
	run(m: Machine, command: string, o: { timeoutS: number; exclusive: boolean }): Promise<Ran>;
	app(m: Machine, action: string, target: string, o: { args: string[]; env: Record<string, string>; cwd?: string }): Promise<string>;
	put(m: Machine, locals: string[], remote: string): Promise<string>;
	get(m: Machine, remote: string, local: string): Promise<string>;
	power(m: Machine, action: string): Promise<string>;
	/** The plugin's queue let the machine go: the driver gives back what it holds. */
	released(m: Machine): Promise<void>;
	/** The steps drive takes, for the tool's description. */
	steps(kind: Kind): string;
	/** The app in front, where the driver can tell: for keeping agents out of sensitive ones. */
	frontmost?(m: Machine): Promise<App | null>;
	/** Leaves the app in front: hides it, or goes home on a phone. */
	leave?(m: Machine): Promise<void>;
	/** The package or bundle id of a build, a file here, where the driver can read it. */
	packageOf?(m: Machine, file: string): Promise<string>;
	/** What's on the screen: its elements, named, at screenshot pixels. */
	describe?(m: Machine): Promise<Element[]>;
	/** What it needs, checked: a line each, good or not. */
	doctor?(): Promise<Check[]>;
	/** The driver's own command line, as is (adb's): its output and exit code. */
	raw?(m: Machine, args: string[]): Promise<{ code: number; output: string }>;
	/** Starts recording the screen, for seconds at most. */
	recordStart?(m: Machine, o: { seconds: number; title: string }): Promise<void>;
	/** Stops it, and gives the video. */
	recordStop?(m: Machine): Promise<Recording>;
}

/** A recording: its bytes, or a file here the driver saved it to; cleanup removes what's left of it, once it's kept. */
export interface Recording {
	data?: Uint8Array;
	path?: string;
	ext: string;
	cleanup?: () => Promise<void>;
}

/** A check of doctor's: what, whether it's right, and what was found or what to do. */
export interface Check {
	what: string;
	ok: boolean;
	detail: string;
}

/** An app, by its name and its id (a bundle id, a package name). */
export interface App {
	name: string;
	id: string;
}

export class DriverError extends Error {
	constructor(message: string, readonly busy = false) {
		super(message);
		this.name = "DriverError";
	}
}

const out = (r: { stdout: string; stderr: string }) => (r.stdout + (r.stderr ? (r.stdout ? "\n" : "") + r.stderr : "")).trim();

// ---- bb ----

/** bb test-machines' exit code when it isn't the caller's turn. */
const NOT_YOUR_TURN = 75;

export class BB implements Driver {
	readonly name = "bb";
	private cache: Machine[] = [];

	private async bb(args: string[], timeoutS = 300): Promise<{ code: number; stdout: string; stderr: string }> {
		const r = await process.run(String(settings.get("bbPath") || "bb"), ["test-machines", ...args], { timeout: (timeoutS + 30) * 1000 });
		if (r.code === NOT_YOUR_TURN) throw new DriverError(out(r) || "bb's queue has the machine", true);
		return r;
	}

	private async ok(args: string[], timeoutS?: number): Promise<string> {
		const r = await this.bb(args, timeoutS);
		if (r.code !== 0) throw new DriverError(out(r) || `bb test-machines ${args[0]} failed (${r.code})`);
		return out(r);
	}

	async machines(): Promise<Machine[]> {
		const r = await this.bb(["status", "--json"], 30);
		if (r.code !== 0) throw new DriverError(out(r) || "bb test-machines status failed");
		const list = JSON.parse(r.stdout) as { id: string; name: string; kind: Kind; about: string }[];
		this.cache = list.map((m) => ({ id: m.id, name: m.name, kind: m.kind, about: m.about, driver: this }));
		return this.cache;
	}

	async status(m: Machine): Promise<string> {
		const r = await this.bb(["status", m.id, "--json"], 30);
		const [s] = JSON.parse(r.stdout || "[]") as { summary: string }[];
		return s ? `bb: ${s.summary}` : "";
	}

	async capture(m: Machine): Promise<Shot> {
		const path = (await this.ok(["capture", m.id, "--wait", "0"], 120)).split("\n").filter(Boolean).pop() ?? "";
		const data = await fs.readBytes(path);
		return { data, mimeType: /\.png$/i.test(path) ? "image/png" : "image/jpeg", path };
	}

	drive(m: Machine, steps: string[]) {
		return this.ok(["drive", m.id, "--wait", "0", "--", ...steps], 120);
	}

	async run(m: Machine, command: string, o: { timeoutS: number; exclusive: boolean }): Promise<Ran> {
		const r = await this.bb(["run", m.id, "--wait", "0", "--timeout", `${o.timeoutS}s`, ...(o.exclusive ? ["--exclusive"] : []), "--", command], o.timeoutS);
		return { code: r.code, output: out(r), timedOut: r.code === 124 };
	}

	app(m: Machine, action: string, target: string, o: { args: string[]; env: Record<string, string>; cwd?: string }) {
		const env = Object.entries(o.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
		return this.ok(["app", m.id, action, target, "--wait", "0", ...env, ...(o.cwd ? ["--cwd", o.cwd] : []), "--", ...o.args], 300);
	}

	put(m: Machine, locals: string[], remote: string) {
		return this.ok(["put", m.id, "--wait", "0", "--", ...locals, remote], 600);
	}

	get(m: Machine, remote: string, local: string) {
		return this.ok(["get", m.id, remote, local, "--wait", "0"], 600);
	}

	power(m: Machine, action: string) {
		return this.ok(["power", m.id, action, "--wait", "0"], 300);
	}

	private recordedSince = 0;

	async recordStart(m: Machine, o: { title: string }) {
		this.recordedSince = Date.now();
		await this.ok(["record", m.id, "start", "--wait", "0", ...(o.title ? ["--title", o.title] : [])], 120);
	}

	async recordStop(m: Machine): Promise<Recording> {
		await this.ok(["record", m.id, "stop", "--wait", "0"], 300);
		// bb keeps it among its media, where the plugin reads: the newest since the start.
		const dir = "~/.cache/test-machines/media";
		const files = (await fs.list(dir)).filter((f) => !f.dir && /\.(mp4|mov|webm)$/i.test(f.name) && Date.parse(f.modified) >= this.recordedSince - 5000);
		files.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
		const f = files[0];
		if (!f) throw new DriverError("bb stopped the recording, and its video isn't among bb's media.");
		return { data: await fs.readBytes(`${dir}/${f.name}`), ext: f.name.split(".").pop()!.toLowerCase() };
	}

	async released(m: Machine): Promise<void> {
		// What bb holds for this thread of bb's, given back with Swarm's.
		await this.bb(["release", m.id], 30).catch(() => {});
	}

	steps(kind: Kind): string {
		switch (kind) {
			case "mac":
				return "cliclick steps in screenshot pixels: c:X,Y click, dc:X,Y double, rc:X,Y right, m:X,Y move, t:TEXT type, kp:return|esc|tab|delete|arrow-down… a key, kd:cmd then t:m then ku:cmd for a chord, w:MS wait";
			case "windows":
				return "winvm drive steps in screenshot pixels: click X Y, dclick X Y, rclick X Y, move X Y, drag X1 Y1 X2 Y2, wheel N, sleep MS, keys SENDKEYS (^ Ctrl, % Alt, + Shift, {ENTER}), type TEXT";
			case "linux":
				return "lindrive steps in screenshot pixels: click X Y, rclick X Y, dclick X Y, move X Y, scroll N, key ctrl+shift+m, type TEXT, wait MS";
			case "android":
			case "ios":
				return "phone steps in screenshot pixels: tap X Y, long X Y [MS], swipe X1 Y1 X2 Y2 [MS], type TEXT, key NAME, wait MS";
		}
		return "";
	}
}

// ---- ssh ----

/** Quotes text for a POSIX shell. */
export const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

export class SSH implements Driver {
	readonly name = "ssh";

	async machines(): Promise<Machine[]> {
		const spec = String(settings.get("ssh") ?? "");
		const out: Machine[] = [];
		for (const part of spec.split(/[,;\n]/)) {
			const [id, kind, target] = part.trim().split(":").map((s) => s.trim());
			if (!id || !kind || !target) continue;
			out.push({ id, name: id, kind: kind as Kind, about: `${target}, over ssh.`, driver: this });
		}
		return out;
	}

	private target(m: Machine) {
		return m.about.split(",")[0]!;
	}

	private ssh(m: Machine, command: string, timeoutS = 120) {
		return process.run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", this.target(m), command], { timeout: timeoutS * 1000 });
	}

	async status(m: Machine): Promise<string> {
		const r = await this.ssh(m, "true", 20);
		return r.code === 0 ? "ssh: reachable" : `ssh: unreachable (${out(r)})`;
	}

	async capture(m: Machine): Promise<Shot> {
		let cmd: string;
		switch (m.kind) {
			case "mac":
				cmd = "f=$(mktemp -t swarm-shot).jpg && screencapture -x -t jpg \"$f\" && base64 < \"$f\" && rm -f \"$f\"";
				break;
			case "linux":
				cmd = "f=$(mktemp --suffix .png) && (grim \"$f\" 2>/dev/null || gnome-screenshot -f \"$f\") && base64 -w0 < \"$f\" && rm -f \"$f\"";
				break;
			default:
				throw new DriverError(`The ssh driver takes no screenshots of a ${m.kind} machine: use the bb driver.`);
		}
		const r = await this.ssh(m, cmd);
		if (r.code !== 0) throw new DriverError(out(r) || "the screenshot failed");
		const bin = atob(r.stdout.replace(/\s+/g, ""));
		const data = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
		return { data, mimeType: m.kind === "mac" ? "image/jpeg" : "image/png" };
	}

	async drive(m: Machine, steps: string[]): Promise<string> {
		if (m.kind !== "mac") throw new DriverError(`The ssh driver drives only a Mac's screen (cliclick): use the bb driver for ${m.kind}.`);
		const r = await this.ssh(m, "cliclick -w 60 " + steps.map(sh).join(" "));
		if (r.code !== 0) throw new DriverError(out(r));
		return out(r);
	}

	async run(m: Machine, command: string, o: { timeoutS: number }): Promise<Ran> {
		const r = await this.ssh(m, command, o.timeoutS);
		return { code: r.code, output: out(r), timedOut: !!r.timedOut };
	}

	async app(m: Machine, action: string, target: string, o: { args: string[] }): Promise<string> {
		if (m.kind === "mac" && action === "launch") return out(await this.ssh(m, `open -a ${sh(target)}${o.args.length ? " --args " + o.args.map(sh).join(" ") : ""}`));
		if (m.kind === "mac" && action === "focus") return out(await this.ssh(m, `osascript -e ${sh(`tell application "${target}" to activate`)}`));
		throw new DriverError(`The ssh driver can't ${action} apps on a ${m.kind} machine: use the bb driver.`);
	}

	async put(m: Machine, locals: string[], remote: string): Promise<string> {
		const r = await process.run("scp", ["-o", "BatchMode=yes", "--", ...locals, `${this.target(m)}:${remote}`], { timeout: 600_000 });
		if (r.code !== 0) throw new DriverError(out(r));
		return `Copied ${locals.length} file(s) to ${remote}.`;
	}

	async get(m: Machine, remote: string, local: string): Promise<string> {
		const r = await process.run("scp", ["-o", "BatchMode=yes", "--", `${this.target(m)}:${remote}`, local], { timeout: 600_000 });
		if (r.code !== 0) throw new DriverError(out(r));
		return `Copied ${remote} to ${local}.`;
	}

	async power(m: Machine): Promise<string> {
		throw new DriverError(`The ssh driver has no power for ${m.name}.`);
	}

	async frontmost(m: Machine): Promise<App | null> {
		if (m.kind !== "mac") return null;
		const script = 'tell application "System Events" to tell (first application process whose frontmost is true) to return name & linefeed & bundle identifier';
		const r = await this.ssh(m, `osascript -e ${sh(script)}`, 20);
		if (r.code !== 0) throw new DriverError(`can't tell which app is in front on ${m.name}: ${out(r)}`);
		const [name = "", id = ""] = r.stdout.trim().split("\n");
		return { name, id };
	}

	async leave(m: Machine): Promise<void> {
		if (m.kind !== "mac") return;
		await this.ssh(m, `osascript -e ${sh('tell application "System Events" to set visible of (first application process whose frontmost is true) to false')}`, 20);
	}

	async released() {}

	async doctor(): Promise<Check[]> {
		const checks: Check[] = [];
		for (const m of await this.machines()) {
			const s = await this.status(m);
			checks.push({ what: `${m.name} over ssh`, ok: s.endsWith("reachable"), detail: s.replace(/^ssh: /, "") });
		}
		return checks;
	}

	steps(kind: Kind): string {
		return kind === "mac" ? "cliclick steps in screenshot pixels: c:X,Y click, dc:X,Y, rc:X,Y, m:X,Y, t:TEXT, kp:KEY, w:MS" : "";
	}
}

// ---- adb ----

/** A device as `adb devices -l` lists it. */
interface Device {
	serial: string;
	model: string;
}

/**
 * Android phones and emulators through adb: on this machine, or over ssh
 * on the one they're plugged into (the adbHost setting). A phone's id is
 * the name the phones setting gives its serial (pixel:SERIAL), else its
 * serial.
 */
export class ADB implements Driver {
	readonly name = "adb";
	private serials = new Map<string, string>();

	private host = () => String(settings.get("adbHost") ?? "").trim();

	/** Runs a program where the phones are plugged in: adb, or what reads a build. */
	private async exec(program: string, args: string[], timeoutS = 60) {
		return runAt(await whereOf(this.host()), program, args, { timeout: timeoutS * 1000 });
	}

	private async adb(m: Machine, args: string[], timeoutS = 60) {
		return this.exec("adb", ["-s", this.serial(m), ...args], timeoutS);
	}

	/** adb shell, as one command line on the phone. */
	private async shell(m: Machine, line: string, timeoutS = 60): Promise<string> {
		const r = await this.adb(m, ["shell", line], timeoutS);
		if (r.code !== 0) throw new DriverError(out(r) || `adb shell failed (${r.code})`);
		return r.stdout;
	}

	private serial(m: Machine) {
		return this.serials.get(m.id) ?? m.id;
	}

	private names(): Map<string, string> {
		const names = new Map<string, string>();
		for (const part of String(settings.get("phones") ?? "").split(/[,;\n]/)) {
			// On the first colon alone: a wireless phone's is host:port.
			const at = part.indexOf(":");
			const id = part.slice(0, at).trim(), serial = part.slice(at + 1).trim();
			if (at > 0 && id && serial) names.set(serial, id);
		}
		return names;
	}

	/** Each transport's phone, by its own serial (ro.serialno): a wireless one's address changes, its serial doesn't. */
	private hardware = new Map<string, string>();

	async machines(): Promise<Machine[]> {
		const r = await this.exec("adb", ["devices", "-l"], 30);
		if (r.code !== 0) throw new DriverError(out(r) || "adb devices failed");
		const names = this.names();
		const host = await whereOf(this.host());
		const where = this.host() ? `, plugged into ${host.label}` : "";
		// Swarm's window shows a phone on one of its machines (scrcpy's, by its serial): not one over ssh.
		const screenOf = (serial: string) => (host.ssh ? undefined : `swarm://screen/${encodeURIComponent(host.machine ?? "server")}?phone=${encodeURIComponent(serial)}`);
		const serials = new Map<string, string>();
		const found: Machine[] = [];
		// USB first: a phone on both is one machine, by its cable.
		const seen = new Set<string>();
		// The phones the user stopped using, by either serial: adb lists every one plugged in.
		const skipped = new Set(String(settings.get("skipPhones") ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean));
		const devices = parseDevices(r.stdout).filter((d) => !skipped.has(d.serial)).sort((a, b) => Number(a.serial.includes(":")) - Number(b.serial.includes(":")));
		for (const d of devices) {
			let hw = this.hardware.get(d.serial);
			if (!hw) {
				const g = await this.exec("adb", ["-s", d.serial, "shell", "getprop ro.serialno"], 20).catch(() => null);
				hw = g?.code === 0 ? g.stdout.trim() : "";
				if (hw) this.hardware.set(d.serial, hw);
			}
			// The setting's name for either serial; else the phone's own serial, the transport's for an emulator.
			const id = names.get(d.serial) ?? (hw ? names.get(hw) : undefined) ?? (d.serial.includes(":") && hw ? hw : d.serial);
			if (serials.has(id) || (hw && seen.has(hw)) || (hw && skipped.has(hw))) continue;
			if (hw) seen.add(hw);
			serials.set(id, d.serial);
			const model = d.model.replace(/_/g, " ");
			found.push({ id, name: model || id, kind: "android", about: `Android, ${d.serial}${where}, through adb.`, driver: this, screen: screenOf(d.serial) });
		}
		this.serials = serials;
		return found;
	}

	async status(m: Machine): Promise<string> {
		const s = await this.shell(m, "dumpsys power | grep -m1 mWakefulness=; dumpsys battery | grep -m1 level:; dumpsys window | grep -m1 -E 'mDreamingLockscreen=|isKeyguardShowing=|mShowingLockscreen='", 20);
		const awake = /mWakefulness=(\w+)/.exec(s)?.[1] ?? "?";
		const battery = /level:\s*(\d+)/.exec(s)?.[1];
		const locked = /(mDreamingLockscreen|isKeyguardShowing|mShowingLockscreen)=true/.test(s);
		return `adb: ${awake.toLowerCase()}${battery ? `, battery ${battery}%` : ""}${locked ? ", locked (the user unlocks it)" : ""}`;
	}

	/** Turns the screen on before an action, as a finger would. */
	/** The phones whose screens the plugin turned on, and when each goes off again. */
	private woke = new Set<string>();
	private sleepers = new Map<string, number>();

	/** Turns the screen on before an action, as a finger would; one the plugin turned on goes off 90 s after its last. */
	private async wake(m: Machine) {
		this.woken(m, await this.shell(m, WAKE_SH, 20).catch(() => ""));
	}

	/** What WAKE_SH said: a screen it turned on goes off 90 s after the plugin's last action there. */
	private woken(m: Machine, said: string) {
		if (/^WOKE$/m.test(said)) this.woke.add(m.id);
		clearTimeout(this.sleepers.get(m.id));
		this.sleepers.set(m.id, setTimeout(() => void this.sleepAgain(m), 90_000));
	}

	/** The screen off again, where the plugin turned it on: none the user had on. */
	private async sleepAgain(m: Machine) {
		clearTimeout(this.sleepers.get(m.id));
		if (this.woke.delete(m.id)) await this.shell(m, "input keyevent KEYCODE_SLEEP", 20).catch(() => "");
	}

	/** Reaches a phone over wireless debugging (its port is new each time it's turned on), pairing it first with its code. */
	async connect(addr: string, pair?: { addr: string; code: string }): Promise<string> {
		const said: string[] = [];
		if (pair) {
			const r = await this.exec("adb", ["pair", pair.addr, pair.code], 60);
			if (r.code !== 0 || !/Successfully paired/i.test(r.stdout)) throw new DriverError(out(r) || "pairing failed");
			said.push(out(r));
		}
		const r = await this.exec("adb", ["connect", addr], 60);
		if (r.code !== 0 || /failed|cannot|unable/i.test(r.stdout)) throw new DriverError(out(r) || "connecting failed");
		said.push(out(r));
		return said.join("\n");
	}

	async capture(m: Machine): Promise<Shot> {
		// One call: the wake, then the screenshot, which the phone encodes (what a process prints here is text):
		// a JPEG where its screencap makes one (Android 14 on), half a PNG's bytes and time at the same pixels.
		const said = await this.shell(m, `${WAKE_SH}; f=/data/local/tmp/swarm-shot.jpg; if screencap -j $f 2>/dev/null && [ -s $f ]; then echo JPEG; base64 $f; rm -f $f; else echo PNG; screencap -p | base64; fi`, 60);
		this.woken(m, said);
		const at = said.search(/^(JPEG|PNG)$/m);
		const data = unbase64(at < 0 ? "" : said.slice(said.indexOf("\n", at) + 1));
		const jpeg = data[0] === 0xff && data[1] === 0xd8;
		if (data.length < 8 || (!jpeg && data[0] !== 0x89)) throw new DriverError(`the screenshot of ${m.name} came back empty: is its screen locked or protected?`);
		return { data, mimeType: jpeg ? "image/jpeg" : "image/png" };
	}

	async drive(m: Machine, steps: string[]): Promise<string> {
		await this.wake(m);
		const done: string[] = [];
		for (const step of steps) {
			const line = adbStep(step);
			await this.shell(m, line, 60);
			done.push(step);
		}
		return done.length ? `did ${done.length} step(s)` : "";
	}

	async run(m: Machine, command: string, o: { timeoutS: number }): Promise<Ran> {
		const r = await this.adb(m, ["shell", command], o.timeoutS);
		return { code: r.code, output: out(r), timedOut: !!r.timedOut };
	}

	private launched = new Set<string>();

	async app(m: Machine, action: string, target: string, o: { args: string[] }): Promise<string> {
		const pkg = target.trim();
		switch (action) {
			case "launch":
			case "focus": {
				await this.wake(m);
				if (!/^[\w.]+$/.test(pkg)) throw new DriverError(`launch takes a package name, as com.example.app: not ${target}`);
				const said = await this.shell(m, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, 60);
				if (/No activities found|aborted/i.test(said)) throw new DriverError(`${pkg} has nothing to launch on ${m.name}: is it installed?`);
				if (action === "launch") this.launched.add(pkg);
				return `${action === "launch" ? "Launched" : "Brought forward"} ${pkg}.`;
			}
			case "kill":
				if (!this.launched.has(pkg)) throw new DriverError(`You didn't launch ${pkg}: only what you launched is stopped.`);
				await this.shell(m, `am force-stop ${pkg}`);
				this.launched.delete(pkg);
				return `Stopped ${pkg}.`;
			case "install": {
				const r = await this.adb(m, ["install", "-r", ...o.args, target], 300);
				if (r.code !== 0 || !/Success/.test(r.stdout)) throw new DriverError(out(r) || "the install failed");
				return `Installed ${target}.`;
			}
			case "uninstall": {
				const r = await this.adb(m, ["uninstall", pkg], 120);
				if (r.code !== 0 || !/Success/.test(r.stdout)) throw new DriverError(out(r) || "the uninstall failed");
				return `Uninstalled ${pkg}.`;
			}
			case "logs": {
				if (!/^[\w.]+$/.test(pkg)) throw new DriverError(`logs takes a package name, as com.example.app: not ${target}`);
				const said = await this.shell(m, `pid=$(pidof ${pkg}); if [ -n "$pid" ]; then logcat -d -t 500 --pid="$pid"; else echo "${pkg} isn't running: launch it first."; fi`, 60);
				return said.trim() || `Nothing logged by ${pkg} yet.`;
			}
		}
		throw new DriverError(`adb can't ${action} an app.`);
	}

	async put(m: Machine, locals: string[], remote: string): Promise<string> {
		if (this.host()) throw new DriverError(`The phones are plugged into ${(await whereOf(this.host())).label}: copy the files there first, then push them with swarm test-machines adb ${m.id} -- push.`);
		const r = await this.adb(m, ["push", ...locals, remote], 600);
		if (r.code !== 0) throw new DriverError(out(r));
		return out(r);
	}

	async get(m: Machine, remote: string, local: string): Promise<string> {
		if (this.host()) throw new DriverError(`The phones are plugged into ${(await whereOf(this.host())).label}: pull with swarm test-machines adb ${m.id} -- pull, then copy the file from there.`);
		const r = await this.adb(m, ["pull", remote, local], 600);
		if (r.code !== 0) throw new DriverError(out(r));
		return out(r);
	}

	async power(m: Machine, action: string): Promise<string> {
		switch (action) {
			case "status":
				return this.status(m);
			case "on":
			case "wake":
				await this.wake(m);
				return `${m.name}'s screen is on.`;
			case "off":
			case "sleep":
				await this.shell(m, "input keyevent KEYCODE_SLEEP");
				return `${m.name}'s screen is off.`;
		}
		throw new DriverError(`adb's power: status, wake or sleep, not ${action}.`);
	}

	async released(m: Machine) {
		await this.sleepAgain(m);
	}

	async describe(m: Machine): Promise<Element[]> {
		await this.wake(m);
		const xml = await this.shell(m, "uiautomator dump /sdcard/swarm-ui.xml >/dev/null && cat /sdcard/swarm-ui.xml; rm -f /sdcard/swarm-ui.xml", 60);
		return parseUiAutomator(xml);
	}

	async doctor(): Promise<Check[]> {
		const w = await whereOf(this.host());
		const v = await this.exec("adb", ["version"], 20).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
		const checks: Check[] = [{ what: `adb on ${w.label}`, ok: v.code === 0, detail: v.code === 0 ? v.stdout.split("\n")[0]!.trim() : out(v) || "not found: install Android's platform-tools there" }];
		if (v.code !== 0) return checks;
		const d = await this.exec("adb", ["devices", "-l"], 20);
		const list = parseDevices(d.stdout);
		checks.push({ what: "Android phones", ok: list.length > 0, detail: list.length ? list.map((x) => x.model.replace(/_/g, " ") || x.serial).join(", ") : "none plugged in, or none allowed USB debugging" });
		const unauthorized = (d.stdout.match(/\sunauthorized\b/g) ?? []).length;
		if (unauthorized) checks.push({ what: "USB debugging", ok: false, detail: `${unauthorized} phone(s) wait for "Allow USB debugging" on their screen` });
		const a = await this.exec("aapt2", ["version"], 20).catch(() => ({ code: 1, stdout: "", stderr: "" }));
		checks.push({ what: "aapt2", ok: a.code === 0, detail: a.code === 0 ? "reads a build's package, for test builds on a phone you carry" : "not on the PATH there: installs on a phone you carry wait for the user (Android's build-tools)" });
		return checks;
	}

	async raw(m: Machine, args: string[]) {
		const r = await this.adb(m, args, 600);
		return { code: r.code, output: out(r) };
	}

	async recordStart(m: Machine, o: { seconds: number }) {
		await this.wake(m);
		await this.shell(m, `rm -f ${REC_FILE}`, 20).catch(() => "");
		// On the phone, in the background: adb's shell returns, wherever adb runs.
		await this.shell(m, `nohup screenrecord --time-limit ${Math.max(1, Math.min(180, Math.round(o.seconds)))} --bit-rate 2000000 ${REC_FILE} >/dev/null 2>&1 &`, 20);
		// Started once the file's there.
		for (let i = 0; i < 30; i++) {
			if ((await this.shell(m, `[ -e ${REC_FILE} ] && echo yes || true`, 10)).includes("yes")) return;
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	async recordStop(m: Machine): Promise<Recording> {
		// SIGINT: screenrecord finishes the file as it ends.
		await this.shell(m, "pkill -INT screenrecord || true", 20);
		for (let i = 0; i < 50; i++) {
			if (!(await this.shell(m, "pidof screenrecord || true", 10)).trim()) break;
			await new Promise((r) => setTimeout(r, 200));
		}
		// In pieces, as base64: what a process prints here is text, 16 MB at most.
		const parts: Uint8Array[] = [];
		for (let k = 0; ; k += 6) {
			const text = await this.shell(m, `dd if=${REC_FILE} bs=1048576 skip=${k} count=6 2>/dev/null | base64`, 120);
			const part = unbase64(text);
			if (!part.length) break;
			parts.push(part);
			if (part.length < 6 * 1048576) break;
		}
		await this.shell(m, `rm -f ${REC_FILE}`, 20).catch(() => "");
		const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let at = 0;
		for (const p of parts) data.set(p, (at += p.length) - p.length);
		if (!data.length) throw new DriverError(`${m.name} recorded nothing: its screen may be protected, or off.`);
		return { data, ext: "mp4" };
	}

	steps(): string {
		return ADB_STEPS;
	}

	async frontmost(m: Machine): Promise<App | null> {
		const s = await this.shell(m, "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'", 20);
		const pkg = focusedPackage(s);
		return pkg ? { name: pkg, id: pkg } : null;
	}

	async leave(m: Machine): Promise<void> {
		await this.shell(m, "input keyevent KEYCODE_HOME", 20);
	}

	async packageOf(_m: Machine, file: string): Promise<string> {
		// aapt2, from Android's build-tools, on the PATH where the phones are.
		const r = await this.exec("aapt2", ["dump", "packagename", file], 60);
		const pkg = r.stdout.trim().split("\n").pop()?.trim() ?? "";
		if (r.code !== 0 || !/^[\w.]+$/.test(pkg)) throw new DriverError(out(r) || "aapt2 can't read it");
		return pkg;
	}
}

const REC_FILE = "/sdcard/swarm-test-machines.mp4";

export const ADB_STEPS = "phone steps in screenshot pixels: tap X Y, long X Y [MS], swipe X1 Y1 X2 Y2 [MS], type TEXT, key NAME (home, back, enter, …), wait MS";

/** The devices `adb devices -l` lists as ready. */
export function parseDevices(text: string): Device[] {
	const out: Device[] = [];
	for (const line of text.split("\n")) {
		const m = /^(\S+)\s+device\b(.*)$/.exec(line.trim());
		if (!m) continue;
		out.push({ serial: m[1]!, model: /model:(\S+)/.exec(m[2]!)?.[1] ?? "" });
	}
	return out;
}

/** The package in front, from dumpsys window's focus lines. */
export function focusedPackage(text: string): string {
	const focus = /mCurrentFocus=Window\{\S+ \S+ ([\w.]+)\//.exec(text) ?? /mFocusedApp=\S*\{?.*? ([\w.]+)\/[\w.$]+/.exec(text);
	return focus?.[1] ?? "";
}

/** A step, as a command line of the phone's shell. */
export function adbStep(step: string): string {
	const [op = "", ...rest] = step.trim().split(/\s+/);
	const n = rest.map(Number);
	const ints = (k: number) => {
		if (rest.length < k || n.slice(0, k).some((v) => !Number.isFinite(v))) throw new DriverError(`${op} takes ${k} numbers: ${step}`);
		return n.slice(0, k).map(Math.round);
	};
	switch (op) {
		case "tap":
			return `input tap ${ints(2).join(" ")}`;
		case "long": {
			const [x, y] = ints(2);
			return `input swipe ${x} ${y} ${x} ${y} ${Math.round(n[2] || 800)}`;
		}
		case "swipe":
			return `input swipe ${ints(4).join(" ")} ${Math.round(n[4] || 300)}`;
		case "type": {
			// input text takes %s for a space; the rest as the shell quotes it.
			const text = step.trim().slice(4).trimStart();
			return `input text ${sh(text.replace(/%/g, "\\%").replace(/ /g, "%s"))}`;
		}
		case "key": {
			const name = (rest[0] ?? "").toUpperCase().replace(/^KEYCODE_/, "");
			if (!/^\w+$/.test(name)) throw new DriverError(`key takes a name, as home or back: ${step}`);
			return `input keyevent KEYCODE_${name}`;
		}
		case "wait":
			return `sleep ${Math.min(Math.max(n[0] || 0, 0), 10_000) / 1000}`;
	}
	throw new DriverError(`no step ${op}: ${ADB_STEPS}`);
}

/**
 * Turns an Android phone's screen on where it's off, as a finger would, and
 * waits for it to draw: asleep or dozing, a wake key (and WOKE, so the plugin
 * turns it off again); awake with the panel off, which Android 17 leaves with
 * Stay awake on (Developer options) at the screen timeout and where a wake
 * key does nothing, a sleep and a wake.
 */
const WAKE_SH = [
	"s=$(dumpsys power | grep -m1 mWakefulness=; dumpsys SurfaceFlinger 2>/dev/null | grep -m1 -o 'powerMode=[A-Za-z]*')",
	"w=",
	'case "$s" in *Asleep*|*Dozing*) input keyevent KEYCODE_WAKEUP; echo WOKE; w=1;; *powerMode=Off*) input keyevent KEYCODE_SLEEP; sleep 0.5; input keyevent KEYCODE_WAKEUP; w=1;; esac',
	// The panel on, then past the wake's fade in.
	'if [ -n "$w" ]; then for i in 1 2 3 4 5 6 7 8 9 10; do dumpsys SurfaceFlinger 2>/dev/null | grep -m1 -q powerMode=On && break; sleep 0.2; done; sleep 0.8; fi',
].join("; ");

function unbase64(text: string): Uint8Array {
	const bin = atob(text.replace(/\s+/g, ""));
	const data = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
	return data;
}

// ---- WebDriverAgent ----

/**
 * iPhones and iPads through WebDriverAgent, which the user runs for each
 * (xcodebuild test-without-building, or Appium's): its address in the
 * iphones setting, as iphone:http://mac.local:8100. Through curl: no
 * network grant beyond the programs'. Installs and uninstalls go
 * through devicectl on the Mac the phone is plugged into, over ssh
 * (iosHost), by the phone's UDID (iphone:URL@UDID).
 */
export class WDA implements Driver {
	readonly name = "wda";
	private sessions = new Map<string, string>();
	/** Screenshot pixels per WebDriverAgent point. */
	private scales = new Map<string, number>();
	private launched = new Set<string>();

	/** The iPhones the settings name: id:UDID (the plugin runs WebDriverAgent), or id:URL[@UDID] (you do). */
	private phones(): Map<string, { url: string; udid: string }> {
		const out = new Map<string, { url: string; udid: string }>();
		for (const part of String(settings.get("iphones") ?? "").split(/[,;\n\s]+/)) {
			const m = /^([^:]+):(https?:\/\/[^@\s]+?)\/?(?:@([\w-]+))?$/.exec(part.trim());
			if (m) out.set(m[1]!, { url: m[2]!, udid: m[3] ?? "" });
			const u = /^([^:]+):([0-9A-Fa-f-]{20,})$/.exec(part.trim());
			if (u) out.set(u[1]!, { url: "", udid: u[2]! });
		}
		return out;
	}

	/** WebDriverAgent's address for a phone of the plugin's, asked again when it stops answering. */
	private urls = new Map<string, string>();

	/** The Mac the iPhones are plugged into, which runs WebDriverAgent for those of the plugin's. */
	private async mac() {
		const host = String(settings.get("iosHost") ?? "").trim();
		// Swarm on the Mac itself: this one.
		if (!host && process.platform !== "darwin") throw new DriverError("Name the Mac the iPhones are plugged into, in Settings, Plugins, Test machines.");
		return whereOf(host);
	}

	/** Where WebDriverAgent's built for the phones: on that Mac, kept across restarts. */
	private static readonly BUILD = "$HOME/Library/Caches/swarm-test-machines/wda";

	/** WebDriverAgent's address: the setting's, or the phone's own (its tunnel from the Mac), started where it's not answering. */
	private async url(m: Machine): Promise<string> {
		const p = this.phone(m);
		if (p.url) return p.url;
		const known = this.urls.get(m.id);
		if (known) return known;
		const w = await this.mac();
		const info = await runAt(w, "sh", ["-c", 'f=$(mktemp); xcrun devicectl device info details --device "$1" --json-output "$f" >/dev/null 2>&1; cat "$f"; rm -f "$f"', "sh", p.udid], { timeout: 60_000 });
		let ip = "";
		try {
			const cp = JSON.parse(info.stdout).result?.connectionProperties ?? {};
			if (cp.tunnelState !== "connected") throw new Error(`${m.name} isn't connected to ${w.label} (${cp.tunnelState ?? "not found"}): plug it in and unlock it`);
			ip = String(cp.tunnelIPAddress ?? "");
		} catch (e) {
			throw new DriverError(e instanceof Error && !(e instanceof SyntaxError) ? e.message : `devicectl on ${w.label} doesn't know ${m.name} (${p.udid}): ${out(info)}`);
		}
		const url = `http://[${ip}]:8100`;
		const up = async () => (await runAt(w, "curl", ["-s", "-g", "--max-time", "5", url + "/status"], { timeout: 15_000 })).stdout.includes('"ready"');
		if (!(await up())) {
			// Started from its build, in the background on the Mac, until the phone or the Mac restarts.
			const start = await runAt(w, "sh", ["-c", `x=$(ls ${WDA.BUILD}/Build/Products/*.xctestrun 2>/dev/null | head -1); [ -n "$x" ] || { echo "WebDriverAgent isn't built on this Mac: swarm test-machines setup-iphone"; exit 3; }; nohup xcrun xcodebuild test-without-building -xctestrun "$x" -destination "id=$1" < /dev/null > ${WDA.BUILD}/run-$1.log 2>&1 & echo started`, "sh", p.udid], { timeout: 30_000 });
			if (start.code !== 0) throw new DriverError(out(start) || "WebDriverAgent didn't start");
			let ok = false;
			for (let i = 0; i < 40 && !ok; i++) {
				await new Promise((r) => setTimeout(r, 2000));
				ok = await up();
			}
			if (!ok) throw new DriverError(`WebDriverAgent didn't answer on ${m.name} within 80 s: is the phone unlocked, and does it trust the developer (Settings, General, VPN & Device Management)? The log is ${WDA.BUILD}/run-${p.udid}.log on ${w.label}.`);
		}
		this.urls.set(m.id, url);
		return url;
	}

	/** Whether WebDriverAgent's built on the Mac, for the plugin to start on the phones. */
	async built(): Promise<boolean> {
		const r = await runAt(await this.mac(), "sh", ["-c", `ls ${WDA.BUILD}/Build/Products/*.xctestrun >/dev/null 2>&1`], { timeout: 20_000 });
		return r.code === 0;
	}

	/** The Apple developer teams the Mac's signing certificates are of: the Team ID WebDriverAgent's signed for, and the team's name. */
	async teams(): Promise<{ id: string; name: string }[]> {
		const script = `security find-identity -v -p codesigning | sed -n 's/.*"\\(Apple Development[^"]*\\)".*/\\1/p' | sort -u | while IFS= read -r n; do security find-certificate -c "$n" -p | openssl x509 -noout -subject; done`;
		const r = await runAt(await this.mac(), "sh", ["-c", script], { timeout: 30_000 });
		return parseTeams(r.stdout);
	}

	/** Builds WebDriverAgent on the Mac, signed with the user's team, for the plugin to start on the phones. */
	async setup(team: string, onLine: (s: string) => void): Promise<string> {
		if (!/^[A-Z0-9]{10}$/.test(team)) throw new DriverError("Give your Apple developer Team ID (ten letters and digits, in Xcode's Signing & Capabilities or developer.apple.com, Membership).");
		const w = await this.mac();
		onLine(`Building WebDriverAgent on ${w.label}, signed for team ${team}: a few minutes the first time.`);
		const script = [
			`set -e; mkdir -p ${WDA.BUILD}; cd ${WDA.BUILD}`,
			`[ -d src/.git ] || git clone -q --depth 1 https://github.com/appium/WebDriverAgent src`,
			`xcrun xcodebuild build-for-testing -project src/WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination generic/platform=iOS -derivedDataPath ${WDA.BUILD} -allowProvisioningUpdates DEVELOPMENT_TEAM="$1" CODE_SIGN_STYLE=Automatic PRODUCT_BUNDLE_IDENTIFIER="swarm.wda.$(echo "$1" | tr A-Z a-z)" > build.log 2>&1 || { tail -30 build.log; exit 1; }`,
			`ls Build/Products/*.xctestrun`,
		].join("\n");
		const r = await runAt(w, "sh", ["-c", script, "sh", team], { timeout: 600_000 });
		if (r.code !== 0) throw new DriverError(`The build failed:\n${out(r)}`);
		this.urls.clear();
		return `WebDriverAgent is built on ${w.label}. The plugin starts it on each iPhone as an agent first uses it; the first time, the phone asks to trust the developer (Settings, General, VPN & Device Management).`;
	}

	private phone(m: Machine) {
		const p = this.phones().get(m.id);
		if (!p) throw new DriverError(`${m.id} is no longer in the iPhones setting.`);
		return p;
	}

	private async http(m: Machine, method: "GET" | "POST" | "DELETE", path: string, body?: unknown, timeoutS = 60): Promise<any> {
		const args = ["-sS", "-g", "--max-time", String(timeoutS), "-X", method, "-H", "Content-Type: application/json"];
		if (body !== undefined) args.push("--data-binary", "@-");
		args.push((await this.url(m)) + path);
		// From the Mac the phone is plugged into: the phone's tunnel is that Mac's alone, and a
		// WebDriverAgent the user runs listens there too where it's one of Swarm's.
		const w = await whereOf(String(settings.get("iosHost") ?? "").trim());
		const r = await (w.machine || w.ssh || !this.phone(m).url ? runAt(w, "curl", args, { input: body === undefined ? undefined : JSON.stringify(body), timeout: (timeoutS + 5) * 1000 }) : process.run("curl", args, { input: body === undefined ? undefined : JSON.stringify(body), timeout: (timeoutS + 5) * 1000 }));
		if (r.code !== 0) {
			this.urls.delete(m.id);
			throw new DriverError(`WebDriverAgent on ${m.name} isn't answering (${out(r) || `curl ${r.code}`}): ${this.phone(m).url ? "is it running?" : "it's started again on the next call."}`);
		}
		let j: any;
		try {
			j = JSON.parse(r.stdout);
		} catch {
			throw new DriverError(`WebDriverAgent answered what isn't JSON: ${r.stdout.slice(0, 200)}`);
		}
		const v = j?.value;
		if (v && typeof v === "object" && "error" in v) throw new DriverError(`WebDriverAgent: ${v.message || v.error}`);
		return v;
	}

	/** A session of WebDriverAgent's, which input and apps need; made again when it's gone. */
	private async session(m: Machine): Promise<string> {
		const have = this.sessions.get(m.id);
		if (have) return have;
		const v = await this.http(m, "POST", "/session", { capabilities: { alwaysMatch: {} } });
		const id = String(v?.sessionId ?? "");
		if (!id) throw new DriverError("WebDriverAgent made no session.");
		this.sessions.set(m.id, id);
		return id;
	}

	private async inSession(m: Machine, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
		try {
			return await this.http(m, method, `/session/${await this.session(m)}${path}`, body);
		} catch (e) {
			if (!(e instanceof DriverError) || !/session/i.test(e.message)) throw e;
			this.sessions.delete(m.id);
			return this.http(m, method, `/session/${await this.session(m)}${path}`, body);
		}
	}

	async machines(): Promise<Machine[]> {
		// Swarm's window shows an iPhone plugged into one of its Macs (its USB screen, by its UDID): not one over ssh.
		const host = String(settings.get("iosHost") ?? "").trim();
		const w = host || process.platform === "darwin" ? await whereOf(host) : undefined;
		const screenOf = (udid?: string) => (udid && w && !w.ssh ? `swarm://screen/${encodeURIComponent(w.machine ?? "server")}?iphone=${encodeURIComponent(udid)}` : undefined);
		return [...this.phones()].map(([id, p]) => ({ id, name: id, kind: "ios" as Kind, about: p.url ? `iOS, through WebDriverAgent at ${p.url}${p.udid ? ` (${p.udid})` : ""}.` : `iOS (${p.udid}), WebDriverAgent run by the plugin on the Mac it's plugged into.`, driver: this, screen: screenOf(p.udid) }));
	}

	async status(m: Machine): Promise<string> {
		const v = await this.http(m, "GET", "/status", undefined, 15);
		const locked = await this.http(m, "GET", "/wda/locked", undefined, 15).catch(() => undefined);
		const os = v?.os ? `iOS ${v.os.version ?? ""}`.trim() : "iOS";
		return `wda: ${v?.ready === false ? "not ready" : "ready"}, ${os}${locked === true ? ", locked" : ""}`;
	}

	async capture(m: Machine): Promise<Shot> {
		const b64 = await this.http(m, "GET", "/screenshot", undefined, 60);
		const data = unbase64(String(b64 ?? ""));
		if (data.length < 8) throw new DriverError(`the screenshot of ${m.name} came back empty.`);
		if (data[0] === 0x89) this.widths.set(m.id, [(data[16]! << 24) | (data[17]! << 16) | (data[18]! << 8) | data[19]!, (data[20]! << 24) | (data[21]! << 16) | (data[22]! << 8) | data[23]!]);
		return { data, mimeType: data[0] === 0x89 ? "image/png" : "image/jpeg" };
	}

	/** The last screenshot's size in pixels: width, height. */
	private widths = new Map<string, [number, number]>();

	/**
	 * Pixels per point: the screenshot's width over the window's, in
	 * points. WebDriverAgent's queries of the screen hang while a phone
	 * sleeps, so a shape's guess stands in: 3 for a phone, 2 for an iPad.
	 */
	private async scale(m: Machine): Promise<number> {
		const have = this.scales.get(m.id);
		if (have) return have;
		if (!this.widths.has(m.id)) await this.capture(m);
		const [w, h] = this.widths.get(m.id) ?? [0, 0];
		const sid = await this.session(m);
		const size = await this.http(m, "GET", `/session/${sid}/window/size`, undefined, 8).catch(() => null);
		const k = size?.width && w ? w / size.width : Math.max(w, h) / Math.min(w, h) > 1.9 ? 3 : 2;
		if (size?.width) this.scales.set(m.id, k);
		return k;
	}

	async drive(m: Machine, steps: string[]): Promise<string> {
		const k = await this.scale(m);
		const pt = (v: number) => Math.round((v / k) * 10) / 10;
		for (const step of steps) {
			const [op = "", ...rest] = step.trim().split(/\s+/);
			const n = rest.map(Number);
			const need = (c: number) => {
				if (n.length < c || n.slice(0, c).some((v) => !Number.isFinite(v))) throw new DriverError(`${op} takes ${c} numbers: ${step}`);
			};
			switch (op) {
				case "tap":
					need(2);
					await this.inSession(m, "POST", "/wda/tap", { x: pt(n[0]!), y: pt(n[1]!) });
					break;
				case "long":
					need(2);
					await this.inSession(m, "POST", "/wda/touchAndHold", { x: pt(n[0]!), y: pt(n[1]!), duration: (n[2] || 800) / 1000 });
					break;
				case "swipe":
					need(4);
					await this.inSession(m, "POST", "/wda/dragfromtoforduration", { fromX: pt(n[0]!), fromY: pt(n[1]!), toX: pt(n[2]!), toY: pt(n[3]!), duration: (n[4] || 300) / 1000 });
					break;
				case "type":
					await this.inSession(m, "POST", "/wda/keys", { value: [...step.trim().slice(4).trimStart()] });
					break;
				case "key": {
					const name = (rest[0] ?? "").toLowerCase();
					if (name === "home") await this.http(m, "POST", "/wda/homescreen");
					else if (name === "enter" || name === "return") await this.inSession(m, "POST", "/wda/keys", { value: ["\n"] });
					else if (name === "volumeup" || name === "volumedown") await this.inSession(m, "POST", "/wda/pressButton", { name: name === "volumeup" ? "volumeUp" : "volumeDown" });
					else throw new DriverError(`key on iOS: home, enter, volumeup or volumedown, not ${name}`);
					break;
				}
				case "wait":
					await new Promise((r) => setTimeout(r, Math.min(Math.max(n[0] || 0, 0), 10_000)));
					break;
				default:
					throw new DriverError(`no step ${op}: ${WDA_STEPS}`);
			}
		}
		return `did ${steps.length} step(s)`;
	}

	async run(m: Machine): Promise<Ran> {
		throw new DriverError(`${m.name} runs no commands: iOS has no shell. machine_app and machine_drive reach it.`);
	}

	/** devicectl on the Mac the phone is plugged into. */
	private async devicectl(m: Machine, args: string[], timeoutS = 300): Promise<string> {
		const host = String(settings.get("iosHost") ?? "").trim();
		const udid = this.phone(m).udid;
		if (!host || !udid) throw new DriverError(`Installs on ${m.name} need the Mac it's plugged into and its UDID (${m.id}:URL@UDID), in the settings.`);
		const r = await runAt(await whereOf(host), "xcrun", ["devicectl", "device", ...args, "--device", udid], { timeout: timeoutS * 1000 });
		if (r.code !== 0) throw new DriverError(out(r) || `devicectl failed (${r.code})`);
		return out(r);
	}

	async app(m: Machine, action: string, target: string): Promise<string> {
		const id = target.trim();
		switch (action) {
			case "launch":
			case "focus":
				await this.inSession(m, "POST", "/wda/apps/launch", { bundleId: id });
				if (action === "launch") this.launched.add(id);
				return `${action === "launch" ? "Launched" : "Brought forward"} ${id}.`;
			case "kill":
				if (!this.launched.has(id)) throw new DriverError(`You didn't launch ${id}: only what you launched is stopped.`);
				await this.inSession(m, "POST", "/wda/apps/terminate", { bundleId: id });
				this.launched.delete(id);
				return `Stopped ${id}.`;
			case "install":
				await this.devicectl(m, ["install", "app", target]);
				return `Installed ${target}.`;
			case "uninstall":
				await this.devicectl(m, ["uninstall", "app", id]);
				return `Uninstalled ${id}.`;
		}
		throw new DriverError(`WebDriverAgent can launch, focus, kill, install and uninstall, not ${action}.`);
	}

	async put(m: Machine): Promise<string> {
		throw new DriverError(`${m.name} takes no files this way: install an app with machine_app.`);
	}

	async get(m: Machine): Promise<string> {
		throw new DriverError(`${m.name} gives no files this way.`);
	}

	async power(m: Machine, action: string): Promise<string> {
		if (action === "status") return this.status(m);
		if (action === "off") {
			await this.http(m, "POST", "/wda/lock");
			return `${m.name} is locked.`;
		}
		throw new DriverError(`${m.name}'s power: status, or off to lock it. Unlocking is the user's.`);
	}

	async released() {}

	async describe(m: Machine): Promise<Element[]> {
		const k = await this.scale(m);
		const tree = await this.http(m, "GET", "/source?format=json", undefined, 90);
		const out: Element[] = [];
		const walk = (n: any) => {
			if (!n || out.length >= MAX_ELEMENTS) return;
			const label = String(n.label || n.name || n.value || "").trim();
			const r = n.rect;
			if (label && r && n.isVisible !== "0" && n.isVisible !== false && r.width > 0 && r.height > 0) {
				const role = String(n.type || "").replace(/^XCUIElementType/, "").toLowerCase();
				out.push({ role, label, x: r.x * k, y: r.y * k, w: r.width * k, h: r.height * k, action: /button|cell|link|switch|textfield|securetextfield|searchfield|tab|key|slider|picker/.test(role) || n.isEnabled === "1" && role !== "statictext" && role !== "other" });
			}
			for (const c of n.children ?? []) walk(c);
		};
		walk(tree);
		return out;
	}

	async doctor(): Promise<Check[]> {
		const checks: Check[] = [];
		const host = String(settings.get("iosHost") ?? "").trim();
		for (const m of await this.machines()) {
			try {
				checks.push({ what: `${m.name}'s WebDriverAgent`, ok: true, detail: await this.status(m) });
			} catch (e) {
				checks.push({ what: `${m.name}'s WebDriverAgent`, ok: false, detail: e instanceof Error ? e.message : String(e) });
			}
		}
		if (host) {
			const w = await whereOf(host);
			const r = await runAt(w, "xcrun", ["devicectl", "list", "devices"], { timeout: 30_000 }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
			checks.push({ what: `devicectl on ${w.label}`, ok: r.code === 0, detail: r.code === 0 ? "installs and uninstalls test builds" : "not there: Xcode 15 or later on that Mac" });
		}
		return checks;
	}

	steps(): string {
		return WDA_STEPS;
	}

	async frontmost(m: Machine): Promise<App | null> {
		// On the Home Screen WebDriverAgent waits out its own 15 s snapshot of SpringBoard (iOS 27) before it answers; an app's answers at once.
		const v = await this.http(m, "GET", "/wda/activeAppInfo", undefined, 30);
		const id = String(v?.bundleId ?? "");
		return id ? { name: String(v?.name ?? id), id } : null;
	}

	async leave(m: Machine): Promise<void> {
		await this.http(m, "POST", "/wda/homescreen", undefined, 15);
	}

	async packageOf(m: Machine, file: string): Promise<string> {
		// The Info.plist of the .app on the Mac it's installed from.
		const host = String(settings.get("iosHost") ?? "").trim();
		if (!host) throw new DriverError("no Mac to read it on");
		const r = await runAt(await whereOf(host), "sh", ["-c", `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1"`, "sh", file.replace(/\/+$/, "") + "/Info.plist"], { timeout: 30_000 });
		const id = r.stdout.trim();
		if (r.code !== 0 || !/^[\w.-]+$/.test(id)) throw new DriverError(out(r) || "can't read its bundle id");
		return id;
	}
}

export const WDA_STEPS = "phone steps in screenshot pixels: tap X Y, long X Y [MS], swipe X1 Y1 X2 Y2 [MS], type TEXT, key home|enter|volumeup|volumedown, wait MS";

// ---- demo ----

/** The demo machine: a screen in memory, which drive draws on, and a shell of this machine's. */
export class Demo implements Driver {
	readonly name = "demo";
	readonly screen = new Screen(320, 200);
	private launched: string[] = [];
	/** The apps in front, the last on top. */
	private front: string[] = [];
	readonly files = new Map<string, Uint8Array>();

	constructor() {
		this.screen.fill(0, 0, 320, 200, [30, 34, 44]);
		this.screen.fill(0, 0, 320, 18, [70, 90, 140]);
	}

	async machines(): Promise<Machine[]> {
		return [{ id: "demo", name: "Demo machine", kind: "demo", about: "A machine of the plugin's own, a 320×200 screen in memory that drive draws on: for trying the tools.", driver: this }];
	}

	async status(): Promise<string> {
		return `demo: ${this.launched.length ? "running " + this.launched.join(", ") : "nothing running"}`;
	}

	async capture(): Promise<Shot> {
		return { data: this.screen.png(), mimeType: "image/png" };
	}

	async drive(_m: Machine, steps: string[]): Promise<string> {
		const done: string[] = [];
		for (const s of steps) {
			const [op, ...a] = s.trim().split(/\s+/);
			const [x, y] = a.map(Number);
			switch (op) {
				case "click":
					if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DriverError(`click takes X and Y: ${s}`);
					this.screen.fill(x! - 3, y! - 3, 7, 7, [250, 200, 60]);
					done.push(`clicked ${x},${y}`);
					break;
				case "type":
					done.push(`typed ${a.join(" ")}`);
					break;
				case "open":
					// As a click on a link would, past machine_app.
					this.front.push(a.join(" "));
					done.push(`opened ${a.join(" ")}`);
					break;
				case "wait":
					await new Promise((r) => setTimeout(r, Math.min(Number(a[0]) || 0, 5000)));
					break;
				default:
					throw new DriverError(`no step ${op}: ${this.steps()}`);
			}
		}
		return done.join("\n");
	}

	async run(_m: Machine, command: string, o: { timeoutS: number }): Promise<Ran> {
		// Here, as on bb's Windows VM, Windows' commands are PowerShell's.
		const timeout = o.timeoutS * 1000;
		const r = process.platform === "windows" ? await process.run("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { timeout }) : await process.run("sh", ["-c", command], { timeout });
		return { code: r.code, output: out(r), timedOut: !!r.timedOut };
	}

	async app(_m: Machine, action: string, target: string): Promise<string> {
		switch (action) {
			case "launch":
				this.launched.push(target);
				this.front.push(target);
				this.screen.fill(20, 40, 280, 120, [235, 235, 240]);
				return `Launched ${target}.`;
			case "kill":
				if (!this.launched.includes(target)) throw new DriverError(`You didn't launch ${target}: only what you launched is killed.`);
				this.launched = this.launched.filter((t) => t !== target);
				this.front = this.front.filter((t) => t !== target);
				this.screen.fill(20, 40, 280, 120, [30, 34, 44]);
				return `Stopped ${target}.`;
		}
		throw new DriverError(`The demo machine can launch and kill, not ${action}.`);
	}

	async put(_m: Machine, locals: string[], remote: string): Promise<string> {
		for (const l of locals) this.files.set(remote.endsWith("/") ? remote + l.split("/").pop() : remote, await fs.readBytes(l));
		return `Copied ${locals.length} file(s) to ${remote}.`;
	}

	async get(_m: Machine, remote: string, local: string): Promise<string> {
		const b = this.files.get(remote);
		if (!b) throw new DriverError(`no file ${remote} on the demo machine`);
		await fs.writeBytes(local, b);
		return `Copied ${remote} to ${local}.`;
	}

	async power(): Promise<string> {
		return "The demo machine is always on.";
	}

	async released() {}

	steps(): string {
		return "click X Y, type TEXT, open APP, wait MS";
	}

	async recordStart() {}

	/** No video here: the screen as it is when it stops, a still. */
	async recordStop(): Promise<Recording> {
		return { data: this.screen.png(), ext: "png" };
	}

	async frontmost(): Promise<App | null> {
		const name = this.front.at(-1);
		return name ? { name, id: name } : null;
	}

	async leave(): Promise<void> {
		this.front.pop();
	}
}
