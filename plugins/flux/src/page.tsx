// Flux's page, laid out like Flux: a board or a grouped list across the
// content area, display options, and an issue page with a properties rail.
import { settings, storage, ui, type Child, type ColorValue, type IconName } from "swarm";
import type { Comment as IssueComment, Issue, IssuePatch, Label, Member, Project } from "./contract";
import { hub, parseExtras } from "./hub";
import { CLOSED_STATUSES, PRIORITIES, PRIORITY_LABELS, PRIORITY_LEVEL, STATUSES, STATUS_LABELS, type Priority, type Status } from "./flux";
import { CommentEditor, DescriptionEditor, StartAgent, isStarting, mentionOptions, startAgent } from "./edit";
import type { Flux } from "./service";
import { threadInfo } from "./threads";
import { navMark } from "./marks";
import { Avatar, FluxMark, PriorityIcon, ProjectMark, Properties, StatusIcon, colorOf } from "./view";
import { drafted, editDraft } from "./drafts";
import type { ImageOf } from "./view";
import {
	DEFAULT_DISPLAY,
	GROUPINGS,
	GROUPING_LABELS,
	LAYOUTS,
	ORDERINGS,
	ORDERING_LABELS,
	PROPERTIES,
	PROPERTY_LABELS,
	SCOPES,
	SCOPE_LABELS,
	buildGroups,
	draftForGroup,
	effectiveGrouping,
	matchesQuery,
	matchesScope,
	parseDisplay,
	patchForMove,
	positionBetween,
	scopeOf,
	shows,
	type DisplayOptions,
	type GroupKey,
	type IssueGroup,
	type Property,
	type Scope,
} from "./layout";

let query = "";
let selected = new Set<string>();
let cursor = "";
let displayOpen = false;
let palette: "" | "status" | "priority" | "assignee" | "label" | "project" | "due" | "parent" = "";
let lastPatch: IssuePatch | null = null;
let adding = false;
let addURL = "";
let addToken = "";
let creating = false;
let createMore = false;
let draftTitle = "";
let draftBody = "";
let draftStatus: Status = "todo";
let draftPriority: Priority = "none";
let draftAssignees: string[] = [];
let draftLabels: string[] = [];
let draftProject = "";
let draftDue: string | null = null;
let draftParent: string | null = null;
let editingComment = "";
let commentBody = "";

const PAGE_KEYS = [
	"j", "k", "Enter", "Escape", "c", "C", "/", "s", "S", "p", "P", "a", "A", "l", "L", "i", "I", "d", "D", "x", "X", "e", "E", ".",
	"ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Backspace",
	"Mod+a", "Mod+A", "Mod+Backspace", "Mod+b", "Mod+B", "Shift+1", "Shift+2", "Shift+3", "Shift+4", "Shift+0", "Shift+v", "Shift+V", "Shift+d", "Shift+D", "Shift+p", "Shift+P", "Shift+x", "Shift+X",
];

function displayOf(): DisplayOptions {
	return parseDisplay(storage.get("display"));
}

function setDisplay(next: DisplayOptions) {
	storage.set("display", next);
}

function openIssue(key: string) {
	ui.navTo("flux", `issues/${encodeURIComponent(key)}`);
}

function openList(path: string) {
	ui.navTo("flux", path);
}

export function navItems(flux: Flux): { id: string; title: string; icon?: IconName; path?: string; section?: string; badge?: string; mark?: string }[] {
	const open = flux.issues().filter((issue) => !CLOSED_STATUSES.has(issue.status));
	const count = (n: number) => (n ? String(n) : undefined);
	return [
		{ id: "all", title: "All projects", icon: "flux:mark", path: "", section: "Projects", badge: count(open.length) },
		...flux.projects().map((project) => ({
			id: "p-" + project.id,
			title: project.name,
			...navMark(project),
			path: `p/${project.key}`,
			section: "Projects",
			badge: count(open.filter((issue) => issue.projectId === project.id).length),
		})),
	];
}

export function syncNav(flux: Flux) {
	const me = flux.me?.id;
	const mine = flux.issues().filter((issue) => !CLOSED_STATUSES.has(issue.status) && me && issue.assigneeIds.includes(me)).length;
	try {
		ui.navItems("flux", navItems(flux));
		ui.navBadge("flux", { text: mine ? String(mine) : "" });
	} catch {
		// The page is registered a moment later.
	}
}

function scopeNow(): Scope {
	return scopeOf(storage.get<string>("scope") ?? "mine");
}

function parsePath(path: string): { kind: "list"; project: string | null } | { kind: "issue"; key: string } {
	const parts = path.split("/").filter(Boolean);
	if (parts[0] === "issues" && parts[1]) return { kind: "issue", key: decodeURIComponent(parts[1]) };
	if (parts[0] === "p" && parts[1]) return { kind: "list", project: decodeURIComponent(parts[1]) };
	return { kind: "list", project: null };
}

export function FluxPage({ path, slot, image }: { path: string; slot: string; image: ImageOf }) {
	const flux = hub.active;
	const route = parsePath(path);
	const connection = flux.connection();
	const unset = connection.state === "unconfigured" || connection.state === "unauthorized";
	if (slot === "head") {
		if (unset) return null;
		const project = route.kind === "list" ? flux.projects().find((item) => item.key === route.project) : undefined;
		return <PageHead flux={flux} onCreate={() => openCreate(flux, project?.id)} />;
	}
	if (unset) return <Setup flux={flux} />;
	if (route.kind === "issue") return <IssuePage flux={flux} issueKey={route.key} image={image} />;
	return <ListScreen flux={flux} scope={scopeNow()} projectKey={route.project} />;
}

function ListScreen({ flux, scope, projectKey }: { flux: Flux; scope: Scope; projectKey: string | null }) {
	const options = displayOf();
	const projects = flux.projects();
	const project = projects.find((item) => item.key === projectKey) ?? null;
	const members = flux.memberList();
	const labels = flux.labels();
	const me = flux.me?.id;
	const grouping = effectiveGrouping(options, !!project);
	const issues = flux.issues().filter((issue) => {
		if (project && issue.projectId !== project.id) return false;
		if (!options.showSubIssues && issue.parentId) return false;
		if (!options.showClosed && CLOSED_STATUSES.has(issue.status)) return false;
		if (!matchesScope(issue, scope, me)) return false;
		return matchesQuery(issue, query);
	});
	const groups = buildGroups({ issues, grouping, ordering: options.ordering, showEmptyGroups: options.showEmptyGroups, showClosed: options.showClosed, members, labels, projects, me });
	const flat = groups.flatMap((group) => group.issues);
	const connection = flux.connection();
	return (
		<ui.box
			style={{ position: "relative", flex: 1, height: "100%", minHeight: 0, minWidth: 0, width: "100%", gap: 0 }}
			keys={PAGE_KEYS}
			onKeyDown={(key) => onListKey(flux, key, flat, groups, options)}
		>
			<Toolbar flux={flux} project={project} scope={scope} options={options} />
			{connection.state !== "ready" && connection.message ? (
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingLeft: EDGE, paddingRight: EDGE, paddingTop: 8, paddingBottom: 8, borderBottom: "1px solid border" }}>
					<ui.icon icon="alert-circle" style={{ width: 14, height: 14, color: "amber", flexShrink: 0 }} />
					<ui.text style={{ fontSize: 13, color: "text2", flex: 1, minWidth: 0 }} maxLines={2} tooltip={connection.message}>{offline(connection.message)}</ui.text>
				</ui.box>
			) : null}
			{adding ? <ui.box style={{ paddingLeft: EDGE, paddingRight: EDGE, paddingBottom: 8 }}><AddConnection /></ui.box> : null}
			{flat.length === 0 ? <Empty flux={flux} scope={scope} inProject={!!project} onCreate={() => openCreate(flux, project?.id)} /> : options.layout === "list" ? <IssueList flux={flux} groups={groups} options={options} showProject={!project} /> : <Board flux={flux} groups={groups} options={options} />}
			{selected.size > 0 ? <SelectionBar flux={flux} /> : null}
			{displayOpen ? displayPanel(options, !!project) : null}
			{palette ? <Palette flux={flux} /> : null}
		</ui.box>
	);
}

/** What the toolbar says while Flux can't be reached: the copy shown, not the raw error, which is its tooltip. */
function offline(message: string, copy = true): string {
	const host = /Could not reach Flux at (\S+): /.exec(message)?.[1];
	const said = host ? `Can't reach Flux at ${host.replace(/^https?:\/\//, "")}.` : message.replace(/\.?\s*$/, ".");
	return copy ? `${said} Showing the last copy.` : `${said} Trying again.`;
}

function PageHead({ flux, onCreate }: { flux: Flux; onCreate: () => void }) {
	return (
		<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
			<Connections />
			<ui.button kind="primary" size="sm" icon="plus" onClick={onCreate}>New issue</ui.button>
		</ui.box>
	);
}

function Toolbar({ flux, project, scope, options }: { flux: Flux; project: Project | null; scope: Scope; options: DisplayOptions }) {
	const projects = flux.projects();
	return (
		<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 48, flexShrink: 0, paddingLeft: EDGE - ghostChip.paddingLeft, paddingRight: EDGE, borderBottom: "1px solid border", media: [{ maxWidth: 639, style: { height: "auto", flexWrap: "wrap", rowGap: 8, paddingTop: 10, paddingBottom: 10 } }] }}>
			<ui.menu label={project ? project.name : "All projects"} style={ghostChip}>
				{project ? <ProjectMark project={project} /> : <FluxMark />}
				<ui.text style={{ fontSize: 13 }}>{project ? project.name : "All projects"}</ui.text>
				<ui.icon icon="chevron-down" style={{ width: 12, height: 12, color: "text3" }} />
				<ui.item icon="icon.svg" checked={!project} onClick={() => openList("")}>All projects</ui.item>
				{projects.map((item) => (
					<ui.item key={item.id} checked={item.key === project?.key} onClick={() => openList(`p/${item.key}`)}>{item.name}</ui.item>
				))}
			</ui.menu>
			<ui.box style={{ width: 1, height: 16, flexShrink: 0, marginLeft: 4, marginRight: 4, backgroundColor: "border" }} />
			{SCOPES.map((item) => (
				<ui.pressable key={item} label={SCOPE_LABELS[item]} role="tab" checked={scope === item} onClick={() => storage.set("scope", item)} style={{ height: 28, flexShrink: 0, paddingLeft: 8, paddingRight: 8, justifyContent: "center", borderRadius: "control", backgroundColor: scope === item ? "hover" : "transparent", hover: { backgroundColor: "hover" } }}>
					<ui.text style={{ fontSize: 13, color: scope === item ? "text" : "text2" }} maxLines={1}>{SCOPE_LABELS[item]}</ui.text>
				</ui.pressable>
			))}
			<ui.box style={{ flex: 1, media: [{ maxWidth: 639, style: { display: "none" } }] }} />
			<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", width: 208, minWidth: 96, flexShrink: 1, height: 28, media: [{ maxWidth: 639, style: { flex: 1, marginLeft: ghostChip.paddingLeft } }], paddingLeft: 8, paddingRight: 4, borderRadius: "control", border: "1px solid border", backgroundColor: "field" }}>
				<ui.icon icon="search" style={{ width: 13, height: 13, color: "text3", flexShrink: 0 }} />
				<ui.field key="flux-filter" value={query} placeholder="Filter issues" onChange={(value) => { query = value; }} style={{ flex: 1, height: 26, padding: 0, backgroundColor: "transparent", boxShadow: "none" }} />
			</ui.box>
			<ui.pressable label="Display" role="button" tooltip="Display options" checked={displayOpen} onClick={() => { displayOpen = !displayOpen; }} style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: "control", border: "1px solid border", backgroundColor: displayOpen ? "hover" : "transparent", hover: { backgroundColor: "hover" } }}>
				<ui.icon icon="sliders" style={{ width: 14, height: 14, color: "text2" }} />
			</ui.pressable>
		</ui.box>
	);
}

