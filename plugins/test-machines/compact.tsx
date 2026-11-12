// The machines on a phone (args.compact "1"): the page's bar has its
// title, Back and the page's head, so these draw no title of their own.
// Each machine is a row of a card, its latest screen as a thumbnail, who
// has it as a dot and a line; a tap opens the machine (a page of the
// rail's, or the row opened in place in a thread's panel): its screen as
// wide as the phone allows at its own shape, live or its latest
// screenshot, and what the user does there, in buttons a thumb reaches.
import { ui, type Child } from "swarm";
import type { Found } from "./discover";
import type { Machine } from "./drivers";
import { liveLink, NAV, standing, watchingLive } from "./machinesPage";
import { ago, isPhone, KIND_ICON, line, look, lookIfStale, looking, SETUP, watch, watching } from "./panel";
import { carried } from "./rules";
import { phoneRow } from "./settingsPage";
import { claim, plainTitle, shots, turnsOf } from "./state";
import { USER } from "./turns";

/** A card's fill on a phone: the background, 5% toward the text. */
export const CARD = "color-mix(in srgb, text 5%, bg)";
/** The phone's side margins. */
export const SIDE = 16;

/** A section's heading on a phone: uppercase, small, quiet; what follows it at its end. */
export function heading(title: string, count?: number, end?: Child): Child {
	return (
		<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 4, minHeight: end ? 36 : undefined }}>
			<ui.text style={{ fontSize: "caption", fontWeight: 600, color: "text3", textTransform: "uppercase" }}>{title}</ui.text>
			{count !== undefined ? <ui.text style={{ fontSize: "caption", fontWeight: 600, color: "text3" }}>{String(count)}</ui.text> : null}
			{end ? <ui.spacer /> : null}
			{end}
		</ui.box>
	);
}

/** A card of rows, with dividers inset to the rows' text. inset is where the text starts. */
export function card(rows: Child[], inset = SIDE): Child {
	return (
		<ui.box style={{ borderRadius: 10, backgroundColor: CARD }}>
			{rows.map((r, i) => (
				<ui.box key={i}>
					{i ? <ui.box style={{ height: 1, marginLeft: inset, backgroundColor: "divider" }} /> : null}
					{r}
				</ui.box>
			))}
		</ui.box>
	);
}

/** The width and height a PNG or JPEG says it is; null where it says neither. */
export function imageSize(d: Uint8Array): { w: number; h: number } | null {
	if (d.length > 24 && d[0] === 0x89 && d[1] === 0x50) {
		const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
		return { w: v.getUint32(16), h: v.getUint32(20) };
	}
	if (d[0] !== 0xff || d[1] !== 0xd8) return null;
	let i = 2;
	while (i + 9 < d.length) {
		if (d[i] !== 0xff) return null;
		const mark = d[i + 1]!;
		const len = (d[i + 2]! << 8) | d[i + 3]!;
		// A frame's start (SOF0…SOF15, not DHT, JPG or DAC): its height, then its width.
		if (mark >= 0xc0 && mark <= 0xcf && mark !== 0xc4 && mark !== 0xc8 && mark !== 0xcc) {
			return { h: (d[i + 5]! << 8) | d[i + 6]!, w: (d[i + 7]! << 8) | d[i + 8]! };
		}
		i += 2 + len;
	}
	return null;
}

/** A machine's shape, from its latest screenshot or its kind. */
function aspect(m: Machine): number {
	const k = shots.get(m.id);
	const s = k ? imageSize(k.data) : null;
	if (s && s.w > 0 && s.h > 0) return s.w / s.h;
	return isPhone(m) ? 9 / 20 : 16 / 10;
}

