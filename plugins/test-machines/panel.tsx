// The Machines panel beside a thread: each machine, whose turn it is and
// who waits, its last screen, and what the user does with it: look, take
// it for themselves, give it back, end an agent's turn.
import { ui, type Child, type IconName } from "swarm";
import { discover, found } from "./discover";
import type { Machine } from "./drivers";
import { carried } from "./rules";
import { claim, keep, learnTitles, message, plainTitle, recording, refresh, shots, st, turnsOf } from "./state";
import { imageSize } from "./png";
import { USER } from "./turns";

export const PAGE = "test-machines";
/** The link that opens the Settings page. */
export const SETUP = `swarm://settings/test-machines/${PAGE}`;

export const KIND_ICON: Record<string, IconName> = { mac: "laptop", linux: "computer", windows: "monitor", android: "mobile", ios: "mobile", demo: "terminal" };

const looking = ui.store(new Map<string, string>());

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

/** The tallest a card's screen is drawn. */
const SHOT_MAX = 360;

/** A screenshot's size, read once per picture. */
const sizes = new WeakMap<Uint8Array, { width: number; height: number } | null>();
function shotSize(d: Uint8Array) {
	if (!sizes.has(d)) sizes.set(d, imageSize(d));
	return sizes.get(d)!;
}

/** Remembers a machine's screen size as its screen's shown. */
function remember(m: Machine, d: Uint8Array) {
	const sz = shotSize(d);
	if (sz?.width && sz.height) lastSize.set(m.id, sz);
}

/**
 * The screen's box, at the screenshot's own proportions and at most
 * SHOT_MAX tall: it keeps its size while the next screenshot loads,
 * rather than folding to nothing for a frame and the card under it
 * jumping.
 */
function shotBox(d: Uint8Array) {
	const sz = shotSize(d);
	return sz && sz.width && sz.height ? boxOf(sz) : {};
}

const boxOf = (sz: { width: number; height: number }) => ({ width: Math.round(Math.min(SHOT_MAX * (sz.width / sz.height), 2000)), aspectRatio: `${sz.width} / ${sz.height}` as const });

/** Each machine's last screen size, for the box its first look fills while it loads. */
const lastSize = new Map<string, { width: number; height: number }>();