// EDGE is the page's edge, where Swarm's header puts its title: the bars'
// marks and words start on it, a ghost control's fill reaching out past
// it; boxes that show, as the board's columns, the list's groups and the
// filter, start and end on it.
const EDGE = 16;

const ghostChip = { height: 28, flexShrink: 0, paddingLeft: 8, paddingRight: 8, gap: 6, flexDirection: "row", alignItems: "center", borderRadius: "control", backgroundColor: "transparent" } as const;

function displayPanel(options: DisplayOptions, singleProject: boolean): Child {
	const set = (patch: Partial<DisplayOptions>) => setDisplay({ ...options, ...patch });
	const toggle = (property: Property) => {
		const has = options.properties.includes(property);
		set({ properties: has ? options.properties.filter((item) => item !== property) : [...options.properties, property] });
	};
	const close = () => { displayOpen = false; };
	return [
		<ui.pressable key="display-shade" label="Close display options" onClick={close} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 20 }} />,
		<ui.box key="display-panel" label="Display options" style={{ position: "absolute", top: 44, right: 20, width: 288, zIndex: 21, gap: 12, padding: 12, borderRadius: "card", backgroundColor: "overlay", border: "1px solid border", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
			<ui.box style={{ flexDirection: "row", gap: 6 }}>
				{LAYOUTS.map((layout) => (
					<ui.pressable key={"layout-" + layout} label={layout === "board" ? "Board" : "List"} role="radio" checked={options.layout === layout} onClick={() => set({ layout })} style={{ flex: 1, height: 32, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderRadius: "control", border: "1px solid border", backgroundColor: options.layout === layout ? "hover" : "transparent" }}>
						<ui.icon icon={layout === "board" ? "columns" : "rows"} style={{ width: 13, height: 13, color: "text2" }} />
						<ui.text style={{ fontSize: 13 }}>{layout === "board" ? "Board" : "List"}</ui.text>
					</ui.pressable>
				))}
			</ui.box>
			<DisplayRow label="Grouping" value={GROUPING_LABELS[options.grouping]}>
				{GROUPINGS.filter((grouping) => grouping !== "project" || !singleProject).map((grouping) => (
					<ui.item key={"group-" + grouping} checked={options.grouping === grouping} onClick={() => set({ grouping })}>{GROUPING_LABELS[grouping]}</ui.item>
				))}
			</DisplayRow>
			<DisplayRow label="Ordering" value={ORDERING_LABELS[options.ordering]}>
				{ORDERINGS.map((ordering) => <ui.item key={"order-" + ordering} checked={options.ordering === ordering} onClick={() => set({ ordering })}>{ORDERING_LABELS[ordering]}</ui.item>)}
			</DisplayRow>
			<ui.box style={{ gap: 6 }}>
				<ui.text style={{ fontSize: 12, color: "text2" }}>Display properties</ui.text>
				<ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
					{PROPERTIES.map((property) => {
						const on = options.properties.includes(property);
						return (
							<ui.pressable key={"prop-" + property} label={PROPERTY_LABELS[property]} role="checkbox" checked={on} onClick={() => toggle(property)} style={{ height: 22, paddingLeft: 6, paddingRight: 6, justifyContent: "center", borderRadius: "control", border: "1px solid border", backgroundColor: on ? "hover" : "transparent" }}>
								<ui.text style={{ fontSize: 12, color: on ? "text" : "text3" }}>{PROPERTY_LABELS[property]}</ui.text>
							</ui.pressable>
						);
					})}
				</ui.box>
			</ui.box>
			<DisplaySwitch label="Show completed issues" on={options.showClosed} set={(on) => set({ showClosed: on })} />
			<DisplaySwitch label="Show empty groups" on={options.showEmptyGroups} set={(on) => set({ showEmptyGroups: on })} />
			<DisplaySwitch label="Show sub-issues" on={options.showSubIssues} set={(on) => set({ showSubIssues: on })} />
		</ui.box>,
	];
}

function DisplaySwitch({ label, on, set }: { label: string; on: boolean; set: (on: boolean) => void }) {
	return (
		<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
			<ui.text style={{ fontSize: 13, color: "text2", flex: 1 }}>{label}</ui.text>
			<ui.toggle tooltip={label} checked={on} onChange={set} />
		</ui.box>
	);
}

function DisplayRow({ label, value, children }: { label: string; value: string; children?: Child }) {
	return (
		<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
			<ui.text style={{ fontSize: 13, color: "text2", flex: 1 }}>{label}</ui.text>
			<ui.menu label={`${label}: ${value}`} style={{ ...ghostChip, height: 24 }}>
				<ui.text style={{ fontSize: 13 }}>{value}</ui.text>
				<ui.icon icon="chevron-down" style={{ width: 11, height: 11, color: "text3" }} />
				{children}
			</ui.menu>
		</ui.box>
	);
}

function Board({ flux, groups, options }: { flux: Flux; groups: IssueGroup[]; options: DisplayOptions }) {
	return (
		<ui.box style={{ flex: 1, minHeight: 0, minWidth: 0, width: "100%", flexDirection: "row", gap: 20, overflowX: "auto", overflowY: "hidden", alignItems: "stretch", paddingLeft: EDGE, paddingRight: EDGE, paddingTop: 16, paddingBottom: 32 }}>
			{groups.map((group) => (
				<ui.box key={group.id} label={group.title} style={{ width: 346, flexShrink: 0, minHeight: 0, height: "100%", gap: 6, padding: 8, borderRadius: 12, backgroundColor: "raised", overflowY: "auto" }} onDrop={(event) => dropOn(flux, group, event, options)}>
					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingLeft: 8, paddingRight: 2, paddingTop: 2, paddingBottom: 2, flexShrink: 0 }}>
						<GroupMark group={group} flux={flux} />
						<ui.text style={{ fontSize: 14, fontWeight: 500 }} maxLines={1}>{group.title}</ui.text>
						<ui.text style={{ fontSize: 14, color: "text3" }}>{String(group.issues.length)}</ui.text>
						<ui.box style={{ flex: 1 }} />
						<ui.iconButton icon="plus" label={`New issue in ${group.title}`} onClick={() => openCreate(flux, undefined, group.key)} />
					</ui.box>
					{group.issues.map((issue, index) => (
						<Card key={issue.id} flux={flux} issue={issue} group={group} index={index} options={options} />
					))}
				</ui.box>
			))}
		</ui.box>
	);
}

function Card({ flux, issue, group, index, options }: { flux: Flux; issue: Issue; group: IssueGroup; index: number; options: DisplayOptions }) {
	const project = flux.projects().find((item) => item.id === issue.projectId);
	const parent = issue.parentId ? flux.issue(issue.parentId) : undefined;
	const assignees = flux.memberList().filter((member) => issue.assigneeIds.includes(member.id));
	const marks = flux.labels().filter((item) => issue.labelIds.includes(item.id));
	const on = selected.has(issue.id);
	const fields = shows(options, "priority") || (shows(options, "dueDate") && !!issue.dueDate) || issue.subIssueCount > 0 || (shows(options, "labels") && marks.length > 0) || (shows(options, "agents") && issue.threadIds.length > 0);
	return (
		<ui.box
			label={issue.title}
			drag={{ id: issue.id, index }}
			onClick={(event) => clickIssue(issue, event)}
			onDrop={(event) => dropBefore(flux, group, index, event, options)}
			style={{ flexDirection: "row", gap: 8, flexShrink: 0, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: "control", backgroundColor: on ? "selected" : "bg", border: on ? "1px solid text2" : "1px solid border", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", cursor: "pointer" }}
		>
			<IssueContextMenu flux={flux} issue={issue} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 0 }}>
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 16 }}>
					<ProjectMark project={project} size={14} />
					<KeyLine issue={issue} parent={parent} showKey={shows(options, "id")} />
				</ui.box>
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 4 }}>
					{shows(options, "status") ? <ui.box style={{ height: 20, width: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 }}><StatusIcon status={issue.status} size={14} /></ui.box> : null}
					<ui.text style={{ fontSize: 14, lineHeight: "20px", fontWeight: 500, flex: 1, minWidth: 0, paddingTop: 1, color: CLOSED_STATUSES.has(issue.status) ? "text3" : "text" }} maxLines={2}>{issue.title}</ui.text>
				</ui.box>
				{fields ? (
					<ui.box style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
						{shows(options, "priority") ? <ui.box label={`Priority: ${PRIORITY_LABELS[issue.priority]}`} style={{ ...field, width: 22, paddingLeft: 0, paddingRight: 0 }}><PriorityIcon priority={issue.priority} size={12} /></ui.box> : null}
						{shows(options, "dueDate") && issue.dueDate ? <DueChip date={issue.dueDate} /> : null}
						{issue.subIssueCount > 0 ? <SubIssueChip done={issue.subIssueDoneCount} total={issue.subIssueCount} /> : null}
						{shows(options, "labels") ? marks.map((item) => <Tag key={item.id} label={item} />) : null}
						{shows(options, "agents") && issue.threadIds.length > 0 ? <AgentChip issue={issue} /> : null}
					</ui.box>
				) : null}
				{shows(options, "created") ? <ui.text style={{ fontSize: 12, color: "text3", marginTop: 8 }}>{createdOn(issue.createdAt)}</ui.text> : null}
			</ui.box>
			{shows(options, "assignee") && assignees.length > 0 ? <AvatarStack members={assignees} size={20} /> : null}
		</ui.box>
	);
}