/** A row's thumbnail: the latest screen, small, at the machine's shape; its kind's icon where there's none. */
function thumb(m: Machine): Child {
	lookIfStale(m);
	const k = shots.get(m.id);
	const phone = isPhone(m);
	const size = phone ? { width: 26, height: 52 } : { width: 52, height: 34 };
	if (!k || carried(m.id)) {
		return (
			<ui.box style={{ ...size, borderRadius: 6, backgroundColor: "hover", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
				<ui.icon icon={KIND_ICON[m.kind] ?? "computer"} style={{ width: 14, height: 14, color: "text3" }} />
			</ui.box>
		);
	}
	return <ui.image src={k.data} alt={`${m.name}'s latest screen`} style={{ ...size, borderRadius: 6, backgroundColor: "black", objectFit: "contain", flexShrink: 0 }} />;
}

/** A machine's row: its thumbnail, its name, and who has it; a tap opens it. open says it's open below (the panel's). */
export function machineRow(m: Machine, thread: string, onOpen: () => void, open = false): Child {
	const s = standing(m, thread);
	const problem = looking.get(m.id);
	return (
		<ui.pressable key={m.id} label={`${m.name}: ${s.said}`} role="button" onClick={onOpen} style={{ flexDirection: "row", gap: 12, alignItems: "center", minHeight: 64, padding: `8px ${SIDE}px` }}>
			{thumb(m)}
			<ui.box style={{ flex: 1, minWidth: 0, gap: 3 }}>
				<ui.text style={{ fontWeight: 500, ...line }}>{m.name}</ui.text>
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
					<ui.box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.dot, flexShrink: 0 }} />
					<ui.text style={{ fontSize: "small", color: "text2", ...line }}>{problem ? problem : `${s.said} · ${s.more}`}</ui.text>
				</ui.box>
			</ui.box>
			<ui.icon icon={open ? "chevron-down" : "chevron-right"} style={{ width: 14, height: 14, color: "text3", flexShrink: 0 }} />
		</ui.pressable>
	);
}

/** The phones' Swarm view of a machine: its link's machine, and which phone on it. */
function screenProps(m: Machine): { machine: string; phone?: string; iphone?: string } | null {
	const u = /^swarm:\/\/screen\/([^?]*)(?:\?(.*))?$/.exec(m.screen ?? "");
	if (!u) return null;
	const q = new Map((u[2] ?? "").split("&").filter(Boolean).map((p) => p.split("=").map(decodeURIComponent) as [string, string]));
	return { machine: decodeURIComponent(u[1]!), ...(q.get("phone") ? { phone: q.get("phone") } : {}), ...(q.get("iphone") ? { iphone: q.get("iphone") } : {}) };
}

/** The machines shown live on the phone, in place of their latest screenshot. */
const live = ui.store(new Set<string>(), { shallow: true });

/**
 * A machine's screen on a phone: as wide as the phone, at its own shape;
 * a phone's narrower, so its controls stay on the screen under it. Live
 * where the user asked and Swarm can show it, else its latest screenshot.
 */
function bigScreen(m: Machine, thread: string): Child {
	const phone = isPhone(m);
	const box = phone ? ({ width: 190, alignSelf: "center" } as const) : ({ width: "100%" } as const);
	const h = turnsOf(m).holder;
	const props = screenProps(m);
	if (carried(m.id)) {
		return (
			<ui.box style={{ ...box, aspectRatio: aspect(m), borderRadius: 10, backgroundColor: CARD, alignItems: "center", justifyContent: "center", padding: SIDE }}>
				<ui.text style={{ fontSize: "small", color: "text3", textAlign: "center" }}>Not shown: the phone you carry</ui.text>
			</ui.box>
		);
	}
	if (live.has(m.id) && props && (ui.format ?? 0) >= 17) {
		const watch = h && h.thread !== USER ? (h.thread === thread ? "this thread's agent" : plainTitle(h.thread)) : undefined;
		return <ui.screen {...props} watch={watch} label={`${m.name}'s screen`} style={box} />;
	}
	lookIfStale(m);
	const k = shots.get(m.id);
	if (!k) return <ui.box style={{ ...box, aspectRatio: aspect(m), borderRadius: 10, backgroundColor: "hover", animation: { name: "shimmer" } }} />;
	// The box holds the shape, the picture fills it: a picture's own height isn't its shown width's.
	return (
		<ui.box style={{ ...box, aspectRatio: aspect(m), borderRadius: 10, backgroundColor: "black" }}>
			<ui.image src={k.data} alt={`Screenshot of ${m.name}`} viewer style={{ width: "100%", height: "100%", borderRadius: 10, objectFit: "contain" }} />
		</ui.box>
	);
}

