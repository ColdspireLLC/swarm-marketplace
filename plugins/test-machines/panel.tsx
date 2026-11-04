// The Machines panel beside a thread: each machine, whose turn it is and
// who waits, its last screen, and what the user does with it: look, take
// it for themselves, give it back, end an agent's turn.
import { ui, type Child, type IconName } from "swarm";
import { discover, found } from "./discover";
import type { Machine } from "./drivers";
import { carried } from "./rules";
import { claim, keep, learnTitles, message, plainTitle, recording, refresh, shots, st, turnsOf } from "./state";
import { USER } from "./turns";

export const PAGE = "test-machines";
/** The link that opens the Settings page. */
const SETUP = `swarm://settings/test-machines/${PAGE}`;

const KIND_ICON: Record<string, IconName> = { mac: "laptop", linux: "computer", windows: "monitor", android: "mobile", ios: "mobile", demo: "terminal" };

const looking = ui.store(new Map<string, string>());

/** The machines the panel watches: a screenshot every few seconds, for 5 minutes at most. */
const watching = ui.store(new Map<string, number>());
const WATCH_EVERY = 3000;
const WATCH_FOR = 5 * 60_000;

function watch(m: Machine, on: boolean) {
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
async function look(m: Machine) {
	looking.set(m.id, "");
	try {
		keep(m, await m.driver.capture(m), USER);
		looking.delete(m.id);
	} catch (e) {
		looking.set(m.id, message(e));
	}
}

/** When, said anew each minute in a render (ui.now). */
function ago(at: number) {
	const s = Math.max(0, (ui.now() - at) / 1000);
	return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(at).toISOString().slice(0, 10);
}

const line = { flexShrink: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

function card(m: Machine, thread: string): Child {
	const t = turnsOf(m);
	const h = t.holder;
	const mine = h?.thread === thread;
	const yours = h?.thread === USER;
	const carry = carried(m.id);
	const waiting = t.waiting.filter((w) => !w.kept).length;
	const rec = recording.get(m.id);
	const k = shots.get(m.id);
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
				<ui.box style={{ borderRadius: "control", overflow: "hidden", border: "1px solid border", position: "relative", alignSelf: "flex-start", maxWidth: "100%" }}>
					<ui.image src={k.data} alt={`Screenshot of ${m.name}`} style={{ maxWidth: "100%", maxHeight: 360 }} />
					<ui.box style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "s3 s4", background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent)" }}>
						<ui.text style={{ color: "white", fontSize: "small", ...line }}>{watching.has(m.id) ? "Live · every few seconds" : `${ago(k.at)} · ${k.by === USER ? "by you" : plainTitle(k.by)}`}</ui.text>
					</ui.box>
				</ui.box>
			) : busy ? (
				<ui.box style={{ height: 96, borderRadius: "control", backgroundColor: "hover", animation: { name: "shimmer" } }} />
			) : null}
			<ui.text style={{ fontSize: "small", color: "text2" }}>{detail}</ui.text>
			{problem ? <ui.text style={{ fontSize: "small", color: "red" }}>{problem}</ui.text> : null}
			<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
				{!carry && (
					<ui.button size="sm" kind="soft" icon="eye" tooltip={`Look at ${m.name} now`} disabled={busy} onClick={() => void look(m)}>
						{busy ? "Looking…" : "Look now"}
					</ui.button>
				)}
				{!carry && (
					<ui.button size="sm" kind="ghost" icon={watching.has(m.id) ? "pause" : "play"} tooltip={watching.has(m.id) ? `Stop watching ${m.name}` : `Watch ${m.name}: a screenshot every few seconds, for 5 minutes`} onClick={() => watch(m, !watching.has(m.id))}>
						{watching.has(m.id) ? "Stop watching" : "Watch"}
					</ui.button>
				)}
				{m.screen && !carry && (
					<ui.button size="sm" kind="soft" icon="monitor" href={m.screen} tooltip={`Open ${m.name}'s screen in Swarm, live, and use it yourself: agents wait until you give it back`} onClick={() => void (yours || claim(m, true))}>
						Open
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
function unusedPhones(): Child {
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
					{unusedPhones()}
					{st.machines.length === 0 ? empty() : (
						<ui.box style={{ display: "grid", gridTemplateColumns: 1, gap: 10, media: [{ minWidth: 760, style: { gridTemplateColumns: 2 } }] }}>
							{st.machines.map((m) => card(m, thread))}
						</ui.box>
					)}
				</ui.box>
			</ui.scroll>
		),
	});
}
