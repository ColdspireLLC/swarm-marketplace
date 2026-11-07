// What the user sees: beside a thread, the Simulators panel (the thread's
// own simulators first, their last screen and their live view, then every
// agent simulator, who has it and who waits), and the row above the
// composer while the thread holds one.
import { ui, type Child } from "swarm";
import * as ops from "./ops";
import { PLATFORM_NAME } from "./ops";
import type { Slot } from "./pool";
import { info, key, liveLink, placed, pool, shots, slimOn, title, view } from "./state";

const line = { flexShrink: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

function ago(at: number) {
	const s = Math.max(0, (ui.now() - at) / 1000);
	return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
}

/** How a slot is, in a few words. */
function stateOf(s: Slot): string {
	const i = info(s);
	if (i.busy) return i.busy[0]!.toUpperCase() + i.busy.slice(1) + "…";
	if (i.problem && !s.holder) return "Failed";
	return i.booted ? (i.slim ? "Running, slim" : "Running") : "Shut down";
}

function screen(s: Slot, big: boolean): Child {
	const k = shots.get(key(s));
	const size = s.platform === "ios" ? (big ? { width: 160, height: 346 } : { width: 40, height: 86 }) : big ? { width: 160, height: 356 } : { width: 40, height: 89 };
	return (
		<ui.box style={{ ...size, borderRadius: big ? 14 : 6, overflow: "hidden", backgroundColor: "black", border: "1px solid border", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
			{k ? <ui.image src={k.data} alt={`${info(s).name}'s last screen`} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <ui.icon icon="mobile" style={{ width: 16, height: 16, color: "text3" }} />}
		</ui.box>
	);
}

/** Its machine, as ui.screen names it: a joined one's id, "server" for Swarm's own computer; none over ssh. */
function machineOf(s: Slot): string {
	const w = placed.get(s.platform);
	if (!w || w.ssh) return "";
	return w.machine ?? "server";
}

/**
 * A simulator the thread holds, or held last: live, in the panel, as bb's
 * side panel shows it (only watching while the agent drives it; Use it
 * takes it over), with how it is and what the user does with it. Where
 * Swarm can't show it live (over ssh), its last screenshot.
 */
function mineCard(s: Slot, thread: string): Child {
	const i = info(s);
	const w = placed.get(s.platform);
	const k = shots.get(key(s));
	const machine = machineOf(s);
	const held = s.holder?.thread === thread;
	const device = s.platform === "ios" ? (i.udid ? { simulator: i.udid } : null) : i.serial ? { phone: i.serial } : null;
	return (
		<ui.box key={key(s)} style={{ gap: 10 }}>
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
				<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
					<ui.text style={{ fontWeight: 600, ...line }}>{i.name}</ui.text>
					<ui.text style={{ fontSize: "small", color: "text2", ...line }}>{`${PLATFORM_NAME[s.platform]} · ${held ? stateOf(s) : "given back, kept for this thread"}${w ? ` · ${w.label}` : ""}`}</ui.text>
					{held && s.holder?.note ? <ui.text style={{ fontSize: "small", color: "text2" }}>{s.holder.note}</ui.text> : null}
				</ui.box>
				{held ? <ui.iconButton icon="stop" label="Give it back: the agent's turn on it ends" onClick={() => ops.endTurn(s)} /> : null}
			</ui.box>
			{i.problem ? <ui.text style={{ fontSize: "small", color: "red" }}>{i.problem}</ui.text> : null}
			{machine && device && i.booted && (ui.format ?? 0) >= 17 ? (
				<ui.screen machine={machine} {...device} watch={held ? "this thread's agent" : undefined} label={i.name} style={{ alignSelf: "center", width: "100%", maxWidth: 380 }} />
			) : (
				<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
					{screen(s, true)}
					<ui.box style={{ flex: 1, minWidth: 0, gap: 6 }}>
						<ui.text style={{ fontSize: "small", color: "text2" }}>{i.booted ? (k ? `Its screen from ${ago(k.at)}.` : "Not looked at yet.") : "Shut down: the agent's next call boots it."}</ui.text>
						{i.booted ? <ui.button label="Look" icon="refresh" kind="ghost" onClick={() => ops.lookAt(s)} /> : null}
					</ui.box>
				</ui.box>
			)}
		</ui.box>
	);
}

/** A row of the pool. */
function row(s: Slot, thread: string): Child {
	const i = info(s);
	const who = s.holder ? (s.holder.thread === thread ? "This thread" : title(s.holder.thread)) : "Free";
	return (
		<ui.box key={key(s)} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", padding: "s3 s2" }}>
			{screen(s, false)}
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<ui.text style={{ fontWeight: 500, ...line }}>{i.name}</ui.text>
				<ui.text style={{ fontSize: "small", color: "text2", ...line }}>{`${who} · ${stateOf(s)}`}</ui.text>
			</ui.box>
			{s.holder && s.holder.thread !== thread ? <ui.iconButton icon="stop" label={`End ${title(s.holder.thread)}'s hold on ${i.name}`} onClick={() => ops.endTurn(s)} /> : null}
		</ui.box>
	);
}

function empty(): Child {
	return (
		<ui.box style={{ alignSelf: "center", maxWidth: 320, padding: "s8 s4", gap: 6, alignItems: "center" }}>
			<ui.box style={{ width: 40, height: 40, borderRadius: "card", backgroundColor: "field", boxShadow: "inset 0 0 0 1px divider", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
				<ui.icon icon="mobile" style={{ width: 18, height: 18, color: "text2" }} />
			</ui.box>
			<ui.text style={{ fontWeight: 500, textAlign: "center" }}>No agent simulators yet</ui.text>
			<ui.text style={{ fontSize: "small", color: "text2", textAlign: "center" }}>{`An agent gets an iOS simulator or Android emulator of its own the first time it needs one${slimOn() ? ", slim" : ""}.`}</ui.text>
		</ui.box>
	);
}

export function registerPanel() {
	ui.panel({
		id: "simulators",
		title: "Simulators",
		icon: "mobile",
		render: ({ thread }) => {
			void view.v;
			const mine = pool.slots.filter((s) => s.holder?.thread === thread || (!s.holder && s.last === thread));
			const others = [...pool.slots].sort((a, b) => a.platform.localeCompare(b.platform) || a.n - b.n);
			const waiting = pool.waiting;
			return (
				<ui.scroll style={{ flex: 1 }}>
					<ui.box style={{ padding: "s6", gap: 16 }}>
						<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
							<ui.text style={{ fontWeight: 600 }}>Simulators</ui.text>
							<ui.spacer />
							<ui.iconButton icon="refresh" label="Look at them again" onClick={() => ops.look()} />
						</ui.box>
						{mine.map((s) => mineCard(s, thread))}
						{mine.length ? <ui.divider /> : null}
						{others.length ? (
							<ui.box style={{ gap: 4 }}>
								<ui.text style={{ fontSize: "small", fontWeight: 600, color: "text2" }}>Agents' simulators</ui.text>
								{others.map((s) => row(s, thread))}
							</ui.box>
						) : (
							empty()
						)}
						{waiting.length ? <ui.text style={{ fontSize: "small", color: "text2" }}>{`Waiting: ${waiting.map((w) => `${title(w.thread)} (${w.platform === "ios" ? "iOS" : "Android"})`).join(", ")}`}</ui.text> : null}
					</ui.box>
				</ui.scroll>
			);
		},
	});

	ui.context({
		id: "simulators",
		title: "Simulators",
		icon: "mobile",
		group: "simulators",
		summary: ({ thread }) => {
			void view.v;
			const mine = pool.heldBy(thread);
			const waits = pool.waiting.filter((w) => w.thread === thread);
			if (!mine.length && !waits.length) return null;
			const s = mine[0];
			const verb = s ? (info(s).busy ? info(s).busy[0]!.toUpperCase() + info(s).busy.slice(1) : s.running ? "Using" : "Holding") : "Waiting for";
			const name = s ? info(s).name : waits[0]!.platform === "ios" ? "an iOS simulator" : "an Android emulator";
			return (
				<ui.box label={`${verb} ${name}`} style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
					<ui.text style={{ fontWeight: 500, color: s ? (s.running || info(s).busy ? "accent" : "text2") : "amber", flexShrink: 0 }}>{verb}</ui.text>
					<ui.text style={{ fontWeight: 500, ...line }}>{name}</ui.text>
					{s ? <ui.text style={{ color: "text3", flexShrink: 0 }}>{"goes back when this turn ends"}</ui.text> : null}
					{mine.length > 1 ? <ui.text style={{ color: "text3", flexShrink: 0 }}>{`+${mine.length - 1}`}</ui.text> : null}
				</ui.box>
			);
		},
		badge: ({ thread }) => {
			void view.v;
			const s = pool.heldBy(thread).find((x) => x.running > 0);
			return s ? <ui.box label="Live" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "accent", animation: { name: "pulse" } }} /> : null;
		},
		action: ({ thread }) => {
			void view.v;
			const mine = pool.heldBy(thread);
			if (!mine.length) return null;
			const w = placed.get(mine[0]!.platform);
			const live = w ? liveLink(w, mine[0]!, title(thread)) : "";
			return live ? <ui.iconButton icon="eye" label={`Watch ${info(mine[0]!).name} live`} href={live} /> : <ui.iconButton icon="stop" label="Give this thread's simulators back" onClick={() => mine.forEach((s) => ops.endTurn(s))} />;
		},
	});
}