/** The box a look fills before its screen comes: the machine's last screen's, else a phone's or a computer's proportions. */
function loadingBox(m: Machine) {
	const k = shots.get(m.id);
	const sz = (k && shotSize(k.data)) || lastSize.get(m.id) || (m.kind === "android" || m.kind === "ios" ? { width: 9, height: 20 } : { width: 16, height: 10 });
	return boxOf(sz);
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
function lookIfStale(m: Machine) {
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

export function card(m: Machine, thread: string): Child {
	const t = turnsOf(m);
	const h = t.holder;
	const mine = h?.thread === thread;
	const yours = h?.thread === USER;
	const carry = carried(m.id);
	const waiting = t.waiting.filter((w) => !w.kept).length;
	const rec = recording.get(m.id);
	lookIfStale(m);
	const k = shots.get(m.id);
	if (k) remember(m, k.data);
	const busy = looking.has(m.id) && !looking.get(m.id);
	const problem = looking.get(m.id);
	const tag: [string, "green" | "accent" | "amber" | "muted"] = carry ? ["You carry it", "muted"] : yours ? ["Yours", "accent"] : mine ? ["This thread", "accent"] : h ? ["In use", "amber"] : ["Free", "green"];
	const who = yours ? "You have it" : h ? `${mine ? "This thread" : plainTitle(h.thread)} has it` : "";
	const detail = carry
		? "Agents only install and uninstall your test builds here, and read their logs."
		: h
			? `${who} since ${ago(h.since)}${h.note ? `: ${h.note}` : ""}${rec ? ", recording" : ""}${waiting ? ` · ${waiting} waiting` : ""}${yours ? ". Agents wait until you give it back." : "."}`
			: "Free: the next agent to use it gets it at once.";
	return (
		<ui.box key={m.id} label={m.name} style={{ padding: "s5", gap: 10, borderRadius: "card", backgroundColor: "raised", border: "1px solid border" }}>
			<ui.box style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
				<ui.box style={{ width: 32, height: 32, borderRadius: "control", backgroundColor: "hover", alignItems: "center", justifyContent: "center", flexShrink: 0, alignSelf: "flex-start" }}>
					<ui.icon icon={KIND_ICON[m.kind] ?? "computer"} style={{ width: 16, height: 16, color: "text2" }} />
				</ui.box>
				<ui.box style={{ flex: 1, minWidth: 0, gap: 1 }}>
					<ui.text style={{ fontWeight: 600, ...line }}>{m.name}</ui.text>
					<ui.text style={{ fontSize: "small", color: "text3", ...line }}>{m.about}</ui.text>
				</ui.box>
				<ui.tag tone={tag[1]} style={{ flexShrink: 0 }}>{tag[0]}</ui.tag>
			</ui.box>
			{k && !carry ? (
				<ui.box style={{ borderRadius: "control", overflow: "hidden", border: "1px solid border", position: "relative", alignSelf: "flex-start", maxWidth: "100%", ...shotBox(k.data) }}>
					<ui.image src={k.data} alt={`Screenshot of ${m.name}`} style={shotSize(k.data) ? { width: "100%", height: "100%" } : { maxWidth: "100%", maxHeight: SHOT_MAX }} />
					<ui.box style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "s3 s4", background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent)" }}>
						<ui.text style={{ color: "white", fontSize: "small", ...line }}>{watching.has(m.id) ? "Live · every few seconds" : `${ago(k.at)} · ${k.by === USER ? "by you" : plainTitle(k.by)}`}</ui.text>
					</ui.box>
				</ui.box>
			) : busy ? (
				<ui.box style={{ ...loadingBox(m), maxWidth: "100%", alignSelf: "flex-start", borderRadius: "control", backgroundColor: "hover", animation: { name: "shimmer" } }} />
			) : null}
			<ui.text style={{ fontSize: "small", color: "text2" }}>{detail}</ui.text>
			{problem ? <ui.text style={{ fontSize: "small", color: "red" }}>{problem}</ui.text> : null}
			<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
				{!carry && (
					<ui.button size="sm" kind="soft" icon="eye" tooltip={`Look at ${m.name} now`} disabled={busy} onClick={() => void look(m)}>
						{busy ? "Looking…" : "Look now"}
					</ui.button>
				)}
				{/* Watch: screenshots every few seconds, where there's no live view. */}
				{!carry && !m.screen && (
					<ui.button size="sm" kind="ghost" icon={watching.has(m.id) ? "pause" : "play"} tooltip={watching.has(m.id) ? `Stop watching ${m.name}` : `Watch ${m.name}: a screenshot every few seconds, for 5 minutes`} onClick={() => watch(m, !watching.has(m.id))}>
						{watching.has(m.id) ? "Stop watching" : "Watch"}
					</ui.button>
				)}
				{m.screen && !carry && (
					<ui.button size="sm" kind="soft" icon="monitor" href={m.screen} tooltip={`${m.name}'s screen in Swarm, live. An agent on it keeps its turn: Use it myself to take it.`}>
						Live view
					</ui.button>
				)}
				{yours ? (
					<ui.button size="sm" kind="soft" icon="check" tooltip={`Give ${m.name} back`} onClick={() => void claim(m, false)}>Give it back</ui.button>
				) : (
					<ui.button size="sm" kind="ghost" icon="hand" tooltip={`Use ${m.name} myself`} onClick={() => void claim(m, true)}>Use it myself</ui.button>
				)}
				{h && !yours && (
					<ui.button size="sm" kind="ghost" tooltip={mine ? `Release ${m.name}` : `End the turn on ${m.name}`} onClick={() => void t.release(h.thread)}>
						{mine ? "Release" : "End its turn"}
					</ui.button>
				)}
			</ui.box>
		</ui.box>
	);
}

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
export function unusedPhones(): Child {
	const unused = found.phones.filter((f) => !f.id && !f.problem);
	if (!unused.length) return null;
	const names = unused.map((f) => f.model);
	const said = names.length === 1 ? `${names[0]} is plugged in` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are plugged in`;
	return (
		<ui.box style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", padding: "s4 s5", borderRadius: "card", backgroundColor: "raised", border: "1px solid border" }}>
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

/** A group of cards under its heading: Phones, Computers. */
export function group(title: string, children: Child, columns: { minWidth: number; style: { gridTemplateColumns: number } }[]): Child {
	return (
		<ui.box style={{ gap: 8 }}>
			<ui.text style={{ fontSize: "small", fontWeight: 600, color: "text2", paddingLeft: 4 }}>{title}</ui.text>
			<ui.box style={{ display: "grid", gridTemplateColumns: 1, gap: 10, media: columns }}>{children}</ui.box>
		</ui.box>
	);
}

export function registerPanel() {
	ui.panel({
		id: "machines",
		title: "Machines",
		icon: "laptop-mobile",
		render: ({ thread }) => (
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
						<>
							{st.machines.some(isPhone) || unusedPhones() ? group("Phones", [unusedPhones(), ...st.machines.filter(isPhone).map((m) => card(m, thread))], [{ minWidth: 760, style: { gridTemplateColumns: 2 } }]) : null}
							{st.machines.some((m) => !isPhone(m)) ? group("Computers", st.machines.filter((m) => !isPhone(m)).map((m) => card(m, thread)), [{ minWidth: 760, style: { gridTemplateColumns: 2 } }]) : null}
						</>
					)}
				</ui.box>
			</ui.scroll>
		),
	});
}
