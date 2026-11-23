// The rules of lending and taking over, apart from Swarm so they're
// tested: the user's simulator lent to one thread, for its platform, as a
// slot of its own (0, outside the pool); a loan ends when taken back,
// after IDLE_MS unused, or with its thread. A simulator the user took over
// refuses the agents' calls until it's handed back.
import { SimError } from "./devices";
import type { Device } from "./picker";
import { IDLE_MS, type Platform, type Slot } from "./pool";

export interface Loan {
	thread: string;
	device: Device;
	since: number;
}

export class LoanBook {
	now: Loan | null = null;
	/** Simulators the user took over, by slot key ("ios:2", "ios:0" for a loan). */
	taken = new Set<string>();
	private slot: Slot | null = null;

	constructor(private changed: () => void = () => {}) {}

	lend(thread: string, device: Device, at = Date.now()) {
		this.now = { thread, device, since: at };
		this.slot = null;
		this.changed();
	}

	takeBack() {
		this.now = null;
		this.slot = null;
		this.changed();
	}

	/** The loan as a slot, if the thread has it for that platform. */
	lentTo(thread: string, p: Platform): Slot | null {
		const l = this.now;
		if (!l || l.thread !== thread || l.device.platform !== p) return null;
		this.slot ??= { platform: p, n: 0, holder: { thread, since: l.since, note: "lent" }, last: thread, used: l.since, running: 0, over: false };
		return this.slot;
	}

	/** Ends a loan unused for IDLE_MS (nothing running on it); says whether it did. */
	sweep(now = Date.now()): boolean {
		const l = this.now;
		if (!l) return false;
		const used = this.slot ? this.slot.used : l.since;
		if ((this.slot?.running ?? 0) > 0 || now - used < IDLE_MS) return false;
		this.takeBack();
		return true;
	}

	threadGone(thread: string) {
		if (this.now?.thread === thread) this.takeBack();
	}

	takeOver(k: string) {
		this.taken.add(k);
		this.changed();
	}

	handBack(k: string) {
		this.taken.delete(k);
		this.changed();
	}

	/** Refuses an agent's call on a simulator the user took over. */
	check(k: string, name: string) {
		if (this.taken.has(k)) throw new SimError(`The user took over ${name} and is using it: wait until they hand it back (sim_status says), or ask them in your reply.`);
	}
}
