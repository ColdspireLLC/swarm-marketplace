// The Test machines page, on the window's rail: every machine at once, as
// a tile shaped like its screen (phones narrow and tall, computers wide),
// its latest screen filling the top, who has it in a line under it, and
// what the user does there in a row of buttons; the phones plugged in and
// not used yet, each turned on from here; and a badge of the machines
// agents are on. The Machines panel beside a thread keeps its own cards,
// for its narrow column; Settings keeps how the machines are reached.
import { ui, type Child, type Color } from "swarm";
import { discover, found, type Found } from "./discover";
import type { Machine } from "./drivers";
import { ago, isPhone, KIND_ICON, line, look, lookIfStale, looking, SETUP, watch, watching } from "./panel";
import { carried } from "./rules";
import { phoneRow } from "./settingsPage";
import { claim, doing, learnTitles, plainTitle, recording, refresh, shots, st, turnsOf } from "./state";
import { USER } from "./turns";

export const NAV = "test-machines";

/** A tile's width: a phone's narrow, a computer's wide; its screen at its own proportions under that. */
const PHONE_W = 172;
const COMPUTER_W = 344;

async function again() {
	await refresh();
	await learnTitles();
	void discover();
}

/** The machines agents have now, and those threads wait in line for. */
function counts() {
	let held = 0;
	let waiting = 0;
	for (const m of st.machines) {
		const t = turnsOf(m);
		if (t.holder && t.holder.thread !== USER) held++;
		waiting += t.waiting.filter((w) => !w.kept).length;
	}
	return { held, waiting };
}

/** Who has a machine, as a tile says it: a dot's colour, a line, and what's under it. */
function standing(m: Machine): { dot: Color; said: string; more: string } {
	const t = turnsOf(m);
	const h = t.holder;
	const waiting = t.waiting.filter((w) => !w.kept).length;
	const queue = waiting ? ` · ${waiting} waiting` : "";
	if (carried(m.id)) return { dot: "text3", said: "You carry it", more: "Your test builds only" };
	if (h?.thread === USER) return { dot: "accent", said: "Yours", more: `Agents wait until you give it back${queue}` };
	if (h) {
		const ops = (doing.get(m.id) ?? []).filter((o) => o.thread === h.thread);
		const rec = recording.get(m.id)?.thread === h.thread;
		const what = rec ? "recording" : ops.length ? ops.map((o) => o.label).join(", ") : h.note || `holding it since ${ago(h.since)}`;
		return { dot: "amber", said: plainTitle(h.thread), more: `${what}${queue}` };
	}
	return { dot: "green", said: "Free", more: "The next agent gets it at once" };
}

/** A tile's screen: the latest screenshot, its box held while the next loads, or a shimmer of the same size. */
function screenOf(m: Machine, width: number): Child {
	lookIfStale(m);
	const k = shots.get(m.id);
	const phone = isPhone(m);
	// One shape a section, so a row's tiles line up and a look's shimmer is the screen's size: a screen of
	// other proportions fits inside it, on black.
	const box = { width, aspectRatio: phone ? "9 / 20" : "16 / 10" } as const;
	if (carried(m.id)) {
		return (
			<ui.box style={{ ...box, backgroundColor: "hover", alignItems: "center", justifyContent: "center", padding: "s5" }}>
				<ui.text style={{ fontSize: "small", color: "text3", textAlign: "center" }}>Not shown: the phone you carry</ui.text>
			</ui.box>
		);
	}
	if (!k) return <ui.box style={{ ...box, backgroundColor: "hover", animation: { name: "shimmer" } }} />;
	const busy = looking.has(m.id) && !looking.get(m.id);
	return (
		<ui.box style={{ ...box, position: "relative", backgroundColor: "black", overflow: "hidden" }}>
			<ui.image src={k.data} alt={`Screenshot of ${m.name}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
			<ui.box style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "s3 s4", flexDirection: "row", gap: 6, alignItems: "center", background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)" }}>
				<ui.text style={{ color: "white", fontSize: "small", ...line, flex: 1 }}>{watching.has(m.id) ? "Watching · every few seconds" : busy ? "Looking…" : ago(k.at)}</ui.text>
			</ui.box>
		</ui.box>
	);
}

/** One machine: its screen, its name and who has it, and what the user does there. */
function tile(m: Machine): Child {
	const t = turnsOf(m);
	const h = t.holder;
	const yours = h?.thread === USER;
	const carry = carried(m.id);
	const phone = isPhone(m);
	const width = phone ? PHONE_W : COMPUTER_W;
	const s = standing(m);
	const busy = looking.has(m.id) && !looking.get(m.id);
	const problem = looking.get(m.id);
	return (
		<ui.box key={m.id} label={m.name} style={{ width, borderRadius: "card", backgroundColor: "raised", border: "1px solid border", overflow: "hidden" }}>
			{screenOf(m, width)}
			<ui.box style={{ padding: "s4 s5 s5", gap: 8 }}>
				<ui.box style={{ gap: 2 }}>
					<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
						<ui.icon icon={KIND_ICON[m.kind] ?? "computer"} style={{ width: 13, height: 13, color: "text3", flexShrink: 0 }} />
						<ui.text style={{ fontWeight: 600, ...line }}>{m.name}</ui.text>
					</ui.box>
					<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
						<ui.box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.dot, flexShrink: 0 }} />
						<ui.text style={{ fontSize: "small", fontWeight: 500, ...line }}>{s.said}</ui.text>
					</ui.box>
					<ui.text style={{ fontSize: "small", color: "text2", ...line }}>{s.more}</ui.text>
					{problem ? <ui.text style={{ fontSize: "small", color: "red" }}>{problem}</ui.text> : null}
				</ui.box>
				<ui.box style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
					{m.screen && !carry ? (
						phone ? (
							<ui.iconButton icon="monitor" label={`Live view: ${m.name}'s screen in Swarm, live. An agent on it keeps its turn.`} href={m.screen} />
						) : (
							<ui.button size="sm" kind="soft" icon="monitor" href={m.screen} tooltip={`${m.name}'s screen in Swarm, live. An agent on it keeps its turn: take it to use it.`}>
								Live view
							</ui.button>
						)
					) : null}
					<ui.spacer />
					{!carry ? <ui.iconButton icon="refresh" label={`Look at ${m.name} now`} busy={busy} disabled={busy} onClick={() => void look(m)} /> : null}
					{!carry && !m.screen ? <ui.iconButton icon={watching.has(m.id) ? "pause" : "play"} label={watching.has(m.id) ? `Stop watching ${m.name}` : `Watch ${m.name}: a screenshot every few seconds`} onClick={() => watch(m, !watching.has(m.id))} /> : null}
					{h && !yours ? <ui.iconButton icon="stop" label={`End ${plainTitle(h.thread)}'s turn on ${m.name}`} onClick={() => void t.release(h.thread)} /> : null}
					{yours ? <ui.iconButton icon="check" label={`Give ${m.name} back`} onClick={() => void claim(m, false)} /> : <ui.iconButton icon="hand" label={`Use ${m.name} myself: the agent on it is cut off, the rest wait`} onClick={() => void claim(m, true)} />}
				</ui.box>
			</ui.box>
		</ui.box>
	);
}