/** A button of the machine's, half the row: a thumb's. */
function act(label: string, icon: Parameters<typeof ui.button>[0]["icon"], onClick: () => unknown, kind: "primary" | "soft" | "secondary" | "danger" = "secondary", busy = false): Child {
	return (
		<ui.box style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }}>
			<ui.button kind={kind} size="md" icon={icon} disabled={busy} onClick={onClick} style={{ width: "100%", minHeight: 44 }}>
				{label}
			</ui.button>
		</ui.box>
	);
}

/** What the user does on a machine, as a thumb's buttons: the way to its screen and a look, then taking it or ending a turn. */
function actions(m: Machine, thread: string): Child {
	const t = turnsOf(m);
	const h = t.holder;
	const yours = h?.thread === USER;
	const carry = carried(m.id);
	const busy = looking.has(m.id) && !looking.get(m.id);
	const isLive = live.has(m.id);
	const see: Child[] = [];
	if (!carry && screenProps(m) && (ui.format ?? 0) >= 17) {
		see.push(
			act(isLive ? "Screenshot" : "Live view", isLive ? "image" : "monitor", () => {
				if (isLive) live.delete(m.id);
				else {
					live.add(m.id);
					watchingLive(m);
				}
			}),
		);
	} else if (!carry && m.screen) {
		see.push(
			<ui.box style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }}>
				<ui.button kind="secondary" size="md" icon="monitor" href={liveLink(m)} onClick={() => watchingLive(m)} style={{ width: "100%", minHeight: 44 }}>
					Live view
				</ui.button>
			</ui.box>,
		);
	}
	if (!carry && !m.screen) see.push(act(watching.has(m.id) ? "Stop watching" : "Watch", watching.has(m.id) ? "pause" : "play", () => watch(m, !watching.has(m.id))));
	if (!carry && !isLive) see.push(act(busy ? "Looking…" : "Look now", "refresh", () => void look(m), "secondary", busy));
	const take: Child[] = [];
	if (h && !yours) take.push(act(h.thread === thread ? "Release" : "End turn", "stop", () => void t.release(h.thread), "danger"));
	if (yours) take.push(act("Give it back", "check", () => void claim(m, false), "primary"));
	else take.push(act("Use it myself", "hand", () => void claim(m, true), h ? "secondary" : "primary"));
	return (
		<ui.box style={{ gap: 8 }}>
			{see.length ? <ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{see}</ui.box> : null}
			<ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{take}</ui.box>
		</ui.box>
	);
}

/** Who has a machine and what's done there, and how old its screen is. */
function status(m: Machine, thread: string): Child {
	const s = standing(m, thread);
	const k = shots.get(m.id);
	return (
		<ui.box style={{ flexDirection: "row", gap: 10, alignItems: "center", minWidth: 0 }}>
			<ui.box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.dot, flexShrink: 0 }} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<ui.text style={{ fontWeight: 500 }}>{s.said}</ui.text>
				<ui.text style={{ fontSize: "small", color: "text2" }}>{s.more}</ui.text>
			</ui.box>
			{k && !live.has(m.id) && !carried(m.id) ? <ui.text style={{ fontSize: "small", color: "text3", flexShrink: 0 }}>{watching.has(m.id) ? "Watching" : ago(k.at)}</ui.text> : null}
		</ui.box>
	);
}

/** A machine opened in place, under its row in a thread's panel, which says who has it: its screen, and what the user does there. */
export function machineDetail(m: Machine, thread: string): Child {
	const problem = looking.get(m.id);
	return (
		<ui.box style={{ gap: 14, padding: `4px ${SIDE}px ${SIDE}px` }}>
			{bigScreen(m, thread)}
			{problem ? <ui.text style={{ fontSize: "small", color: "red" }}>{problem}</ui.text> : null}
			{actions(m, thread)}
		</ui.box>
	);
}

