// What the page's views share: Swarm's page column and cards (as
// Requests draws them), the marks of an automation's state and of a run's,
// and the strip of its latest runs.
import { ui, type Child, type IconName, type Style, type Tone } from "swarm";
import { formatDuration, stamp } from "./cron";
import { projects } from "./runner";
import { activeRun, type Automation, type Run } from "./store";

export const NAV = "automations";

export const faint: Style = { fontSize: "small", color: "text3", whiteSpace: "nowrap" };
export const soft: Style = { fontSize: "small", color: "text2" };
export const line: Style = { flexShrink: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap" };
export const card: Style = { borderRadius: "card", boxShadow: "inset 0 0 0 1px divider", overflow: "hidden" };
export const column: Style = { maxWidth: 760, width: "100%", alignSelf: "center", paddingLeft: 32, paddingRight: 32 };
export const top: Style = { flexDirection: "row", height: 44, flexShrink: 0, alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 8 };
export const title: Style = { fontSize: 20, fontWeight: 500, whiteSpace: "nowrap" };

/** The projects' names, as Projects last said. */
export const projectNames = ui.store(new Map<string, string>());
export async function learnProjects() {
	for (const p of await projects().catch(() => [])) projectNames.set(p.id, p.name);
}

export type State = "running" | "on" | "failing" | "paused" | "done";

export function state(a: Automation): State {
	if (activeRun(a.id)) return "running";
	if (!a.enabled) return a.cron || a.nextAt ? "paused" : "done";
	return a.lastError ? "failing" : "on";
}

export const STATE: { [s in State]: { label: string; tone: Tone } } = {
	running: { label: "Running", tone: "accent" },
	on: { label: "Active", tone: "green" },
	failing: { label: "Failing", tone: "red" },
	paused: { label: "Paused", tone: "muted" },
	done: { label: "Done", tone: "muted" },
};

export const RUN: { [s in Run["status"]]: { label: string; tone: Tone; icon: IconName } } = {
	running: { label: "Running", tone: "accent", icon: "clock" },
	ok: { label: "Done", tone: "green", icon: "check-circle" },
	failed: { label: "Failed", tone: "red", icon: "alert-circle" },
	skipped: { label: "Skipped", tone: "muted", icon: "minimize" },
};

const toneColor = (t: Tone) => (t === "muted" || t === "default" || t === "faint" ? "text3" : t);

/** When it next runs, in a few words: "in 4m", "in 5h 10m" within the day, else its day and time ("Mon 09:30"). */
export function upcoming(t: number): string {
	const d = t - ui.now(30_000);
	if (d < 60_000) return "in under a minute";
	if (d < 20 * 3_600_000) return `in ${formatDuration(d)}`;
	const at = new Date(t);
	const p = (n: number) => String(n).padStart(2, "0");
	const day = d < 6 * 86_400_000 ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][at.getDay()] : stamp(t).replace(/, \d\d:\d\d$/, "");
	return `${day} ${p(at.getHours())}:${p(at.getMinutes())}`;
}

/** "in 4m", "2h ago", against the clock the render reads. */
export function relative(t: number): string {
	const d = t - ui.now(30_000);
	const abs = Math.abs(d);
	if (abs < 60_000) return d >= 0 ? "in under a minute" : "just now";
	return d >= 0 ? `in ${formatDuration(abs)}` : `${formatDuration(abs)} ago`;
}

/** What an automation does, in a few words. */
export function doing(a: Automation): string {
	if (a.mode === "script") return `${a.interpreter ?? "sh"} script${a.prompt ? ", then an agent" : ""}`;
	return a.target ? "Re-prompts a thread" : a.worktree ? "New thread in a worktree" : "New thread";
}

