// Who drives what, past the pool: the user lending their own simulator to
// one thread (its agent then uses it in place of one of its own, with the
// user's apps and data), an agent asking to borrow it (only the user's
// answer lends it), and the user taking over a simulator an agent has
// (the agent's calls on it are refused until they hand it back). After
// bb's Simulator.
import { storage, ui } from "swarm";
import type { Device } from "./picker";
import { LoanBook, type Loan } from "./loan";
import type { Platform, Slot } from "./pool";
import { key, quoted, setInfo, view } from "./state";

export type { Loan } from "./loan";

const SAVE = "loan";
/** What the panels draw from: the loan and what the user took over, as the book has them. */
export const loans = ui.store({ now: (storage.get<Loan>(SAVE) ?? null) as Loan | null, told: false });
export const takenOver = ui.store(new Set<string>(), { shallow: true });

const book = new LoanBook(() => {
	if (loans.now !== book.now) {
		loans.now = book.now;
		loans.told = false;
		storage.set(SAVE, book.now);
	}
	takenOver.clear();
	for (const k of book.taken) takenOver.add(k);
	view.v++;
});
book.now = loans.now;

/** The user's simulator lent to the thread, of the platform, as a slot, if it is. */
export function lentTo(thread: string, p: Platform): Slot | null {
	const s = book.lentTo(thread, p);
	if (s) {
		const d = book.now!.device;
		setInfo(s, { udid: d.platform === "ios" ? d.id : undefined, serial: d.serial, name: d.name, booted: true, slim: false, busy: "" });
	}
	return s;
}

export const isLoan = (s: Slot) => s.n === 0;

/** The user lends one of their own simulators to a thread: one thread at a time. */
export const lend = (thread: string, d: Device) => book.lend(thread, d);
/** The loan ends: the user takes it back. */
export const takeBack = () => book.takeBack();

/** What an agent is told the first time it uses a lent simulator. */
export function loanNote(l = loans.now): string {
	if (!l) return "";
	return `This is the user's own ${l.device.name}, lent to this thread: it has their apps, accounts and data. Look and test; never sign in or out of their accounts, change their settings beyond what the task needs, or delete their apps or data. You can't shut it down or erase it. It stays lent until the user takes it back.`;
}

/** Each minute: a loan unused for IDLE_MS ends. */
export const sweepLoan = (now = Date.now()) => book.sweep(now);

// ---- Borrowing ----

/** A thread's ask to borrow, while it's open: thread → its close. */
const asking = new Map<string, () => void>();

/**
 * An agent asks for the user's simulator, saying why: the user is asked
 * in the thread, and only Lend it lends it. Returns at once (an agent's
 * call can't wait for the user); its next call finds it lent.
 */
export function borrow(thread: string, d: Device, reason: string): string {
	if (loans.now?.thread === thread) return `${loans.now.device.name} is lent to you already.`;
	if (asking.has(thread)) return "You've asked already: the user hasn't answered yet.";
	const q = ui.ask<boolean>(thread, {
		id: "simulators-borrow",
		title: `Lend ${d.name} to this thread?`,
		icon: "mobile",
		render: (ctx) => (
			<ui.box style={{ gap: 10 }}>
				<ui.text style={{ fontSize: "small", color: "text2" }}>{`The agent asks for your own ${d.name}, with your apps and data${reason ? `: “${reason}”` : "."} It can't shut it down or erase it, and you take it back whenever you like.`}</ui.text>
				<ui.box style={{ flexDirection: "row", gap: 8 }}>
					<ui.button label="Lend it" kind="primary" icon="mobile" onClick={() => ctx.answer?.(true)} />
					<ui.button label="Not now" kind="ghost" onClick={() => ctx.answer?.(false)} />
				</ui.box>
			</ui.box>
		),
	});
	asking.set(thread, () => q.close());
	void q.then((yes) => {
		asking.delete(thread);
		if (yes) lend(thread, d);
	});
	return `Asked the user to lend you ${d.name}. Go on with your own meanwhile; once they lend it, your calls on ${d.platform === "ios" ? "iOS" : "Android"} use theirs (sim_status says).`;
}

// ---- Taking over ----

export const takeOver = (s: Slot) => book.takeOver(key(s));
export const handBack = (s: Slot) => book.handBack(key(s));
/** The user takes over, or hands back, by key ("ios:0" for a loan). */
export const takeOverKey = (k: string) => book.takeOver(k);
export const handBackKey = (k: string) => book.handBack(k);

/** Refuses an agent's call on a simulator the user has taken over. */
export const checkDriving = (s: Slot, name: string) => book.check(key(s), name);

/** A thread went (archived or deleted): its loan ends, and its ask closes. */
export function threadGone(thread: string) {
	book.threadGone(thread);
	asking.get(thread)?.();
	asking.delete(thread);
}

export const loanSaid = () => (loans.now ? `lent to ${quoted(loans.now.thread)}` : "");