/** The machine page's path, and the machine a path names. */
export const machinePath = (m: Machine) => `machine/${encodeURIComponent(m.id)}`;
export const pathMachine = (path: string | undefined) => (path?.startsWith("machine/") ? decodeURIComponent(path.slice(8)) : "");

/**
 * A machine's page on a phone, the rail's page at its path: its screen
 * scrolls, and what the user does there stays at the foot, under the
 * thumb.
 */
export function machinePage(m: Machine): Child {
	const problem = looking.get(m.id);
	return (
		<ui.box style={{ flex: 1, minHeight: 0 }}>
			<ui.scroll style={{ flex: 1 }}>
				<ui.box style={{ padding: `12px ${SIDE}px ${SIDE}px`, gap: 14 }}>
					{/* Its name is the bar's (navTo's title). */}
					{status(m, "")}
					{bigScreen(m, "")}
					{problem ? <ui.text style={{ fontSize: "small", color: "red" }}>{problem}</ui.text> : null}
					<ui.text style={{ fontSize: "small", color: "text3" }}>{m.about}</ui.text>
				</ui.box>
			</ui.scroll>
			<ui.box style={{ padding: `12px ${SIDE}px`, borderTop: "1px solid divider", backgroundColor: "bg" }}>{actions(m, "")}</ui.box>
		</ui.box>
	);
}

/** The phones plugged in and not used yet, as a phone's card. */
export function unusedCard(unused: Found[]): Child {
	if (!unused.length) return null;
	return (
		<ui.box style={{ gap: 8 }}>
			{heading("Plugged in, not in use", unused.length)}
			{card(unused.map((f) => <ui.box style={{ padding: `12px ${SIDE}px` }}>{phoneRow(f, true)}</ui.box>))}
		</ui.box>
	);
}

/** The rail's page on a phone: the machines in cards, each opening its own page. */
export function pageList(o: { phones: Machine[]; computers: Machine[]; unused: Found[]; problems: string[]; said: string }): Child {
	const open = (m: Machine) => () => ui.navTo(NAV, machinePath(m), { title: m.name });
	return (
		<ui.scroll style={{ flex: 1 }}>
			<ui.box style={{ padding: `12px ${SIDE}px ${SIDE + 8}px`, gap: 20 }}>
				{o.said ? <ui.text style={{ fontSize: "small", color: "text2", paddingLeft: 4 }}>{o.said}</ui.text> : null}
				{o.problems.map((p, i) => (
					<ui.text key={"dp" + i} style={{ fontSize: "small", color: "red" }}>{p}</ui.text>
				))}
				{o.phones.length ? (
					<ui.box style={{ gap: 8 }}>
						{heading("Phones", o.phones.length)}
						{card(o.phones.map((m) => machineRow(m, "", open(m))), SIDE + 26 + 12)}
					</ui.box>
				) : null}
				{unusedCard(o.unused)}
				{o.computers.length ? (
					<ui.box style={{ gap: 8 }}>
						{heading("Computers", o.computers.length)}
						{card(o.computers.map((m) => machineRow(m, "", open(m))), SIDE + 52 + 12)}
					</ui.box>
				) : null}
			</ui.box>
		</ui.scroll>
	);
}

/** The machine open in a thread's panel on a phone, by thread. */
const opened = ui.store(new Map<string, string>(), { shallow: true });

/** The rows of a section of a thread's panel on a phone: each opens below itself. */
export function panelRows(thread: string, ms: Machine[]): Child[] {
	const now = opened.get(thread) ?? "";
	return ms.map((m) => (
		<ui.box key={m.id}>
			{machineRow(m, thread, () => (now === m.id ? opened.delete(thread) : opened.set(thread, m.id)), now === m.id)}
			{now === m.id ? machineDetail(m, thread) : null}
		</ui.box>
	));
}