/** What leads an automation: its mode's icon, red where it's failing, a spinner while it runs; on its first line of text, lineHeight high. */
export function mark(a: Automation, size = 16, lineHeight = 20): Child {
	const s = state(a);
	return (
		<ui.box style={{ width: size, height: lineHeight, alignSelf: "flex-start", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
			{s === "running" ? (
				<ui.spinner tone="accent" />
			) : (
				<ui.icon icon={s === "failing" ? "alert-circle" : a.mode === "script" ? "terminal" : "bot"} style={{ width: size, height: size, color: s === "failing" ? "red" : s === "paused" || s === "done" ? "text3" : "text2" }} />
			)}
		</ui.box>
	);
}

/** A run's mark: a dot of its outcome, a spinner while it goes. */
export function runMark(r: Run): Child {
	if (r.status === "running") return <ui.spinner tone="accent" />;
	return <ui.icon icon={RUN[r.status].icon} style={{ width: 14, height: 14, color: toneColor(RUN[r.status].tone) as Style["color"], flexShrink: 0 }} />;
}

export function runTip(r: Run): string {
	const took = r.ended ? `, ${formatDuration(Math.max(1000, r.ended - r.started))}` : "";
	return `${RUN[r.status].label} · ${stamp(r.started)}${took}${r.summary ? `\n${r.summary}` : ""}`;
}

/** The latest runs, oldest at the left, a bar each in its outcome's colour, in slots of a fixed width so the rows' strips line up; slots not yet run are faint. */
export function strip(list: Run[], n = 8, height = 14): Child {
	const shown = list.slice(0, n).reverse();
	const slots = [...Array(n - shown.length).fill(null), ...shown] as (Run | null)[];
	return (
		<ui.box label={shown.length ? (shown.length === 1 ? "Its last run" : `Its last ${shown.length} runs`) : "No runs yet"} style={{ flexDirection: "row", gap: 2, alignItems: "flex-end", height, flexShrink: 0 }}>
			{slots.map((r, i) =>
				r ? (
					<ui.box key={r.id} tooltip={runTip(r)} style={{ width: 3, height: r.status === "skipped" ? height / 2 : height, borderRadius: 2, backgroundColor: (r.status === "skipped" ? "text3" : toneColor(RUN[r.status].tone)) as Style["backgroundColor"], opacity: r.status === "running" ? 0.6 : r.status === "skipped" ? 0.5 : 1 }} />
				) : (
					<ui.box key={"e" + i} style={{ width: 3, height: height / 2, borderRadius: 2, backgroundColor: "divider" }} />
				),
			)}
		</ui.box>
	);
}

/** Fills what has nothing to show, as Swarm's empty states. */
export function empty(icon: IconName, heading: string, sub = "", action?: Child): Child {
	return (
		<ui.box style={{ alignSelf: "center", maxWidth: 340, padding: "s8 s4", gap: 6, alignItems: "center" }}>
			<ui.box style={{ width: 40, height: 40, borderRadius: "card", backgroundColor: "field", boxShadow: "inset 0 0 0 1px divider", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
				<ui.icon icon={icon} style={{ width: 18, height: 18, color: "text2" }} />
			</ui.box>
			<ui.text style={{ fontWeight: 500, textAlign: "center" }}>{heading}</ui.text>
			{sub ? <ui.text style={{ ...soft, textAlign: "center" }}>{sub}</ui.text> : null}
			{action ? <ui.box style={{ marginTop: 8 }}>{action}</ui.box> : null}
		</ui.box>
	);
}

/** A labelled line of a summary card. */
export function fact(label: string, divided: boolean, ...value: Child[]): Child {
	return (
		<ui.box key={label} style={{ flexDirection: "row", minHeight: 36, gap: 8, alignItems: "center", padding: "6 12", borderTop: divided ? "1px solid divider" : undefined }}>
			<ui.text style={{ ...faint, width: 96, flexShrink: 0 }}>{label}</ui.text>
			<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{value}</ui.box>
		</ui.box>
	);
}

/** A section's small heading. */
export function heading(text: string, extra?: Child): Child {
	return (
		<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", minHeight: 24 }}>
			<ui.text style={{ fontSize: "small", fontWeight: 600, color: "text2", whiteSpace: "nowrap" }}>{text}</ui.text>
			{extra}
		</ui.box>
	);
}

export function project(id: string): Child {
	return (
		<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", flexShrink: 0 }}>
			<ui.projectIcon project={id} />
			<ui.text style={{ fontSize: "small", color: "text2", whiteSpace: "nowrap" }}>{projectNames.get(id) ?? "A project"}</ui.text>
		</ui.box>
	);
}
