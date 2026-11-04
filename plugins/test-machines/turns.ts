// Turns: one queue per machine, of Swarm's threads. A thread holds a
// machine from its first call that needs it until its turn ends (the
// turnEnd hook), it releases it, or it sits idle 10 minutes while
// another waits. One that waits past its call's time keeps its place a
// while for its next call. Ported from bb's test-machines (turns.ts).
import { ui } from "swarm";
import { endsHold } from "./turnend";

export const IDLE_BUMP_MS = 10 * 60_000;
export const KEEP_PLACE_MS = 3 * 60_000;
/** How long a machine is held for a thread whose kept place came up. */
export const RESERVE_MS = 90_000;
/** Who holds a machine the user took: theirs until they give it back. */
export const USER = "user";

export class TurnError extends Error {
	constructor(
		readonly code: "busy" | "timeout" | "cut-off" | "gone",
		message: string,
	) {
		super(message);
		this.name = "TurnError";
	}
}

interface Waiter {
	thread: string;
	resolve: () => void;
	reject: (e: Error) => void;
	timer: number;
	/** A kept place: no call waits on it, until the thread's next. */
	kept: boolean;
	/** When the thread joined the line: a kept place's call taking it over keeps its time. */
	since: number;
}

export interface Holder {
	thread: string;
	since: number;
	lastUsed: number;
	note: string;
	/** Its turn ended with work still running: let go once that's done. */
	over: boolean;
	/**
	 * The thread's turn it holds the machine for (Swarm's turn count),
	 * where it's known: an end of an earlier turn, heard late, doesn't
	 * end it.
	 */
	turn?: number;
}

/** A machine's queue. */
export class Turns {
	// Who holds it and who waits are tracked, for the Machines panel to
	// show them as they change: the holder deep, as its note is set in
	// place; the line shallow, so that its waiters are handed out as
	// they are and indexOf finds them.
	private s = ui.store({ holder: null as Holder | null });
	get holder(): Holder | null {
		return this.s.holder;
	}
	set holder(h: Holder | null) {
		this.s.holder = h;
	}
	readonly waiting = ui.store<Waiter[]>([], { shallow: true });
	/** What runs now, by thread: commands, captures… */
	running = new Map<string, number>();
	private reserved: { thread: string; timer: number } | null = null;
	/** The threads the user took the machine from, and when. */
	private cut = new Map<string, number>();
	/** The turn each thread's next hold is for (forTurn). */
	private turns = new Map<string, number>();

	constructor(
		readonly name: string,
		private freed: () => void,
		private now: () => number = Date.now,
	) {}

	/** Waits for thread to hold the machine, up to waitMs. */
	acquire(thread: string, waitMs: number, keepPlaceMs = KEEP_PLACE_MS): Promise<void> {
		const h = this.holder;
		if (h?.thread === thread) {
			h.lastUsed = this.now();
			h.over = false;
			return Promise.resolve();
		}
		if (!h && this.reserved?.thread === thread) {
			clearTimeout(this.reserved.timer);
			this.reserved = null;
			this.hold(thread);
			return Promise.resolve();
		}
		this.bumpIdle();
		if (!this.holder && !this.reserved && this.waiting.length === 0) {
			this.hold(thread);
			return Promise.resolve();
		}
		if (waitMs <= 0) {
			return Promise.reject(new TurnError("busy", `${this.name} is ${this.whose()} turn: wait in line with wait, or try again later.${this.userNote()}`));
		}
		return new Promise((resolve, reject) => {
			// A kept place of this thread's: its call takes it over.
			const at = this.waiting.findIndex((w) => w.thread === thread && w.kept);
			const w: Waiter = { thread, resolve, reject, timer: 0, kept: false, since: at >= 0 ? this.waiting[at]!.since : this.now() };
			w.timer = setTimeout(() => {
				const i = this.waiting.indexOf(w);
				if (i < 0) return;
				if (keepPlaceMs > 0) {
					w.kept = true;
					w.timer = setTimeout(() => this.drop(w), keepPlaceMs);
					reject(new TurnError("timeout", `${this.name} is still ${this.whose()} turn. Your place in line is kept ${Math.round(keepPlaceMs / 60_000)} min for your next call.${this.userNote()}`));
				} else {
					this.drop(w);
					reject(new TurnError("timeout", `${this.name} is still ${this.whose()} turn.${this.userNote()}`));
				}
			}, waitMs);
			if (at >= 0) {
				clearTimeout(this.waiting[at]!.timer);
				this.waiting[at] = w;
			} else {
				this.waiting.push(w);
			}
			this.serve();
		});
	}

	private drop(w: Waiter) {
		const i = this.waiting.indexOf(w);
		if (i >= 0) this.waiting.splice(i, 1);
		clearTimeout(w.timer);
		this.serve();
	}

	private hold(thread: string, note = "") {
		const now = this.now();
		this.holder = { thread, since: now, lastUsed: now, note, over: false, turn: this.turns.get(thread) };
	}