/** Flux's bordered field chip: priority, due date, sub-issues, labels, agents. */
const field = { flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", height: 22, paddingLeft: 6, paddingRight: 6, flexShrink: 0, borderRadius: 4, border: "1px solid border" } as const;

function KeyLine({ issue, parent, showKey }: { issue: Issue; parent?: Issue; showKey: boolean }) {
	if (!showKey && !parent) return null;
	return (
		<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", minWidth: 0 }}>
			{parent ? <ui.text style={{ fontSize: 11, color: "text3" }} maxLines={1}>{parent.key}</ui.text> : null}
			{parent && showKey ? <ui.text style={{ fontSize: 11, color: "text3" }}>›</ui.text> : null}
			{showKey ? <ui.text style={{ fontSize: 11, color: "text3", flexShrink: 0 }}>{issue.key}</ui.text> : null}
		</ui.box>
	);
}

function AvatarStack({ members, size }: { members: Member[]; size: number }) {
	return (
		<ui.box style={{ flexDirection: "row", gap: 2, flexShrink: 0 }}>
			{members.slice(0, 3).map((member) => <Avatar key={member.id} member={member} size={size} />)}
		</ui.box>
	);
}

/** When it's due: overdue in red, today and soon in amber, later muted. */
function dueTone(date: string): ColorValue {
	const today = new Date().toISOString().slice(0, 10);
	if (date < today) return "red";
	const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
	return date <= soon ? "amber" : "text2";
}

function dueLabel(date: string): string {
	const today = new Date().toISOString().slice(0, 10);
	const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
	if (date === today) return "Today";
	if (date === tomorrow) return "Tomorrow";
	return monthDay(`${date}T12:00:00Z`);
}

function DueChip({ date }: { date: string }) {
	const tone = dueTone(date);
	return (
		<ui.box label={`Due ${date}`} style={field}>
			<ui.icon icon="calendar" style={{ width: 12, height: 12, color: tone }} />
			<ui.text style={{ fontSize: 12, fontWeight: 500, color: tone }}>{dueLabel(date)}</ui.text>
		</ui.box>
	);
}

function SubIssueChip({ done, total }: { done: number; total: number }) {
	const color = done >= total ? "green" : "text2";
	return (
		<ui.box label={`${done} of ${total} sub-issues done`} style={field}>
			<ui.canvas width={14} height={14} label="" style={{ width: 14, height: 14, flexShrink: 0 }} draw={(g) => {
				g.circle(7, 7, 5, { stroke: "borderStrong", lineWidth: 2 });
				if (done > 0) g.arc(7, 7, 5, -90, -90 + (360 * Math.min(done, total)) / total, { stroke: color, lineWidth: 2 });
			}} />
			<ui.text style={{ fontSize: 12, fontWeight: 500, color }}>{`${done}/${total}`}</ui.text>
		</ui.box>
	);
}

function AgentChip({ issue }: { issue: Issue }) {
	const busy = issue.threadIds.some((id) => threadInfo(id)?.working);
	const count = issue.threadIds.length;
	return (
		<ui.box label={busy ? "An agent is working on this" : `${count} thread${count === 1 ? "" : "s"}`} style={{ ...field, border: busy ? "1px solid color-mix(in srgb, green 40%, transparent)" : "1px solid border" }}>
			<ui.box style={{ width: 6, height: 6, borderRadius: "full", backgroundColor: busy ? "green" : "text3", ...(busy ? { animation: { name: "pulse" } } : {}) }} />
			<ui.text style={{ fontSize: 12, fontWeight: 500, color: busy ? "text" : "text2" }}>{busy ? "Working" : count === 1 ? "Agent" : `${count} agents`}</ui.text>
		</ui.box>
	);
}

function createdOn(iso: string): string {
	const day = monthDay(iso);
	return day ? `Created ${day}` : "";
}

function monthDay(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function ago(iso: string): string {
	const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
	if (!Number.isFinite(minutes) || minutes < 1) return "now";
	if (minutes < 60) return `${Math.round(minutes)}m`;
	const hours = minutes / 60;
	if (hours < 24) return `${Math.round(hours)}h`;
	return `${Math.round(hours / 24)}d`;
}

function IssueList({ flux, groups, options, showProject }: { flux: Flux; groups: IssueGroup[]; options: DisplayOptions; showProject: boolean }) {
	const projects = flux.projects();
	const members = flux.memberList();
	const labels = flux.labels();
	return (
		<ui.box style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingLeft: EDGE, paddingRight: EDGE, paddingTop: 12, paddingBottom: 32, gap: 12 }}>
			{groups.map((group) => (
				<ui.box key={group.id} label={group.title} onDrop={(event) => dropOn(flux, group, event, options)} style={{ gap: 4 }}>
					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 32, paddingLeft: 8, paddingRight: 4, borderRadius: "control", backgroundColor: "hover" }}>
						<ui.icon icon="chevron-down" style={{ width: 12, height: 12, color: "text3" }} />
						<GroupMark group={group} flux={flux} />
						<ui.text style={{ fontSize: 14, fontWeight: 500 }} maxLines={1}>{group.title}</ui.text>
						<ui.text style={{ fontSize: 14, color: "text3" }}>{String(group.issues.length)}</ui.text>
						<ui.box style={{ flex: 1 }} />
						<ui.iconButton icon="plus" label={`New issue in ${group.title}`} onClick={() => openCreate(flux, undefined, group.key)} />
					</ui.box>
					{group.issues.map((issue, index) => {
						const project = projects.find((item) => item.id === issue.projectId);
						const parent = issue.parentId ? flux.issue(issue.parentId) : undefined;
						const assignees = members.filter((member) => issue.assigneeIds.includes(member.id));
						const marks = labels.filter((item) => issue.labelIds.includes(item.id));
						const on = selected.has(issue.id);
						const closed = CLOSED_STATUSES.has(issue.status);
						return (
							<ui.box key={issue.id} label={issue.title} drag={{ id: issue.id, index }} onClick={(event) => clickIssue(issue, event)} onDrop={(event) => dropBefore(flux, group, index, event, options)} style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 40, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: "control", backgroundColor: on ? "selected" : "transparent", hover: { backgroundColor: on ? "selected" : "hover" }, cursor: "pointer" }}>
								<IssueContextMenu flux={flux} issue={issue} />
								<ui.box style={{ width: 16, flexShrink: 0 }}>
									{selected.size > 0 ? <ui.checkbox tooltip={`Select ${issue.key}`} checked={on} onChange={(checked) => toggleSelected(issue.id, checked)} /> : null}
								</ui.box>
								{shows(options, "priority") ? <ui.box style={{ width: 24, alignItems: "center", flexShrink: 0 }}><PriorityIcon priority={issue.priority} size={14} /></ui.box> : null}
								{shows(options, "id") ? <ui.text style={{ fontSize: 12, color: "text3", width: 72, flexShrink: 0 }} maxLines={1}>{issue.key}</ui.text> : null}
								{shows(options, "status") ? <ui.box style={{ width: 24, alignItems: "center", flexShrink: 0 }}><StatusIcon status={issue.status} size={14} /></ui.box> : null}
								<ui.box style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 6, alignItems: "center" }}>
									{showProject ? <ProjectMark project={project} size={14} /> : null}
									{parent ? <ui.text style={{ fontSize: 12, color: "text3", flexShrink: 0 }}>{`${parent.key} ›`}</ui.text> : null}
									<ui.text style={{ fontSize: 14, fontWeight: 500, minWidth: 0, flexShrink: 1, color: closed ? "text3" : "text" }} maxLines={1}>{issue.title}</ui.text>
									{issue.subIssueCount > 0 ? <SubIssueChip done={issue.subIssueDoneCount} total={issue.subIssueCount} /> : null}
								</ui.box>
								{shows(options, "agents") && issue.threadIds.length > 0 ? <AgentChip issue={issue} /> : null}
								{shows(options, "labels") ? marks.map((item) => <Tag key={item.id} label={item} />) : null}
								{shows(options, "dueDate") && issue.dueDate ? <DueChip date={issue.dueDate} /> : null}
								{shows(options, "assignee") ? (assignees.length ? <AvatarStack members={assignees} size={20} /> : <ui.box style={{ width: 20 }} />) : null}
								{shows(options, "created") ? <ui.text style={{ fontSize: 12, color: "text3", width: 48, textAlign: "right", flexShrink: 0 }}>{monthDay(issue.createdAt)}</ui.text> : null}
								{shows(options, "updated") ? <ui.text style={{ fontSize: 12, color: "text3", width: 40, textAlign: "right", flexShrink: 0 }}>{ago(issue.updatedAt)}</ui.text> : null}
							</ui.box>
						);
					})}
				</ui.box>
			))}
		</ui.box>
	);
}

function GroupMark({ group, flux }: { group: IssueGroup; flux: Flux }) {
	if (group.key.kind === "status") return <StatusIcon status={group.key.status} />;
	if (group.key.kind === "priority") return <PriorityIcon priority={group.key.priority} />;
	const key = group.key;
	if (key.kind === "project") return <ProjectMark project={flux.projects().find((item) => item.id === key.projectId)} />;
	if (key.kind === "assignee" && key.memberId) return <Avatar member={flux.memberList().find((item) => item.id === key.memberId)} size={16} />;
	return <ui.box style={{ width: 8, height: 8, borderRadius: "full", backgroundColor: "text3" }} />;
}

function Tag({ label }: { label: Label }) {
	return (
		<ui.box style={{ ...field, justifyContent: "flex-start", maxWidth: 144 }}>
			<ui.box style={{ width: 8, height: 8, borderRadius: "full", backgroundColor: colorOf[label.color] ?? "text3", flexShrink: 0 }} />
			<ui.text style={{ fontSize: 12, fontWeight: 500 }} maxLines={1}>{label.name}</ui.text>
		</ui.box>
	);
}

function dropOn(flux: Flux, group: IssueGroup, event: { data: unknown }, options: DisplayOptions) {
	const id = dragged(event);
	if (!id) return;
	const issue = flux.issue(id);
	if (!issue) return;
	const from = groupOf(issue, effectiveGrouping(options, false));
	const patch = patchForMove(issue, from, group.key);
	const ordering = options.ordering === "manual";
	const position = ordering ? positionBetween(group.issues[group.issues.length - 1], undefined) : undefined;
	const next = { ...(patch ?? {}), ...(position !== undefined ? { position } : {}) };
	if (!patch && position === undefined) return;
	void apply(flux, id, next);
}

