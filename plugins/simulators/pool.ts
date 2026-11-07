// The agents' simulators: a pool of slots for each platform, each slot one
// simulator (or emulator) of the plugin's, a thread's alone while it holds
// it, after simlock's leases and bb's agent pool. A thread holds one from
// its first call that needs it until its turn ends, it releases it, or it
// sits unused IDLE_MS while another waits; a command still running keeps
// it until it's done. Given back, a slot goes to the first in line, and
// else stays free for the thread that had it: it gets it back as it was.
// No Swarm here, for the tests: onChange tells the plugin to redraw.

export type Platform = "ios" | "android";

export const IDLE_MS = 10 * 60_000;
/** How long a thread's place in line is kept after its call stopped waiting, for its next call. */
export const KEEP_MS = 3 * 60_000;
/** How long a slot that came up for a kept place is held for that thread, unused, before the next gets it. */
export const RESERVE_MS = 90_000;

export class PoolError extends Error {
	constructor(
		readonly code: "busy" | "timeout" | "full",
		message: string,
	) {
		super(message);
		this.name = "PoolError";
	}
}

export interface Slot {
	platform: Platform;
	/** 1, 2…: the simulator's number, in its name. */
	n: number;
	holder: { thread: string; since: number; note: string; turn?: number } | null;
	/** The thread that held it last, which it's kept for while free. */
	last: string;
	/** When it was last used, held or not. */
	used: number;
	/** What runs on it now, by any thread: an action holds it past its turn's end. */
	running: number;
	/** Its turn ended while an action ran: given back as that's done. */
	over: boolean;
}

interface Waiter {
	thread: string;
	platform: Platform;
	since: number;
	resolve: (s: Slot) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	/** A kept place: no call waits on it, until the thread's next (KEEP_MS). */
	kept?: boolean;
}

export class Pool {
	readonly slots: Slot[] = [];
	readonly waiting: Waiter[] = [];

	constructor(
		/** How many slots each platform may have: the settings'. */
		private cap: (p: Platform) => number,
		private onChange: () => void = () => {},
		private now: () => number = Date.now,
	) {}

	/** The slot a thread holds on a platform. */
	held(thread: string, platform: Platform): Slot | undefined {
		return this.slots.find((s) => s.platform === platform && s.holder?.thread === thread);
	}

	/** Every slot a thread holds. */
	heldBy(thread: string): Slot[] {
		return this.slots.filter((s) => s.holder?.thread === thread);
	}

	/**
	 * The thread's slot on a platform, waiting in line up to waitMs for one
	 * where all are held: the one it holds, the free one it had last, any
	 * free one (the least lately used), or a new one under the cap. fresh
	 * says the slot comes to it from another thread, or new: what was on it
	 * is someone else's.
	 */
	async take(thread: string, platform: Platform, o: { waitMs: number; note?: string; turn?: number }): Promise<{ slot: Slot; fresh: boolean; created: boolean }> {
		const have = this.held(thread, platform);
		if (have) {
			have.used = this.now();
			if (o.note) have.holder!.note = o.note;
			if (o.turn !== undefined) have.holder!.turn = o.turn;
			this.onChange();
			return { slot: have, fresh: false, created: false };
		}
		const cap = this.cap(platform);
		if (cap <= 0) throw new PoolError("full", `No ${platform === "ios" ? "iOS simulators" : "Android emulators"} for agents: the Simulators setting has 0.`);
		const free = this.slots.filter((s) => s.platform === platform && !s.holder && !this.waiting.some((w) => w.platform === platform));
		let slot = free.find((s) => s.last === thread) ?? free.filter((s) => !s.last).sort((a, b) => a.n - b.n)[0] ?? [...free].sort((a, b) => a.used - b.used)[0];
		let created = false;
		if (!slot && this.slots.filter((s) => s.platform === platform).length < cap && !this.waiting.some((w) => w.platform === platform)) {
			slot = { platform, n: this.nextN(platform), holder: null, last: "", used: 0, running: 0, over: false };
			this.slots.push(slot);
			created = true;
		}
		if (slot) return { slot: this.give(slot, thread, o), fresh: slot.last !== thread, created };
		// A place kept from the thread's last call: this one takes it over, where it was in line.
		const kept = this.waiting.find((x) => x.thread === thread && x.platform === platform && x.kept);
		if (o.waitMs <= 0 && !kept) throw new PoolError("busy", this.busyMessage(platform));
		const got = await new Promise<Slot>((resolve, reject) => {
			const w: Waiter = {
				thread,
				platform,
				since: kept?.since ?? this.now(),
				resolve,
				reject,
				timer: setTimeout(() => {
					// The call stops waiting; the thread's place doesn't, a while (KEEP_MS), unless
					// another of its calls still waits there.
					const i = this.waiting.indexOf(w);
					const others = this.waiting.some((x) => x !== w && x.thread === thread && x.platform === platform && !x.kept);
					if (i >= 0 && !others) {
						w.kept = true;
						w.resolve = (slot) => this.reserve(slot, thread);
						w.reject = () => {};
						w.timer = setTimeout(() => this.dropWaiter(w), KEEP_MS);
						this.onChange();
					} else this.dropWaiter(w);
					const place = this.waiting.filter((x) => x.platform === platform).indexOf(w) + 1;
					reject(
						new PoolError(
							"timeout",
							place > 0
								? `You're #${place} in line for ${platform === "ios" ? "an iOS simulator" : "an Android emulator"}: ${this.busyMessage(platform)} Your place is kept ${KEEP_MS / 60_000} minutes: call again in a minute.`
								: `Still in line: ${this.busyMessage(platform)}`,
						),
					);
				}, Math.max(o.waitMs, 0)),
			};
			if (kept) {
				clearTimeout(kept.timer);
				this.waiting.splice(this.waiting.indexOf(kept), 1, w);
			} else this.waiting.push(w);
			this.onChange();
		});
		const fresh = got.last !== thread;
		return { slot: this.give(got, thread, o), fresh, created: false };
	}

