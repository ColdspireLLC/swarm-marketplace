// What an agent does on its own simulator past the tools' taps and
// screenshots: run commands on it (as root on Android, without restarting
// adbd, which would drop its forwards), copy files to and from it from the
// thread's own computer, and reach its dev server from it (Metro, say),
// wherever the thread runs. Each acts on the thread's simulator alone.
import * as android from "./android";
import type { Sdk } from "./android";
import { SimError } from "./devices";
import type { Slot } from "./pool";
import { info, key } from "./state";
import { copy, removeOn, samePlace, tempOn, threadPlace } from "./transfer";
import { runAt, type Where } from "./where";

export interface Ran {
	code: number;
	output: string;
}

const out = (r: { stdout: string; stderr: string; truncated?: boolean }) => (r.stdout + (r.stderr.trim() ? (r.stdout ? "\n" : "") + r.stderr : "")).trimEnd() + (r.truncated ? "\n… (cut short)" : "");

/** An iOS simulator's data folder, on the Mac. */
const IOS_DATA = `"$HOME/Library/Developer/CoreSimulator/Devices/$1/data"`;

/**
 * Runs a command on the thread's device: Android's shell (root: through
 * su, which keeps adbd and its forwards as they are); for an iOS simulator,
 * on its Mac, in its data folder, with $UDID and $DATA set.
 */
export async function shell(s: Slot, w: Where, sdk: Sdk | null, command: string, root: boolean, timeoutS: number): Promise<Ran> {
	const i = info(s);
	const timeout = Math.min(600, Math.max(1, timeoutS)) * 1000;
	const r =
		s.platform === "android"
			? await runAt(w, "sh", ["-c", `${android.env(sdk!)}; "$adb" -s "$1" shell ${root ? "su 0 sh" : "sh"}`, "sh", i.serial!], { input: command, timeout })
			: await runAt(w, "sh", ["-c", `export UDID="$1" DATA=${IOS_DATA}; cd "$DATA" && sh -c "$2"`, "sh", i.udid!, command], { timeout });
	return { code: r.timedOut ? 124 : r.code, output: out(r) + (r.timedOut ? `\n(stopped after ${timeout / 1000} s)` : "") };
}

/**
 * Where a path on an iOS simulator is, on its Mac: app:BUNDLE/… in that
 * app's data container, else a path in the simulator's data folder
 * (absolute there, or $DATA/…). Nothing outside the simulator's own.
 */
async function iosPath(w: Where, udid: string, remote: string): Promise<string> {
	const r = await runAt(
		w,
		"sh",
		[
			"-c",
			`DATA=${IOS_DATA}; p="$2"
case "$p" in
  app:*) b="\${p#app:}"; rest="\${b#*/}"; b="\${b%%/*}"; [ "$rest" = "$b" ] && rest=""
    c=$(xcrun simctl get_app_container "$1" "$b" data 2>/dev/null) || { echo "no app $b installed on the simulator" >&2; exit 2; }
    p="$c/$rest" ;;
  \\$DATA/*|'$DATA'/*) p="$DATA/\${p#*/}" ;;
  /*) ;;
  *) p="$DATA/$p" ;;
esac
case "$p" in "$DATA"/*|"$DATA") ;; *) case "$p" in "$HOME/Library/Developer/CoreSimulator/Devices/$1/"*) ;; *) echo "$2 isn't in the simulator's own folder" >&2; exit 2 ;; esac ;; esac
case "$p" in *..*) echo "$2 climbs out of its folder" >&2; exit 2 ;; esac
echo "$p"`,
			"sh",
			udid,
			remote,
		],
		{ timeout: 30_000 },
	);
	if (r.code !== 0) throw new SimError(r.stderr.trim() || `no such place: ${remote}`);
	return r.stdout.trim();
}

/** Android paths adb reaches without root. */
const openOnAndroid = (p: string) => /^\/(sdcard|storage\/emulated|data\/local\/tmp)(\/|$)/.test(p);

/**
 * Copies a file from the thread's computer onto its device (put), or back
 * (get): through the simulators' computer where the thread runs on another.
 * Android's files outside shared storage go as root.
 */
