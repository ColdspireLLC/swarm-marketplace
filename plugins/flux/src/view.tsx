// What the Flux plugin draws (SWARM-188): an issue as bb's Flux panel
// shows it, in Swarm's look: its key, title and parent, its properties
// as pickers opening Swarm's own menus, its description with task lists,
// code and links, its sub-issues and its activity. Colors are the
// theme's tokens, so it follows the user's theme, dark and contrast;
// icons are Swarm's and Nucleo's, and Flux's status and priority glyphs
// are drawn on canvases.
import { ui, type Child, type ColorValue, type Style } from "swarm";
import type { Comment, Issue, IssueDetail, Label, Member, Project } from "./contract";
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type ColorName, type Priority, type Status } from "./flux";
import { asIcon, emojiImage, glyphImage, MARK_HEX } from "./marks";

/** A Flux color, as the theme's where it has one. */
export const colorOf: Record<ColorName, ColorValue> = {
	gray: "text3",
	red: "red",
	orange: "#d9711c",
	yellow: "amber",
	green: "green",
	cyan: "#1597a8",
	blue: "accent",
	indigo: "#5b5bd6",
	purple: "violet",
	pink: "#d6409f",
};

const STATUS_COLOR: Record<Status, ColorValue> = {
	backlog: "text2",
	todo: "text2",
	progress: "amber",
	review: "violet",
	complete: "green",
	canceled: "text3",
};

/** Flux's status glyph: a ring, filled as far as the work has come. */
export function StatusIcon({ status, size = 14 }: { status: Status; size?: number }) {
	const c = STATUS_COLOR[status];
	return (
		<ui.canvas label={STATUS_LABELS[status]} width={14} height={14} style={{ width: size, height: size, flexShrink: 0 }}
			draw={(g) => {
				switch (status) {
					case "backlog":
						for (let i = 0; i < 12; i++) g.arc(7, 7, 6, i * 30 - 90, i * 30 - 77, { stroke: c, lineWidth: 1.5 });
						break;
					case "todo":
						g.circle(7, 7, 6, { stroke: c, lineWidth: 1.5 });
						break;
					case "progress":
					case "review":
						g.circle(7, 7, 6, { stroke: c, lineWidth: 1.5 });
						g.arc(7, 7, 4, -90, status === "progress" ? 180 : 90, { fill: c });
						break;
					case "complete":
						g.circle(7, 7, 6, { fill: c });
						g.path("M4.2 7.15 L6.15 9.1 L9.8 5.25", { stroke: "bg", lineWidth: 1.5 });
						break;
					case "canceled":
						g.circle(7, 7, 6, { fill: c });
						g.path("M5 5 L9 9 M9 5 L5 9", { stroke: "bg", lineWidth: 1.5 });
						break;
				}
			}} />
	);
}

/** Flux's priority glyph: bars as high as it is; urgent, a red mark. */
export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
	if (priority === "none") return <ui.text style={{ fontSize: 14, color: "text2", width: size, textAlign: "center" }}>–</ui.text>;
	const level = { urgent: 4, high: 3, medium: 2, low: 1 }[priority];
	return (
		<ui.canvas label={PRIORITY_LABELS[priority]} width={14} height={14} style={{ width: size, height: size, flexShrink: 0 }}
			draw={(g) => {
				if (priority === "urgent") {
					g.rect(0.5, 0.5, 13, 13, "red", { radius: 3 });
					g.rect(6.2, 3, 1.6, 5.5, "white", { radius: 0.8 });
					g.rect(6.2, 9.6, 1.6, 1.6, "white", { radius: 0.8 });
					return;
				}
				for (let i = 0; i < 3; i++) g.rect(1.5 + i * 4, 10 - i * 3.2, 3, 3 + i * 3.2, i < level ? "text" : "borderStrong", { radius: 1 });
			}} />
	);
}