/** A section: its heading and how many, then its tiles, wrapping. */
function section(title: string, count: number, children: Child): Child {
	return (
		<ui.box style={{ gap: 10 }}>
			<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "baseline", paddingLeft: 2 }}>
				<ui.text style={{ fontWeight: 600 }}>{title}</ui.text>
				<ui.text style={{ color: "text3" }}>{String(count)}</ui.text>
			</ui.box>
			<ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>{children}</ui.box>
		</ui.box>
	);
}

/** Phones plugged in and not used yet, under the phones: each turned on from here. */
function unusedPhones(unused: Found[]): Child {
	if (!unused.length) return null;
	return (
		<ui.box style={{ padding: "s5 s6", gap: 14, borderRadius: "card", border: "1px dashed borderStrong", maxWidth: 720 }}>
			<ui.text style={{ fontSize: "small", fontWeight: 600, color: "text2" }}>Plugged in, not in use</ui.text>
			{unused.map(phoneRow)}
		</ui.box>
	);
}

function head(): Child {
	const { held, waiting } = counts();
	const said = [held ? `${held} in use` : "", waiting ? `${waiting} waiting` : ""].filter(Boolean).join(" · ");
	return (
		<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
			{said ? <ui.text style={{ fontSize: "small", color: "text2" }}>{said}</ui.text> : null}
			<ui.iconButton icon="refresh" label="Look for machines and phones again" onClick={() => void again()} />
			<ui.iconButton icon="settings" label="Set up test machines" href={SETUP} />
		</ui.box>
	);
}

function body(): Child {
	if (!found.at && !found.busy) void discover();
	const unused = found.phones.filter((f) => !f.id);
	const phones = st.machines.filter(isPhone);
	const computers = st.machines.filter((m) => !isPhone(m));
	if (!st.machines.length && !unused.length) {
		return (
			<ui.box style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: "s8", gap: 6 }}>
				<ui.text style={{ fontWeight: 500 }}>No test machines yet</ui.text>
				<ui.text style={{ fontSize: "small", color: "text2", textAlign: "center", maxWidth: 360 }}>Join a computer to Swarm, or plug a phone into one, and it shows here.</ui.text>
				<ui.link label="Set up test machines" href={SETUP} />
			</ui.box>
		);
	}
	return (
		<ui.scroll style={{ flex: 1 }}>
			<ui.box style={{ padding: "s7 s8", gap: 28 }}>
				{st.driverProblems.map((p, i) => (
					<ui.text key={"dp" + i} style={{ fontSize: "small", color: "red" }}>{p}</ui.text>
				))}
				{phones.length || unused.length ? (
					<ui.box style={{ gap: 12 }}>
						{section("Phones", phones.length, phones.map(tile))}
						{unusedPhones(unused)}
					</ui.box>
				) : null}
				{computers.length ? section("Computers", computers.length, computers.map(tile)) : null}
			</ui.box>
		</ui.scroll>
	);
}

/** The badge on the rail: how many machines agents are on, said again as that changes. */
let badge = "";
function updateBadge() {
	const { held } = counts();
	const next = held ? String(held) : "";
	if (next === badge) return;
	badge = next;
	ui.navBadge(NAV, next ? { text: next } : null);
}

export function registerMachinesPage() {
	ui.nav({ id: NAV, title: "Test machines", icon: "laptop-mobile", order: 60, fill: true, items: [], render: ({ args }) => (args.slot === "head" ? head() : body()) });
	// Turns change in many places (a call, a timeout, a turn's end): the badge looks every 2 s, and only says a change.
	setInterval(updateBadge, 2000);
}
