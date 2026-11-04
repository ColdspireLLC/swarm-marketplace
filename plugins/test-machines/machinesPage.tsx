// The Test machines page, on the window's rail: every machine at once,
// its latest screen and who has it, the phones plugged in and not used
// yet, each turned on from here, and a badge of the machines agents are
// on. The Machines panel beside a thread shows the same cards; Settings
// keeps how the machines are reached.
import { ui, type Child } from "swarm";
import { discover, found, type Found } from "./discover";
import { card, group, isPhone, SETUP } from "./panel";
import { phoneRow } from "./settingsPage";
import { learnTitles, refresh, st, turnsOf } from "./state";
import { USER } from "./turns";

export const NAV = "test-machines";

const COLUMNS = [
	{ minWidth: 760, style: { gridTemplateColumns: 2 } },
	{ minWidth: 1100, style: { gridTemplateColumns: 3 } },
];

/** Phones: those in use, as cards, then those plugged in and not used yet, each turned on from here. */
function phonesGroup(unused: Found[]): Child {
	const used = st.machines.filter(isPhone);
	return (
		<ui.box style={{ gap: 10 }}>
			{group("Phones", used.length ? used.map((m) => card(m, "")) : unused.length ? null : <ui.text style={{ color: "text2", paddingLeft: 4 }}>No phones yet: plug one into a computer joined to Swarm.</ui.text>, COLUMNS)}
			{unused.length ? (
				<ui.box style={{ padding: "s5 s6", gap: 14, borderRadius: "card", backgroundColor: "raised", border: "1px solid border" }}>
					<ui.text style={{ fontSize: "small", fontWeight: 600, color: "text2" }}>Plugged in, not in use</ui.text>
					{unused.map(phoneRow)}
				</ui.box>
			) : null}
		</ui.box>
	);
}

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

function head(): Child {
	return (
		<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
			<ui.iconButton icon="refresh" label="Look for machines and phones again" onClick={() => void again()} />
			<ui.iconButton icon="settings" label="Set up test machines" href={SETUP} />
		</ui.box>
	);
}

function body(): Child {
	if (!found.at && !found.busy) void discover();
	const { held, waiting } = counts();
	const unused = found.phones.filter((f) => !f.id);
	const said = [`${st.machines.length} machine${st.machines.length === 1 ? "" : "s"}`, held ? `${held} in use by agents` : "none in use", waiting ? `${waiting} waiting` : ""].filter(Boolean).join(" · ");
	return (
		<ui.scroll style={{ flex: 1 }}>
			<ui.box style={{ padding: "s7 s8", gap: 16, maxWidth: 1200 }}>
				<ui.text style={{ color: "text2" }}>{said}</ui.text>
				{st.driverProblems.map((p, i) => (
					<ui.text key={"dp" + i} style={{ fontSize: "small", color: "red" }}>{p}</ui.text>
				))}
				{st.machines.length || unused.length ? (
					<>
						{phonesGroup(unused)}
						{st.machines.some((m) => !isPhone(m)) ? group("Computers", st.machines.filter((m) => !isPhone(m)).map((m) => card(m, "")), COLUMNS) : null}
					</>
				) : (
					<ui.box style={{ alignSelf: "center", maxWidth: 360, padding: "s8 s4", gap: 6, alignItems: "center" }}>
						<ui.text style={{ fontWeight: 500, textAlign: "center" }}>No test machines yet</ui.text>
						<ui.text style={{ fontSize: "small", color: "text2", textAlign: "center" }}>Join a computer to Swarm, or plug a phone into one, and it shows here.</ui.text>
						<ui.link label="Set up test machines" href={SETUP} />
					</ui.box>
				)}
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
