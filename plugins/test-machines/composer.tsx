// The row above a thread's composer: each machine the thread uses, holds
// or waits for, with what it does there and for how long, so the user
// sees it without opening the Machines panel. Its end ends the thread's
// turn there; open, each machine's latest screen, Watch, Open and End
// turn.
import { ui, type Child, type Color } from "swarm";
import { ago, KIND_ICON, line, look, watch, watching } from "./panel";
import { plainTitle, shots, turnsOf, usesOf, type Use } from "./state";
import { USER } from "./turns";

/** The page of all the machines, on the rail. */
export const MACHINES_PAGE = "swarm://plugin/test-machines";

/** "0:42", "12:05", "1:02:03". */
export function timer(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const RANK: Record<Use["state"], number> = { using: 0, holding: 1, waiting: 2, looking: 3 };

/** The thread's uses, the busiest first: what the row's line says. */
function ranked(thread: string): Use[] {
	return usesOf(thread).sort((a, b) => Number(!!b.recording) - Number(!!a.recording) || RANK[a.state] - RANK[b.state]);
}

/** A use as words: its verb, its tone, and what follows the machine's name. */
export function said(u: Use): { verb: string; tone: Color; meta: string[]; label: string } {
	const name = u.m.name;
	if (u.recording && u.state !== "waiting") return { verb: "Recording", tone: "red", meta: u.ops.map((o) => o.label), label: `This thread is recording ${name}` };
	switch (u.state) {
		case "using":
			return { verb: "Using", tone: "accent", meta: u.ops.map((o) => o.label), label: `This thread is using ${name}: ${u.ops.map((o) => o.label).join(", ")}` };
		case "holding":
			return { verb: "Holding", tone: "text2", meta: ["goes back when this turn ends"], label: `This thread holds ${name} until its turn ends` };
		case "looking":
			return { verb: "Looking at", tone: "text2", meta: u.ops.map((o) => o.label), label: `This thread is looking at ${name}` };
		case "waiting": {
			const by = u.holder === USER ? "you have it" : u.holder ? `${plainTitle(u.holder)} has it` : "";
			const place = u.kept ? "its place is kept" : u.position === 1 ? "next in line" : `#${u.position} in line`;
			return { verb: "Waiting for", tone: "amber", meta: [place, by].filter(Boolean), label: `This thread is waiting in line for ${name}` };
		}
	}
}

/** The end of the row: end the thread's turn on the machine, or leave the line. */
function endButton(u: Use, thread: string): Child {
	if (u.state === "looking") return null;
	const waiting = u.state === "waiting";
	return (
		<ui.iconButton
			icon={waiting ? "x" : "stop"}
			label={waiting ? `Take this thread out of ${u.m.name}'s line` : `End this thread's turn on ${u.m.name}: the next in line gets it`}
			onClick={() => void turnsOf(u.m).release(thread)}
		/>
	);
}

/** One machine in the open row: its latest screen, what the thread does there, and what the user can do. */
function detail(u: Use, thread: string): Child {
	const s = said(u);
	const k = shots.get(u.m.id);
	const phone = u.m.kind === "android" || u.m.kind === "ios";
	return (
		<ui.box key={u.m.id} label={s.label} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", minHeight: 30 }}>
			{k ? (
				<ui.box style={{ borderRadius: "control", overflow: "hidden", border: "1px solid border", flexShrink: 0 }}>
					<ui.image src={k.data} alt={`${u.m.name}'s latest screen`} style={phone ? { width: 34, height: 72 } : { width: 96, height: 60 }} />
				</ui.box>
			) : (
				<ui.icon icon={KIND_ICON[u.m.kind] ?? "computer"} style={{ width: 14, height: 14, marginTop: 3, color: "text3", flexShrink: 0 }} />
			)}
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<ui.text style={line}>
					<ui.text style={{ fontWeight: 500, color: s.tone }}>{s.verb}</ui.text>
					{` ${u.m.name}`}
				</ui.text>
				<ui.text style={{ fontSize: "small", color: "text2" }}>{[...s.meta, k ? `screen ${ago(k.at)}` : ""].filter(Boolean).join(" · ")}</ui.text>
				<ui.box style={{ flexDirection: "row", gap: 6, paddingTop: 4, flexWrap: "wrap" }}>
					<ui.button size="sm" kind="ghost" icon={watching.has(u.m.id) ? "pause" : "play"} onClick={() => watch(u.m, !watching.has(u.m.id))}>{watching.has(u.m.id) ? "Stop watching" : "Watch"}</ui.button>
					{!k ? <ui.button size="sm" kind="ghost" icon="eye" onClick={() => void look(u.m)}>Look now</ui.button> : null}
					{u.m.screen ? <ui.button size="sm" kind="ghost" icon="monitor" href={u.m.screen}>Open</ui.button> : null}
					{u.state !== "looking" ? (
						<ui.button size="sm" kind="ghost" onClick={() => void turnsOf(u.m).release(thread)}>{u.state === "waiting" ? "Leave the line" : "End turn"}</ui.button>
					) : null}
				</ui.box>
			</ui.box>
		</ui.box>
	);
}

export function registerComposer() {
	ui.context({
		id: "machines",
		title: "Test machines",
		icon: "laptop-mobile",
		group: "test-machines",
		summary: ({ thread }) => {
			const uses = ranked(thread);
			if (!uses.length) return null;
			const u = uses[0]!;
			const s = said(u);
			const now = ui.now(1000);
			const live = u.state === "using" || !!u.recording;
			return (
				<ui.box label={s.label} style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
					{/* Swarm draws the row's laptop-mobile icon before it: a machine's own would say it twice. */}
					{live ? (
						<ui.box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.tone, flexShrink: 0, animation: { name: "pulse" } }} />
					) : u.state === "waiting" ? (
						<ui.icon icon="clock" style={{ width: 13, height: 13, color: "text3", flexShrink: 0 }} />
					) : null}
					<ui.text style={{ fontWeight: 500, color: s.tone, flexShrink: 0 }}>{s.verb}</ui.text>
					<ui.text style={{ fontWeight: 500, flexShrink: 0 }}>{u.m.name}</ui.text>
					{s.meta.length ? <ui.text style={{ ...line, color: "text2" }}>{s.meta.join(" · ")}</ui.text> : null}
					<ui.text style={{ color: "text3", fontFamily: "mono", fontSize: 12, flexShrink: 0 }}>{timer(now - u.since)}</ui.text>
					{uses.length > 1 ? <ui.text style={{ color: "text3", flexShrink: 0 }}>{`+${uses.length - 1}`}</ui.text> : null}
				</ui.box>
			);
		},
		action: ({ thread }) => {
			const uses = ranked(thread);
			return uses.length === 1 ? endButton(uses[0]!, thread) : uses.length ? <ui.iconButton icon="external" label="All test machines" href={MACHINES_PAGE} /> : null;
		},
		details: ({ thread }) => {
			const uses = ranked(thread);
			if (!uses.length) return null;
			return (
				<ui.box style={{ gap: 10 }}>
					{uses.map((u) => detail(u, thread))}
					<ui.box style={{ alignSelf: "flex-start" }}>
						<ui.link label="All test machines" href={MACHINES_PAGE} />
					</ui.box>
				</ui.box>
			);
		},
	});
}
