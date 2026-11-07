// Files between the thread's computer (where its agent builds) and the one
// the simulators run on: the same computer, nothing to do; else through
// Swarm, in chunks a command's output holds (16 MB at most, so 8 MB of a
// file base64'd), checked by their SHA-256 at the end.
import { call, process, type RunResult } from "swarm";
import { SimError } from "./devices";
import { joinedMachines, runAt, sh, type Where } from "./where";

/** The thread's computer, as runAt reaches it, and what to call it. */
export async function threadPlace(thread: string): Promise<Where & { host: string }> {
	let machine = "";
	try {
		const d = (await call("Thread", { thread })) as { thread?: { machine?: string } | null } | null;
		machine = d?.thread?.machine ?? "";
	} catch {}
	const all = (await call("Machines", {}).catch(() => [])) as { id: string; name: string; server?: boolean }[];
	if (!machine) {
		const server = all.find((m) => m.server);
		return { label: server?.name ?? "Swarm's computer", host: server?.name ?? "localhost" };
	}
	const m = (await joinedMachines()).find((x) => x.id === machine);
	return { machine, label: m?.name ?? machine, host: m?.name ?? machine };
}

/** Whether two places are one computer. */
export const samePlace = (a: Where, b: Where) => !a.ssh && !b.ssh && (a.machine ?? "") === (b.machine ?? "");

const CHUNK = 8 << 20;

async function run(w: Where, script: string, args: string[], o: { input?: string; timeout?: number } = {}): Promise<RunResult> {
	const r = await runAt(w, "sh", ["-c", script, "sh", ...args], { timeout: o.timeout ?? 120_000, input: o.input });
	if (r.code !== 0 || r.timedOut) throw new SimError((r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).split("\n").slice(-4).join("\n"));
	return r;
}

const SUM = `if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1`;

/** A file's size in bytes there; an error where it's not a file. */
async function sizeOf(w: Where, path: string): Promise<number> {
	const r = await run(w, `[ -f "$1" ] || { echo "no file $1 on this computer" >&2; exit 2; }; wc -c < "$1"`, [path]);
	return Number(r.stdout.trim());
}

/** Copies a file from one computer to another, to the path given there (its folder made). */
export async function copy(from: Where, src: string, to: Where, dest: string, onProgress?: (done: number, total: number) => void): Promise<number> {
	const size = await sizeOf(from, src);
	await run(to, `mkdir -p "$(dirname "$1")" && : > "$1"`, [dest]);
	for (let at = 0; at < size; at += CHUNK) {
		const part = await run(from, `dd if="$1" bs=1048576 skip=$2 count=$3 2>/dev/null | base64`, [src, String(at / (1 << 20)), String(CHUNK / (1 << 20))], { timeout: 300_000 });
		await run(to, `base64 -d >> "$1" 2>/dev/null || base64 -D >> "$1"`, [dest], { input: part.stdout, timeout: 300_000 });
		onProgress?.(Math.min(size, at + CHUNK), size);
	}
	const [a, b] = await Promise.all([run(from, SUM, [src]), run(to, SUM, [dest])]);
	if (a.stdout.trim() !== b.stdout.trim()) throw new SimError(`${dest} arrived different from ${src}: try again.`);
	return size;
}

/** A fresh path in the simulators' computer's temporary folder for a file of this name. */
export async function tempOn(w: Where, name: string): Promise<string> {
	const r = await run(w, `d=$(mktemp -d "\${TMPDIR:-/tmp}/swarm-sim-XXXXXX") && echo "$d/$1"`, [name.replace(/[^\w.-]+/g, "_") || "file"]);
	return r.stdout.trim();
}

export async function removeOn(w: Where, path: string) {
	await runAt(w, "sh", ["-c", `rm -rf "$(dirname "$1")"`, "sh", path], { timeout: 30_000 }).catch(() => {});
}

/**
 * A file the thread names for the simulators' computer: its path there,
 * copied from the thread's computer where that's another and has it (a
 * build there), else the path as it is (one already on the simulators'
 * computer). done removes a copy.
 */
export async function bring(thread: string, path: string, w: Where): Promise<{ path: string; done: () => Promise<void>; copied: boolean }> {
	const t = await threadPlace(thread);
	if (samePlace(t, w)) return { path, done: async () => {}, copied: false };
	const there = await sizeOf(t, path).then(
		() => true,
		() => false,
	);
	if (!there) return { path, done: async () => {}, copied: false };
	const dest = await tempOn(w, path.split("/").pop() ?? "file");
	await copy(t, path, w, dest);
	return { path: dest, done: () => removeOn(w, dest), copied: true };
}

export { sh, process };