	/**
	 * A slot came up for a thread's kept place, no call of its waiting: it's
	 * held for the thread RESERVE_MS, for its next call, then goes on.
	 */
	private reserve(slot: Slot, thread: string) {
		this.give(slot, thread, { note: "kept for its next call" });
		const at = slot.used;
		setTimeout(() => {
			if (slot.holder?.thread === thread && slot.used === at && slot.running === 0) this.release(slot);
		}, RESERVE_MS);
	}

	private give(slot: Slot, thread: string, o: { note?: string; turn?: number }): Slot {
		slot.holder = { thread, since: this.now(), note: o.note ?? "", turn: o.turn };
		slot.used = this.now();
		slot.over = false;
		this.onChange();
		return slot;
	}

	private nextN(platform: Platform): number {
		const taken = new Set(this.slots.filter((s) => s.platform === platform).map((s) => s.n));
		let n = 1;
		while (taken.has(n)) n++;
		return n;
	}

	private dropWaiter(w: Waiter) {
		const i = this.waiting.indexOf(w);
		if (i >= 0) this.waiting.splice(i, 1);
		this.onChange();
	}

	private busyMessage(platform: Platform): string {
		const held = this.slots.filter((s) => s.platform === platform && s.holder);
		return `all ${held.length} of the agents' ${platform === "ios" ? "iOS simulators" : "Android emulators"} are other threads' just now. Try again later, or ask the user for more (the Simulators settings).`;
	}

	/** Gives a slot back: to the first in line for its platform, else free, kept for its last thread. */
	release(slot: Slot) {
		if (!slot.holder) return;
		if (slot.running > 0) {
			slot.over = true;
			this.onChange();
			return;
		}
		slot.last = slot.holder.thread;
		slot.holder = null;
		slot.over = false;
		slot.used = this.now();
		const w = this.waiting.find((x) => x.platform === slot.platform);
		if (w) {
			// Every call of that thread's in line for one gets it: it's the thread's, not the call's.
			for (const x of this.waiting.filter((x) => x.thread === w.thread && x.platform === slot.platform)) {
				clearTimeout(x.timer);
				this.waiting.splice(this.waiting.indexOf(x), 1);
				x.resolve(slot);
			}
		}
		this.onChange();
	}

	/** Gives back what a thread holds (on one platform, or all), and takes it out of line. */
	releaseAll(thread: string, platform?: Platform): Slot[] {
		const mine = this.heldBy(thread).filter((s) => !platform || s.platform === platform);
		for (const s of mine) this.release(s);
		for (const w of this.waiting.filter((x) => x.thread === thread && (!platform || x.platform === platform))) {
			clearTimeout(w.timer);
			this.dropWaiter(w);
			w.reject(new PoolError("busy", "You gave your simulators back while this waited."));
		}
		return mine;
	}

	/**
	 * A thread's turn ended: its slots go back, those taken for that turn or
	 * an earlier one. An end heard late, of a turn before the one a slot was
	 * taken for, keeps it.
	 */
	turnEnded(thread: string, turn?: number) {
		for (const s of this.heldBy(thread)) {
			const t = s.holder!.turn;
			if (t === undefined || turn === undefined || turn >= t) this.release(s);
		}
	}

	/** Runs fn on a slot, which holds it past its turn's end until fn's done. */
	async using<T>(slot: Slot, fn: () => Promise<T>): Promise<T> {
		slot.running++;
		slot.used = this.now();
		this.onChange();
		try {
			return await fn();
		} finally {
			slot.running--;
			slot.used = this.now();
			if (slot.running === 0 && slot.over) this.release(slot);
			else this.onChange();
		}
	}

	/**
	 * Gives back slots held unused IDLE_MS while another thread waits for one
	 * of their platform, and says which free slots have been unused that
	 * long (for their simulators to be shut down).
	 */
	sweep(): { bumped: Slot[]; idle: Slot[] } {
		const t = this.now();
		const bumped: Slot[] = [];
		for (const s of this.slots) {
			if (s.holder && s.running === 0 && t - s.used >= IDLE_MS && this.waiting.some((w) => w.platform === s.platform && w.thread !== s.holder!.thread)) {
				bumped.push(s);
				this.release(s);
			}
		}
		const idle = this.slots.filter((s) => !s.holder && s.running === 0 && t - s.used >= IDLE_MS);
		return { bumped, idle };
	}

	/** Forgets a slot (its simulator deleted): only a free one. */
	remove(slot: Slot) {
		if (slot.holder) return;
		const i = this.slots.indexOf(slot);
		if (i >= 0) this.slots.splice(i, 1);
		this.onChange();
	}

	/** Slots as kept across restarts: who had each last, none held (a restart ends every turn). */
	save(): { platform: Platform; n: number; last: string }[] {
		return this.slots.map((s) => ({ platform: s.platform, n: s.n, last: s.holder?.thread ?? s.last }));
	}

	restore(saved: { platform: Platform; n: number; last: string }[]) {
		for (const x of saved) {
			if (this.slots.some((s) => s.platform === x.platform && s.n === x.n)) continue;
			this.slots.push({ platform: x.platform, n: x.n, holder: null, last: x.last, used: this.now(), running: 0, over: false });
		}
		this.onChange();
	}
}