	/**
	 * Says which of thread's turns a hold it takes next is for: the one
	 * under way, or for an idle thread the next (its last has ended).
	 */
	forTurn(thread: string, turn: number | undefined) {
		if (turn === undefined) this.turns.delete(thread);
		else this.turns.set(thread, turn);
	}

	/** Gives the machine to the next in line, when it's free. */
	private serve() {
		if (this.holder || this.reserved) return;
		const w = this.waiting.shift();
		if (!w) {
			this.freed();
			return;
		}
		clearTimeout(w.timer);
		if (w.kept) {
			// Held a while for the thread to come back for it.
			const timer = setTimeout(() => {
				this.reserved = null;
				this.serve();
			}, RESERVE_MS);
			this.reserved = { thread: w.thread, timer };
		} else {
			this.hold(w.thread);
			w.resolve();
		}
		// The same thread waiting in another call gets it too.
		for (const o of [...this.waiting]) {
			if (o.thread === w.thread && !o.kept && (this.holder as Holder | null)?.thread === w.thread) {
				this.waiting.splice(this.waiting.indexOf(o), 1);
				clearTimeout(o.timer);
				o.resolve();
			}
		}
	}

	/** Runs work in thread's turn, which must hold the machine. */
	async run<T>(thread: string, work: () => Promise<T>): Promise<T> {
		if (this.holder?.thread !== thread) throw new TurnError("cut-off", `${this.name} isn't your turn any more.${this.userNote()}`);
		this.running.set(thread, (this.running.get(thread) ?? 0) + 1);
		this.holder.lastUsed = this.now();
		try {
			return await work();
		} finally {
			const n = (this.running.get(thread) ?? 1) - 1;
			if (n > 0) this.running.set(thread, n);
			else this.running.delete(thread);
			if (this.holder?.thread === thread) {
				this.holder.lastUsed = this.now();
				if (this.holder.over && n <= 0) this.letGo();
			}
		}
	}

	/** Gives the machine back, now or once the thread's work ends. */
	release(thread: string): "released" | "after" | "left-line" | "not-held" {
		if (this.holder?.thread === thread) {
			if (this.running.has(thread)) {
				this.holder.over = true;
				return "after";
			}
			this.letGo();
			return "released";
		}
		const i = this.waiting.findIndex((w) => w.thread === thread);
		if (i >= 0) {
			const w = this.waiting[i]!;
			this.waiting.splice(i, 1);
			clearTimeout(w.timer);
			if (!w.kept) w.reject(new TurnError("gone", "You gave up your place."));
			return "left-line";
		}
		return "not-held";
	}

	/** A thread's turn ended: its kept places go, and the machine, once its work ends. */
	turnEnded(thread: string, turn?: number) {
		// The end of a turn before the one it holds for, heard late (the
		// hook is waited for by nothing): the hold goes on.
		const h = this.holder;
		if (h?.thread === thread && !endsHold(h.turn, turn)) return;
		for (const w of this.waiting.filter((w) => w.thread === thread && w.kept)) this.drop(w);
		if (this.reserved?.thread === thread) {
			clearTimeout(this.reserved.timer);
			this.reserved = null;
			this.serve();
		}
		if (this.holder?.thread === thread) this.release(thread);
	}

	/**
	 * The user takes the machine: whoever holds it is cut off at once
	 * (what it runs there goes on to its end, but no longer in its turn),
	 * and the line waits until they give it back. Returns the thread cut off.
	 */
	claim(): string | null {
		const h = this.holder;
		if (h?.thread === USER) return null;
		if (this.reserved) {
			clearTimeout(this.reserved.timer);
			this.reserved = null;
		}
		const now = this.now();
		this.holder = { thread: USER, since: now, lastUsed: now, note: "", over: false };
		if (!h) return null;
		this.cut.set(h.thread, now);
		return h.thread;
	}

	/** The user gives the machine back: the next in line gets it. */
	giveBack(): boolean {
		if (this.holder?.thread !== USER) return false;
		this.letGo();
		return true;
	}

	/** Whether the user took the machine from thread at or after since. */
	cutSince(thread: string, since: number): boolean {
		return (this.cut.get(thread) ?? -1) >= since;
	}

	private userNote() {
		return this.holder?.thread === USER ? " The user took it: stop, and tell them what you were doing there." : "";
	}

	private letGo() {
		this.holder = null;
		this.serve();
	}

	/** A holder idle 10 minutes with someone waiting gives way. */
	bumpIdle() {
		const h = this.holder;
		if (h && h.thread !== USER && !this.running.has(h.thread) && this.waiting.some((w) => !w.kept) && this.now() - h.lastUsed >= IDLE_BUMP_MS) {
			this.letGo();
		}
	}

	/** Whose turn it is, as "the user's" or "thread X's". */
	whose(): string {
		const t = this.holder?.thread ?? this.reserved?.thread;
		return t === USER ? "the user's" : t ? `thread ${t}'s` : "someone's";
	}
}