function dropBefore(flux: Flux, group: IssueGroup, index: number, event: { data: unknown }, options: DisplayOptions) {
	if (options.ordering !== "manual") {
		dropOn(flux, group, event, options);
		return;
	}
	const id = dragged(event);
	if (!id) return;
	const issue = flux.issue(id);
	if (!issue) return;
	const from = groupOf(issue, effectiveGrouping(options, false));
	const patch = patchForMove(issue, from, group.key) ?? {};
	const before = group.issues[index - 1];
	const after = group.issues[index];
	void apply(flux, id, { ...patch, position: positionBetween(before?.id === id ? group.issues[index - 2] : before, after?.id === id ? group.issues[index + 1] : after) });
}

function dragged(event: { data: unknown }): string {
	const data = event.data as { id?: string } | null;
	return data && typeof data.id === "string" ? data.id : "";
}

function groupOf(issue: Issue, grouping: DisplayOptions["grouping"]): GroupKey {
	switch (grouping) {
		case "priority":
			return { kind: "priority", priority: issue.priority };
		case "assignee":
			return { kind: "assignee", memberId: issue.assigneeIds[0] ?? null };
		case "label":
			return { kind: "label", labelId: issue.labelIds[0] ?? null };
		case "project":
			return { kind: "project", projectId: issue.projectId };
		case "none":
			return { kind: "none" };
		default:
			return { kind: "status", status: issue.status };
	}
}

function apply(flux: Flux, id: string, patch: IssuePatch) {
	lastPatch = patch;
	void flux.updateIssue(id, patch).catch((error: unknown) => ui.toast(error instanceof Error ? error.message : String(error)));
}

function toggleSelected(id: string, on: boolean) {
	const next = new Set(selected);
	if (on) next.add(id);
	else next.delete(id);
	selected = next;
	cursor = id;
}

function openCard(issue: Issue) {
	cursor = issue.id;
	openIssue(issue.key);
}

function clickIssue(issue: Issue, event?: { mod?: boolean; shift?: boolean }) {
	if (event?.mod || event?.shift || selected.size > 0) {
		toggleSelected(issue.id, !selected.has(issue.id));
		return;
	}
	openCard(issue);
}

function SelectionBar({ flux }: { flux: Flux }) {
	const issues = flux.issues().filter((issue) => selected.has(issue.id));
	const clear = () => { selected = new Set(); };
	const status = issues.every((issue) => issue.status === issues[0]?.status) ? issues[0]?.status : undefined;
	return (
		<ui.box label="Selected issues" style={{ position: "absolute", bottom: 16, left: 0, right: 0, alignItems: "center", zIndex: 10 }}>
			<ui.box style={{ flexDirection: "row", gap: 2, alignItems: "center", height: 40, paddingLeft: 14, paddingRight: 4, borderRadius: "full", backgroundColor: "bg", border: "1px solid border", boxShadow: "0 6px 20px rgba(0,0,0,0.12)" }}>
				<ui.text style={{ fontSize: 13, color: "text2", paddingRight: 8 }}>{`${issues.length} selected`}</ui.text>
				<ui.menu label="Move to…" style={{ ...ghostChip, borderRadius: "full" }}>
					<ui.text style={{ fontSize: 13, fontWeight: 500 }}>Move to…</ui.text>
					{STATUSES.map((item) => <ui.item key={item} checked={item === status} onClick={() => { for (const issue of issues) apply(flux, issue.id, { status: item }); }}>{STATUS_LABELS[item]}</ui.item>)}
				</ui.menu>
				<ui.menu label="Actions" style={{ ...ghostChip, borderRadius: "full" }}>
					<ui.icon icon="command" style={{ width: 13, height: 13, color: "text2" }} />
					<ui.text style={{ fontSize: 13, fontWeight: 500 }}>Actions</ui.text>
					{propertyMenus(flux, issues, false)}
					<ui.separator />
					<ui.item icon="user" onClick={() => assignToMe(flux, issues)}>Assign to me</ui.item>
					<ui.item icon="copy" onClick={() => { for (const issue of issues) void flux.duplicateIssue(issue.id); }}>Duplicate</ui.item>
					<ui.item icon="external" onClick={() => ui.copy(issues.map((issue) => flux.issueUrl(issue)).join("\n"))}>Copy link</ui.item>
					<ui.item icon="copy" onClick={() => ui.copy(issues.map((issue) => issue.key).join("\n"))}>Copy ID</ui.item>
					<ui.separator />
					<ui.item icon="trash" danger onClick={() => { for (const issue of issues) void flux.deleteIssue(issue.id); clear(); }}>Delete</ui.item>
				</ui.menu>
				<ui.iconButton icon="x" label="Clear selection" onClick={clear} />
			</ui.box>
		</ui.box>
	);
}

function assignToMe(flux: Flux, issues: Issue[]) {
	const me = flux.me?.id;
	if (!me) return;
	for (const issue of issues) if (!issue.assigneeIds.includes(me)) apply(flux, issue.id, { assigneeIds: [...issue.assigneeIds, me] });
}

function propertyMenus(flux: Flux, issues: Issue[], shortcuts: boolean): Child {
	const all = (has: (issue: Issue) => boolean) => issues.length > 0 && issues.every(has);
	const each = (patch: (issue: Issue) => IssuePatch) => { for (const issue of issues) apply(flux, issue.id, patch(issue)); };
	const toggled = (list: string[], id: string, on: boolean) => (on ? list.filter((item) => item !== id) : list.includes(id) ? list : [...list, id]);
	const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
	const projects = flux.projects();
	return [
		<ui.menu key="status" label="Status" icon="check-circle" shortcut={shortcuts ? "S" : undefined}>
			{STATUSES.map((status) => <ui.item key={status} checked={all((issue) => issue.status === status)} onClick={() => each(() => ({ status }))}>{STATUS_LABELS[status]}</ui.item>)}
		</ui.menu>,
		<ui.menu key="priority" label="Priority" icon="rows" shortcut={shortcuts ? "P" : undefined}>
			{PRIORITIES.map((priority, index) => <ui.item key={priority} shortcut={shortcuts ? `Shift+${(index + 1) % 5}` : undefined} checked={all((issue) => issue.priority === priority)} onClick={() => each(() => ({ priority }))}>{PRIORITY_LABELS[priority]}</ui.item>)}
		</ui.menu>,
		<ui.menu key="assignee" label="Assignee" icon="user" shortcut={shortcuts ? "A" : undefined}>
			{flux.memberList().map((member) => {
				const on = all((issue) => issue.assigneeIds.includes(member.id));
				return <ui.item key={member.id} checked={on} onClick={() => each((issue) => ({ assigneeIds: toggled(issue.assigneeIds, member.id, on) }))}>{member.name}</ui.item>;
			})}
		</ui.menu>,
		<ui.menu key="due" label="Due date" icon="calendar" shortcut={shortcuts ? "Shift+D" : undefined}>
			<ui.item onClick={() => each(() => ({ dueDate: day(0) }))}>Today</ui.item>
			<ui.item onClick={() => each(() => ({ dueDate: day(1) }))}>Tomorrow</ui.item>
			<ui.item onClick={() => each(() => ({ dueDate: day(7) }))}>In a week</ui.item>
			{issues.some((issue) => issue.dueDate) ? <ui.item onClick={() => each(() => ({ dueDate: null }))}>No due date</ui.item> : null}
		</ui.menu>,
		<ui.menu key="labels" label="Labels" icon="tag" shortcut={shortcuts ? "L" : undefined}>
			{flux.labels().length === 0 ? <ui.item disabled>No labels</ui.item> : flux.labels().map((label) => {
				const on = all((issue) => issue.labelIds.includes(label.id));
				return <ui.item key={label.id} checked={on} onClick={() => each((issue) => ({ labelIds: toggled(issue.labelIds, label.id, on) }))}>{label.name}</ui.item>;
			})}
		</ui.menu>,
		projects.length >= 2 ? (
			<ui.menu key="project" label="Move to project" icon="folder" shortcut={shortcuts ? "Shift+P" : undefined}>
				{projects.map((project) => <ui.item key={project.id} checked={all((issue) => issue.projectId === project.id)} onClick={() => each(() => ({ projectId: project.id }))}>{project.name}</ui.item>)}
			</ui.menu>
		) : null,
	];
}

function IssueContextMenu({ flux, issue }: { flux: Flux; issue: Issue }) {
	const me = flux.me?.id;
	const url = flux.issueUrl(issue);
	return (
		<ui.menu context label={`${issue.key} actions`}>
			<ui.item shortcut="Enter" onClick={() => openCard(issue)}>Open</ui.item>
			<ui.item icon="external" href={url} disabled={!url}>Open in Flux</ui.item>
			<ui.item icon="bot" onClick={() => { startAgent(issue.id); openIssue(issue.key); }}>Start agent</ui.item>
			<ui.separator />
			<ui.menu label="Copy" icon="copy">
				<ui.item onClick={() => ui.copy(issue.key)}>Copy ID</ui.item>
				<ui.item shortcut="Mod+Shift+," disabled={!url} onClick={() => ui.copy(url)}>Copy link</ui.item>
				<ui.item disabled={!issue.title.trim()} onClick={() => ui.copy(issue.title)}>Copy title</ui.item>
			</ui.menu>
			<ui.separator />
			{propertyMenus(flux, [issue], true)}
			<ui.separator />
			<ui.item icon="user" shortcut="I" disabled={!me || issue.assigneeIds.includes(me)} onClick={() => assignToMe(flux, [issue])}>Assign to me</ui.item>
			<ui.item icon="copy" shortcut="D" onClick={() => void flux.duplicateIssue(issue.id)}>Duplicate</ui.item>
			<ui.item icon="plus" shortcut="Mod+Shift+O" onClick={() => openCreate(flux, issue.projectId, undefined, issue.id)}>Add sub-issue</ui.item>
			<ui.item icon="branch" shortcut="Mod+Shift+P" onClick={() => { cursor = issue.id; palette = "parent"; }}>Set parent</ui.item>
			{issue.parentId ? <ui.item onClick={() => apply(flux, issue.id, { parentId: null })}>Remove parent</ui.item> : null}
			<ui.separator />
			<ui.item icon="trash" danger shortcut="Mod+Backspace" onClick={() => { void flux.deleteIssue(issue.id); selected.delete(issue.id); }}>Delete</ui.item>
		</ui.menu>
	);
}