export async function files(thread: string, s: Slot, w: Where, sdk: Sdk | null, action: "put" | "get", local: string, remote: string): Promise<string> {
	const i = info(s);
	const t = await threadPlace(thread);
	const same = samePlace(t, w);
	const name = (action === "put" ? local : remote).split("/").pop() || "file";
	// The file's stop on the simulators' computer: itself where the thread runs there.
	const stop = same && action === "put" ? local : await tempOn(w, name);
	const run = async (script: string, args: string[], timeout = 300_000) => {
		const r = await runAt(w, "sh", ["-c", script, "sh", ...args], { timeout });
		if (r.code !== 0 || r.timedOut) throw new SimError((r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).split("\n").slice(-4).join("\n"));
		return r.stdout;
	};
	try {
		if (action === "put") {
			if (!same) await copy(t, local, w, stop);
			if (s.platform === "android") {
				const env = android.env(sdk!);
				if (openOnAndroid(remote)) await run(`${env}; "$adb" -s "$1" push "$2" "$3" >/dev/null`, [i.serial!, stop, remote]);
				else
					// Pushed where adb may write, then copied into place as root, its script on su's input.
					await run(
						`${env}; t=/data/local/tmp/swarm-put-$$; "$adb" -s "$1" push "$2" "$t" >/dev/null && printf 'mkdir -p "$(dirname "%s")" && cp "%s" "%s" && rm -f "%s"\\n' "$3" "$t" "$3" "$t" | "$adb" -s "$1" shell su 0 sh`,
						[i.serial!, stop, remote],
					);
			} else {
				const dest = await iosPath(w, i.udid!, remote);
				await run(`mkdir -p "$(dirname "$2")" && cp "$1" "$2"`, [stop, dest]);
			}
			return `Put ${local} on ${i.name} at ${remote}.`;
		}
		if (s.platform === "android") {
			const env = android.env(sdk!);
			if (openOnAndroid(remote)) await run(`${env}; "$adb" -s "$1" pull "$2" "$3" >/dev/null`, [i.serial!, remote, stop]);
			else await run(`${env}; "$adb" -s "$1" exec-out su 0 cat "$2" > "$3" && [ -s "$3" ] || { echo "nothing at $2 (or it's empty)" >&2; exit 2; }`, [i.serial!, remote, stop]);
		} else {
			const src = await iosPath(w, i.udid!, remote);
			await run(`[ -f "$1" ] || { echo "no file $1" >&2; exit 2; }; cp "$1" "$2"`, [src, stop]);
		}
		if (same) await run(`mkdir -p "$(dirname "$2")" && mv "$1" "$2"`, [stop, local]);
		else await copy(w, stop, t, local);
		return `Got ${remote} from ${i.name} into ${local}${same ? "" : ` on ${t.label}`}.`;
	} finally {
		if (stop !== local) await removeOn(w, stop);
	}
}

// ---- Forwards ----

/** A forward the thread made: the device's port, the simulators' computer's port it reaches, and where that goes. */
interface Forward {
	device: number;
	local: number;
	to: string;
	/** A forwarder of the plugin's runs for it on the simulators' computer. */
	forwarder: boolean;
}
const forwards = new Map<string, Forward[]>();

const FORWARDER = `import socket, sys, threading
lp, host, port = int(sys.argv[1]), sys.argv[2], int(sys.argv[3])
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", lp))
s.listen(64)
def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d:
                break
            b.sendall(d)
    except OSError:
        pass
    finally:
        for x in (a, b):
            try:
                x.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
while True:
    c, _ = s.accept()
    try:
        u = socket.create_connection((host, port), timeout=10)
        u.settimeout(None)
    except OSError:
        c.close()
        continue
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()
`;

const tag = (s: Slot, port: number) => `swarm-sim-fwd-${key(s).replace(":", "-")}-${port}`;

/** Whether a port of the simulators' computer is free to listen on. */
async function free(w: Where, port: number): Promise<boolean> {
	// Through sh, which the plugin runs, not python3 itself.
	const r = await runAt(w, "sh", ["-c", `python3 -c 'import socket,sys
s=socket.socket()
try:
    s.bind(("127.0.0.1",int(sys.argv[1])))
except OSError:
    sys.exit(1)' "$1"`, "sh", String(port)], { timeout: 15_000 });
	return r.code === 0;
}

