// The parts the page is built of, in Swarm's look (as Coolify's plugin has them), and
// what Proxmox adds: a meter of what's used, and a graph of the last hour.
import { ui, type Child, type IconName, type Style } from "swarm";
import type * as api from "./pve";

/**
 * Whether the surface being drawn is a phone's (args.compact "1"). Each
 * render sets it as it starts; renders run one at a time, so the parts
 * below read it while they're built.
 */
export const phone = { on: false };
export const setPhone = (args: { compact?: string }) => void (phone.on = args.compact === "1");

/** A phone's card: a shade off the page, rounded, no border and no clip (a clip under Android's stretch costs a mask pass a frame). */
export const phoneCard: Style = { backgroundColor: "color-mix(in srgb, text 5%, bg)", borderRadius: 10 };

export const faint: Style = { fontSize: "small", color: "text3", whiteSpace: "nowrap" };
export const line: Style = { flexShrink: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap" };
const desktopColumn: Style = { maxWidth: 760, width: "100%", alignSelf: "center", paddingLeft: 32, paddingRight: 32 };
const phoneColumn: Style = { width: "100%", paddingLeft: 16, paddingRight: 16 };
/** The page's column: centred on a desktop, the screen's width less 16 each side on a phone. */
export const columnStyle = (): Style => (phone.on ? phoneColumn : desktopColumn);
export const column: Style = desktopColumn;
export const top: Style = { flexDirection: "row", height: 44, flexShrink: 0, alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 8 };
export const heading: Style = { fontSize: "small", fontWeight: 600, color: "text2" };
const desktopRow: Style = { flexDirection: "row", width: "100%", gap: 10, alignItems: "center", padding: "s4 s5", hover: { backgroundColor: "hover" }, checked: { backgroundColor: "selected" }, transition: { duration: 120, colors: true } };
const phoneRow: Style = { flexDirection: "row", width: "100%", gap: 12, alignItems: "center", minHeight: 56, padding: "10 14", active: { backgroundColor: "hover" }, checked: { backgroundColor: "selected" }, transition: { duration: 120, colors: true } };
/** A row of a list: a finger's height on a phone. */
export const rowOf = (): Style => (phone.on ? phoneRow : desktopRow);
export const rowStyle: Style = desktopRow;
/** A line of a row that gives way to what's beside it, ellipsized, on a phone; as it was on a desktop. */
export const fitted = (s: Style): Style => (phone.on ? { ...s, flexShrink: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap" } : s);

/** A state as Swarm's badge: Running in green, Failed in red. */
export const badge = (tone: api.Tone | "accent", label: string): Child => (
	<ui.tag tone={tone} style={{ flexShrink: 0 }}>
		{label}
	</ui.tag>
);

/** A state as a dot of its tone, the word in its label: what the composer's row shows in place of a badge. */
export const dot = (tone: api.Tone | "accent", label: string, live = false): Child => (
	<ui.box label={label} style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: tone === "muted" ? "text3" : tone, ...(live ? { animation: { name: "pulse" } } : {}) }} />
);

export function empty(icon: IconName, title: string, sub = "", action?: Child): Child {
	return (
		<ui.box style={{ marginTop: "auto", marginBottom: "auto", alignSelf: "center", maxWidth: 340, padding: 16, gap: 6, alignItems: "center" }}>
			<ui.box style={{ width: 40, height: 40, borderRadius: "card", backgroundColor: "field", boxShadow: "inset 0 0 0 1px divider", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
				<ui.icon icon={icon} style={{ width: 18, height: 18, color: "text2" }} />
			</ui.box>
			<ui.text style={{ fontWeight: 500, textAlign: "center" }}>{title}</ui.text>
			{sub ? <ui.text style={{ fontSize: "small", color: "text2", textAlign: "center" }}>{sub}</ui.text> : null}
			{action ? <ui.box style={{ marginTop: 8 }}>{action}</ui.box> : null}
		</ui.box>
	);
}

export function skeleton(widths: number[]): Child {
	const bar: Style = { height: 10, borderRadius: 4, backgroundColor: "hover", animation: { name: "shimmer", duration: 1400, iterationCount: "infinite" } };
	return (
		<ui.box style={{ flexGrow: 1, overflow: "hidden", padding: 12, gap: 12 }}>
			{widths.map((w, i) => (w ? <ui.box key={i} style={{ ...bar, width: `${w}%` }} /> : <ui.box key={i} style={{ height: 10 }} />))}
		</ui.box>
	);
}

/** What shows while something's read: a small spinner and a word, where it will be. */
export function loading(what = "Loading…", big = false): Child {
	return (
		<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", padding: big ? 48 : 20, ...(big ? { flexGrow: 1 } : {}) }}>
			<ui.spinner />
			<ui.text style={{ fontSize: "small", color: "text3" }}>{what}</ui.text>
		</ui.box>
	);
}

/** Figures in a row, a line between each, in one card; on a phone, two by two. */
export function stats(items: { value: string; label: string; tone?: "green" | "amber" | "red" | "accent" }[]): Child {
	if (phone.on) {
		const cell = (it: (typeof items)[number]) => (
			<ui.box key={it.label} style={{ ...phoneCard, flex: 1, minWidth: 0, padding: "12 14", gap: 2 }}>
				<ui.text style={{ fontSize: 20, fontWeight: 500, color: it.tone ?? "text" }}>{it.value}</ui.text>
				<ui.text style={{ ...faint, ...line }}>{it.label}</ui.text>
			</ui.box>
		);
		const rows: Child[] = [];
		for (let i = 0; i < items.length; i += 2) rows.push(<ui.box key={`r${i}`} style={{ flexDirection: "row", gap: 8 }}>{items.slice(i, i + 2).map(cell)}</ui.box>);
		return <ui.box style={{ gap: 8 }}>{rows}</ui.box>;
	}
	return (
		<ui.card padding="s0" gap="s0" style={{ flexDirection: "row" }}>
			{items.flatMap((it, i) => [
				...(i ? [<ui.box key={`line-${i}`} style={{ width: 1, flexShrink: 0, alignSelf: "stretch", backgroundColor: "divider" }} />] : []),
				<ui.box key={it.label} style={{ flex: 1, minWidth: 0, padding: "s4 s5", gap: 2 }}>
					<ui.text style={{ fontSize: 18, fontWeight: 500, color: it.tone ?? "text" }}>{it.value}</ui.text>
					<ui.text style={{ ...faint, ...line }}>{it.label}</ui.text>
				</ui.box>,
			])}
		</ui.card>
	);
}

/** A bone of a loading shape: a line or a mark still to come. */
export const bone = (width: number | `${number}%`, height = 10, style?: Style): Child => (
	<ui.box style={{ width, height, flexShrink: 0, borderRadius: 4, backgroundColor: "hover", animation: { name: "shimmer" }, ...style }} />
);

/** The overview's shape while Proxmox is first read, as the page lays it out: the search, the counts, and rows in cards under their headings. */
export function overviewBones(): Child {
	const rows = (widths: number[]) => (
		<ui.card padding="s0" gap="s0">
			{widths.map((w, i) => (
				<ui.box key={i} style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: "s4 s5", minHeight: 51, borderTop: i ? "1px solid divider" : undefined }}>
					{bone(14, 14)}
					<ui.box style={{ flex: 1, minWidth: 0, gap: 7 }}>
						{bone(`${w}%`)}
						{bone(`${w * 0.7}%`, 8)}
					</ui.box>
					{bone(52, 18)}
				</ui.box>
			))}
		</ui.card>
	);
	return (
		<ui.box style={{ ...columnStyle(), flexGrow: 1, minHeight: 0, overflow: "hidden", gap: 16 }}>
			{bone("100%", 28, { marginBottom: -4 })}
			<ui.card padding="s0" gap="s0" style={{ flexDirection: "row" }}>
				{[0, 1, 2, 3].map((i) => [
					i ? <ui.box key={`line-${i}`} style={{ width: 1, flexShrink: 0, alignSelf: "stretch", backgroundColor: "divider" }} /> : null,
					<ui.box key={i} style={{ flex: 1, minWidth: 0, padding: "s4 s5", gap: 8 }}>
						{bone(36, 16)}
						{bone(64, 8)}
					</ui.box>,
				])}
			</ui.card>
			<ui.box style={{ gap: 8 }}>
				{bone(110)}
				{rows([34])}
			</ui.box>
			<ui.box style={{ gap: 8 }}>
				{bone(130)}
				{rows([52, 44, 60, 38])}
			</ui.box>
		</ui.box>
	);
}

/** Swarm's refresh: busy turns its icon, not the button. */
export const refresh = (reading: boolean, run: () => unknown): Child => <ui.iconButton icon="refresh" label="Refresh" busy={reading} onClick={run} />;

/** Rows in Swarm's card, a line between each and the next; on a phone, the phone's card, its lines inset. */
export const list = (items: Child[]): Child =>
	phone.on ? (
		<ui.box style={phoneCard}>{items.flatMap((row, i) => (i === 0 ? [row] : [<ui.box key={`line-${i}`} style={{ height: 1, marginLeft: 14, backgroundColor: "divider" }} />, row]))}</ui.box>
	) : (
		<ui.card padding="s0" gap="s0">
			{items.flatMap((row, i) => (i === 0 ? [row] : [<ui.divider key={`line-${i}`} />, row]))}
		</ui.card>
	);

export function problem(text: string): Child {
	return (
		<ui.box style={{ flexDirection: "row", gap: "s4", alignItems: "flex-start", padding: "s4 s5", borderRadius: "card", backgroundColor: "redSoft" }}>
			<ui.icon icon="alert-circle" style={{ width: 15, height: 15, color: "red", flexShrink: 0 }} />
			<ui.text style={{ flex: 1, minWidth: 0 }} selectable>
				{text}
			</ui.text>
		</ui.box>
	);
}

/** Swarm's own search field: Escape and × clear it. */
export const searchField = (key: string, value: string, placeholder: string, set: (v: string) => void): Child => <ui.search key={key} value={value} placeholder={placeholder} onChange={set} />;

/** A phone's section heading: caption, uppercase, semibold, faint. */
const phoneHeading: Style = { fontSize: "caption", fontWeight: 600, color: "text3", textTransform: "uppercase", paddingLeft: 4 };

/** A section's heading, with what acts on it at its end. */
export const sectionHead = (title: string, ...end: Child[]): Child => (
	<ui.box style={{ flexDirection: "row", alignItems: "center", minHeight: phone.on ? 28 : 24, gap: 4 }}>
		<ui.text style={phone.on ? phoneHeading : heading}>{title}</ui.text>
		<ui.spacer />
		{end}
	</ui.box>
);

/** The lines a log shows in place on a phone; the rest is a tap away, in the overlay. */
const PHONE_LINES = 120;

/**
 * A log on a phone: the newest lines, monospace, wrapped, on the page's own
 * scroll (no scroll of its own inside it, which Android's stretch makes
 * slow), Copy and All of it under them.
 */
function phoneLog(key: string, text: string, larger?: { title: string }): Child {
	const all = text.split("\n");
	const shown = all.length > PHONE_LINES ? all.slice(-PHONE_LINES).join("\n") : text;
	return (
		<ui.box key={key} style={{ gap: 8, minWidth: 0 }}>
			{all.length > PHONE_LINES ? <ui.text style={{ ...faint, whiteSpace: "normal" }}>{`The newest ${PHONE_LINES} of ${all.length.toLocaleString()} lines.`}</ui.text> : null}
			<ui.box style={{ ...phoneCard, padding: "10 12" }}>
				<ui.text selectable style={{ fontFamily: "mono", fontSize: 11, lineHeight: 1.45, color: "text2", whiteSpace: "pre-wrap" }}>{shown || " "}</ui.text>
			</ui.box>
			<ui.box style={{ flexDirection: "row", gap: 8 }}>
				<ui.button kind="secondary" icon="copy" onClick={() => { ui.copy(text); ui.toast("Copied the log."); }} style={{ flex: 1 }}>Copy</ui.button>
				{larger ? <ui.button kind="secondary" icon="maximize" onClick={() => openBigLog(larger.title, text)} style={{ flex: 1 }}>All of it</ui.button> : null}
			</ui.box>
		</ui.box>
	);
}

/** A log in Swarm's code viewer: selectable across lines, copied with the keyboard, scrolled within its height. */
export function logBox(key: string, text: string, height = 420, larger?: { title: string }): Child {
	if (phone.on) return phoneLog(key, text, larger);
	return (
		<ui.box key={key} style={{ position: "relative", minWidth: 0 }}>
			<ui.source key="src" text={text || " "} style={{ maxHeight: height, minHeight: Math.min(height, 120) }} />
			{/* Copy and Larger in the corner, over the log, as Swarm's code blocks keep their copy. */}
			<ui.box style={{ position: "absolute", top: 6, right: 6, flexDirection: "row", gap: 2, padding: 2, borderRadius: "control", backgroundColor: "raised", boxShadow: "inset 0 0 0 1px divider" }}>
				<ui.iconButton icon="copy" label="Copy the log" onClick={() => { ui.copy(text); ui.toast("Copied the log."); }} style={{ width: 24, height: 24 }} />
				{larger ? <ui.iconButton icon="maximize" label="Open the log larger" onClick={() => openBigLog(larger.title, text)} style={{ width: 24, height: 24 }} /> : null}
			</ui.box>
		</ui.box>
	);
}

/** The log the overlay shows, larger. */
export const bigLog = { title: "", text: "" };

export function openBigLog(title: string, text: string) {
	bigLog.title = title;
	bigLog.text = text;
	ui.showOverlay("proxmox-log");
}

/** The overlay of a log at full size, its copy beside its title. */
export function registerLogOverlay() {
	ui.overlay({
		id: "proxmox-log",
		width: 1100,
		onClose: () => void (bigLog.text = ""),
		render: () => (
			<ui.box style={{ gap: 10 }}>
				<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<ui.text style={{ fontWeight: 600, ...line }}>{bigLog.title}</ui.text>
					<ui.spacer />
					<ui.button size="sm" kind="ghost" icon="copy" onClick={() => { ui.copy(bigLog.text); ui.toast("Copied the log."); }}>Copy</ui.button>
				</ui.box>
				<ui.source key="big-log" text={bigLog.text || " "} style={{ maxHeight: 640, minHeight: 200 }} />
			</ui.box>
		),
	});
}

/** Whether a line of a container's log reads as an error. */
export const errorLine = (s: string) => /\b(error|err!|fatal|panic|exception|traceback)\b/i.test(s);

/** A row of facts: what it is, then its value; on a phone, the label above its value. */
export const fact = (label: string, value: Child): Child =>
	phone.on ? (
		<ui.box key={label} style={{ gap: 4, padding: "10 14", minHeight: 52, justifyContent: "center" }}>
			<ui.text style={faint}>{label}</ui.text>
			<ui.box style={{ minWidth: 0, flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{value}</ui.box>
		</ui.box>
	) : (
	<ui.box key={label} style={{ flexDirection: "row", gap: 12, alignItems: "center", minHeight: 30, padding: "0 s5" }}>
		<ui.text style={{ ...faint, width: 120, flexShrink: 0 }}>{label}</ui.text>
		<ui.box style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap", paddingTop: 4, paddingBottom: 4 }}>{value}</ui.box>
	</ui.box>
	);

/** How full something is, as a bar: amber past 80%, red past 90%. */
export function meter(f: number | undefined, tone?: "accent" | "green" | "amber" | "red"): Child {
	const v = f === undefined || !isFinite(f) ? 0 : Math.max(0, Math.min(1, f));
	const t = tone ?? (v >= 0.9 ? "red" : v >= 0.8 ? "amber" : "accent");
	return (
		<ui.box style={{ height: 6, borderRadius: 3, backgroundColor: "hover", overflow: "hidden", width: "100%" }}>
			<ui.box style={{ width: `${Math.round(v * 1000) / 10}%` as `${number}%`, height: "100%", borderRadius: 3, backgroundColor: t }} />
		</ui.box>
	);
}

/** A figure with its meter: what it is, how much, and of what. */
export function usage(label: string, f: number | undefined, detail: string): Child {
	return (
		<ui.box key={label} style={{ flex: 1, minWidth: phone.on ? 0 : 140, gap: 6 }}>
			<ui.box style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
				<ui.text style={{ ...faint, color: "text2" }}>{label}</ui.text>
				<ui.spacer />
				<ui.text style={{ fontSize: 13, fontWeight: 500 }}>{f === undefined ? "—" : `${(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`}</ui.text>
			</ui.box>
			{meter(f)}
			<ui.text style={{ ...faint, ...line }}>{detail}</ui.text>
		</ui.box>
	);
}

/** A series of a graph: its values (undefined where Proxmox has none), its name, its colour, and how a value reads. */
export interface Series {
	name: string;
	values: (number | undefined)[];
	color: "accent" | "green" | "amber" | "red" | "violet";
	format: (v: number) => string;
}

const W = 600;
const H = 110;

/**
 * A graph of the last hour (or day, or week), as Swarm's Usage draws its:
 * each series an area under its line, the scale from 0 to max (or the
 * largest value), and a tip at each point naming its time and values.
 */
export function graph(key: string, title: string, times: number[], series: Series[], max?: number): Child {
	const n = times.length;
	const top = max ?? Math.max(1e-9, ...series.flatMap((s) => s.values.filter((v): v is number => v !== undefined && isFinite(v))));
	const now = series.map((s) => [...s.values].reverse().find((v) => v !== undefined));
	const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
	const y = (v: number) => H - 4 - (Math.min(v, top) / top) * (H - 8);
	const span = n > 1 ? times[n - 1]! - times[0]! : 0;
	const when = (t: number) => {
		const d = new Date(t * 1000);
		const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		return span > 2 * 86400 ? `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${hm}` : hm;
	};
	return (
		<ui.card key={key} padding={phone.on ? "s3 s4" : "s4 s5"} gap="s3">
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
				<ui.text style={{ fontWeight: 500, fontSize: 13 }}>{title}</ui.text>
				<ui.spacer />
				{series.map((s, i) => (
					<ui.box key={s.name} style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
						<ui.box style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.color }} />
						<ui.text style={faint}>{series.length > 1 ? `${s.name} ${now[i] === undefined ? "—" : s.format(now[i]!)}` : now[i] === undefined ? "—" : s.format(now[i]!)}</ui.text>
					</ui.box>
				))}
			</ui.box>
			{n < 2 ? (
				<ui.box style={{ height: 80, alignItems: "center", justifyContent: "center" }}>
					<ui.text style={faint}>No data yet.</ui.text>
				</ui.box>
			) : (
				<ui.canvas
					label={`${title}, ${series.map((s, i) => `${s.name} ${now[i] === undefined ? "none" : s.format(now[i]!)}`).join(", ")}`}
					width={W}
					height={H}
					fit="fill"
					style={{ width: "100%", height: 80 }}
					draw={(g) => {
						for (const f of [0.5, 1]) g.line(0, y(top * f), W, y(top * f), { stroke: "divider", lineWidth: 1 });
						g.line(0, H - 4, W, H - 4, { stroke: "divider", lineWidth: 1 });
						for (const s of series) {
							// Each run of points Proxmox has, apart: no line across a gap.
							let run: number[] = [];
							const flush = () => {
								if (run.length >= 4) {
									g.poly([...run, run[run.length - 2]!, H - 4, run[0]!, H - 4], { fill: s.color, opacity: 0.14 }, true);
									g.poly(run, { stroke: s.color, lineWidth: 2 });
								}
								run = [];
							};
							s.values.forEach((v, i) => {
								if (v === undefined || !isFinite(v)) return flush();
								run.push(x(i), y(v));
							});
							flush();
						}
						const w = W / n;
						times.forEach((t, i) =>
							g.hit(`p${i}`, Math.max(0, x(i) - w / 2), 0, w, H, {
								title: when(t),
								rows: series.map((s) => ({ label: s.name, value: s.values[i] === undefined ? "—" : s.format(s.values[i]!), color: s.color })),
							}),
						);
					}}
				/>
			)}
			{n >= 2 ? (
				<ui.box style={{ flexDirection: "row" }}>
					<ui.text style={faint}>{when(times[0]!)}</ui.text>
					<ui.spacer />
					<ui.text style={faint}>{when(times[n - 1]!)}</ui.text>
				</ui.box>
			) : null}
		</ui.card>
	);
}

/** A question before what can't be undone at once, as Swarm asks it: what happens, then the act and a way out. */
export function confirmBox(title: string, detail: string, act: string, onYes: () => void, onNo: () => void, keep = "Cancel"): Child {
	return (
		<ui.box style={{ flexDirection: "row", gap: "s4", alignItems: "flex-start", padding: "s4 s5", borderRadius: "card", backgroundColor: "redSoft" }}>
			<ui.icon icon="alert" style={{ width: 15, height: 15, color: "red", flexShrink: 0 }} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 8 }}>
				<ui.text style={{ fontWeight: 500 }}>{title}</ui.text>
				<ui.text style={{ fontSize: "small", color: "text2" }}>{detail}</ui.text>
				<ui.box style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
					<ui.button kind="danger" size="sm" onClick={onYes}>{act}</ui.button>
					<ui.button kind="ghost" size="sm" onClick={onNo}>{keep}</ui.button>
				</ui.box>
			</ui.box>
		</ui.box>
	);
}