const menuRow = { padding: 6, borderRadius: "control", hover: { backgroundColor: "hover" } } as const;

function Palette({ flux }: { flux: Flux }) {
	const issue = flux.issue(cursor) ?? flux.issues().find((item) => selected.has(item.id));
	const close = () => { palette = ""; };
	if (!issue) {
		palette = "";
		return null;
	}
	const rows: { label: string; run: () => void }[] = [];
	if (palette === "status") for (const status of STATUSES) rows.push({ label: STATUS_LABELS[status], run: () => void apply(flux, issue.id, { status }) });
	if (palette === "priority") for (const priority of PRIORITIES) rows.push({ label: PRIORITY_LABELS[priority], run: () => void apply(flux, issue.id, { priority }) });
	if (palette === "assignee") for (const member of flux.memberList()) rows.push({ label: member.name, run: () => void apply(flux, issue.id, { assigneeIds: issue.assigneeIds.includes(member.id) ? issue.assigneeIds.filter((id) => id !== member.id) : [...issue.assigneeIds, member.id] }) });
	if (palette === "label") for (const label of flux.labels()) rows.push({ label: label.name, run: () => void apply(flux, issue.id, { labelIds: issue.labelIds.includes(label.id) ? issue.labelIds.filter((id) => id !== label.id) : [...issue.labelIds, label.id] }) });
	if (palette === "project") for (const project of flux.projects()) rows.push({ label: project.name, run: () => void apply(flux, issue.id, { projectId: project.id }) });
	if (palette === "parent") {
		for (const other of flux.issues().filter((item) => item.projectId === issue.projectId && item.id !== issue.id && !CLOSED_STATUSES.has(item.status)).slice(0, 12)) {
			rows.push({ label: `${other.key} ${other.title}`, run: () => void apply(flux, issue.id, { parentId: other.id }) });
		}
	}
	if (palette === "due") {
		const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
		for (const [label, date] of [["Today", day(0)], ["Tomorrow", day(1)], ["In a week", day(7)], ["Clear", null]] as const) {
			rows.push({ label, run: () => void apply(flux, issue.id, { dueDate: date }) });
		}
	}
	return (
		<ui.box style={{ position: "absolute", top: 64, alignSelf: "center", width: 280, gap: 2, padding: 6, borderRadius: "card", backgroundColor: "overlay", border: "1px solid border" }}>
			<ui.text style={{ fontSize: "small", color: "text3", padding: 6 }}>{`${issue.key} · ${palette}`}</ui.text>
			{rows.map((row) => (
				<ui.pressable key={row.label} label={row.label} onClick={() => { row.run(); close(); }} style={menuRow}><ui.text style={{ fontSize: 13 }}>{row.label}</ui.text></ui.pressable>
			))}
		</ui.box>
	);
}

function onListKey(flux: Flux, key: { key: string; shift: boolean; mod: boolean }, flat: Issue[], groups: IssueGroup[], options: DisplayOptions) {
	const index = Math.max(0, flat.findIndex((issue) => issue.id === cursor));
	const current = flat[index];
	const move = (next: number) => {
		const issue = flat[Math.max(0, Math.min(flat.length - 1, next))];
		if (!issue) return;
		cursor = issue.id;
		if (key.shift) toggleSelected(issue.id, !selected.has(issue.id));
	};
	if (key.key === "j" || key.key === "ArrowDown") move(index + 1);
	else if (key.key === "k" || key.key === "ArrowUp") move(cursor ? index - 1 : 0);
	else if (key.key === "ArrowRight" || key.key === "ArrowLeft") {
		const at = groups.findIndex((group) => group.issues.some((issue) => issue.id === cursor));
		const next = groups[at + (key.key === "ArrowRight" ? 1 : -1)];
		if (next?.issues[0]) cursor = next.issues[0].id;
	} else if (key.key === "Enter" && current) openIssue(current.key);
	else if (key.key === "c" || key.key === "C") openCreate(flux);
	else if (key.key === "/" ) query = query;
	else if ((key.key === "s" || key.key === "S") && !key.shift) palette = "status";
	else if ((key.key === "p" || key.key === "P") && !key.shift) palette = "priority";
	else if (key.key === "a" || key.key === "A") palette = key.mod ? "" : "assignee";
	else if (key.key === "l" || key.key === "L") palette = "label";
	else if (key.shift && (key.key === "d" || key.key === "D")) palette = "due";
	else if (key.shift && (key.key === "p" || key.key === "P")) palette = "project";
	else if (key.shift && key.key === "v") setDisplay({ ...options, layout: options.layout === "board" ? "list" : "board" });
	else if (key.mod && (key.key === "b" || key.key === "B")) setDisplay({ ...options, layout: options.layout === "board" ? "list" : "board" });
	else if (key.key === "i" || key.key === "I") {
		const me = flux.me?.id;
		if (current && me) void apply(flux, current.id, { assigneeIds: current.assigneeIds.includes(me) ? current.assigneeIds.filter((id) => id !== me) : [...current.assigneeIds, me] });
	} else if ((key.key === "d" || key.key === "D") && !key.shift && current) void flux.duplicateIssue(current.id);
	else if ((key.key === "x" || key.key === "X") && current) toggleSelected(current.id, key.shift ? true : !selected.has(current.id));
	else if (key.mod && (key.key === "a" || key.key === "A")) selected = new Set(flat.map((issue) => issue.id));
	else if ((key.mod && key.key === "Backspace") || key.key === "Backspace" && key.mod) {
		for (const id of selected.size ? selected : current ? [current.id] : []) void flux.deleteIssue(id);
		selected = new Set();
	} else if (key.key === "." && lastPatch && current) void apply(flux, current.id, lastPatch);
	else if (key.shift && key.key >= "0" && key.key <= "4") {
		const priority = ({ "1": "urgent", "2": "high", "3": "medium", "4": "low", "0": "none" } as Record<string, Priority>)[key.key];
		if (current && priority) void apply(flux, current.id, { priority });
	} else if (key.key === "Escape") {
		palette = "";
		displayOpen = false;
		if (selected.size) selected = new Set();
	}
}

function Empty({ flux, scope, inProject, onCreate }: { flux: Flux; scope: Scope; inProject: boolean; onCreate: () => void }) {
	const filtered = query.trim() !== "";
	const title = filtered ? "No matching issues" : scope === "active" ? "Nothing in progress" : scope === "mine" ? "No issues assigned to you" : inProject ? "Add issues to the project" : "No issues yet";
	const text = filtered
		? `Nothing here matches “${query.trim()}”.`
		: scope === "active"
			? "Issues show up here once someone starts them or hands them to an agent."
			: scope === "mine"
				? "Issues assigned to you will show up here."
				: "Start building your project by creating an issue.";
	return (
		<ui.box style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
			<ui.canvas width={80} height={74} label="No issues" style={{ width: 80, height: 74, flexShrink: 0 }} draw={(g) => {
				g.ellipse(28, 28, 22, 16, { fill: "hover", stroke: "text3", lineWidth: 1.5 });
				g.ellipse(48, 40, 22, 16, { fill: "raised", stroke: "text2", lineWidth: 1.5 });
				g.path("M40 40 L46 46 L58 32", { stroke: "text", lineWidth: 2 });
			}} />
			<ui.text style={{ fontSize: 18, fontWeight: 600 }}>{title}</ui.text>
			<ui.text style={{ color: "text2" }}>{text}</ui.text>
			<ui.box style={{ flexDirection: "row", gap: 8 }}>
				{filtered ? <ui.button kind="secondary" onClick={() => { query = ""; }}>Clear filter</ui.button> : null}
				{!filtered && scope !== "all" ? <ui.button kind="secondary" onClick={() => storage.set("scope", "all")}>Show all issues</ui.button> : null}
				{!filtered && scope !== "active" && flux.projects().length > 0 ? <ui.button kind="primary" icon="plus" onClick={onCreate}>New issue</ui.button> : null}
			</ui.box>
		</ui.box>
	);
}

function openCreate(flux: Flux, projectId?: string, key?: GroupKey, parentId?: string) {
	const seeded = key ? draftForGroup(key) : {};
	const me = flux.me?.id;
	creating = true;
	draftTitle = "";
	draftBody = "";
	draftStatus = seeded.status ?? "todo";
	draftPriority = seeded.priority ?? "none";
	draftAssignees = seeded.assigneeIds ?? (scopeNow() === "mine" && me ? [me] : []);
	draftLabels = seeded.labelIds ?? [];
	draftProject = seeded.projectId ?? projectId ?? flux.projects()[0]?.id ?? "";
	draftDue = null;
	draftParent = parentId ?? null;
	ui.showOverlay("flux-new");
}