/** Starts a forwarder on the simulators' computer: its port to host:port, until stopped. */
async function startForwarder(w: Where, s: Slot, local: number, host: string, port: number) {
	const r = await runAt(
		w,
		"sh",
		["-c", `d="$HOME/.swarm-simulators"; mkdir -p "$d"; cat > "$d/forward.py"; nohup python3 "$d/forward.py" "$1" "$2" "$3" "$4" < /dev/null > "$d/$4.log" 2>&1 & sleep 0.5; kill -0 $! 2>/dev/null || { cat "$d/$4.log" >&2; exit 1; }`, "sh", String(local), host, String(port), tag(s, local)],
		{ input: FORWARDER, timeout: 30_000 },
	);
	if (r.code !== 0) throw new SimError(`The forward didn't start: ${r.stderr.trim()}`);
}

async function stopForwarder(w: Where, s: Slot, local: number) {
	await runAt(w, "sh", ["-c", `pkill -f "forward.py .* $1$" 2>/dev/null; exit 0`, "sh", tag(s, local)], { timeout: 15_000 }).catch(() => {});
}

/**
 * Makes the device's localhost:port reach the thread's dev server: to
 * (host:port, or a port) on the thread's computer, port itself when not
 * given. Android's through adb reverse, onto a port of the simulators'
 * computer that forwards on where the thread runs elsewhere; an iOS
 * simulator shares its Mac's network, so the Mac's port is the device's.
 */
export async function forward(thread: string, s: Slot, w: Where, sdk: Sdk | null, port: number, to?: string): Promise<string> {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SimError(`${port} isn't a port.`);
	const t = await threadPlace(thread);
	const m = /^(?:(.+):)?(\d+)$/.exec((to ?? "").trim());
	if (to && !m) throw new SimError(`to is host:port, or a port: not ${to}.`);
	const host = m?.[1] ?? (samePlace(t, w) ? "127.0.0.1" : t.host);
	const toPort = Number(m?.[2] ?? port);
	await unforward(s, w, sdk, port);
	let local = port;
	const direct = host === "127.0.0.1" || host === "localhost";
	const forwarder = !(direct && toPort === port);
	if (forwarder) {
		// A forwarder on the simulators' computer: on the device's port where it's free, else
		// (Android, whose device port adb reverse maps) another.
		if (!(await free(w, port))) {
			if (s.platform === "ios") throw new SimError(`Port ${port} of ${w.label} is taken, and an iOS simulator's is its Mac's: use another port.`);
			for (local = 20000 + (port % 10000); !(await free(w, local)); local++) if (local > 40000) throw new SimError(`No free port on ${w.label}.`);
		}
		await startForwarder(w, s, local, direct ? "127.0.0.1" : host, toPort);
	}
	if (s.platform === "android") await android.adb(w, sdk!, info(s).serial!, ["reverse", `tcp:${port}`, `tcp:${local}`]);
	const list = (forwards.get(key(s)) ?? []).filter((f) => f.device !== port);
	list.push({ device: port, local, to: `${host}:${toPort}`, forwarder });
	forwards.set(key(s), list);
	return `${info(s).name}'s localhost:${port} reaches ${direct ? `${w.label}'s` : `${t.label}'s`} port ${toPort}${direct ? "" : ` (${host}:${toPort})`}.`;
}

/** Undoes a forward of the device's port (all of them when none is named). */
export async function unforward(s: Slot, w: Where, sdk: Sdk | null, port?: number) {
	const list = forwards.get(key(s)) ?? [];
	for (const f of list.filter((f) => port === undefined || f.device === port)) {
		if (f.forwarder) await stopForwarder(w, s, f.local);
		if (s.platform === "android" && sdk && info(s).serial) await android.adb(w, sdk, info(s).serial!, ["reverse", "--remove", `tcp:${f.device}`]).catch(() => "");
	}
	forwards.set(
		key(s),
		list.filter((f) => port !== undefined && f.device !== port),
	);
}

/** The forwards a slot has, as said. */
export const forwardsOf = (s: Slot) => forwards.get(key(s)) ?? [];

/** Puts a slot's adb reverses back after its emulator booted again (the forwarders on the computer stay). */
export async function reforward(s: Slot, w: Where, sdk: Sdk) {
	for (const f of forwardsOf(s)) await android.adb(w, sdk, info(s).serial!, ["reverse", `tcp:${f.device}`, `tcp:${f.local}`]).catch(() => "");
}

export { removeOn };
