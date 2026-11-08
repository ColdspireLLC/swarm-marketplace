// The parts the page is built of, in Swarm's look.
import { ui, type Child, type IconName, type Style } from "swarm";
import * as api from "./coolify";
import type { Resource } from "./coolify";

export const faint: Style = { fontSize: "small", color: "text3", whiteSpace: "nowrap" };
export const line: Style = { flexShrink: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap" };
export const column: Style = { maxWidth: 760, width: "100%", alignSelf: "center", paddingLeft: 32, paddingRight: 32 };
export const top: Style = { flexDirection: "row", height: 44, flexShrink: 0, alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 8 };
export const heading: Style = { fontSize: "small", fontWeight: 600, color: "text2" };
export const rowStyle: Style = { flexDirection: "row", width: "100%", gap: 10, alignItems: "center", padding: "s4 s5", hover: { backgroundColor: "hover" }, checked: { backgroundColor: "selected" }, transition: { duration: 120, colors: true } };

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

/** Figures in a row, a line between each, in one card. */
export function stats(items: { value: string; label: string; tone?: "green" | "amber" | "red" | "accent" }[]): Child {
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

/** Swarm's refresh: busy turns its icon, not the button. */
export const refresh = (reading: boolean, run: () => unknown): Child => <ui.iconButton icon="refresh" label="Refresh" busy={reading} onClick={run} />;

/** Rows in Swarm's card, a line between each and the next. */
export const list = (items: Child[]): Child => (
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

export function iconOf(r: { type: string }): IconName {
	if (r.type === "application") return "cube";
	if (r.type === "service") return "layers";
	return "database";
}

/** A section's heading, with what acts on it at its end. */
export const sectionHead = (title: string, ...end: Child[]): Child => (
	<ui.box style={{ flexDirection: "row", alignItems: "center", minHeight: 24, gap: 4 }}>
		<ui.text style={heading}>{title}</ui.text>
		<ui.spacer />
		{end}
	</ui.box>
);

/** A log in Swarm's code viewer: selectable across lines, copied with the keyboard, scrolled within its height. */
export function logBox(key: string, text: string, height = 420, larger?: { title: string }): Child {
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
	ui.showOverlay("coolify-log");
}

/** The overlay of a log at full size, its copy beside its title. */
export function registerLogOverlay() {
	ui.overlay({
		id: "coolify-log",
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

/** A row of facts: what it is, then its value. */
export const fact = (label: string, value: Child): Child => (
	<ui.box key={label} style={{ flexDirection: "row", gap: 12, alignItems: "center", minHeight: 30, padding: "0 s5" }}>
		<ui.text style={{ ...faint, width: 120, flexShrink: 0 }}>{label}</ui.text>
		<ui.box style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap", paddingTop: 4, paddingBottom: 4 }}>{value}</ui.box>
	</ui.box>
);

/** A figure of the overview: a number, what it counts, and a tone. */
export const tile = (value: string, label: string, tone?: "green" | "amber" | "red" | "accent"): Child => (
	<ui.card key={label} padding="s5 s6" gap="s1" style={{ flex: 1, minWidth: 120 }}>
		<ui.text style={{ fontSize: 22, fontWeight: 500, color: tone ?? "text" }}>{value}</ui.text>
		<ui.text style={faint}>{label}</ui.text>
	</ui.card>
);

/** What a resource is built from, in a few words. */
export function sourceText(r: Resource): string {
	if (r.type !== "application") return api.typeLabel(r.type);
	if (r.build_pack === "dockerimage") return `${r.docker_registry_image_name ?? "image"}${r.docker_registry_image_tag ? ":" + r.docker_registry_image_tag : ""}`;
	return r.git_repository ? `${r.git_repository}${r.git_branch ? " @ " + r.git_branch : ""}` : api.typeLabel(r.type);
}

/** How a deployment was started. */
export const howDeployed = (d: { rollback?: boolean; restart_only?: boolean; is_webhook?: boolean; is_api?: boolean }) => (d.rollback ? "Rollback" : d.restart_only ? "Restart" : d.is_webhook ? "Push" : d.is_api ? "API" : "Manual");

/** A deployment's title: its commit's message, else what it deployed. */
export function deploymentTitle(d: { commit?: string | null; commit_message?: string | null; rollback?: boolean; restart_only?: boolean }, r?: Resource): string {
	const msg = d.commit_message?.split("\n")[0]?.trim();
	if (msg) return msg;
	if (d.rollback) return "Rollback";
	if (d.restart_only) return "Restart";
	if (r?.build_pack === "dockerimage") return `Deploy ${r.docker_registry_image_tag || "latest"}`;
	return "Deploy";
}