export function NewIssue({ flux }: { flux: Flux }) {
	const projects = flux.projects();
	const project = projects.find((item) => item.id === draftProject);
	const members = flux.memberList();
	const who = members.find((member) => member.id === draftAssignees[0]);
	const labels = flux.labels();
	const parent = draftParent ? flux.issue(draftParent) : undefined;
	const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
	const chip = { ...ghostChip, height: 28, border: "1px solid border" } as const;
	return (
		<ui.box style={{ gap: 0 }} keys={["Mod+Enter"]} onKeyDown={() => void submitNew(flux)}>
			<ui.box style={{ gap: 12, paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 8 }}>
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
					<ui.menu label={`Project: ${project?.name ?? "None"}`} style={{ ...ghostChip, height: 28, paddingLeft: 4, hover: { backgroundColor: "hover" } }}>
						<ProjectMark project={project} size={14} />
						<ui.text style={{ fontSize: 13 }}>{project?.name ?? "Project"}</ui.text>
						{projects.map((item) => <ui.item key={item.id} checked={item.id === draftProject} onClick={() => { draftProject = item.id; }}>{item.name}</ui.item>)}
					</ui.menu>
					{parent ? <ui.text style={{ fontSize: 13, color: "text3" }}>{`› Sub-issue of ${parent.key}`}</ui.text> : null}
				</ui.box>
				<ui.field key="new-title" value={draftTitle} placeholder="Issue title" onChange={(value) => { draftTitle = value; }} onSubmit={() => void submitNew(flux)} style={{ fontSize: 18, fontWeight: 500, lineHeight: "28px", backgroundColor: "transparent", boxShadow: "none", padding: 0 }} />
				<ui.editor key="new-body" value={draftBody} placeholder="Add description..." label="Description" options={mentionOptions(flux)} onChange={(value) => { draftBody = value; }} onSubmit={() => void submitNew(flux)} style={{ minHeight: 144 }} />
			</ui.box>
			<ui.box style={{ height: 1, backgroundColor: "divider" }} />
			<ui.box style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", paddingLeft: 16, paddingRight: 16, paddingTop: 12 }}>
				<ui.menu label={`Status: ${STATUS_LABELS[draftStatus]}`} style={chip}>
					<StatusIcon status={draftStatus} size={13} />
					<ui.text style={{ fontSize: 13 }}>{STATUS_LABELS[draftStatus]}</ui.text>
					{STATUSES.map((status) => <ui.item key={status} checked={draftStatus === status} onClick={() => { draftStatus = status; }}>{STATUS_LABELS[status]}</ui.item>)}
				</ui.menu>
				<ui.menu label={`Priority: ${PRIORITY_LABELS[draftPriority]}`} style={chip}>
					<PriorityIcon priority={draftPriority} size={13} />
					<ui.text style={{ fontSize: 13 }}>{draftPriority === "none" ? "Priority" : PRIORITY_LABELS[draftPriority]}</ui.text>
					{PRIORITIES.map((priority) => <ui.item key={priority} checked={draftPriority === priority} onClick={() => { draftPriority = priority; }}>{PRIORITY_LABELS[priority]}</ui.item>)}
				</ui.menu>
				<ui.menu label={who ? `Assignee: ${who.name}` : "Assignee"} style={chip}>
					{who ? <Avatar member={who} size={16} /> : <ui.icon icon="user" style={{ width: 13, height: 13, color: "text2" }} />}
					<ui.text style={{ fontSize: 13 }}>{who ? who.name : "Assignee"}</ui.text>
					{members.map((member) => <ui.item key={member.id} checked={draftAssignees.includes(member.id)} onClick={() => { draftAssignees = draftAssignees.includes(member.id) ? draftAssignees.filter((id) => id !== member.id) : [...draftAssignees, member.id]; }}>{member.name}</ui.item>)}
				</ui.menu>
				<ui.menu label="Labels" style={chip}>
					<ui.icon icon="tag" style={{ width: 13, height: 13, color: "text2" }} />
					<ui.text style={{ fontSize: 13 }}>{draftLabels.length ? labels.filter((item) => draftLabels.includes(item.id)).map((item) => item.name).join(", ") : "Labels"}</ui.text>
					{labels.length === 0 ? <ui.item disabled>No labels</ui.item> : labels.map((item) => <ui.item key={item.id} checked={draftLabels.includes(item.id)} onClick={() => { draftLabels = draftLabels.includes(item.id) ? draftLabels.filter((id) => id !== item.id) : [...draftLabels, item.id]; }}>{item.name}</ui.item>)}
				</ui.menu>
				<ui.menu label={draftDue ? `Due ${draftDue}` : "Due date"} style={chip}>
					<ui.icon icon="calendar" style={{ width: 13, height: 13, color: "text2" }} />
					<ui.text style={{ fontSize: 13 }}>{draftDue ?? "Due date"}</ui.text>
					<ui.item onClick={() => { draftDue = day(0); }}>Today</ui.item>
					<ui.item onClick={() => { draftDue = day(1); }}>Tomorrow</ui.item>
					<ui.item onClick={() => { draftDue = day(7); }}>In a week</ui.item>
					{draftDue ? <ui.item onClick={() => { draftDue = null; }}>No due date</ui.item> : null}
				</ui.menu>
			</ui.box>
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "flex-end", paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
				<ui.toggle label="Create more" checked={createMore} onChange={(checked) => { createMore = checked; }} />
				<ui.button kind="primary" disabled={!draftTitle.trim()} onClick={() => void submitNew(flux)}>Create  ⌘↵</ui.button>
			</ui.box>
		</ui.box>
	);
}

async function submitNew(flux: Flux) {
	const title = draftTitle.trim();
	if (!title || !draftProject) {
		ui.toast(title ? "Pick a project." : "Give the issue a title.");
		return;
	}
	try {
		const issue = await flux.createIssue({ projectId: draftProject, title, descriptionMarkdown: draftBody, status: draftStatus, priority: draftPriority, assigneeIds: draftAssignees, labelIds: draftLabels, parentId: draftParent });
		if (draftDue) await flux.updateIssue(issue.id, { dueDate: draftDue });
		ui.toast(`Created ${issue.key}.`);
		if (createMore) {
			draftTitle = "";
			draftBody = "";
		} else {
			creating = false;
			ui.hideOverlay("flux-new");
			openIssue(issue.key);
		}
	} catch (error) {
		ui.toast(error instanceof Error ? error.message : String(error));
	}
}

function IssuePage({ flux, issueKey, image }: { flux: Flux; issueKey: string; image: ImageOf }) {
	const issue = flux.findIssue(issueKey);
	if (!issue) {
		const connection = flux.connection();
		const waiting = connection.state !== "ready";
		return (
			<ui.box style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
				<ui.text style={{ fontSize: 16, fontWeight: 600 }}>{waiting ? `Loading ${issueKey}…` : `No issue ${issueKey}`}</ui.text>
				<ui.text style={{ color: "text2", textAlign: "center" }}>{waiting ? (connection.message ? offline(connection.message, false) : "Syncing with Flux.") : "It was deleted, or moved to another project."}</ui.text>
				<ui.button kind="secondary" onClick={() => openList("")}>Back to the board</ui.button>
			</ui.box>
		);
	}
	const detail = flux.detail(issue.id);
	const project = flux.projects().find((item) => item.id === issue.projectId);
	const members = flux.memberList();
	const back = () => openList(project ? `p/${project.key}` : "");
	const titleKey = `title:${flux.id}:${issue.id}`;
	const edits = { update: (patch: IssuePatch) => void flux.updateIssue(issue.id, patch) };
	return (
		<ui.box style={{ flex: 1, height: "100%", minHeight: 0, minWidth: 0, width: "100%", gap: 0 }} keys={["e", "E"]} onKeyDown={() => { if (editingTitle !== issue.id) editingTitle = issue.id; }}>
			<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 48, flexShrink: 0, paddingLeft: EDGE - 6, paddingRight: EDGE, borderBottom: "1px solid border" }}>
				<ui.pressable label={project?.name ?? "Issues"} onClick={back} style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 28, paddingLeft: 6, paddingRight: 6, borderRadius: "control", color: "text2", hover: { backgroundColor: "hover", color: "text" } }}>
					{project ? <ProjectMark project={project} /> : null}
					<ui.text style={{ fontSize: 13, color: "currentColor" }} maxLines={1}>{project?.name ?? "Issues"}</ui.text>
				</ui.pressable>
				<ui.icon icon="chevron-right" style={{ width: 12, height: 12, color: "text3", flexShrink: 0 }} />
				<ui.text style={{ fontSize: 13, color: "text2", flexShrink: 0 }}>{issue.key}</ui.text>
				<ui.text style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 }} maxLines={1}>{issue.title.trim() || "Untitled"}</ui.text>
				<ui.iconButton icon="external" label="Open in Flux" href={flux.issueUrl(issue)} disabled={!flux.issueUrl(issue)} />
				<IssueMenu flux={flux} issue={issue} onDelete={back} />
			</ui.box>
			<ui.box style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
				<ui.box style={{ flexDirection: "row", width: "100%", maxWidth: 928, alignSelf: "center", paddingLeft: 16, paddingRight: 16, paddingTop: 24, paddingBottom: 96, media: [{ minWidth: 700, style: { paddingLeft: 32, paddingRight: 32, paddingTop: 40 } }] }}>
					<ui.box style={{ flex: 1, minWidth: 0, gap: 0 }}>
						{editingTitle === issue.id ? (
							<ui.field
								key={titleKey}
								value={drafted(titleKey, issue.title)}
								placeholder="Issue title"
								autoFocus
								onChange={(value) => editDraft(titleKey, value, (next) => saveTitle(flux, issue, next))}
								onSubmit={(value) => { editingTitle = ""; void saveTitle(flux, issue, value); }}
								style={{ ...titleStyle, height: 38, padding: 0, backgroundColor: "transparent", boxShadow: "none" }}
							/>
						) : (
							<ui.pressable label="Title" tooltip="Edit the title (E)" onClick={() => { editingTitle = issue.id; }} style={{ cursor: "text" }}>
								<ui.text style={titleStyle}>{drafted(titleKey, issue.title).trim() || "Untitled"}</ui.text>
							</ui.pressable>
						)}
						{detail.parent ? <ParentLine parent={detail.parent} /> : null}
						<ui.box style={{ marginTop: 16, media: [{ minWidth: 900, style: { display: "none" } }] }}>
							<Properties issue={issue} project={project} members={members} labels={flux.labels()} me={flux.me?.id} edits={edits} start={() => startAgent(issue.id)} />
						</ui.box>
						{isStarting(issue.id) ? <ui.box style={{ marginTop: 16 }}><StartAgent flux={flux} issue={issue} markdown={detail.descriptionMarkdown} /></ui.box> : null}
						<ui.box style={{ marginTop: 24 }}>
							<DescriptionEditor flux={flux} issue={issue} markdown={detail.descriptionMarkdown} image={image} />
						</ui.box>
						<SubIssues flux={flux} issue={issue} subs={detail.subIssues} />
						<ui.box style={{ height: 1, backgroundColor: "divider", marginTop: 32 }} />
						<ui.text style={{ fontSize: 14, fontWeight: 500, marginTop: 24 }}>Activity</ui.text>
						<ui.box style={{ gap: 20, marginTop: 20 }}>
							<ActivityRow member={members.find((member) => member.id === issue.creatorId)} when={issue.createdAt} text="created the issue" />
							{detail.comments.map((comment) => <Comment key={comment.id} flux={flux} comment={comment} members={members} />)}
							<CommentEditor flux={flux} issue={issue} image={image} />
						</ui.box>
					</ui.box>
					<ui.box style={{ display: "none", media: [{ minWidth: 900, style: { display: "flex" } }] }}>
						<PropertyRail flux={flux} issue={issue} project={project} members={members} />
					</ui.box>
				</ui.box>
			</ui.box>
		</ui.box>
	);
}

const titleStyle = { fontSize: 30, lineHeight: "38px", fontWeight: 600, letterSpacing: -0.4, media: [{ maxWidth: 699, style: { fontSize: 24, lineHeight: "30px" } }] } as const;
let editingTitle = "";

async function saveTitle(flux: Flux, issue: Issue, value: string) {
	const next = value.trim();
	if (next && next !== issue.title) await flux.updateIssue(issue.id, { title: next });
}