/** A member's avatar: their picture, or their initial in their color. */
export function Avatar({ member, size = 18 }: { member: Member | undefined; size?: number }) {
	if (!member) return <ui.icon icon="user" style={{ width: size - 4, height: size - 4, color: "text3" }} />;
	if (member.avatarUrl) {
		return <ui.image src={member.avatarUrl} alt={member.name} style={{ width: size, height: size, borderRadius: "full", objectFit: "cover", flexShrink: 0 }} />;
	}
	return (
		<ui.box label={member.name} style={{ width: size, height: size, borderRadius: "full", backgroundColor: colorOf[member.avatarColor], alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
			<ui.text style={{ color: "white", fontSize: Math.round(size * 0.5), fontWeight: 600 }}>{(member.name || member.username).slice(0, 1).toUpperCase()}</ui.text>
		</ui.box>
	);
}

/** Flux's own mark: the three chevrons, in the text's color. */
export function FluxMark({ size = 14, color = "text2" }: { size?: number; color?: ColorValue }) {
	return <ui.icon icon="icon.svg" style={{ width: size, height: size, color, flexShrink: 0 }} />;
}

/** A project's mark: its emoji or icon, or its key's first letter in its color. No project is Flux's own mark. */
export function ProjectMark({ project, size = 14 }: { project: Project | undefined; size?: number }) {
	if (!project) return <FluxMark size={size} />;
	const box = { width: size, height: size, flexShrink: 0 } as const;
	const emoji = emojiImage(project?.emoji);
	if (emoji) return <ui.image src={emoji} alt={project?.key ?? "Project"} style={box} />;
	const icon = asIcon(project?.icon);
	if (icon && project) return <ui.icon icon={icon} style={{ ...box, color: colorOf[project.color] }} />;
	const glyph = project ? glyphImage(project.icon, MARK_HEX[project.color]) : null;
	if (glyph) return <ui.image src={glyph} alt={project?.key ?? "Project"} style={box} />;
	return (
		<ui.box style={{ width: size, height: size, borderRadius: 3, backgroundColor: project ? colorOf[project.color] : "text3", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
			<ui.text style={{ color: "white", fontSize: Math.round(size * 0.6), fontWeight: 700 }}>{(project?.key ?? "?").slice(0, 1)}</ui.text>
		</ui.box>
	);
}

/** A property's chip, as bb's, in Swarm's look: it opens Swarm's menu of the choices. */
const chip: Style = {
	height: 28, paddingLeft: 9, paddingRight: 10, gap: 6, borderRadius: "control", flexDirection: "row", alignItems: "center",
	border: "1px solid border", backgroundColor: "raised", color: "text", cursor: "pointer",
	hover: { backgroundColor: "hover" }, checked: { backgroundColor: "hover", borderColor: "borderStrong" },
	focus: { boxShadow: "0 0 0 2px color-mix(in srgb, accent 45%, transparent)" },
	transition: { duration: 120, colors: true },
};
const square: Style = { ...chip, width: 28, paddingLeft: 0, paddingRight: 0, justifyContent: "center" };

/** What the panel changes an issue with. */
export interface Edits {
	update(patch: Partial<Pick<Issue, "status" | "priority" | "assigneeIds" | "labelIds" | "dueDate">>): unknown;
}

/** The issue's properties, each a picker. */
export function Properties({ issue, project, members, labels, me, edits, start }: {
	issue: Issue; project?: Project; members: Member[]; labels: Label[]; me?: string; edits: Edits; start?: () => unknown;
}) {
	const assignees = members.filter((m) => issue.assigneeIds.includes(m.id));
	const chosen = labels.filter((l) => issue.labelIds.includes(l.id));
	const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
	const today = new Date();
	const day = (d: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + d).toISOString().slice(0, 10);
	return (
		<ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
			{project && (
				<ui.box style={chip} label={"Project: " + project.name}>
					<ProjectMark project={project} />
					<ui.text style={{ fontSize: 13 }}>{project.name}</ui.text>
				</ui.box>
			)}
			<ui.menu label={"Status: " + STATUS_LABELS[issue.status]} style={chip}>
				<StatusIcon status={issue.status} />
				<ui.text style={{ fontSize: 13 }}>{STATUS_LABELS[issue.status]}</ui.text>
				{STATUSES.map((s) => <ui.item key={s} checked={issue.status === s} onClick={() => edits.update({ status: s })}>{STATUS_LABELS[s]}</ui.item>)}
			</ui.menu>
			<ui.menu label={"Priority: " + PRIORITY_LABELS[issue.priority]} tooltip={PRIORITY_LABELS[issue.priority]} style={issue.priority === "none" ? square : chip}>
				<PriorityIcon priority={issue.priority} />
				{issue.priority !== "none" && <ui.text style={{ fontSize: 13 }}>{PRIORITY_LABELS[issue.priority]}</ui.text>}
				{PRIORITIES.map((p) => <ui.item key={p} checked={issue.priority === p} onClick={() => edits.update({ priority: p })}>{PRIORITY_LABELS[p]}</ui.item>)}
			</ui.menu>
			<ui.menu label={assignees.length ? "Assignees: " + assignees.map((m) => m.name).join(", ") : "Assign"} tooltip="Assignees" style={assignees.length === 1 ? square : chip}>
				{assignees.length === 0 ? <ui.icon icon="user" style={{ width: 14, height: 14, color: "text2" }} /> : assignees.slice(0, 3).map((m) => <Avatar key={"av-" + m.id} member={m} />)}
				{assignees.length > 1 && <ui.text style={{ fontSize: 13 }}>{String(assignees.length)}</ui.text>}
				{me && <ui.item key="me" icon="user" onClick={() => edits.update({ assigneeIds: toggle(issue.assigneeIds, me) })}>{issue.assigneeIds.includes(me) ? "Unassign me" : "Assign to me"}</ui.item>}
				{me && <ui.separator key="sep" />}
				{members.map((m) => <ui.item key={m.id} checked={issue.assigneeIds.includes(m.id)} detail={"@" + m.username} onClick={() => edits.update({ assigneeIds: toggle(issue.assigneeIds, m.id) })}>{m.name}</ui.item>)}
			</ui.menu>
			<ui.menu label={chosen.length ? "Labels: " + chosen.map((l) => l.name).join(", ") : "Labels"} tooltip="Labels" style={chosen.length ? chip : square}>
				{chosen.length === 0 && <ui.icon icon="tag" style={{ width: 14, height: 14, color: "text2" }} />}
				{chosen.map((l) => (
					<ui.box key={"lb-" + l.id} style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
						<ui.box style={{ width: 7, height: 7, borderRadius: "full", backgroundColor: colorOf[l.color] }} />
						<ui.text style={{ fontSize: 13 }}>{l.name}</ui.text>
					</ui.box>
				))}
				{labels.length === 0 ? <ui.item key="none" disabled>No labels yet</ui.item> : labels.map((l) => <ui.item key={l.id} checked={issue.labelIds.includes(l.id)} onClick={() => edits.update({ labelIds: toggle(issue.labelIds, l.id) })}>{l.name}</ui.item>)}
			</ui.menu>
			<ui.menu label={issue.dueDate ? "Due " + issue.dueDate : "Due date"} tooltip="Due date" style={issue.dueDate ? chip : square}>
				<ui.icon icon="calendar" style={{ width: 14, height: 14, color: issue.dueDate && issue.dueDate < day(0) ? "red" : "text2" }} />
				{issue.dueDate && <ui.text style={{ fontSize: 13 }}>{issue.dueDate}</ui.text>}
				<ui.item key="today" onClick={() => edits.update({ dueDate: day(0) })}>Today</ui.item>
				<ui.item key="tomorrow" onClick={() => edits.update({ dueDate: day(1) })}>Tomorrow</ui.item>
				<ui.item key="week" onClick={() => edits.update({ dueDate: day(7) })}>In a week</ui.item>
				{issue.dueDate && <ui.item key="clear" danger onClick={() => edits.update({ dueDate: null })}>Clear the due date</ui.item>}
			</ui.menu>
			{start && (
				<ui.pressable label="Start agent" onClick={start} style={chip}>
					<ui.icon icon="robot" style={{ width: 14, height: 14, color: "text2" }} />
					<ui.text style={{ fontSize: 13 }}>Start agent</ui.text>
				</ui.pressable>
			)}
		</ui.box>
	);
}

/** Markdown's inline: `code`, [links](url), **bold** and *emphasis*, as one paragraph's runs. */
export function inline(text: string): Child[] {
	const out: Child[] = [];
	const re = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\n]+)\*(?!\w)/g;
	let at = 0;
	for (let m; (m = re.exec(text)); ) {
		if (m.index > at) out.push(text.slice(at, m.index));
		if (m[1] !== undefined) out.push(<ui.text style={{ fontFamily: "mono", fontSize: "small", backgroundColor: "hover", borderRadius: 4 }}>{m[1]}</ui.text>);
		else if (m[2] !== undefined) out.push(<ui.link href={m[3]}>{m[2]}</ui.link>);
		else if (m[4] !== undefined) out.push(<ui.text style={{ fontWeight: 600 }}>{m[4]}</ui.text>);
		else out.push(<ui.text style={{ fontStyle: "italic" }}>{m[5]}</ui.text>);
		at = m.index + m[0].length;
	}
	if (at < text.length) out.push(text.slice(at));
	return out;
}

const prose: Style = { fontSize: "prose", lineHeight: 1.7, color: "text" };

/** What a picture's src shows: its bytes, a URL the window reads, or null while it comes. */
export type ImageOf = (src: string) => string | Uint8Array | null;

/**
 * Markdown as the panel shows it: paragraphs, headings, task lists (whose
 * boxes tick, when given what does), bullets and numbered lists, quotes,
 * code blocks and images.
 */
export function Markdown({ md, onTask, image }: { md: string; onTask?: (index: number, done: boolean) => unknown; image?: ImageOf }) {
	const blocks: Child[] = [];
	const picture = (key: string, src: string, alt: string): Child => {
		const got = image ? image(src) : src;
		if (got === null) return <ui.box key={key} label={alt || "A picture"} style={{ height: 120, borderRadius: "control", backgroundColor: "hover", animation: { name: "shimmer" } }} />;
		return <ui.image key={key} src={got} alt={alt || "A picture"} style={{ maxWidth: "100%", borderRadius: "control", alignSelf: "flex-start" }} />;
	};
	let task = 0;
	const lines = md.replace(/\r/g, "").split("\n");
	for (let i = 0; i < lines.length; ) {
		const l = lines[i]!;
		if (l.trim() === "") {
			i++;
			continue;
		}
		if (l.startsWith("```")) {
			const code: string[] = [];
			for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
			i++;
			blocks.push(
				<ui.scroll key={"code" + i} style={{ maxHeight: 320, overflowX: "auto", padding: "s4 s5", borderRadius: "control", backgroundColor: "field", border: "1px solid border" }}>
					<ui.text style={{ fontFamily: "mono", fontSize: "small", whiteSpace: "pre", userSelect: "text" }}>{code.join("\n")}</ui.text>
				</ui.scroll>,
			);
			continue;
		}
		const heading = /^(#{1,4})\s+(.*)$/.exec(l);
		if (heading) {
			blocks.push(<ui.text key={"h" + i} style={{ fontSize: heading[1]!.length === 1 ? "title" : "prose", fontWeight: 600, marginTop: 6 }}>{inline(heading[2]!)}</ui.text>);
			i++;
			continue;
		}
		const img = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/.exec(l);
		if (img) {
			blocks.push(picture("img" + i, img[2]!, img[1]!));
			i++;
			continue;
		}
		if (/^\s*([-*+]|\d+\.)\s/.test(l)) {
			const items: Child[] = [];
			for (; i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i]!); i++) {
				const item = lines[i]!;
				const t = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(item);
				const depth = Math.min(Math.floor((item.length - item.trimStart().length) / 2), 4);
				if (t) {
					const n = task++;
					const done = t[1] !== " ";
					items.push(
						<ui.box key={"t" + n} style={{ flexDirection: "row", gap: 9, alignItems: "flex-start", paddingLeft: depth * 18 }}>
							<ui.pressable role="checkbox" checked={done} label={t[2]!.slice(0, 80)} disabled={!onTask} onClick={() => onTask?.(n, !done)}
								style={{
									width: 14, height: 14, marginTop: 5, borderRadius: 4, border: "1.5px solid borderStrong", justifyContent: "center", flexShrink: 0, cursor: onTask ? "pointer" : "default",
									checked: { backgroundColor: "accent", borderColor: "accent" }, hover: { borderColor: "text3" },
								}}>
								{done && <ui.icon icon="check" style={{ width: 10, height: 10, color: "accentText" }} />}
							</ui.pressable>
							<ui.text style={{ ...prose, flex: 1, ...(done ? { color: "text3", textDecoration: "line-through" } : {}) }}>{inline(t[2]!)}</ui.text>
						</ui.box>,
					);
				} else {
					const num = /^\s*(\d+)\.\s+/.exec(item);
					items.push(
						<ui.box key={"li" + i} style={{ flexDirection: "row", gap: 8, paddingLeft: depth * 18 }}>
							<ui.text style={{ ...prose, color: "text3", minWidth: 12 }}>{num ? num[1] + "." : "•"}</ui.text>
							<ui.text style={{ ...prose, flex: 1 }}>{inline(item.replace(/^\s*([-*+]|\d+\.)\s+/, ""))}</ui.text>
						</ui.box>,
					);
				}
			}
			blocks.push(<ui.box key={"list" + i} style={{ gap: 2 }}>{items}</ui.box>);
			continue;
		}
		if (l.startsWith(">")) {
			const quote: string[] = [];
			for (; i < lines.length && lines[i]!.startsWith(">"); i++) quote.push(lines[i]!.replace(/^>\s?/, ""));
			blocks.push(
				<ui.box key={"q" + i} style={{ borderLeft: "3px solid border", paddingLeft: 12 }}>
					<ui.text style={{ ...prose, color: "text2" }}>{inline(quote.join(" "))}</ui.text>
				</ui.box>,
			);
			continue;
		}
		const para: string[] = [];
		for (; i < lines.length && lines[i]!.trim() !== "" && !/^(```|#{1,4}\s|>|\s*([-*+]|\d+\.)\s)/.test(lines[i]!); i++) para.push(lines[i]!.trim());
		// Pictures in a paragraph follow its words.
		const pics: Child[] = [];
		const words = para.join(" ").replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt: string, src: string) => {
			pics.push(picture("pic" + i + "-" + pics.length, src, alt));
			return "";
		}).trim();
		if (words) blocks.push(<ui.text key={"p" + i} style={prose}>{inline(words)}</ui.text>);
		blocks.push(...pics);
	}
	return <ui.box style={{ gap: 10 }}>{blocks}</ui.box>;
}

/** Ticks a task of Markdown: the nth box. */
export function tickTask(md: string, n: number, done: boolean): string {
	let seen = -1;
	return md.replace(/^(\s*[-*+]\s+)\[([ xX])\]/gm, (all, lead: string) => {
		seen++;
		return seen === n ? `${lead}[${done ? "x" : " "}]` : all;
	});
}

/** How long ago, as bb says it: now, 5m, 3h, 2d, then the date. */
export function ago(iso: string, now = Date.now()): string {
	const s = Math.max(0, (now - Date.parse(iso)) / 1000);
	if (s < 60) return "now";
	if (s < 3600) return Math.floor(s / 60) + "m";
	if (s < 86400) return Math.floor(s / 3600) + "h";
	if (s < 86400 * 7) return Math.floor(s / 86400) + "d";
	return iso.slice(0, 10);
}

/** An issue as a row: its status, key and title, its priority and assignee. */
export function IssueRow({ issue, members, right, onOpen }: { issue: Issue; members: Member[]; right?: Child; onOpen?: () => unknown }) {
	const who = members.find((m) => issue.assigneeIds[0] === m.id);
	return (
		<ui.pressable key={issue.id} label={`${issue.key} ${issue.title}`} onClick={onOpen ?? (() => {})}
			style={{ width: "100%", height: 36, gap: 8, paddingLeft: 6, paddingRight: 6, borderRadius: "control", flexDirection: "row", alignItems: "center", hover: { backgroundColor: "hover" }, cursor: onOpen ? "pointer" : "default" }}>
			<StatusIcon status={issue.status} size={14} />
			<ui.text style={{ fontSize: 12, color: "text3", flexShrink: 0 }}>{issue.key}</ui.text>
			<ui.text style={{ fontSize: "body", flex: 1, whiteSpace: "nowrap", textOverflow: "ellipsis", ...(issue.status === "complete" || issue.status === "canceled" ? { color: "text3", textDecoration: "line-through" } : {}) }}>{issue.title}</ui.text>
			{who && <Avatar member={who} size={20} />}
			{right}
		</ui.pressable>
	);
}

/** An issue whole: bb's Flux panel's, in Swarm's look. */
export function IssueView(props: {
	detail: IssueDetail; project?: Project; members: Member[]; labels: Label[]; me?: string; url: string; working: boolean;
	edits: Edits; onTask?: (index: number, done: boolean) => unknown; detach?: () => unknown; start?: () => unknown; open?: (issue: Issue) => unknown;
	image?: ImageOf;
	description?: Child;
	comment?: Child;
}) {
	const { detail: d, members } = props;
	const issue = d.issue;
	const name = (id: string | null) => members.find((m) => m.id === id);
	return (
		<ui.box style={{ gap: 0 }}>
			<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 22 }}>
				<ProjectMark project={props.project} size={13} />
				<ui.text style={{ fontSize: "small", color: "text2", letterSpacing: 0.2, userSelect: "text" }}>{issue.key}</ui.text>
				<ui.box style={{ flexDirection: "row", marginLeft: "auto", gap: 2, alignItems: "center" }}>
					<ui.iconButton icon="external" label="Open in Flux" href={props.url} disabled={!props.url} />
					{props.detach && (
						<ui.menu label="" icon="more" tooltip={"More of " + issue.key}>
							<ui.item icon="x" onClick={props.detach}>Detach this thread</ui.item>
						</ui.menu>
					)}
				</ui.box>
			</ui.box>
			<ui.text style={{ fontSize: "title", fontWeight: 600, lineHeight: 1.35, marginTop: 8, userSelect: "text" }}>{issue.title}</ui.text>

			{d.parent && (
				<ui.box style={{ marginTop: 10, gap: 4 }}>
					<ui.text style={{ fontSize: "small", color: "text2" }}>Sub-issue of</ui.text>
					<ui.pressable label={`${d.parent.key} ${d.parent.title}`} onClick={() => props.open?.(d.parent!)}
						style={{ flexDirection: "row", gap: 7, alignItems: "center", cursor: "pointer", color: "text", hover: { color: "accent" } }}>
						<StatusIcon status={d.parent.status} size={13} />
						<ui.text style={{ fontSize: "body", flex: 1, whiteSpace: "nowrap", textOverflow: "ellipsis", color: "currentColor" }}>{`${d.parent.key} ${d.parent.title}`}</ui.text>
					</ui.pressable>
					{d.parent.subIssueCount > 0 && (
						<ui.box style={{ flexDirection: "row" }}>
							<ui.box label={`${d.parent.subIssueDoneCount} of ${d.parent.subIssueCount} sub-issues done`} style={{ ...chip, height: 22, paddingLeft: 6, paddingRight: 7, gap: 5, cursor: "default", hover: {} }}>
								<ui.canvas label="Progress" width={14} height={14} style={{ width: 12, height: 12 }}
									draw={(g) => {
										g.circle(7, 7, 5.5, { stroke: "borderStrong", lineWidth: 2.2 });
										g.arc(7, 7, 5.5, -90, -90 + (360 * d.parent!.subIssueDoneCount) / d.parent!.subIssueCount, { stroke: "text2", lineWidth: 2.2 });
									}} />
								<ui.text style={{ fontSize: "small" }}>{`${d.parent.subIssueDoneCount}/${d.parent.subIssueCount}`}</ui.text>
							</ui.box>
						</ui.box>
					)}
				</ui.box>
			)}

			<ui.box style={{ marginTop: 14, gap: 6 }}>
				<Properties issue={issue} project={props.project} members={members} labels={props.labels} me={props.me} edits={props.edits} start={props.start} />
				{props.working && (
					<ui.box style={{ flexDirection: "row" }}>
						<ui.box label="An agent works on it" style={{ ...chip, cursor: "default", border: "1px solid color-mix(in srgb, green 45%, transparent)", backgroundColor: "greenSoft", hover: {} }}>
							<ui.box style={{ width: 7, height: 7, borderRadius: "full", backgroundColor: "green", animation: { name: "pulse" } }} />
							<ui.text style={{ fontSize: 13 }}>Working</ui.text>
						</ui.box>
					</ui.box>
				)}
			</ui.box>

			<ui.box style={{ marginTop: 20 }}>
				{props.description ?? (d.descriptionMarkdown.trim() ? <Markdown md={d.descriptionMarkdown} onTask={props.onTask} image={props.image} /> : <ui.text style={{ ...prose, color: "text3" }}>No description.</ui.text>)}
			</ui.box>

			{d.subIssues.length > 0 && (
				<ui.box style={{ marginTop: 22, gap: 2 }}>
					<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
						<ui.text style={{ fontSize: "small", fontWeight: 600 }}>Sub-issues</ui.text>
						<ui.text style={{ fontSize: "small", color: "text3" }}>{`${issue.subIssueDoneCount}/${issue.subIssueCount}`}</ui.text>
					</ui.box>
					{d.subIssues.map((s) => <IssueRow key={s.id} issue={s} members={members} onOpen={props.open ? () => props.open!(s) : undefined} />)}
				</ui.box>
			)}

			<ui.box style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid divider", gap: 14 }}>
				<ui.text style={{ fontSize: "small", fontWeight: 600 }}>Activity</ui.text>
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<Avatar member={name(issue.creatorId)} size={18} />
					<ui.text style={{ fontSize: "small", color: "text2" }}>
						<ui.text style={{ fontWeight: 600, color: "text" }}>{name(issue.creatorId)?.name ?? "Someone"}</ui.text>
						{" created the issue · " + ago(issue.createdAt)}
					</ui.text>
				</ui.box>
				{d.comments.map((c: Comment) => {
					const who = name(c.authorId);
					return (
						<ui.box key={c.id} style={{ gap: 6 }}>
							<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
								{c.agent ? <ui.box style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: "accentSoft", alignItems: "center", justifyContent: "center" }}><ui.icon icon="robot" style={{ width: 12, height: 12, color: "accent" }} /></ui.box> : <Avatar member={who} />}
								<ui.text style={{ fontSize: "small", color: "text2" }}>
									<ui.text style={{ fontWeight: 600, color: "text" }}>{c.agent ? c.agent.name : (who?.name ?? "Someone")}</ui.text>
									{(c.agent && who ? " for " + who.name : "") + " · " + ago(c.createdAt)}
								</ui.text>
							</ui.box>
							<ui.box style={{ paddingLeft: 26 }}>
								<Markdown md={c.markdown} image={props.image} />
							</ui.box>
						</ui.box>
					);
				})}
				{props.comment}
			</ui.box>
		</ui.box>
	);
}
