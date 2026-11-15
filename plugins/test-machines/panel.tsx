// The Machines panel beside a thread: each machine, whose turn it is and
// who waits, its last screen, and what the user does with it: look, take
// it for themselves, give it back, end an agent's turn.
import { ui, type Child, type IconName } from "swarm";
import { discover, found } from "./discover";
import type { Machine } from "./drivers";
import { carried } from "./rules";
import { keep, learnTitles, message, refresh, shots, st } from "./state";
import { section, tile } from "./machinesPage";
import { USER } from "./turns";
import { card, CARD, heading, panelRows, SIDE } from "./compact";

export const PAGE = "test-machines";
/** The link that opens the Settings page. */
export const SETUP = `swarm://settings/test-machines/${PAGE}`;

export const KIND_ICON: Record<string, IconName> = { mac: "laptop", linux: "computer", windows: "monitor", android: "mobile", ios: "mobile", demo: "terminal" };

export const looking = ui.store(new Map<string, string>());

/** The machines the panel watches: a screenshot every few seconds, for 5 minutes at most. */
export const watching = ui.store(new Map<string, number>());
const WATCH_EVERY = 3000;
const WATCH_FOR = 5 * 60_000;

export function watch(m: Machine, on: boolean) {
	clearInterval(watching.get(m.id));
	watching.delete(m.id);
	if (!on) return;
	const until = Date.now() + WATCH_FOR;
	let busy = false;
	const timer = setInterval(async () => {
		if (Date.now() > until || carried(m.id)) return watch(m, false);
		if (busy) return;
		busy = true;
		try {
			keep(m, await m.driver.capture(m), USER);
			looking.delete(m.id);
		} catch (e) {
			looking.set(m.id, message(e));
			watch(m, false);
		}
		busy = false;
	}, WATCH_EVERY);
	watching.set(m.id, timer);
	void look(m);
}

/** Looks at a machine for the user. */
export async function look(m: Machine) {
	looking.set(m.id, "");
	try {
		keep(m, await m.driver.capture(m), USER);
		looking.delete(m.id);
	} catch (e) {
		looking.set(m.id, message(e));
	}
}

/** When each machine was last looked at by itself, for a card shown with no screen, or an old one. */
const lookedBy = new Map<string, number>();
/** A screen older than this is looked at again as its card's shown. */
const STALE_MS = 10 * 60_000;

/**
 * A card shows the machine's screen without a click: looked at once as
 * it's shown with none, or with one older than STALE_MS, and no more
 * often than that.
 */
export function lookIfStale(m: Machine) {
	const k = shots.get(m.id);
	const now = Date.now();
	if (carried(m.id) || looking.has(m.id) || watching.has(m.id)) return;
	if (k && now - k.at < STALE_MS) return;
	if (now - (lookedBy.get(m.id) ?? 0) < STALE_MS) return;
	lookedBy.set(m.id, now);
	// After the render: what the look writes (its shimmer, then the screen) isn't the render's to write.
	setTimeout(() => void look(m), 0);
}

/** When, said anew each minute in a render (ui.now). */
export function ago(at: number) {
	const s = Math.max(0, (ui.now() - at) / 1000);
	return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(at).toISOString().slice(0, 10);
}