/** "Sub-issue of PARENT", under the title. */
function ParentLine({ parent }: { parent: Issue }) {
	return (
		<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
			<ui.text style={{ fontSize: 13, color: "text2" }}>Sub-issue of</ui.text>
			<ui.pressable label={`${parent.key} ${parent.title}`} onClick={() => openIssue(parent.key)} style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0, flexShrink: 1 }}>
				<StatusIcon status={parent.status} size={14} />
				<ui.text style={{ fontSize: 13, minWidth: 0 }} maxLines={1}>{`${parent.key} ${parent.title.trim() || "Untitled"}`}</ui.text>
			</ui.pressable>
			{parent.subIssueCount > 0 ? <SubIssueChip done={parent.subIssueDoneCount} total={parent.subIssueCount} /> : null}
		</ui.box>
	);
}

let subsOpen = true;

function SubIssues({ flux, issue, subs }: { flux: Flux; issue: Issue; subs: Issue[] }) {
	const members = flux.memberList();
	const add = () => openCreate(flux, issue.projectId, undefined, issue.id);
	if (subs.length === 0) {
		return (
			<ui.pressable label="Add sub-issues" onClick={add} style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 32, marginTop: 32, paddingLeft: 6, paddingRight: 6, borderRadius: "control", color: "text2", hover: { backgroundColor: "hover", color: "text" } }}>
				<ui.icon icon="plus" style={{ width: 14, height: 14, color: "currentColor" }} />
				<ui.text style={{ fontSize: 14, color: "currentColor" }}>Add sub-issues</ui.text>
			</ui.pressable>
		);
	}
	const done = subs.filter((sub) => CLOSED_STATUSES.has(sub.status)).length;
	return (
		<ui.box style={{ marginTop: 32, gap: 4 }}>
			<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", height: 32 }}>
				<ui.pressable label="Sub-issues" checked={subsOpen} onClick={() => { subsOpen = !subsOpen; }} style={{ flex: 1, flexDirection: "row", gap: 6, alignItems: "center", height: 32, paddingLeft: 6, paddingRight: 6, borderRadius: "control", hover: { backgroundColor: "hover" } }}>
					<ui.icon icon={subsOpen ? "chevron-down" : "chevron-right"} style={{ width: 12, height: 12, color: "text3" }} />
					<ui.text style={{ fontSize: 14, fontWeight: 500 }}>Sub-issues</ui.text>
					<SubIssueChip done={done} total={subs.length} />
				</ui.pressable>
				<ui.iconButton icon="plus" label="Add sub-issue" onClick={add} />
			</ui.box>
			{subsOpen ? subs.map((sub) => {
				const closed = CLOSED_STATUSES.has(sub.status);
				const who = members.filter((member) => sub.assigneeIds.includes(member.id));
				return (
					<ui.pressable key={sub.id} label={`${sub.key} ${sub.title}`} onClick={() => openIssue(sub.key)} style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 36, paddingLeft: 8, paddingRight: 8, borderRadius: "control", hover: { backgroundColor: "hover" } }}>
						<IssueContextMenu flux={flux} issue={sub} />
						<StatusIcon status={sub.status} size={14} />
						<ui.text style={{ fontSize: 12, color: "text3", flexShrink: 0 }}>{sub.key}</ui.text>
						<ui.text style={{ fontSize: 14, flex: 1, minWidth: 0, color: closed ? "text3" : "text", textDecoration: closed ? "line-through" : "none" }} maxLines={1}>{sub.title}</ui.text>
						{who.length ? <AvatarStack members={who} size={20} /> : null}
					</ui.pressable>
				);
			}) : null}
		</ui.box>
	);
}

/** Flux's "…" menu on the issue page, item for item. */
function IssueMenu({ flux, issue, onDelete }: { flux: Flux; issue: Issue; onDelete: () => void }) {
	const projects = flux.projects();
	const url = flux.issueUrl(issue);
	return (
		<ui.menu label="" icon="more" tooltip="Issue actions">
			<ui.item icon="copy" shortcut="D" onClick={() => void flux.duplicateIssue(issue.id).then((copy) => openIssue(copy.key))}>Duplicate</ui.item>
			<ui.item icon="external" shortcut="Mod+Shift+," disabled={!url} onClick={() => ui.copy(url)}>Copy link</ui.item>
			<ui.item icon="copy" onClick={() => ui.copy(issue.key)}>Copy ID</ui.item>
			{projects.length >= 2 ? (
				<ui.menu label="Move to project" icon="folder" shortcut="Shift+P">
					{projects.map((project) => <ui.item key={project.id} checked={issue.projectId === project.id} onClick={() => void flux.updateIssue(issue.id, { projectId: project.id })}>{project.name}</ui.item>)}
				</ui.menu>
			) : null}
			<ui.separator />
			<ui.item icon="plus" shortcut="Mod+Shift+O" onClick={() => openCreate(flux, issue.projectId, undefined, issue.id)}>Add sub-issue</ui.item>
			<ui.item icon="branch" shortcut="Mod+Shift+P" onClick={() => { cursor = issue.id; palette = "parent"; }}>Set parent</ui.item>
			{issue.parentId ? <ui.item onClick={() => void flux.updateIssue(issue.id, { parentId: null })}>Remove parent</ui.item> : null}
			<ui.separator />
			<ui.item icon="trash" danger shortcut="Mod+Backspace" onClick={() => { void flux.deleteIssue(issue.id); onDelete(); }}>Delete</ui.item>
		</ui.menu>
	);
}

function Comment({ flux, comment, members }: { flux: Flux; comment: IssueComment; members: Member[] }) {
	const author = members.find((member) => member.id === comment.authorId);
	const mine = comment.authorId === flux.me?.id && !comment.agent;
	const editing = editingComment === comment.id;
	return (
		<ui.box style={{ gap: 6 }}>
			<ui.box style={{ flexDirection: "row", gap: 10, alignItems: "center", height: 24 }}>
				{comment.agent ? <ui.box style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: "accentSoft", alignItems: "center", justifyContent: "center" }}><ui.icon icon="robot" style={{ width: 13, height: 13, color: "accent" }} /></ui.box> : <Avatar member={author} size={20} />}
				<ui.text style={{ fontSize: 14, color: "text2" }}>
					<ui.text style={{ fontWeight: 600, color: "text" }}>{comment.agent?.name ?? author?.name ?? "Someone"}</ui.text>
					{comment.agent && author ? ` for ${author.name}` : ""}
					{` · ${ago(comment.createdAt)}`}
				</ui.text>
				<ui.box style={{ flex: 1 }} />
				{mine && !editing ? (
					<ui.menu label="" icon="more" tooltip="Comment actions">
						<ui.item icon="pencil" onClick={() => { editingComment = comment.id; commentBody = comment.markdown; }}>Edit</ui.item>
						<ui.item icon="trash" danger onClick={() => void flux.deleteComment(comment.id)}>Delete</ui.item>
					</ui.menu>
				) : null}
			</ui.box>
			{editing ? (
				<ui.box style={{ marginLeft: 30, gap: 0, borderRadius: "control", border: "1px solid border", backgroundColor: "raised" }}>
					<ui.box style={{ padding: 8 }}>
						<ui.editor key={"edit-" + comment.id} value={commentBody} label="Edit comment" options={mentionOptions(flux)} onChange={(value) => { commentBody = value; }} onSubmit={() => saveComment(flux, comment.id)} style={{ padding: 0 }} />
					</ui.box>
					<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}>
						<ui.button size="sm" kind="ghost" onClick={() => { editingComment = ""; }}>Cancel</ui.button>
						<ui.button size="sm" kind="primary" disabled={!commentBody.trim()} onClick={() => saveComment(flux, comment.id)}>Save</ui.button>
					</ui.box>
				</ui.box>
			) : (
				<ui.box style={{ paddingLeft: 30 }}><ui.markdown text={comment.markdown} /></ui.box>
			)}
		</ui.box>
	);
}

function saveComment(flux: Flux, id: string) {
	const body = commentBody.trim();
	if (!body) return;
	editingComment = "";
	void flux.updateComment(id, body).catch((error: unknown) => ui.toast(error instanceof Error ? error.message : String(error)));
}

function ActivityRow({ member, when, text }: { member?: Member; when: string; text: string }) {
	return (
		<ui.box style={{ flexDirection: "row", gap: 10, alignItems: "center", height: 24 }}>
			<Avatar member={member} size={20} />
			<ui.text style={{ fontSize: 14, color: "text2" }}>
				<ui.text style={{ fontWeight: 600, color: "text" }}>{member?.name ?? "Someone"}</ui.text>
				{` ${text} · ${ago(when)}`}
			</ui.text>
		</ui.box>
	);
}

const railHeading = { fontSize: 12, fontWeight: 500, color: "text2", paddingLeft: 6, paddingRight: 6, paddingBottom: 8 } as const;

