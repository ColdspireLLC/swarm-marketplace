// Where the simulators' programs run: on this computer, on a computer
// joined to Swarm (by its name or id: Swarm reaches it, nothing to set
// up), or over ssh to a target that's none of those. From test-machines.
import { call, process, type RunOptions } from "swarm";

export interface Where {
	/** A computer joined to Swarm, by its id. */
	machine?: string;
	/** An ssh target. */
	ssh?: string;
	/** What to call it in what's said. */
	label: string;
}

interface Joined {
	id: string;
	name: string;
	os?: string;
	connected: boolean;
	server?: boolean;
	pairing?: string;
}

let joined: { at: number; list: Joined[] } = { at: 0, list: [] };

/** The computers joined to Swarm, asked again each 30 s at most. */
export async function joinedMachines(): Promise<Joined[]> {
	if (Date.now() - joined.at > 30_000) {
		try {
			joined = { at: Date.now(), list: ((await call("Machines", {})) as Joined[]).filter((m) => m.id && !m.server && !m.pairing) };
		} catch {
			joined = { at: Date.now(), list: [] };
		}
	}
	return joined.list;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Where a setting says: "" for this computer, a joined machine, else an ssh target. */
export async function whereOf(target: string): Promise<Where> {
	const t = target.trim();
	if (!t) return { label: "this computer" };
	const m = (await joinedMachines()).find((x) => x.id === t || x.name.toLowerCase() === t.toLowerCase() || slug(x.name) === slug(t));
	if (m) return { machine: m.id, label: m.name };
	return { ssh: t, label: t };
}

export const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** Runs a program there: Swarm's machine's PATH, or the ssh target's login shell. */
export function runAt(w: Where, program: string, args: string[], o: RunOptions = {}) {
	if (w.ssh) {
		const line = [program, ...args].map(sh).join(" ");
		return process.run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", w.ssh, `sh -lc ${sh(line)}`], o);
	}
	return process.run(program, args, { ...o, machine: w.machine });
}