export const line = { flexShrink: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;


function empty(): Child {
	return (
		<ui.box style={{ alignSelf: "center", maxWidth: 320, padding: "s8 s4", gap: 6, alignItems: "center" }}>
			<ui.box style={{ width: 40, height: 40, borderRadius: "card", backgroundColor: "field", boxShadow: "inset 0 0 0 1px divider", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
				<ui.icon icon="laptop-mobile" style={{ width: 18, height: 18, color: "text2" }} />
			</ui.box>
			<ui.text style={{ fontWeight: 500, textAlign: "center" }}>No test machines yet</ui.text>
			<ui.text style={{ fontSize: "small", color: "text2", textAlign: "center" }}>Add computers, Android phones and iPhones for your agents to test on.</ui.text>
			<ui.box style={{ marginTop: 8 }}>
				<ui.link label="Set up test machines" href={SETUP} />
			</ui.box>
		</ui.box>
	);
}

/** The phones plugged in that the plugin doesn't use, from the last look: one link turns them on. */
export function unusedPhones(phone = false): Child {
	const unused = found.phones.filter((f) => !f.id && !f.problem);
	if (!unused.length) return null;
	const names = unused.map((f) => f.model);
	const said = names.length === 1 ? `${names[0]} is plugged in` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are plugged in`;
	return (
		<ui.box style={phone ? { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: `12px ${SIDE}px`, borderRadius: 10, backgroundColor: CARD } : { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: "s4 s5", borderRadius: "card", backgroundColor: "raised", border: "1px solid border" }}>
			<ui.icon icon="mobile" style={{ width: 16, height: 16, marginTop: 2, color: "text2", flexShrink: 0 }} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<ui.text style={{ fontWeight: 500 }}>{`${said}, not in use`}</ui.text>
				<ui.text style={{ fontSize: "small", color: "text2" }}>{`On ${[...new Set(unused.map((f) => f.placeLabel))].join(", ")}. Turn ${names.length === 1 ? "it" : "them"} on for agents to test on.`}</ui.text>
			</ui.box>
			<ui.link label="Set up" href={SETUP} />
		</ui.box>
	);
}

export const isPhone = (m: Machine) => m.kind === "android" || m.kind === "ios";


/**
 * The panel on a phone, a page over the thread whose bar names it: the
 * machines as rows of cards, one opened in place, its look-again and
 * set-up at the first heading's end.
 */
function compactPanel(thread: string): Child {
	const phones = st.machines.filter(isPhone);
	const computers = st.machines.filter((m) => !isPhone(m));
	const actions = (
		<ui.box style={{ flexDirection: "row", alignItems: "center" }}>
			<ui.iconButton icon="refresh" label="Look for machines again" onClick={async () => { await refresh(); await learnTitles(); void discover(); }} />
			<ui.iconButton icon="settings" label="Set up test machines" href={SETUP} />
		</ui.box>
	);
	return (
		<ui.scroll style={{ flex: 1 }}>
			<ui.box style={{ padding: `12px ${SIDE}px ${SIDE + 8}px`, gap: 20 }}>
				{st.driverProblems.map((p, i) => (
					<ui.text key={"dp" + i} style={{ fontSize: "small", color: "red" }}>{p}</ui.text>
				))}
				{unusedPhones(true)}
				{st.machines.length === 0 ? (
					<>
						<ui.box style={{ alignSelf: "flex-end" }}>{actions}</ui.box>
						{empty()}
					</>
				) : null}
				{phones.length ? (
					<ui.box style={{ gap: 8 }}>
						{heading("Phones", phones.length, actions)}
						{card(panelRows(thread, phones), SIDE + 26 + 12)}
					</ui.box>
				) : null}
				{computers.length ? (
					<ui.box style={{ gap: 8 }}>
						{heading("Computers", computers.length, phones.length ? undefined : actions)}
						{card(panelRows(thread, computers), SIDE + 52 + 12)}
					</ui.box>
				) : null}
			</ui.box>
		</ui.scroll>
	);
}

export function registerPanel() {
	ui.panel({
		id: "machines",
		title: "Machines",
		icon: "laptop-mobile",
		render: ({ thread, args }) => args.compact === "1" ? compactPanel(thread) : (
			<ui.scroll style={{ flex: 1 }}>
				<ui.box style={{ padding: "s6", gap: 12 }}>
					<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
						<ui.text style={{ fontWeight: 600 }}>Test machines</ui.text>
						<ui.spacer />
						<ui.iconButton icon="settings" label="Set up test machines" href={SETUP} />
						<ui.iconButton icon="refresh" label="Look for machines again" onClick={async () => { await refresh(); await learnTitles(); void discover(); }} />
					</ui.box>
					{st.driverProblems.map((p, i) => (
						<ui.text key={"dp" + i} style={{ fontSize: "small", color: "red" }}>{p}</ui.text>
					))}
					{st.machines.length === 0 ? (
						<>
							{unusedPhones()}
							{empty()}
						</>
					) : (
						<ui.box style={{ gap: 20 }}>
							{st.machines.some(isPhone) || unusedPhones() ? (
								<ui.box style={{ gap: 10 }}>
									{unusedPhones()}
									{st.machines.some(isPhone) ? section("Phones", st.machines.filter(isPhone).length, st.machines.filter(isPhone).map((m) => tile(m, thread))) : null}
								</ui.box>
							) : null}
							{st.machines.some((m) => !isPhone(m)) ? section("Computers", st.machines.filter((m) => !isPhone(m)).length, st.machines.filter((m) => !isPhone(m)).map((m) => tile(m, thread))) : null}
						</ui.box>
					)}
				</ui.box>
			</ui.scroll>
		),
	});
}