function PropertyRail({ flux, issue, project, members }: { flux: Flux; issue: Issue; project?: Project; members: Member[] }) {
	const labels = flux.labels().filter((item) => issue.labelIds.includes(item.id));
	const assignees = members.filter((member) => issue.assigneeIds.includes(member.id));
	const edits = { update: (patch: IssuePatch) => void flux.updateIssue(issue.id, patch) };
	const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
	const labelItems = flux.labels().map((item) => <ui.item key={item.id} checked={issue.labelIds.includes(item.id)} onClick={() => edits.update({ labelIds: issue.labelIds.includes(item.id) ? issue.labelIds.filter((id) => id !== item.id) : [...issue.labelIds, item.id] })}>{item.name}</ui.item>);
	const another = issue.threadIds.length > 0;
	return (
		<ui.box style={{ width: 240, flexShrink: 0, gap: 32, paddingLeft: 40 }}>
			<ui.box style={{ gap: 2 }}>
				<ui.text style={railHeading}>Properties</ui.text>
				<RailRow icon={<ProjectMark project={project} />} label="Project" value={project?.name ?? "None"} menu={"Project: " + (project?.name ?? "None")}>
					{flux.projects().map((item) => <ui.item key={item.id} checked={item.id === issue.projectId} onClick={() => edits.update({ projectId: item.id })}>{item.name}</ui.item>)}
				</RailRow>
				<RailRow icon={<StatusIcon status={issue.status} />} label="Status" value={STATUS_LABELS[issue.status]} menu={"Status: " + STATUS_LABELS[issue.status]}>
					{STATUSES.map((status) => <ui.item key={status} checked={issue.status === status} onClick={() => edits.update({ status })}>{STATUS_LABELS[status]}</ui.item>)}
				</RailRow>
				<RailRow icon={<PriorityIcon priority={issue.priority} />} label="Priority" value={issue.priority === "none" ? "Set priority" : PRIORITY_LABELS[issue.priority]} muted={issue.priority === "none"} menu={"Priority: " + PRIORITY_LABELS[issue.priority]}>
					{PRIORITIES.map((priority) => <ui.item key={priority} checked={issue.priority === priority} onClick={() => edits.update({ priority })}>{PRIORITY_LABELS[priority]}</ui.item>)}
				</RailRow>
				<RailRow icon={assignees[0] ? <Avatar member={assignees[0]} size={14} /> : <ui.icon icon="user" style={{ width: 14, height: 14, color: "text3" }} />} label="Assignee" value={assignees.length > 1 ? `${assignees[0]!.name} +${assignees.length - 1}` : assignees[0]?.name ?? "Assign"} muted={assignees.length === 0} menu={assignees.length ? "Assignees: " + assignees.map((m) => m.name).join(", ") : "Assign"}>
					{members.map((member) => <ui.item key={member.id} checked={issue.assigneeIds.includes(member.id)} onClick={() => edits.update({ assigneeIds: issue.assigneeIds.includes(member.id) ? issue.assigneeIds.filter((id) => id !== member.id) : [...issue.assigneeIds, member.id] })}>{member.name}</ui.item>)}
				</RailRow>
				<RailRow icon={<ui.icon icon="calendar" style={{ width: 14, height: 14, color: issue.dueDate ? dueTone(issue.dueDate) : "text2" }} />} label="Due date" value={issue.dueDate ? dueLabel(issue.dueDate) : "Due date"} menu={issue.dueDate ? "Due " + issue.dueDate : "Due date"}>
					<ui.item onClick={() => edits.update({ dueDate: day(0) })}>Today</ui.item>
					<ui.item onClick={() => edits.update({ dueDate: day(1) })}>Tomorrow</ui.item>
					<ui.item onClick={() => edits.update({ dueDate: day(7) })}>In a week</ui.item>
					{issue.dueDate ? <ui.item danger onClick={() => edits.update({ dueDate: null })}>Clear</ui.item> : null}
				</RailRow>
			</ui.box>
			<ui.box style={{ gap: 2 }}>
				<ui.text style={railHeading}>Labels</ui.text>
				{labels.length === 0 ? (
					<ui.menu label="Add label" style={{ flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "flex-start", alignSelf: "flex-start", height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: "control", backgroundColor: "transparent", hover: { backgroundColor: "hover" } }}>
						<ui.icon icon="tag" style={{ width: 14, height: 14, color: "text2" }} />
						<ui.text style={{ fontSize: 14, color: "text2" }}>Add label</ui.text>
						{labelItems}
					</ui.menu>
				) : (
					<ui.box style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center", paddingLeft: 2 }}>
						{labels.map((item) => (
							<ui.menu key={item.id} label={`Labels: ${item.name}`} style={{ ...field, height: 28, paddingLeft: 8, paddingRight: 8, backgroundColor: "transparent", hover: { backgroundColor: "hover" } }}>
								<ui.box style={{ width: 8, height: 8, borderRadius: "full", backgroundColor: colorOf[item.color] ?? "text3" }} />
								<ui.text style={{ fontSize: 12, fontWeight: 500 }} maxLines={1}>{item.name}</ui.text>
								{labelItems}
							</ui.menu>
						))}
						<ui.menu label="" icon="plus" tooltip="Add label">{labelItems}</ui.menu>
					</ui.box>
				)}
			</ui.box>
			<ui.box style={{ gap: 4 }}>
				<ui.text style={{ ...railHeading, paddingBottom: 4 }}>Agents</ui.text>
				{issue.threadIds.map((id) => {
					const thread = threadInfo(id);
					return (
						<ui.box key={id} style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
							<ui.pressable label={thread?.title || "Archived thread"} onClick={() => ui.openThread(id)} style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 8, alignItems: "center", height: 32, paddingLeft: 6, paddingRight: 6, borderRadius: "control", hover: { backgroundColor: "hover" } }}>
								<ui.box style={{ width: 14, alignItems: "center", flexShrink: 0 }}>
									<ui.box style={{ width: 8, height: 8, borderRadius: "full", backgroundColor: thread?.working ? "green" : "text3", ...(thread?.working ? { animation: { name: "pulse" } } : {}) }} />
								</ui.box>
								<ui.text style={{ fontSize: 14, minWidth: 0 }} maxLines={1}>{thread ? thread.title || "Untitled thread" : "Archived thread"}</ui.text>
							</ui.pressable>
							<ui.iconButton icon="x" label="Detach thread" onClick={() => void flux.detach(issue.id, id)} />
						</ui.box>
					);
				})}
				<ui.button size="sm" kind={another ? "secondary" : "primary"} icon="bot" onClick={() => startAgent(issue.id)} style={{ marginTop: 4, width: "100%" }}>{another ? "Start another agent" : "Start agent"}</ui.button>
			</ui.box>
		</ui.box>
	);
}

function RailRow({ icon, value, menu, muted, children }: { icon: Child; label: string; value: string; menu: string; muted?: boolean; children?: Child }) {
	return (
		<ui.menu label={menu} style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 32, paddingLeft: 6, paddingRight: 6, borderRadius: "control", backgroundColor: "transparent", hover: { backgroundColor: "hover" } }}>
			{icon}
			<ui.text style={{ fontSize: 13, flex: 1, color: muted ? "text3" : "text" }}>{value}</ui.text>
			{children}
		</ui.menu>
	);
}

function Connections() {
	const list = hub.all().filter((flux) => flux.state !== "unconfigured" || flux.id === "default");
	const active = hub.active;
	return (
		<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
			<ui.menu label={active.workspace?.name || active.baseUrl || "Flux"} style={ghostChip}>
				<ui.box style={{ width: 8, height: 8, borderRadius: "full", backgroundColor: active.connection().state === "ready" ? "green" : "amber" }} />
				<ui.text style={{ fontSize: 13 }}>{active.workspace?.name || "Flux"}</ui.text>
				<ui.icon icon="chevron-down" style={{ width: 12, height: 12, color: "text3" }} />
				{list.map((item) => {
					const connection = item.connection();
					const title = connection.workspace?.name || connection.baseUrl || "Not connected";
					return <ui.item key={item.id} checked={item.id === active.id} onClick={() => hub.use(item.id)}>{title}</ui.item>;
				})}
				<ui.separator />
				<ui.item onClick={() => { adding = !adding; }}>Connect another Flux…</ui.item>
			</ui.menu>
			{adding ? <AddConnection /> : null}
		</ui.box>
	);
}

function AddConnection() {
	return (
		<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
			<ui.field key="flux-url" value={addURL} placeholder="https://flux.example.com" onChange={(value) => { addURL = value; }} />
			<ui.field key="flux-token" value={addToken} placeholder="API token" onChange={(value) => { addToken = value; }} />
			<ui.button size="sm" kind="primary" onClick={() => saveConnection()}>Add</ui.button>
		</ui.box>
	);
}

function saveConnection() {
	const url = addURL.trim();
	const token = addToken.trim();
	if (!url || !token) {
		ui.toast("Give Flux's URL and an API token.");
		return;
	}
	const current = parseExtras(String(settings.get("connections") ?? ""));
	current.push({ id: crypto.randomUUID(), url, token });
	settings.set({ connections: JSON.stringify(current) });
	addURL = "";
	addToken = "";
	adding = false;
}

// Setup connects a Flux where none is: in the page's middle, as its empty
// states are, what Flux does here, and a card with the address and the
// token it takes. A token Flux refused says so above it.
function Setup({ flux }: { flux: Flux }) {
	const connection = flux.connection();
	const refused = connection.state === "unauthorized";
	return (
		<ui.box style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
			<ui.box style={{ width: "100%", maxWidth: 420, gap: 20 }}>
				<ui.box style={{ alignItems: "center", gap: 10 }}>
					<ui.box style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "raised", border: "1px solid border" }}>
						<FluxMark size={24} color="text" />
					</ui.box>
					<ui.text style={{ fontSize: 18, fontWeight: 600 }}>Connect Flux</ui.text>
					<ui.text style={{ color: "text2", textAlign: "center" }}>See your issues here, start a thread from one, and keep its status in step as the thread works on it.</ui.text>
				</ui.box>
				{refused ? (
					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", padding: "s3 s4", borderRadius: "control", backgroundColor: "redSoft" }}>
						<ui.icon icon="alert-circle" style={{ width: 14, height: 14, color: "red", flexShrink: 0 }} />
						<ui.text style={{ color: "text", flex: 1 }}>{connection.message || "Flux didn't take that token: make another."}</ui.text>
					</ui.box>
				) : null}
				<ui.box style={{ gap: 14, padding: 16, borderRadius: "card", backgroundColor: "raised", border: "1px solid border" }}>
					<ui.box style={{ gap: 6 }}>
						<ui.text style={{ fontWeight: 500 }}>Address</ui.text>
						<ui.field key="flux-url" value={addURL} placeholder="https://flux.example.com" onChange={(value) => { addURL = value; }} onSubmit={() => saveConnection()} />
					</ui.box>
					<ui.box style={{ gap: 6 }}>
						<ui.text style={{ fontWeight: 500 }}>API token</ui.text>
						<ui.field key="flux-token" value={addToken} placeholder="Paste the token" onChange={(value) => { addToken = value; }} onSubmit={() => saveConnection()} />
						<ui.text style={{ fontSize: "small", color: "text3" }}>Make one in Flux, under Settings, API tokens.</ui.text>
					</ui.box>
					<ui.box style={{ flexDirection: "row", justifyContent: "flex-end" }}>
						<ui.button kind="primary" onClick={() => saveConnection()}>Connect</ui.button>
					</ui.box>
				</ui.box>
			</ui.box>
		</ui.box>
	);
}

export function unstarted(flux: Flux): Issue[] {
	const me = flux.me?.id ?? "";
	return flux.issues()
		.filter((issue) => !CLOSED_STATUSES.has(issue.status) && issue.status !== "review" && issue.threadIds.length === 0 && (issue.assigneeIds.length === 0 || issue.assigneeIds.includes(me)))
		.sort((left, right) => Number(right.assigneeIds.includes(me)) - Number(left.assigneeIds.includes(me)) || PRIORITY_LEVEL[right.priority] - PRIORITY_LEVEL[left.priority] || right.updatedAt.localeCompare(left.updatedAt))
		.slice(0, 5);
}
