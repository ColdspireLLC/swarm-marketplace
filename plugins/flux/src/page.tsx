// Flux's page, laid out like Flux: a board or a grouped list across the
// content area, display options, and an issue page with a properties rail.
import { BoardBones, CardBones, IssueBones, ListBones, RowBones } from "./skeleton";
import { storage, ui, type Child, type ColorValue, type IconName, type MenuChild, type Style } from "swarm";
import type { Comment as IssueComment, Issue, IssuePatch, Label, Member, Project } from "./contract";
import { ConnectForm } from "./connect";
import { hub } from "./hub";
import { CLOSED_STATUSES, COLORS, PRIORITIES, PRIORITY_LABELS, PRIORITY_LEVEL, STATUSES, STATUS_LABELS, type ColorName, type Priority, type Status } from "./flux";
import { CommentEditor, DescriptionEditor, mentionOptions, startAgent } from "./edit";
import type { Flux } from "./service";
import { threadInfo } from "./threads";
import { MARK_HEX, navMark } from "./marks";
import { pictureBytes } from "./pictures";
import { confirmDelete, duplicateProject, openNewProject, openProjectSettings, projectAt, projectMenuItems } from "./projects";
import { confirm } from "./confirm";
import { openPalette, type PaletteKind } from "./palette";
import { dayDelta, dueChoices, dueLabel } from "./dates";
import { dueItems } from "./due";
import { labelMark, memberMark, priorityMark, statusMark } from "./menumarks";
import { AgentAvatar, Avatar, RAISED_HOVER, FluxMark, IssuesArt, Markdown, TrayArt, Unassigned, PriorityIcon, ProjectMark, Properties, StatusIcon, colorOf, type MentionOf } from "./view";
import { clearDraft, drafted, editDraft } from "./drafts";
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
/** Whether the keys moved the cursor, which then shows; anchor, where a range selection starts. */
let keyed = false;
let anchor = "";
/** Bumped by "/" so the filter, built anew, takes the focus. */
let filterFocus = 0;
let lastPatch: IssuePatch | null = null;
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

/** The board's keys in its title bar, but Escape, which its menus and Swarm's back take there. */
const BAR_KEYS = PAGE_KEYS.filter((key) => key !== "Escape");

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

export function navItems(flux: Flux): { id: string; title: string; icon?: IconName; path?: string; section?: string; badge?: string; mark?: string | Uint8Array; initial?: string; tint?: string; movable?: boolean }[] {
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
			movable: true,
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

export function FluxPage({ path, slot, item, section, image }: { path: string; slot: string; item?: string; section?: string; image: ImageOf }) {
	const flux = hub.active;
	if (!slot) shownPath = path;
	// The sidebar's: New project on its heading, a project's right-click.
	if (slot === "section") return section === "Projects" ? <NewProjectButton /> : null;
	if (slot === "item") return <SidebarProjectMenu flux={flux} project={flux.projects().find((p) => "p-" + p.id === item)} />;
	const route = parsePath(path);
	const connection = flux.connection();
	const unset = connection.state === "unconfigured" || connection.state === "unauthorized";
	const cantLoad = (connection.state === "error" || connection.state === "offline") && connection.issueCount === 0;
	// The title bar is the page's own (a bare page): the board's toolbar,
	// an issue's breadcrumb, the same bar either way, so nothing in it
	// moves as one opens the other; Flux's name is the sidebar's.
	// Which Flux, at the end of the sidebar's row that names the page.
	if (slot === "side") return unset ? null : <WorkspaceSwitcher />;
	if (slot === "head") {
		if (unset || cantLoad) return <HeadTitle />;
		if (route.kind === "issue") return <IssueHead flux={flux} issueKey={route.key} />;
		const project = projectAt(flux, route.project);
		return <Toolbar flux={flux} project={project} scope={scopeNow()} options={displayOf()} />;
	}
	if (unset) return <Setup flux={flux} />;
	// Nothing synced to show, and Flux won't answer: why, rather than an empty board.
	if (cantLoad) return <CantLoad flux={flux} />;
	// The first sync: the board's shape while it comes, not "No issues yet".
	if (connection.state === "connecting" && connection.issueCount === 0 && route.kind === "list") {
		// Under the toolbar as it will be, so nothing moves when the issues come.
		const options = displayOf();
		const project = projectAt(flux, route.project);
		return (
			<ui.box style={{ position: "relative", flex: 1, height: "100%", minHeight: 0, minWidth: 0, width: "100%", gap: 0 }}>
				{options.layout === "list" ? <ListBones edge={EDGE} /> : <BoardBones edge={EDGE} />}
				{displayOpen ? displayPanel(options, !!project) : null}
			</ui.box>
		);
	}
	if (route.kind === "issue") return <IssuePage flux={flux} issueKey={route.key} image={image} />;
	return <ListScreen flux={flux} scope={scopeNow()} projectKey={route.project} />;
}

function ListScreen({ flux, scope, projectKey }: { flux: Flux; scope: Scope; projectKey: string | null }) {
	const options = displayOf();
	const projects = flux.projects();
	const project = projectAt(flux, projectKey);
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
	shownFlat = flat;
	shownGroups = groups;
	const connection = flux.connection();
	return (
		<ui.box
			style={{ position: "relative", flex: 1, height: "100%", minHeight: 0, minWidth: 0, width: "100%", gap: 0 }}
			keys={PAGE_KEYS}
			onKeyDown={(key) => onListKey(flux, key, flat, groups, options)}
		>
			<SyncBars flux={flux} />
			{flat.length === 0 ? <Empty flux={flux} scope={scope} inProject={!!project} onCreate={() => openCreate(flux, project?.id)} /> : options.layout === "list" ? <IssueList flux={flux} groups={groups} options={options} showProject={!project} scrollKey={`${project?.key ?? ""}:${scope}`} /> : <Board flux={flux} groups={groups} options={options} showProject={!project} scrollKey={`${project?.key ?? ""}:${scope}`} />}
			{selected.size > 0 ? <SelectionBar flux={flux} /> : null}
			{displayOpen ? displayPanel(options, !!project) : null}
		</ui.box>
	);
}

/** What the toolbar says while Flux can't be reached: the copy shown, not the raw error, which is its tooltip. */
function offline(message: string, copy = true): string {
	const host = /Could not reach Flux at (\S+): /.exec(message)?.[1];
	const said = host ? `Can't reach Flux at ${host.replace(/^https?:\/\//, "")}.` : message.replace(/\.?\s*$/, ".");
	return copy ? `${said} Showing the last copy.` : `${said} Trying again.`;
}

/** "5m ago": how long since an ISO time. */
function since(iso: string | null): string {
	if (!iso) return "a while ago";
	const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/**
 * Flux's bars over the issues while it can't be reached (bb's page.tsx):
 * the copy showing and how old it is, the changes waiting to send, Retry
 * now; and the changes made offline it didn't take, until dismissed.
 */
/** A retry that didn't reach Flux, said a moment where Retry now was: when it said so. */
let retryFailedAt = 0;

/** Retries now, and says a moment if Flux still can't be reached, as Flux's bar. */
function retryNow(flux: Flux) {
	flux.reconnect();
	setTimeout(() => {
		if (flux.connection().state === "offline") {
			retryFailedAt = Date.now();
			ui.update();
			setTimeout(() => ui.update(), 4_100);
		}
	}, 2_000);
}

export function SyncBars({ flux }: { flux: Flux }) {
	const c = flux.connection();
	const host = (c.baseUrl || flux.url || "Flux").replace(/^https?:\/\//, "");
	const away = (c.state === "offline" || (c.state === "connecting" && c.issueCount > 0)) && c.issueCount > 0;
	// Flux's: one quiet line under the bar, its dot, what's waiting and Retry now at its end.
	const bar = { flexDirection: "row", gap: 8, alignItems: "center", minHeight: 32, paddingLeft: EDGE, paddingRight: EDGE - 6, paddingTop: 4, paddingBottom: 4, borderBottom: "1px solid border", media: [{ minWidth: 768, style: { paddingLeft: 20, paddingRight: 14 } }] } satisfies Style;
	const barButton = { height: 24, paddingLeft: 6, paddingRight: 6, justifyContent: "center", flexShrink: 0, borderRadius: "control", color: "text", hover: { backgroundColor: "hover" } } as const;
	const failed = Date.now() - retryFailedAt < 4_000;
	return (
		<ui.box style={{ gap: 0, flexShrink: 0 }}>
			{away ? (
				<ui.box label="Offline" style={bar}>
					<ui.box style={{ width: 6, height: 6, borderRadius: "full", backgroundColor: "amber", flexShrink: 0 }} />
					<ui.box style={{ flex: 1, minWidth: 0, flexDirection: "row" }}>
						<ui.text style={{ fontSize: 12, minWidth: 0, color: "text2" }} maxLines={1} tooltip={c.message || undefined}>
							<ui.text style={{ fontWeight: 500, color: "text" }}>Offline</ui.text>
							{` · Can't reach ${host}, so this is the copy synced ${since(c.syncedAt)}. Changes you make are sent when it's back.`}
						</ui.text>
					</ui.box>
					{c.queued ? <ui.text style={{ fontSize: 12, color: "text2", flexShrink: 0 }}>{`${c.queued} waiting to send`}</ui.text> : null}
					<ui.pressable label="Retry now" disabled={c.state === "connecting"} onClick={() => retryNow(flux)} style={{ ...barButton, opacity: c.state === "connecting" ? 0.6 : 1 }}>
						<ui.text style={{ fontSize: 12, fontWeight: 500, color: "currentColor" }}>{c.state === "connecting" ? "Retrying…" : failed ? "Still can't reach it" : "Retry now"}</ui.text>
					</ui.pressable>
				</ui.box>
			) : c.state === "error" && c.message ? (
				<ui.box label="Flux couldn't sync" style={bar}>
					<ui.box style={{ width: 6, height: 6, borderRadius: "full", backgroundColor: "red", flexShrink: 0 }} />
					<ui.text style={{ fontSize: 12, color: "text2", flex: 1, minWidth: 0 }} maxLines={1} tooltip={c.message}>{c.message}</ui.text>
					<ui.pressable label="Try again" onClick={() => flux.reconnect()} style={barButton}>
						<ui.text style={{ fontSize: 12, fontWeight: 500, color: "currentColor" }}>Try again</ui.text>
					</ui.pressable>
				</ui.box>
			) : null}
			{c.dropped.length ? (
				<ui.box style={{ ...bar, alignItems: "flex-start", paddingTop: 8, paddingBottom: 8, backgroundColor: "redSoft" }}>
					<ui.icon icon="alert-circle" style={{ width: 14, height: 14, color: "red", flexShrink: 0, marginTop: 1 }} />
					<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
						<ui.text style={{ fontSize: 12, fontWeight: 500 }}>{c.dropped.length === 1 ? "A change made offline wasn't sent" : `${c.dropped.length} changes made offline weren't sent`}</ui.text>
						{c.dropped.slice(-5).map((d) => <ui.text key={d.id} style={{ fontSize: 12, color: "text2" }} maxLines={1}>{`${d.label}: ${d.reason}`}</ui.text>)}
					</ui.box>
					<ui.pressable label="Dismiss" onClick={() => flux.dismissDropped()} style={barButton}>
						<ui.text style={{ fontSize: 12, fontWeight: 500, color: "currentColor" }}>Dismiss</ui.text>
					</ui.pressable>
				</ui.box>
			) : null}
		</ui.box>
	);
}

/** The path the page shows, for what's drawn apart from it. */
let shownPath = "";

/** New project, at the end of the sidebar's Projects heading, as Flux's. */
function NewProjectButton() {
	return (
		<ui.pressable label="New project" tooltip="New project" onClick={openNewProject} style={{ width: 20, height: 20, marginTop: -4, marginBottom: -4, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: "control", color: "text3", transition: { duration: 100, colors: true }, hover: { backgroundColor: "hover", color: "text" } }}>
			<ui.icon icon="plus" style={{ width: 13, height: 13, color: "currentColor" }} />
		</ui.pressable>
	);
}

/** A project's right-click in the sidebar, as Flux's. */
function SidebarProjectMenu({ flux, project }: { flux: Flux; project: Project | undefined }) {
	if (!project) return null;
	// On its board, the board follows it: to a new key, or away as it goes.
	const route = parsePath(shownPath);
	const here = route.kind === "list" && route.project === project.key;
	return (
		<ui.menu context label={`${project.name} actions`}>
			{() => [
				<ui.item key="new" icon="plus" onClick={() => openCreate(flux, project.id)}>New issue</ui.item>,
				<ui.separator key="sep1" />,
				<ui.item key="edit" icon="pencil" onClick={() => openProjectSettings(project, here)}>Edit</ui.item>,
				<ui.item key="link" icon="external" onClick={() => { ui.copy(flux.projectUrl(project)); ui.toast(`Copied ${project.name}'s link.`); }}>Copy link</ui.item>,
				<ui.item key="dup" icon="copy" onClick={() => void duplicateProject(flux, project)}>Duplicate</ui.item>,
				<ui.separator key="sep2" />,
				<ui.item key="del" icon="trash" danger onClick={() => confirmDelete(flux, project, here ? () => openList("") : undefined)}>Delete</ui.item>,
			]}
		</ui.menu>
	);
}

/** The title bar while there's no board to show: Flux's mark and name, as the sidebar's row. */
function HeadTitle() {
	return (
		<ui.box style={{ ...bar, gap: 8, paddingLeft: EDGE, media: [{ minWidth: 768, style: { paddingLeft: 20 } }] }}>
			<FluxMark size={16} color="text" />
			<ui.text style={{ fontSize: 14, fontWeight: 600 }}>Flux</ui.text>
		</ui.box>
	);
}

/** The bar's end: New issue, its icon where there's no room for its name, never cut short. */
function BarEnd({ onCreate }: { onCreate: () => void }) {
	return <>{[
		<ui.box key="new" style={{ display: "none", flexShrink: 0, media: [{ minWidth: NEW_AT, style: { display: "flex" } }] }}>
			<ui.button kind="primary" size="sm" icon="plus" tooltip="New issue (C)" onClick={onCreate}>New issue</ui.button>
		</ui.box>,
		<ui.box key="new-narrow" style={{ flexShrink: 0, media: [{ minWidth: NEW_AT, style: { display: "none" } }] }}>
			{/* As Swarm's primary button, its + alone: the accent, its ink, a little of the text's over it under the pointer. */}
			<ui.pressable label="New issue" tooltip="New issue (C)" onClick={onCreate} style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: "control", backgroundColor: "accent", transition: { duration: 120, colors: true }, hover: { backgroundColor: "color-mix(in srgb, text 12%, accent)" } }}>
				<ui.icon icon="plus" style={{ width: 14, height: 14, color: "accentText" }} />
			</ui.pressable>
		</ui.box>,
	]}</>;
}


/** The filter opened full width on a narrow bar, as Flux's. */
let searching = false;

function Toolbar({ flux, project, scope, options }: { flux: Flux; project: Project | null; scope: Scope; options: DisplayOptions }) {
	const projects = flux.projects();
	const narrowSearch = searching || query !== "";
	const filter = (wide: boolean) => (
		<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 28, paddingLeft: 8, paddingRight: 4, borderRadius: "control", border: "1px solid border", backgroundColor: "field", ...(wide ? { flex: 1, minWidth: 0 } : { width: 208, flexShrink: 0 }), focus: { borderColor: "borderStrong" } }}>
			<ui.icon icon="search" style={{ width: 14, height: 14, color: "text2", flexShrink: 0 }} />
			<ui.field key={"flux-filter-" + (wide ? "n" : "w") + filterFocus} autoFocus={filterFocus > 0 || (wide && searching)} value={query} placeholder="Filter issues" onChange={(value) => { query = value; }} style={{ flex: 1, height: 26, padding: 0, fontSize: 14, backgroundColor: "transparent", boxShadow: "none" }} />
		</ui.box>
	);
	return (
		<ui.box style={bar} keys={BAR_KEYS} onKeyDown={(key) => onListKey(flux, key, shownFlat, shownGroups, options)}>
			{narrowSearch ? (
				<ui.box style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 6, alignItems: "center", paddingLeft: ghostChip.paddingLeft, media: [{ minWidth: WIDE, style: { display: "none" } }] }}>
					{filter(true)}
					<ui.pressable label="Cancel" onClick={() => { query = ""; searching = false; }} style={{ ...ghostChip }}>
						<ui.text style={{ fontSize: 14 }}>Cancel</ui.text>
					</ui.pressable>
				</ui.box>
			) : null}
			<ui.box style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 6, alignItems: "center", ...(narrowSearch ? { display: "none", media: [{ minWidth: WIDE, style: { display: "flex" } }] } : null) }}>
				{/* The one part that shrinks: its name cut short, once all else has given way. */}
				<ui.menu label={`Project: ${project ? project.name : "All projects"}`} style={{ ...ghostChip, minWidth: 0, maxWidth: 224, flexShrink: 1 }}>
					{project ? <ProjectMark project={project} size={16} /> : <FluxMark size={16} />}
					<ui.text style={{ fontSize: 14, minWidth: 0 }} maxLines={1}>{project ? project.name : "All projects"}</ui.text>
					<ui.icon icon="chevron-down" style={{ width: 12, height: 12, color: "text2", flexShrink: 0 }} />
					<ui.item icon="icon.svg" checked={!project} badge={String(flux.issues().filter((i) => !CLOSED_STATUSES.has(i.status)).length)} onClick={() => openList("")}>All projects</ui.item>
					{projects.map((item) => (
						<ui.item key={item.id} {...navMark(item)} checked={item.key === project?.key} badge={String(flux.issues().filter((i) => i.projectId === item.id && !CLOSED_STATUSES.has(i.status)).length)} onClick={() => openList(`p/${item.key}`)}>{item.name}</ui.item>
					))}
					{projectMenuItems(project)}
				</ui.menu>
				<ui.box style={{ display: "none", width: 1, height: 16, flexShrink: 0, marginLeft: 4, marginRight: 4, backgroundColor: "border", media: [{ minWidth: TABS_AT, style: { display: "flex" } }] }} />
				<ui.box label="Issues" style={{ display: "none", flexDirection: "row", flexShrink: 0, gap: 2, alignItems: "center", media: [{ minWidth: TABS_AT, style: { display: "flex" } }] }}>
					{SCOPES.map((item) => (
						<ui.pressable key={item} label={SCOPE_LABELS[item]} role="tab" checked={scope === item} onClick={() => storage.set("scope", item)} style={{ height: 28, flexShrink: 0, paddingLeft: 8, paddingRight: 8, justifyContent: "center", borderRadius: "control", color: scope === item ? "text" : "text2", backgroundColor: scope === item ? "press" : "transparent", transition: { duration: 100, colors: true }, hover: { backgroundColor: scope === item ? "press" : "hover", color: "text" } }}>
							<ui.text style={{ fontSize: 14, color: "currentColor" }} maxLines={1}>{SCOPE_LABELS[item]}</ui.text>
						</ui.pressable>
					))}
				</ui.box>
				{/* Narrow, the scopes are a menu. */}
				<ui.box style={{ flexShrink: 0, media: [{ minWidth: TABS_AT, style: { display: "none" } }] }}>
					<ui.menu label={`Issues: ${SCOPE_LABELS[scope]}`} style={ghostChip}>
						<ui.text style={{ fontSize: 14 }}>{SCOPE_LABELS[scope]}</ui.text>
						<ui.icon icon="chevron-down" style={{ width: 12, height: 12, color: "text2" }} />
						{SCOPES.map((item) => <ui.item key={"scope-" + item} checked={scope === item} onClick={() => storage.set("scope", item)}>{SCOPE_LABELS[item]}</ui.item>)}
					</ui.menu>
				</ui.box>
				<ui.box style={{ flex: 1, minWidth: 8 }} />
				<ui.box style={{ display: "none", flexShrink: 0, media: [{ minWidth: WIDE, style: { display: "flex" } }] }}>{filter(false)}</ui.box>
				<ui.pressable label="Filter issues" tooltip="Filter issues (/)" onClick={() => { searching = true; }} style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: "control", color: "text2", hover: { backgroundColor: "hover", color: "text" }, media: [{ minWidth: WIDE, style: { display: "none" } }] }}>
					<ui.icon icon="search" style={{ width: 14, height: 14, color: "currentColor" }} />
				</ui.pressable>
				<ui.pressable label="Display" role="button" tooltip="Display options (⇧V)" checked={displayOpen} onClick={() => { displayOpen = !displayOpen; }} style={{ position: "relative", width: 28, height: 28, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: "control", border: "1px solid border", color: "text2", backgroundColor: displayOpen ? "press" : "transparent", hover: { backgroundColor: "hover", color: "text" } }}>
					<ui.icon icon="sliders" style={{ width: 14, height: 14, color: "currentColor" }} />
					{customized(options) ? <ui.box style={{ position: "absolute", top: -2, right: -2, width: 6, height: 6, borderRadius: "full", backgroundColor: "accent" }} /> : null}
				</ui.pressable>
				<BarEnd onCreate={() => openCreate(flux, project?.id)} />
			</ui.box>
		</ui.box>
	);
}

// Where the bar has room for each of its parts in full, widest first, as
// it narrows: the filter field (else its icon, which opens it across the
// bar), New issue's name (else its +), the scopes as tabs (else a menu).
// Each is where the next would no longer fit beside a project name the
// picker's widest, so nothing's cut short or slides under another.
const WIDE = 860;
const NEW_AT = 680;
const TABS_AT = 615;

/** Whether the display differs from Flux's default, but for its layout: its button has a dot, and it can be reset. */
function customized(options: DisplayOptions): boolean {
	const d = DEFAULT_DISPLAY;
	return options.grouping !== d.grouping || options.ordering !== d.ordering || options.showClosed !== d.showClosed || options.showEmptyGroups !== d.showEmptyGroups || options.showSubIssues !== d.showSubIssues || options.properties.length !== d.properties.length || options.properties.some((p) => !d.properties.includes(p));
}

// EDGE is the page's edge, where Swarm's header puts its title: the bars'
// marks and words start on it, a ghost control's fill reaching out past
// it; boxes that show, as the board's columns, the list's groups and the
// filter, start and end on it.
const EDGE = 16;

/** The title bar's own shell, the board's and an issue's alike: its height, and its content's edges lined up with the page's. */
const bar = { flex: 1, minWidth: 0, height: "100%", flexDirection: "row", gap: 6, alignItems: "center", paddingLeft: EDGE - 8, paddingRight: EDGE - 4, media: [{ minWidth: 768, style: { paddingLeft: 20 - 8, paddingRight: 16 } }] } satisfies Style;

// A menu's trigger without chrome: the ghost's background on hover, and while its menu is open.
const ghostChip = { height: 28, flexShrink: 0, paddingLeft: 8, paddingRight: 8, gap: 6, flexDirection: "row", alignItems: "center", borderRadius: "control", backgroundColor: "transparent", hover: { backgroundColor: "hover" }, checked: { backgroundColor: "hover" } } as const;

function displayPanel(options: DisplayOptions, singleProject: boolean): Child {
	const set = (patch: Partial<DisplayOptions>) => setDisplay({ ...options, ...patch });
	const toggle = (property: Property) => {
		const has = options.properties.includes(property);
		const properties = has ? options.properties.filter((item) => item !== property) : PROPERTIES.filter((item) => item === property || options.properties.includes(item));
		// As in Flux, the last property stays on.
		if (properties.length > 0) set({ properties });
	};
	const close = () => { displayOpen = false; };
	const picked = (on: boolean): Style => ({ borderRadius: "control", border: on ? "1px solid color-mix(in srgb, text 15%, transparent)" : "1px solid border", backgroundColor: on ? "press" : "transparent", color: on ? "text" : "text2", transition: { duration: 100, colors: true }, hover: { backgroundColor: on ? "press" : "hover", color: "text" } });
	return [
		<ui.pressable key="display-shade" label="Close display options" onClick={close} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 20 }} />,
		<ui.box key="display-panel" label="Display options" style={{ position: "absolute", top: 44, right: 16, width: 288, zIndex: 21, padding: 8, borderRadius: "card", backgroundColor: "overlay", border: "1px solid border", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", animation: { name: "fadeIn", duration: 120 } }}>
			<ui.box style={{ flexDirection: "row", gap: 4, padding: 4 }}>
				{LAYOUTS.map((layout) => (
					<ui.pressable key={"layout-" + layout} label={layout === "board" ? "Board" : "List"} role="radio" checked={options.layout === layout} onClick={() => set({ layout, grouping: layout === "board" && options.grouping === "none" ? "status" : options.grouping })} style={{ ...picked(options.layout === layout), flex: 1, height: 32, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" }}>
						<ui.icon icon={layout === "board" ? "columns" : "rows"} style={{ width: 16, height: 16, color: "currentColor" }} />
						<ui.text style={{ fontSize: 14, fontWeight: 500, color: "currentColor" }}>{layout === "board" ? "Board" : "List"}</ui.text>
					</ui.pressable>
				))}
			</ui.box>
			<ui.box style={{ gap: 2, paddingLeft: 4, paddingRight: 4, paddingTop: 8 }}>
				<DisplayRow label="Grouping" value={GROUPING_LABELS[options.grouping]}>
					{GROUPINGS.filter((grouping) => (grouping !== "project" || !singleProject) && (grouping !== "none" || options.layout === "list")).map((grouping) => (
						<ui.item key={"group-" + grouping} checked={options.grouping === grouping} onClick={() => set({ grouping })}>{GROUPING_LABELS[grouping]}</ui.item>
					))}
				</DisplayRow>
				<DisplayRow label="Ordering" value={ORDERING_LABELS[options.ordering]}>
					{ORDERINGS.map((ordering) => <ui.item key={"order-" + ordering} checked={options.ordering === ordering} onClick={() => set({ ordering })}>{ORDERING_LABELS[ordering]}</ui.item>)}
				</DisplayRow>
			</ui.box>
			<ui.box style={{ gap: 6, paddingLeft: 4, paddingRight: 4, paddingTop: 12 }}>
				<ui.text style={{ fontSize: 12, fontWeight: 500, color: "text2" }}>Display properties</ui.text>
				<ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
					{PROPERTIES.map((property) => {
						const on = options.properties.includes(property);
						return (
							<ui.pressable key={"prop-" + property} label={PROPERTY_LABELS[property]} role="checkbox" checked={on} onClick={() => toggle(property)} style={{ ...picked(on), height: 22, paddingLeft: 6, paddingRight: 6, justifyContent: "center" }}>
								<ui.text style={{ fontSize: 12, fontWeight: 500, color: "currentColor" }}>{PROPERTY_LABELS[property]}</ui.text>
							</ui.pressable>
						);
					})}
				</ui.box>
			</ui.box>
			<ui.box style={{ paddingTop: 12 }}>
				<DisplaySwitch label="Show completed issues" on={options.showClosed} set={(on) => set({ showClosed: on })} />
				<DisplaySwitch label="Show empty groups" on={options.showEmptyGroups} set={(on) => set({ showEmptyGroups: on })} />
				<DisplaySwitch label="Show sub-issues" on={options.showSubIssues} set={(on) => set({ showSubIssues: on })} />
			</ui.box>
			{customized(options) ? (
				<ui.pressable label="Reset to default" onClick={() => setDisplay({ ...DEFAULT_DISPLAY, layout: options.layout })} style={{ marginTop: 4, height: 30, paddingLeft: 4, justifyContent: "center", borderRadius: "control", color: "text2", hover: { color: "text" } }}>
					<ui.text style={{ fontSize: 14, color: "currentColor" }}>Reset to default</ui.text>
				</ui.pressable>
			) : null}
		</ui.box>,
	];
}

function DisplaySwitch({ label, on, set }: { label: string; on: boolean; set: (on: boolean) => void }) {
	return (
		<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 12, height: 32, paddingLeft: 4, paddingRight: 4 }}>
			<ui.text style={{ fontSize: 14, color: "text2", flex: 1 }}>{label}</ui.text>
			<ui.toggle tooltip={label} checked={on} onChange={set} />
		</ui.box>
	);
}

function DisplayRow({ label, value, children }: { label: string; value: string; children?: Child }) {
	return (
		<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 12, height: 32 }}>
			<ui.text style={{ fontSize: 14, color: "text2", flex: 1 }}>{label}</ui.text>
			<ui.menu label={`${label}: ${value}`} style={{ ...ghostChip, height: 26, paddingLeft: 6, paddingRight: 6, gap: 4 }}>
				<ui.text style={{ fontSize: 14, fontWeight: 500 }}>{value}</ui.text>
				<ui.icon icon="chevron-down" style={{ width: 12, height: 12, color: "text2" }} />
				{children}
			</ui.menu>
		</ui.box>
	);
}

function Board({ flux, groups, options, showProject, scrollKey }: { flux: Flux; groups: IssueGroup[]; options: DisplayOptions; showProject: boolean; scrollKey: string }) {
	// As Flux's: ordered by hand, a gap opens where a card would land;
	// ordered otherwise, a column says how its cards are ordered, and a
	// card dropped there lands in its place in that order.
	const manual = options.ordering === "manual";
	const hint = (group: IssueGroup) => (manual ? undefined : `${group.title}\nBoard ordered by ${ORDERING_LABELS[options.ordering]}`);
	// Each project's and scope's board keeps where it was scrolled, its columns too, as bb's.
	return (
		<ui.box key={"board-" + scrollKey} style={{ animation: { name: "fadeIn" }, flex: 1, minHeight: 0, minWidth: 0, width: "100%", flexDirection: "row", gap: 20, overflowX: "auto", overflowY: "hidden", alignItems: "stretch", paddingLeft: EDGE, paddingRight: EDGE, paddingTop: 16, paddingBottom: 32, scrollSnapType: "x mandatory", media: [{ minWidth: 768, style: { paddingLeft: 20, paddingRight: 20, scrollSnapType: "none" } }] }}>
			{groups.map((group) => (
				<ui.box key={group.id} label={group.title} style={{ width: 346, flexShrink: 0, minHeight: 0, height: "100%", gap: 6, padding: 8, borderRadius: 14, backgroundColor: COLUMN_BG, boxShadow: "inset 0 0 0 1px transparent", transition: { duration: 200, colors: true }, dragOver: { boxShadow: "inset 0 0 0 1px color-mix(in srgb, text 10%, transparent)" } }} onDrop={(event) => dropOn(flux, group, event, options)} dropHint={hint(group)}>
					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, flexShrink: 0 }}>
						<GroupMark group={group} flux={flux} size={16} />
						<ui.text style={{ fontSize: 14, fontWeight: 500 }} maxLines={1}>{group.title}</ui.text>
						<ui.text style={{ fontSize: 14, color: "text2" }}>{String(group.issues.length)}</ui.text>
						<ui.box style={{ flex: 1 }} />
						<ui.iconButton icon="plus" label={`New issue in ${group.title}`} style={{ width: 28, height: 28, marginTop: -6, marginBottom: -6 }} onClick={() => openCreate(flux, undefined, group.key)} />
					</ui.box>
					{/* Its cards as they scroll into view: a column of hundreds built at once ran the plugin out of memory.
					    rowHeight is the least a card is, so each card is as tall as it is, 6 apart. */}
					<ui.list
						key={`cards-${scrollKey}-${group.id}`}
						count={group.issues.length}
						rowHeight={40}
						rowKey={(n) => group.issues[n]!.id}
						row={(n) => (
							<ui.box style={{ width: "100%", paddingBottom: n < group.issues.length - 1 ? 6 : 0 }}>
								<Card flux={flux} issue={group.issues[n]!} group={group} index={n} options={options} showProject={showProject} />
							</ui.box>
						)}
						style={{ flex: 1, minHeight: 0 }}
						placeholder={<ui.box style={{ width: "100%", paddingBottom: 6 }}><CardBones /></ui.box>}
						dropGap={manual}
						reveal={keyed && group.issues.some((issue) => issue.id === cursor) ? cursor : undefined}
						onDrop={manual ? (event) => dropAt(flux, group, group.issues, event, options) : undefined}
					/>
				</ui.box>
			))}
		</ui.box>
	);
}

/** A card, as bb's: on the card surface, a shade darker and its border firmer under the pointer. */
const CARD: Style = {
	flexDirection: "row",
	gap: 8,
	flexShrink: 0,
	paddingLeft: 12,
	paddingRight: 12,
	paddingTop: 10,
	paddingBottom: 10,
	borderRadius: 8,
	backgroundColor: "overlay",
	border: "1px solid border",
	boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
	transition: { duration: 100, colors: true },
	hover: { backgroundColor: "color-mix(in srgb, text 4%, overlay)", borderColor: "color-mix(in srgb, text 20%, overlay)" },
};
/** A selected card: the accent's border on a hint of ink. */
const CARD_ON: Style = { backgroundColor: "color-mix(in srgb, text 3%, overlay)", border: "1px solid accent", hover: { backgroundColor: "color-mix(in srgb, text 3%, overlay)", borderColor: "accent" } };

/** A column, as bb's raised surface: a few percent of ink over the page. */
const COLUMN_BG = "color-mix(in srgb, text 4%, bg)";

function Card({ flux, issue, group, index, options, showProject }: { flux: Flux; issue: Issue; group: IssueGroup; index: number; options: DisplayOptions; showProject: boolean }) {
	// The project's mark only where the board shows every project's, as bb's.
	const project = showProject ? flux.projects().find((item) => item.id === issue.projectId) : undefined;
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
			style={{ ...CARD, ...(on ? CARD_ON : null), ...(keyed && cursor === issue.id ? { border: "1px solid accent" } : null) }}
		>
			<IssueContextMenu flux={flux} issue={issue} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 0 }}>
				{shows(options, "id") || parent || project ? (
					<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 16 }}>
						{project ? <ProjectMark project={project} size={14} /> : null}
						<KeyLine issue={issue} parent={parent ?? undefined} showKey={shows(options, "id")} />
					</ui.box>
				) : null}
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: shows(options, "id") || parent || project ? 4 : 0 }}>
					{shows(options, "status") ? <Picker label={`Status: ${STATUS_LABELS[issue.status]}`} style={{ height: 20, width: 20, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 4, backgroundColor: "transparent" }}><StatusIcon status={issue.status} size={14} />{() => pickerItems(flux, issue, "status")}</Picker> : null}
					<ui.text style={{ fontSize: 14, lineHeight: "20px", fontWeight: 500, flex: 1, minWidth: 0, paddingTop: 1, color: CLOSED_STATUSES.has(issue.status) ? "text2" : "text" }} maxLines={2}>{issue.title}</ui.text>
				</ui.box>
				{fields ? (
					<ui.box style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
						{shows(options, "priority") ? <Picker label={`Priority: ${PRIORITY_LABELS[issue.priority]}`} style={{ ...field, width: 22, paddingLeft: 0, paddingRight: 0, backgroundColor: "transparent" }}><PriorityIcon priority={issue.priority} size={12} />{() => pickerItems(flux, issue, "priority")}</Picker> : null}
						{shows(options, "dueDate") && issue.dueDate ? <Picker label={`Due ${dueLabel(issue.dueDate)}`} style={{ ...field, backgroundColor: "transparent" }}>{dueContent(issue.dueDate)}{() => pickerItems(flux, issue, "due")}</Picker> : null}
						{issue.subIssueCount > 0 ? <SubIssueChip done={issue.subIssueDoneCount} total={issue.subIssueCount} /> : null}
						{shows(options, "labels") ? marks.map((item) => <Picker key={item.id} label={`Labels: ${item.name}`} style={{ ...field, justifyContent: "flex-start", maxWidth: 144, backgroundColor: "transparent" }}>{tagContent(item)}{() => pickerItems(flux, issue, "labels")}</Picker>) : null}
						{shows(options, "agents") && issue.threadIds.length > 0 ? <AgentChip issue={issue} /> : null}
					</ui.box>
				) : null}
				{shows(options, "created") ? <ui.text style={{ fontSize: 12, color: "text2", marginTop: 8 }} tooltip={new Date(issue.createdAt).toLocaleString()}>{createdOn(issue.createdAt)}</ui.text> : null}
			</ui.box>
			{/* Assignees at the top, Start agent at the foot, as Flux's. */}
			<ui.box style={{ flexShrink: 0, alignItems: "flex-end", justifyContent: "space-between", gap: 8, alignSelf: "stretch" }}>
				{shows(options, "assignee") ? <Picker label={assignees.length ? `Assignees: ${assignees.map((m) => m.name).join(", ")}` : "Assign"} style={{ minWidth: 24, height: 24, paddingLeft: 2, paddingRight: 2, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "transparent" }}>{assignees.length ? <AvatarStack members={assignees} size={20} ring="overlay" /> : <Unassigned size={20} />}{() => pickerItems(flux, issue, "assignees")}</Picker> : <ui.box />}
				{issue.threadIds.length === 0 && !CLOSED_STATUSES.has(issue.status) ? <StartAgentButton issue={issue} bordered /> : null}
			</ui.box>
		</ui.box>
	);
}

/** A property's menu items for one issue, as Flux's pickers in place: what it is checked, you first among the members, a new label from the palette. */
function pickerItems(flux: Flux, issue: Issue, kind: "status" | "priority" | "due" | "labels" | "assignees"): Child[] {
	const set = (patch: IssuePatch) => apply(flux, issue.id, patch);
	const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
	switch (kind) {
		case "status":
			return STATUSES.map((status) => <ui.item key={status} {...statusMark(status)} checked={issue.status === status} onClick={() => set({ status })}>{STATUS_LABELS[status]}</ui.item>);
		case "priority":
			return [...PRIORITIES.filter((p) => p === "none"), ...PRIORITIES.filter((p) => p !== "none")].map((priority) => <ui.item key={priority} {...priorityMark(priority)} checked={issue.priority === priority} onClick={() => set({ priority })}>{PRIORITY_LABELS[priority]}</ui.item>);
		case "due":
			return dueItems(issue.dueDate, (dueDate) => set({ dueDate }));
		case "labels":
			return [
				...flux.labels().map((label) => <ui.item key={label.id} {...labelMark(label.color)} checked={issue.labelIds.includes(label.id)} onClick={() => set({ labelIds: toggle(issue.labelIds, label.id) })}>{label.name}</ui.item>),
				flux.labels().length ? <ui.separator key="sep" /> : null,
				<ui.item key="new" icon="plus" onClick={() => openPalette("label", [issue.id], (id, patch) => apply(flux, id, patch))}>New label…</ui.item>,
			];
		case "assignees": {
			const me = flux.me?.id;
			return [...flux.memberList()].sort((a, b) => Number(b.id === me) - Number(a.id === me)).map((member) => <ui.item key={member.id} {...memberMark(member)} detail={"@" + member.username} checked={issue.assigneeIds.includes(member.id)} onClick={() => set({ assigneeIds: toggle(issue.assigneeIds, member.id) })}>{member.id === me ? `${member.name} (you)` : member.name}</ui.item>);
		}
	}
}

/** A chip that picks its property in place, as on Flux's cards: its items
 * a function, built as it opens, as every card on a board has its own. */
function Picker({ label, style, children }: { label: string; style: Style; children: MenuChild }) {
	return <ui.menu label={label} style={{ ...style, hover: { backgroundColor: "hover" }, checked: { backgroundColor: "hover" } }}>{children}</ui.menu>;
}

/** Flux's bordered field chip: priority, due date, sub-issues, labels, agents. */
const field = { flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", height: 22, paddingLeft: 6, paddingRight: 6, flexShrink: 0, borderRadius: 4, border: "1px solid border" } as const;

function KeyLine({ issue, parent, showKey }: { issue: Issue; parent?: Issue; showKey: boolean }) {
	if (!showKey && !parent) return null;
	return (
		<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", minWidth: 0 }}>
			{parent ? <ui.text style={{ fontSize: 12, color: "text2" }} maxLines={1}>{parent.key}</ui.text> : null}
			{parent && showKey ? <ui.icon icon="chevron-right" style={{ width: 12, height: 12, color: "text2" }} /> : null}
			{showKey ? <ui.text style={{ fontSize: 12, color: "text2", flexShrink: 0 }}>{issue.key}</ui.text> : null}
		</ui.box>
	);
}

/** Assignees, overlapping as Flux's, each ringed in the surface's color so the one under shows its edge. */
function AvatarStack({ members, size, ring = "bg" }: { members: Member[]; size: number; ring?: ColorValue }) {
	const overlap = Math.round(size * 0.3);
	return (
		<ui.box style={{ flexDirection: "row", flexShrink: 0, alignItems: "center" }}>
			{members.slice(0, 4).map((member, n) => (
				<ui.box key={member.id} style={{ marginLeft: n === 0 ? 0 : -overlap, borderRadius: "full", boxShadow: n === 0 ? "none" : `0 0 0 1.5px ${ring}`, flexShrink: 0 }}>
					<Avatar member={member} size={size} />
				</ui.box>
			))}
		</ui.box>
	);
}

/** When it's due: overdue in red, today and soon in amber, later muted. */
function dueTone(date: string): ColorValue {
	const delta = dayDelta(date);
	if (delta < 0) return "red";
	return delta <= 3 ? "amber" : "text2";
}

function dueContent(date: string): Child[] {
	const tone = dueTone(date);
	return [
		<ui.icon key="icon" icon="calendar" style={{ width: 12, height: 12, color: tone }} />,
		<ui.text key="text" style={{ fontSize: 12, fontWeight: 500, color: tone }}>{dueLabel(date)}</ui.text>,
	];
}

function DueChip({ date }: { date: string }) {
	return <ui.box label={`Due ${dueLabel(date)}`} style={field}>{dueContent(date)}</ui.box>;
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

type ListItem = { group: IssueGroup } | { group: IssueGroup; issue: Issue; index: number } | { group: IssueGroup; empty: true };

function IssueList({ flux, groups, options, showProject, scrollKey }: { flux: Flux; groups: IssueGroup[]; options: DisplayOptions; showProject: boolean; scrollKey: string }) {
	// One list of each group's heading and issues, built as they scroll
	// into view: hundreds built at once ran the plugin out of memory.
	// Without grouping, no heading, as Flux's.
	const headed = effectiveGrouping(options, !showProject) !== "none";
	const rows: ListItem[] = [];
	const headers: number[] = [];
	const folded = new Set(storage.get<string[]>("folded") ?? []);
	for (const group of groups) {
		if (headed) {
			headers.push(rows.length);
			rows.push({ group });
		}
		// A group folded shows its heading alone; an empty one keeps a row's room, as Flux's.
		if (headed && folded.has(group.id)) continue;
		if (group.issues.length === 0) rows.push({ group, empty: true });
		group.issues.forEach((issue, index) => rows.push({ group, issue, index }));
	}
	// The ID column as wide as the longest key, so titles line up.
	const keyWidth = 8 * Math.max(5, ...groups.flatMap((group) => group.issues.map((issue) => issue.key.length))) + 4;
	return (
		<ui.list
			key={"issue-list-" + scrollKey}
			count={rows.length}
			rowHeight={40}
			headers={headers}
			rowKey={(n) => { const row = rows[n]!; return "issue" in row ? row.issue.id : ("empty" in row ? "empty-" : "group-") + row.group.id; }}
			row={(n) => {
				const row = rows[n]!;
				if ("issue" in row) return <ListRow flux={flux} issue={row.issue} group={row.group} index={row.index} options={options} showProject={showProject} keyWidth={keyWidth} />;
				if ("empty" in row) return <ui.box style={{ width: "100%", height: 32 }} onDrop={(event) => dropOn(flux, row.group, event, options)} />;
				return <ListHeading flux={flux} group={row.group} options={options} first={n === 0} />;
			}}
			style={{ animation: { name: "fadeIn" }, flex: 1, minHeight: 0, paddingLeft: EDGE - 4, paddingRight: EDGE - 4, paddingTop: 12, paddingBottom: 32 }}
			placeholder={<RowBones />}
			// Ordered by hand, a gap opens where a row would land, in any group.
			dropGap={options.ordering === "manual"}
			reveal={keyed ? cursor : undefined}
			onDrop={options.ordering === "manual" ? (event) => listDrop(flux, rows, event, options) : undefined}
		/>
	);
}

/** A drop at the list's gap: the group and the neighbours of the rows around it. */
function listDrop(flux: Flux, rows: ListItem[], event: { data: unknown; index?: number }, options: DisplayOptions) {
	const id = dragged(event);
	const others = rows.filter((row) => !("issue" in row) || row.issue.id !== id);
	const at = Math.min(Math.max(event.index ?? others.length, 0), others.length);
	const before = others[at - 1];
	const after = others[at];
	const group = after && "issue" in after ? after.group : (before?.group ?? after?.group);
	if (!group) return;
	const inGroup = group.issues.filter((issue) => issue.id !== id);
	const next = after && "issue" in after && after.group === group ? inGroup.findIndex((issue) => issue.id === after.issue.id) : -1;
	dropAt(flux, group, group.issues, { data: event.data, index: next >= 0 ? next : inGroup.length }, options);
}

function foldedGroup(group: IssueGroup): boolean {
	return (storage.get<string[]>("folded") ?? []).includes(group.id);
}

/** Folds a list's group, or unfolds it; remembered, as Flux's. */
function foldGroup(group: IssueGroup) {
	const folded = new Set(storage.get<string[]>("folded") ?? []);
	if (folded.has(group.id)) folded.delete(group.id);
	else folded.add(group.id);
	storage.set("folded", [...folded]);
}

/** A group's heading, as Flux's: on the page's color, so the rows scroll under it while it stays at the top. */
function ListHeading({ flux, group, options, first }: { flux: Flux; group: IssueGroup; options: DisplayOptions; first: boolean }) {
	const open = !foldedGroup(group);
	return (
		<ui.box label={group.title} onDrop={options.ordering === "manual" ? undefined : (event) => dropOn(flux, group, event, options)} style={{ width: "100%", paddingTop: first ? 0 : 12, paddingBottom: 4, backgroundColor: "bg" }}>
			<ui.box style={{ flexDirection: "row", alignItems: "center", height: 32, paddingRight: 4, borderRadius: 6, backgroundColor: HEADING_BG }}>
				<ui.pressable label={`${open ? "Fold" : "Unfold"} ${group.title}`} role="button" checked={open} onClick={() => foldGroup(group)} style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 8, alignItems: "center", height: 32, paddingLeft: 8, paddingRight: 8, borderRadius: 6, hover: { backgroundColor: "hover" } }}>
					<ui.icon icon="chevron-right" style={{ width: 12, height: 12, color: "text2", transform: open ? "rotate(90deg)" : "none", transition: { duration: 150 } }} />
					<GroupMark group={group} flux={flux} />
					<ui.text style={{ fontSize: 14, fontWeight: 500, minWidth: 0 }} maxLines={1}>{group.title}</ui.text>
					<ui.text style={{ fontSize: 14, color: "text2", flexShrink: 0 }}>{String(group.issues.length)}</ui.text>
				</ui.pressable>
				<ui.iconButton icon="plus" label={`New issue in ${group.title}`} style={{ width: 24, height: 24 }} onClick={() => openCreate(flux, undefined, group.key)} />
			</ui.box>
		</ui.box>
	);
}

/** A list heading's tint: a little ink over the page, opaque, so what scrolls under it stays under. */
const HEADING_BG = "color-mix(in srgb, text 5%, bg)";

/** Columns a list shows from these surface widths on, as Flux's container queries: the narrow list drops them from the right. */
const SM = 544;
const MD = 704;
const from = (min: number): Style => ({ display: "none", media: [{ minWidth: min, style: { display: "flex" } }] });

function ListRow({ flux, issue, group, index, options, showProject, keyWidth }: { flux: Flux; issue: Issue; group: IssueGroup; index: number; options: DisplayOptions; showProject: boolean; keyWidth: number }) {
	const project = flux.projects().find((item) => item.id === issue.projectId);
	const parent = issue.parentId ? flux.issue(issue.parentId) : undefined;
	const assignees = flux.memberList().filter((member) => issue.assigneeIds.includes(member.id));
	const marks = flux.labels().filter((item) => issue.labelIds.includes(item.id));
	const on = selected.has(issue.id);
	const closed = CLOSED_STATUSES.has(issue.status);
	const cell = { width: 24, height: 24, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 6, backgroundColor: "transparent" } as const;
	return (
		<ui.box key={issue.id} label={issue.title} drag={{ id: issue.id, index }} onClick={(event) => clickIssue(issue, event)} onDrop={options.ordering === "manual" ? undefined : (event) => dropOn(flux, group, event, options)} style={{ width: "100%", flexDirection: "row", gap: 8, alignItems: "center", height: 40, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: on ? "selected" : keyed && cursor === issue.id ? "hover" : "transparent", boxShadow: keyed && cursor === issue.id ? "inset 0 0 0 1px color-mix(in srgb, accent 60%, transparent)" : "none", transition: { duration: 100, colors: true }, hover: { backgroundColor: on ? "selected" : "hover" } }}>
			<IssueContextMenu flux={flux} issue={issue} />
			{/* Flux's checkbox gutter: shown on the row's hover, or always while choosing. */}
			<ui.box label={`Select ${issue.key}`} onClick={(event) => (event?.shift ? clickIssue(issue, event) : toggleSelected(issue.id, !on))} style={{ width: 16, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 4, border: on ? "1px solid accent" : "1px solid color-mix(in srgb, text 30%, transparent)", backgroundColor: on ? "accent" : "color-mix(in srgb, bg 80%, transparent)", opacity: on || selected.size > 0 || (keyed && cursor === issue.id) ? 1 : 0, transition: { duration: 100 }, groupHover: { opacity: 1 } }}>
				{on ? <ui.icon icon="check" style={{ width: 10, height: 10, color: "white" }} /> : null}
			</ui.box>
			{shows(options, "priority") ? <Picker label={`Priority: ${PRIORITY_LABELS[issue.priority]}`} style={cell}><PriorityIcon priority={issue.priority} size={14} />{() => pickerItems(flux, issue, "priority")}</Picker> : null}
			{shows(options, "id") ? <ui.text style={{ fontSize: 12, color: "text2", width: keyWidth, flexShrink: 0 }} maxLines={1}>{issue.key}</ui.text> : null}
			{shows(options, "status") ? <Picker label={`Status: ${STATUS_LABELS[issue.status]}`} style={cell}><StatusIcon status={issue.status} size={14} />{() => pickerItems(flux, issue, "status")}</Picker> : null}
			<ui.box style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 6, alignItems: "center" }}>
				{showProject ? <ui.box style={from(SM)}><ProjectMark project={project} size={14} /></ui.box> : null}
				{parent ? (
					<ui.box style={{ ...from(SM), flexDirection: "row", gap: 4, alignItems: "center", flexShrink: 0 }}>
						<ui.text style={{ fontSize: 12, color: "text2" }}>{parent.key}</ui.text>
						<ui.icon icon="chevron-right" style={{ width: 12, height: 12, color: "text2" }} />
					</ui.box>
				) : null}
				<ui.text style={{ fontSize: 14, fontWeight: 500, minWidth: 0, flexShrink: 1, color: closed ? "text2" : "text" }} maxLines={1}>{issue.title}</ui.text>
				{issue.subIssueCount > 0 ? <SubIssueChip done={issue.subIssueDoneCount} total={issue.subIssueCount} /> : null}
			</ui.box>
			{shows(options, "agents") ? (
				<ui.box style={{ ...from(SM), width: 24, justifyContent: "center", flexShrink: 0 }}>
					{issue.threadIds.length > 0 ? <AgentChip issue={issue} /> : closed ? null : <StartAgentButton issue={issue} />}
				</ui.box>
			) : null}
			{shows(options, "dueDate") && issue.dueDate ? <ui.box style={{ ...from(MD), flexShrink: 0 }}><Picker label={`Due ${dueLabel(issue.dueDate)}`} style={{ ...field, backgroundColor: "transparent" }}>{dueContent(issue.dueDate)}{() => pickerItems(flux, issue, "due")}</Picker></ui.box> : null}
			{shows(options, "labels") ? (
				<ui.box style={{ ...from(SM), width: 144, flexShrink: 0, flexDirection: "row", gap: 4, justifyContent: "flex-end", overflow: "hidden" }}>
					{marks.map((item) => <Picker key={item.id} label={`Labels: ${item.name}`} style={{ ...field, justifyContent: "flex-start", maxWidth: 144, backgroundColor: "transparent" }}>{tagContent(item)}{() => pickerItems(flux, issue, "labels")}</Picker>)}
				</ui.box>
			) : null}
			{shows(options, "assignee") ? <Picker label={assignees.length ? `Assignees: ${assignees.map((m) => m.name).join(", ")}` : "Assign"} style={{ minWidth: 24, height: 24, paddingLeft: 2, paddingRight: 2, alignItems: "center", justifyContent: "flex-start", flexShrink: 0, borderRadius: 6, backgroundColor: "transparent" }}>{assignees.length ? <AvatarStack members={assignees} size={20} /> : <Unassigned size={20} />}{() => pickerItems(flux, issue, "assignees")}</Picker> : null}
			{shows(options, "created") ? <ui.text style={{ ...from(MD), fontSize: 12, color: "text2", width: 48, textAlign: "right", flexShrink: 0 }} tooltip={`Created ${new Date(issue.createdAt).toLocaleString()}`}>{monthDay(issue.createdAt)}</ui.text> : null}
			{shows(options, "updated") ? <ui.text style={{ ...from(SM), fontSize: 12, color: "text2", width: 40, textAlign: "right", flexShrink: 0 }} tooltip={`Updated ${new Date(issue.updatedAt).toLocaleString()}`}>{ago(issue.updatedAt)}</ui.text> : null}
		</ui.box>
	);
}

/** Start agent, on a row's or card's hover, as Flux's. */
function StartAgentButton({ issue, bordered = false }: { issue: Issue; bordered?: boolean }) {
	return (
		<ui.pressable label={`Start an agent on ${issue.key}`} tooltip="Start an agent on this issue" onClick={() => startAgent(issue.id)} style={{ width: bordered ? 22 : 24, height: bordered ? 22 : 24, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: bordered ? 4 : 6, border: bordered ? "1px solid border" : "none", color: "text2", opacity: 0, transition: { duration: 100 }, groupHover: { opacity: 1 }, focus: { opacity: 1 }, hover: { backgroundColor: "press", color: "text" } }}>
			<ui.icon icon="bot" style={{ width: 14, height: 14, color: "currentColor" }} />
		</ui.pressable>
	);
}

function GroupMark({ group, flux, size = 14 }: { group: IssueGroup; flux: Flux; size?: number }) {
	if (group.key.kind === "status") return <StatusIcon status={group.key.status} size={size} />;
	if (group.key.kind === "priority") return <PriorityIcon priority={group.key.priority} size={size} />;
	const key = group.key;
	if (key.kind === "project") return <ProjectMark project={flux.projects().find((item) => item.id === key.projectId)} size={size} />;
	if (key.kind === "assignee" && key.memberId) return <Avatar member={flux.memberList().find((item) => item.id === key.memberId)} size={16} />;
	return <ui.box style={{ width: 8, height: 8, borderRadius: "full", backgroundColor: "text3" }} />;
}

function tagContent(label: Label): Child[] {
	return [
		<ui.box key="dot" style={{ width: 8, height: 8, borderRadius: "full", backgroundColor: colorOf[label.color] ?? "text3", flexShrink: 0 }} />,
		<ui.text key="name" style={{ fontSize: 12, fontWeight: 500 }} maxLines={1}>{label.name}</ui.text>,
	];
}

function Tag({ label }: { label: Label }) {
	return <ui.box style={{ ...field, justifyContent: "flex-start", maxWidth: 144 }}>{tagContent(label)}</ui.box>;
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

/**
 * A drop at a gap: event.index is how many of issues, but the one
 * dragged, are above it. The issue takes the group's value, and a
 * position between its new neighbours.
 */
function dropAt(flux: Flux, group: IssueGroup, issues: Issue[], event: { data: unknown; index?: number }, options: DisplayOptions) {
	const id = dragged(event);
	const issue = id ? flux.issue(id) : null;
	if (!issue) return;
	const others = issues.filter((item) => item.id !== id);
	const at = Math.min(Math.max(event.index ?? others.length, 0), others.length);
	const before = others[at - 1];
	const after = others[at];
	const from = groupOf(issue, effectiveGrouping(options, false));
	const patch = patchForMove(issue, from, group.key) ?? {};
	const was = issues.findIndex((item) => item.id === id);
	if (Object.keys(patch).length === 0 && was >= 0 && was === at) return;
	void apply(flux, id, { ...patch, position: positionBetween(before, after) });
}

/** Flux's question before deleting: one issue, or N; then done. */
function askDelete(flux: Flux, ids: string[], done: () => unknown) {
	const one = ids.length === 1;
	confirm(one ? "Delete this issue?" : `Delete ${ids.length} issues?`, "This cannot be undone.", "Delete", async () => {
		done();
		const failed = (await Promise.allSettled(ids.map((id) => flux.deleteIssue(id)))).filter((r) => r.status === "rejected");
		if (failed.length) ui.toast(one ? "Couldn't delete the issue." : `Couldn't delete ${failed.length} of the issues.`);
	});
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

/** Changes an issue; one Flux didn't take says so, as Flux's "Couldn't update KEY". */
function apply(flux: Flux, id: string, patch: IssuePatch) {
	lastPatch = patch;
	void flux.updateIssue(id, patch).catch((error: unknown) => failed(`Couldn't update ${flux.issue(id)?.key ?? "the issue"}`, error));
}

function failed(what: string, error: unknown) {
	const why = error instanceof Error ? error.message : String(error);
	ui.toast(why ? `${what}: ${why}` : `${what}.`);
}

/** Copies an issue, then whatever comes next with the copy. */
function duplicate(flux: Flux, id: string, then?: (copy: Issue) => unknown) {
	void flux.duplicateIssue(id).then((copy) => then?.(copy), (error: unknown) => failed(`Couldn't duplicate ${flux.issue(id)?.key ?? "the issue"}`, error));
}

function toggleSelected(id: string, on: boolean) {
	const next = new Set(selected);
	if (on) next.add(id);
	else next.delete(id);
	selected = next;
	cursor = id;
	anchor = id;
}

function openCard(issue: Issue) {
	cursor = issue.id;
	openIssue(issue.key);
}

/** The issues in view, in their order, as the board or list last showed them: a Shift-click's range. */
let shownFlat: Issue[] = [];
/** Their groups, as last shown: the title bar's keys move through them as the page's do. */
let shownGroups: IssueGroup[] = [];

function clickIssue(issue: Issue, event?: { mod?: boolean; shift?: boolean }) {
	keyed = false;
	if (event?.shift && anchor) {
		selectRange(shownFlat, anchor, issue.id);
		return;
	}
	if (event?.mod || event?.shift || selected.size > 0) {
		toggleSelected(issue.id, !selected.has(issue.id));
		return;
	}
	openCard(issue);
}

function SelectionBar({ flux }: { flux: Flux }) {
	const issues = flux.issues().filter((issue) => selected.has(issue.id));
	const ids = issues.map((issue) => issue.id);
	const clear = () => { selected = new Set(); };
	// As Flux's: a pill over the board while issues are selected, rising in
	// and sinking out, its width following what it says; Move to… is the
	// palette of statuses, Actions every bulk action, and a way out.
	return (
		<ui.box key="selection-bar" style={{ position: "absolute", bottom: 16, left: 16, right: 16, alignItems: "center", zIndex: 10, transition: { duration: 220, enter: { y: 8, opacity: 0 }, exit: { y: 8, opacity: 0 } } }}>
			<ui.box label="Selected issues" style={{ flexDirection: "row", gap: 2, alignItems: "center", height: 40, paddingLeft: 12, paddingRight: 4, borderRadius: "full", backgroundColor: "raised", border: "1px solid border", boxShadow: "0 8px 24px rgba(0,0,0,0.14)", transition: { duration: 220, size: true } }}>
				<ui.text style={{ fontSize: 13, color: "text2", paddingRight: 8, fontVariantNumeric: "tabular-nums" }}>{`${issues.length} selected`}</ui.text>
				<ui.pressable label="Move to…" tooltip="Change status (S)" onClick={() => openPalette("status", ids, (id, patch) => apply(flux, id, patch))} style={{ ...ghostChip, height: 32, paddingLeft: 10, paddingRight: 10, borderRadius: "full", hover: { backgroundColor: RAISED_HOVER }, checked: { backgroundColor: RAISED_HOVER } }}>
					<ui.text style={{ fontSize: 13, fontWeight: 500 }}>Move to…</ui.text>
				</ui.pressable>
				<ui.menu label="Actions" style={{ ...ghostChip, height: 32, paddingLeft: 10, paddingRight: 10, borderRadius: "full", hover: { backgroundColor: RAISED_HOVER }, checked: { backgroundColor: RAISED_HOVER } }}>
					<ui.icon icon="command" style={{ width: 13, height: 13, color: "text2" }} />
					<ui.text style={{ fontSize: 13, fontWeight: 500 }}>Actions</ui.text>
					{() => [
						propertyMenus(flux, issues, false),
						<ui.separator key="sep1" />,
						<ui.item key="me" icon="user" onClick={() => assignToMe(flux, issues)}>Assign to me</ui.item>,
						<ui.item key="dup" icon="copy" onClick={() => { for (const issue of issues) duplicate(flux, issue.id); }}>Duplicate</ui.item>,
						<ui.item key="link" icon="external" onClick={() => ui.copy(issues.map((issue) => flux.issueUrl(issue)).join("\n"))}>Copy link</ui.item>,
						<ui.item key="id" icon="copy" onClick={() => ui.copy(issues.map((issue) => issue.key).join("\n"))}>Copy ID</ui.item>,
						<ui.separator key="sep2" />,
						<ui.item key="del" icon="trash" danger onClick={() => askDelete(flux, ids, clear)}>Delete</ui.item>,
					]}
				</ui.menu>
				<ui.iconButton icon="x" label="Clear selection" tooltip="Clear selection (Esc)" onClick={clear} style={{ width: 28, height: 28, borderRadius: "full", hover: { backgroundColor: RAISED_HOVER } }} />
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
	const projects = flux.projects();
	return [
		<ui.menu key="status" label="Status" icon="check-circle" shortcut={shortcuts ? "S" : undefined}>
			{() => STATUSES.map((status) => <ui.item key={status} {...statusMark(status)} checked={all((issue) => issue.status === status)} onClick={() => each(() => ({ status }))}>{STATUS_LABELS[status]}</ui.item>)}
		</ui.menu>,
		<ui.menu key="priority" label="Priority" icon="rows" shortcut={shortcuts ? "P" : undefined}>
			{() => PRIORITIES.map((priority, index) => <ui.item key={priority} {...priorityMark(priority)} shortcut={shortcuts ? `Shift+${(index + 1) % 5}` : undefined} checked={all((issue) => issue.priority === priority)} onClick={() => each(() => ({ priority }))}>{PRIORITY_LABELS[priority]}</ui.item>)}
		</ui.menu>,
		<ui.menu key="assignee" label="Assignee" icon="user" shortcut={shortcuts ? "A" : undefined}>
			{() => flux.memberList().map((member) => {
				const on = all((issue) => issue.assigneeIds.includes(member.id));
				return <ui.item key={member.id} {...memberMark(member)} checked={on} onClick={() => each((issue) => ({ assigneeIds: toggled(issue.assigneeIds, member.id, on) }))}>{member.name}</ui.item>;
			})}
		</ui.menu>,
		<ui.menu key="due" label="Due date" icon="calendar" shortcut={shortcuts ? "Shift+D" : undefined}>
			{() => dueItems(issues.find((issue) => issue.dueDate)?.dueDate ?? null, (dueDate) => each(() => ({ dueDate })))}
		</ui.menu>,
		<ui.menu key="labels" label="Labels" icon="tag" shortcut={shortcuts ? "L" : undefined}>
			{() => flux.labels().length === 0 ? <ui.item disabled>No labels</ui.item> : flux.labels().map((label) => {
				const on = all((issue) => issue.labelIds.includes(label.id));
				return <ui.item key={label.id} {...labelMark(label.color)} checked={on} onClick={() => each((issue) => ({ labelIds: toggled(issue.labelIds, label.id, on) }))}>{label.name}</ui.item>;
			})}
		</ui.menu>,
		projects.length >= 2 ? (
			<ui.menu key="project" label="Move to project" icon="folder" shortcut={shortcuts ? "Shift+P" : undefined}>
				{() => projects.map((project) => <ui.item key={project.id} {...navMark(project)} checked={all((issue) => issue.projectId === project.id)} onClick={() => each(() => ({ projectId: project.id }))}>{project.name}</ui.item>)}
			</ui.menu>
		) : null,
	];
}

function IssueContextMenu({ flux, issue }: { flux: Flux; issue: Issue }) {
	const me = flux.me?.id;
	const url = flux.issueUrl(issue);
	return (
		<ui.menu context label={`${issue.key} actions`}>
			{() => [
			<ui.item key="open" shortcut="Enter" onClick={() => openCard(issue)}>Open</ui.item>,
			<ui.item key="flux" icon="external" href={url} disabled={!url}>Open in Flux</ui.item>,
			<ui.item key="agent" icon="bot" onClick={() => startAgent(issue.id)}>Start agent</ui.item>,
			<ui.separator key="sep0" />,
			<ui.menu key="copy" label="Copy" icon="copy">
				<ui.item onClick={() => ui.copy(issue.key)}>Copy ID</ui.item>
				<ui.item shortcut="Mod+Shift+," disabled={!url} onClick={() => ui.copy(url)}>Copy link</ui.item>
				<ui.item disabled={!issue.title.trim()} onClick={() => ui.copy(issue.title)}>Copy title</ui.item>
			</ui.menu>,
			<ui.separator key="sep1" />,
			propertyMenus(flux, [issue], true),
			<ui.separator key="sep2" />,
			<ui.item key="me" icon="user" shortcut="I" disabled={!me || issue.assigneeIds.includes(me)} onClick={() => assignToMe(flux, [issue])}>Assign to me</ui.item>,
			<ui.item key="duplicate" icon="copy" shortcut="D" onClick={() => duplicate(flux, issue.id)}>Duplicate</ui.item>,
			<ui.item key="sub" icon="plus" shortcut="Mod+Shift+O" onClick={() => openCreate(flux, issue.projectId, undefined, issue.id)}>Add sub-issue</ui.item>,
			<ui.item key="parent" icon="branch" shortcut="Mod+Shift+P" onClick={() => openPalette("parent", [issue.id], (id, patch) => apply(flux, id, patch))}>Set parent</ui.item>,
			issue.parentId ? <ui.item key="unparent" onClick={() => apply(flux, issue.id, { parentId: null })}>Remove parent</ui.item> : null,
			<ui.separator key="sep3" />,
			<ui.item key="delete" icon="trash" danger shortcut="Mod+Backspace" onClick={() => askDelete(flux, [issue.id], () => selected.delete(issue.id))}>Delete</ui.item>,
			]}
		</ui.menu>
	);
}

const menuRow = { padding: 6, borderRadius: "control", hover: { backgroundColor: "hover" } } as const;

const ISSUE_KEYS = [
	"e", "E", "s", "S", "p", "P", "a", "A", "l", "L", "i", "I", "d", "D", ".",
	"Shift+d", "Shift+D", "Shift+p", "Shift+P", "Shift+0", "Shift+1", "Shift+2", "Shift+3", "Shift+4",
	"Mod+Backspace", "Mod+Shift+,", "Mod+Shift+o", "Mod+Shift+O", "Mod+Shift+p", "Mod+Shift+P",
];

/** Flux's keys on an issue's page (bb's issue-page-hotkeys.ts), as the menus show them. */
function onIssueKey(flux: Flux, issue: Issue, key: { key: string; shift: boolean; mod: boolean }) {
	const k = key.key.toLowerCase();
	const pick = (kind: PaletteKind) => openPalette(kind, [issue.id], (id, patch) => apply(flux, id, patch));
	if (key.mod && key.shift && k === "p") pick("parent");
	else if (key.mod && key.shift && k === "o") composeSub(flux, issue);
	else if (key.mod && key.shift && key.key === ",") {
		ui.copy(flux.issueUrl(issue));
		ui.toast(`Copied ${issue.key}'s link.`);
	} else if (key.mod && key.key === "Backspace") askDelete(flux, [issue.id], () => openList(""));
	else if (key.mod) return;
	else if (k === "e" && editingTitle !== issue.id) editingTitle = issue.id;
	else if (k === "s") pick("status");
	else if (k === "p" && key.shift) pick("project");
	else if (k === "p") pick("priority");
	else if (k === "a") pick("assignee");
	else if (k === "l") pick("label");
	else if (k === "d" && key.shift) pick("due");
	else if (k === "d") duplicate(flux, issue.id, (copy) => openIssue(copy.key));
	else if (k === "i") {
		const me = flux.me?.id;
		if (me) apply(flux, issue.id, { assigneeIds: issue.assigneeIds.includes(me) ? issue.assigneeIds.filter((id) => id !== me) : [...issue.assigneeIds, me] });
	} else if (key.key === "." && lastPatch) apply(flux, issue.id, lastPatch);
	else if (key.shift && key.key >= "0" && key.key <= "4") {
		const priority = ({ "1": "urgent", "2": "high", "3": "medium", "4": "low", "0": "none" } as Record<string, Priority>)[key.key];
		if (priority) apply(flux, issue.id, { priority });
	}
}

/** What the keys act on: the selection, else the issue the cursor is on. */
function targets(flux: Flux, current: Issue | undefined): Issue[] {
	if (selected.size) return [...selected].map((id) => flux.issue(id)).filter((issue): issue is Issue => !!issue);
	return current ? [current] : [];
}

/** Flux's keys for the issues in view (bb's issue-hotkeys.ts). */
function onListKey(flux: Flux, key: { key: string; shift: boolean; mod: boolean }, flat: Issue[], groups: IssueGroup[], options: DisplayOptions) {
	const index = Math.max(0, flat.findIndex((issue) => issue.id === cursor));
	const current = flat.find((issue) => issue.id === cursor);
	const on = targets(flux, current);
	const ids = on.map((issue) => issue.id);
	const change = (patch: (issue: Issue) => IssuePatch) => { for (const issue of on) apply(flux, issue.id, patch(issue)); };
	const pick = (kind: PaletteKind) => openPalette(kind, ids, (id, patch) => apply(flux, id, patch));
	// Escape clears a selection first, as Flux's.
	if (key.key === "Escape" && selected.size > 0) {
		selected = new Set();
		return;
	}
	const move = (next: number) => {
		const issue = flat[Math.max(0, Math.min(flat.length - 1, next))];
		if (!issue) return;
		cursor = issue.id;
		keyed = true;
		if (key.shift) toggleSelected(issue.id, true);
	};
	const k = key.key.toLowerCase();
	if (k === "j" || key.key === "ArrowDown") move(current ? index + 1 : 0);
	else if (k === "k" || key.key === "ArrowUp") move(current ? index - 1 : 0);
	else if (key.key === "ArrowRight" || key.key === "ArrowLeft") {
		const at = groups.findIndex((group) => group.issues.some((issue) => issue.id === cursor));
		const next = groups[at + (key.key === "ArrowRight" ? 1 : -1)];
		if (next?.issues[0]) {
			cursor = next.issues[0].id;
			keyed = true;
		}
	} else if (key.key === "Enter" && current) openIssue(current.key);
	else if (key.mod && k === "a") selected = new Set(flat.map((issue) => issue.id));
	else if (key.mod && key.key === "Backspace") {
		if (ids.length) askDelete(flux, ids, () => { selected = new Set(); });
	} else if (key.mod && k === "b") setDisplay({ ...options, layout: options.layout === "board" ? "list" : "board" });
	else if (key.mod) return;
	else if (k === "c" && !key.shift) openCreate(flux);
	else if (key.key === "/") { filterFocus++; searching = true; }
	else if (k === "s" && !key.shift) pick("status");
	else if (k === "p" && !key.shift) pick("priority");
	else if (k === "p" && key.shift) pick("project");
	else if (k === "a") pick("assignee");
	else if (k === "l") pick("label");
	else if (k === "d" && key.shift) pick("due");
	else if (k === "v" && key.shift) setDisplay({ ...options, layout: options.layout === "board" ? "list" : "board" });
	else if (k === "i") {
		const me = flux.me?.id;
		if (me) change((issue) => ({ assigneeIds: issue.assigneeIds.includes(me) ? issue.assigneeIds.filter((id) => id !== me) : [...issue.assigneeIds, me] }));
	} else if (k === "d") for (const id of ids) duplicate(flux, id);
	else if (k === "x" && current) {
		if (key.shift && anchor) selectRange(flat, anchor, current.id);
		else toggleSelected(current.id, !selected.has(current.id));
	} else if (key.key === "." && lastPatch) {
		const patch = lastPatch;
		change(() => patch);
	} else if (key.shift && key.key >= "0" && key.key <= "4") {
		const priority = ({ "1": "urgent", "2": "high", "3": "medium", "4": "low", "0": "none" } as Record<string, Priority>)[key.key];
		if (priority) change(() => ({ priority }));
	} else if (key.key === "Escape") {
		displayOpen = false;
		keyed = false;
		if (selected.size) selected = new Set();
		else if (query) query = "";
	}
}

/** Selects from one issue to another, as they show. */
function selectRange(flat: Issue[], from: string, to: string) {
	const a = flat.findIndex((issue) => issue.id === from);
	const b = flat.findIndex((issue) => issue.id === to);
	if (a < 0 || b < 0) return;
	const next = new Set(selected);
	for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(flat[i]!.id);
	selected = next;
	cursor = to;
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
		<ui.box style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
			{/* As Flux's: fading in, rising a little. */}
			<ui.box key={filtered ? "tray-q" : scope} style={{ alignItems: "center", maxWidth: 384, animation: { name: "slideIn", duration: 300 } }}>
			{filtered || scope === "active" ? <TrayArt /> : <IssuesArt />}
			<ui.text style={{ marginTop: 32, fontSize: 20, lineHeight: "28px", fontWeight: 500, letterSpacing: -0.2, textAlign: "center" }}>{title}</ui.text>
			<ui.text style={{ marginTop: 6, fontSize: 14, color: "text2", textAlign: "center", maxWidth: 384 }}>{text}</ui.text>
			<ui.box style={{ flexDirection: "row", gap: 8, marginTop: 24 }}>
				{filtered ? <ui.button kind="secondary" onClick={() => { query = ""; }}>Clear filter</ui.button> : null}
				{!filtered && scope !== "all" ? <ui.button kind="secondary" onClick={() => storage.set("scope", "all")}>Show all issues</ui.button> : null}
				{!filtered && scope !== "active" && flux.projects().length > 0 ? <ui.button kind="primary" icon="plus" tooltip="New issue (C)" onClick={onCreate}>New issue</ui.button> : null}
			</ui.box>
			</ui.box>
		</ui.box>
	);
}

function openCreate(flux: Flux, projectId?: string, key?: GroupKey, parentId?: string) {
	const seeded = key ? draftForGroup(key) : {};
	const me = flux.me?.id;
	creating = true;
	// A draft closed unsent comes back, not lost, unless it's for a parent of its own.
	const kept = (draftTitle.trim() || draftBody.trim()) && draftParent === (parentId ?? null);
	if (kept) {
		ui.showOverlay("flux-new");
		return;
	}
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

/** As Swarm closes New issue's dialog: its draft stays, for next time. */
export function closeCreate() {
	creating = false;
}

export function NewIssue({ flux }: { flux: Flux }) {
	const projects = flux.projects();
	const project = projects.find((item) => item.id === draftProject);
	const members = flux.memberList();
	const me = flux.me?.id;
	const chosenPeople = members.filter((member) => draftAssignees.includes(member.id));
	const labels = flux.labels();
	const chosenLabels = labels.filter((label) => draftLabels.includes(label.id));
	const parent = draftParent ? flux.issue(draftParent) : undefined;
	// Flux's property chips: bordered, their text 12px and medium, muted while unset.
	const chip = { ...ghostChip, height: 28, border: "1px solid border", gap: 6 } as const;
	const chipText = { fontSize: 12, fontWeight: 500, minWidth: 0 } as const;
	return (
		<ui.box style={{ gap: 0 }} keys={["Mod+Enter"]} onKeyDown={() => void submitNew(flux)}>
			<ui.box style={{ gap: 12, paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 8 }}>
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
					<ui.menu label={`Project: ${project?.name ?? "None"}`} style={{ ...ghostChip, height: 28, paddingLeft: 4 }}>
						<ProjectMark project={project} size={14} />
						<ui.text style={{ fontSize: 13 }}>{project?.name ?? "Project"}</ui.text>
						{projects.map((item) => <ui.item key={item.id} {...navMark(item)} checked={item.id === draftProject} onClick={() => { draftProject = item.id; }}>{item.name}</ui.item>)}
					</ui.menu>
					{parent ? (
						<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
							<ui.icon icon="chevron-right" style={{ width: 12, height: 12, color: "text2" }} />
							<ui.text style={{ fontSize: 13, color: "text2" }}>Sub-issue</ui.text>
						</ui.box>
					) : null}
				</ui.box>
				<ui.field key="new-title" value={draftTitle} placeholder="Issue title" onChange={(value) => { draftTitle = value; }} onSubmit={() => void submitNew(flux)} style={{ fontSize: 18, fontWeight: 500, lineHeight: "28px", backgroundColor: "transparent", boxShadow: "none", padding: 0 }} />
				<ui.editor key="new-body" value={draftBody} placeholder="Add description…" label="Description" options={mentionOptions(flux)} onChange={(value) => { draftBody = value; }} onSubmit={() => void submitNew(flux)} style={{ minHeight: 144 }} />
			</ui.box>
			<ui.box style={{ height: 1, backgroundColor: "divider" }} />
			<ui.box style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", paddingLeft: 16, paddingRight: 16, paddingTop: 12 }}>
				<ui.menu label={`Status: ${STATUS_LABELS[draftStatus]}`} style={chip}>
					<StatusIcon status={draftStatus} size={14} />
					<ui.text style={chipText}>{STATUS_LABELS[draftStatus]}</ui.text>
					{STATUSES.map((status) => <ui.item key={status} {...statusMark(status)} checked={draftStatus === status} onClick={() => { draftStatus = status; }}>{STATUS_LABELS[status]}</ui.item>)}
				</ui.menu>
				<ui.menu label={`Priority: ${PRIORITY_LABELS[draftPriority]}`} style={chip}>
					<PriorityIcon priority={draftPriority} size={14} />
					<ui.text style={{ ...chipText, color: draftPriority === "none" ? "text2" : "text" }}>{draftPriority === "none" ? "Priority" : PRIORITY_LABELS[draftPriority]}</ui.text>
					{PRIORITIES.map((priority) => <ui.item key={priority} {...priorityMark(priority)} checked={draftPriority === priority} onClick={() => { draftPriority = priority; }}>{PRIORITY_LABELS[priority]}</ui.item>)}
				</ui.menu>
				<ui.menu label={chosenPeople.length ? `Assignee: ${chosenPeople.map((m) => m.name).join(", ")}` : "Assignee"} style={chip}>
					{chosenPeople.length ? <AvatarStack members={chosenPeople} size={16} ring="overlay" /> : <ui.icon icon="user" style={{ width: 14, height: 14, color: "text2" }} />}
					<ui.text style={{ ...chipText, maxWidth: 180, color: chosenPeople.length ? "text" : "text2" }} maxLines={1}>{chosenPeople.length ? chosenPeople.map((m) => m.name).join(", ") : "Assignee"}</ui.text>
					{[...members].sort((a, b) => Number(b.id === me) - Number(a.id === me)).map((member) => <ui.item key={member.id} {...memberMark(member)} detail={"@" + member.username} checked={draftAssignees.includes(member.id)} onClick={() => { draftAssignees = draftAssignees.includes(member.id) ? draftAssignees.filter((id) => id !== member.id) : [...draftAssignees, member.id]; }}>{member.id === me ? `${member.name} (you)` : member.name}</ui.item>)}
				</ui.menu>
				<ui.menu label={chosenLabels.length ? `Label: ${chosenLabels.map((l) => l.name).join(", ")}` : "Labels"} style={chip}>
					{chosenLabels.length ? (
						<ui.box style={{ flexDirection: "row", alignItems: "center" }}>
							{chosenLabels.map((l, n) => <ui.box key={l.id} style={{ width: 10, height: 10, borderRadius: "full", marginLeft: n ? -2 : 0, backgroundColor: colorOf[l.color] ?? "text2", boxShadow: "0 0 0 2px overlay" }} />)}
						</ui.box>
					) : <ui.icon icon="tag" style={{ width: 14, height: 14, color: "text2" }} />}
					<ui.text style={{ ...chipText, color: chosenLabels.length ? "text" : "text2" }}>{chosenLabels.length ? `${chosenLabels.length} ${chosenLabels.length === 1 ? "label" : "labels"}` : "Labels"}</ui.text>
					{labels.map((item) => <ui.item key={item.id} {...labelMark(item.color)} checked={draftLabels.includes(item.id)} onClick={() => { draftLabels = draftLabels.includes(item.id) ? draftLabels.filter((id) => id !== item.id) : [...draftLabels, item.id]; }}>{item.name}</ui.item>)}
					{labels.length === 0 ? <ui.item disabled>No labels</ui.item> : null}
				</ui.menu>
				<ui.menu label={draftDue ? `Due ${dueLabel(draftDue)}` : "Due date"} style={chip}>
					<ui.icon icon="calendar" style={{ width: 14, height: 14, color: draftDue ? dueTone(draftDue) : "text2" }} />
					<ui.text style={{ ...chipText, color: draftDue ? "text" : "text2" }}>{draftDue ? dueLabel(draftDue) : "Due date"}</ui.text>
					{dueItems(draftDue, (value) => { draftDue = value; ui.update(); })}
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
		const issue = await flux.createIssue({ projectId: draftProject, title, descriptionMarkdown: draftBody, status: draftStatus, priority: draftPriority, assigneeIds: draftAssignees, labelIds: draftLabels, parentId: draftParent, dueDate: draftDue });
		// As Flux's: it stays where it was, and says so, with Open.
		ui.toast(`Created ${issue.key} · ${issue.title}`, { action: "Open", href: `swarm://plugin/flux/issues/${encodeURIComponent(issue.key)}` });
		draftTitle = "";
		draftBody = "";
		draftDue = null;
		if (!createMore) {
			creating = false;
			ui.hideOverlay("flux-new");
		}
	} catch (error) {
		ui.toast(error instanceof Error ? error.message : String(error));
	}
}

/** The issues pages showed, by their keys: a page follows its issue to its new key as it moves to another project. */
const shownIds = new Map<string, string>();

function IssuePage({ flux, issueKey, image }: { flux: Flux; issueKey: string; image: ImageOf }) {
	let issue = flux.findIssue(issueKey);
	if (issue) shownIds.set(issueKey, issue.id);
	else {
		const moved = flux.issue(shownIds.get(issueKey) ?? "");
		if (moved && moved.key !== issueKey) {
			shownIds.set(moved.key, moved.id);
			setTimeout(() => openIssue(moved.key));
			issue = moved;
		}
	}
	if (!issue) {
		const connection = flux.connection();
		const waiting = connection.state !== "ready";
		// Still syncing, and nothing wrong: the page's shape while it comes.
		if (waiting && !connection.message) return <IssueBones />;
		return (
			<ui.box style={{ flex: 1, minHeight: 0 }}>
			<SyncBars flux={flux} />
			<ui.box style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
				<ui.box style={{ alignItems: "center", maxWidth: 384, animation: { name: "slideIn", duration: 300 } }}>
					<TrayArt />
					<ui.text style={{ marginTop: 32, fontSize: 20, lineHeight: "28px", fontWeight: 500, letterSpacing: -0.2, textAlign: "center" }}>{waiting ? `Can't load ${issueKey} yet` : `No issue ${issueKey}`}</ui.text>
					<ui.text style={{ marginTop: 6, fontSize: 14, color: "text2", textAlign: "center" }}>{waiting ? (connection.message ? offline(connection.message, false) : "Syncing with Flux.") : "It was deleted, or moved to another project."}</ui.text>
					<ui.box style={{ flexDirection: "row", marginTop: 24 }}>
						<ui.button kind="secondary" onClick={() => openList("")}>Back to the board</ui.button>
					</ui.box>
				</ui.box>
			</ui.box>
			</ui.box>
		);
	}
	const detail = flux.detail(issue.id);
	const project = flux.projects().find((item) => item.id === issue.projectId);
	const members = flux.memberList();
	const titleKey = `title:${flux.id}:${issue.id}`;
	const edits = { update: (patch: IssuePatch) => apply(flux, issue.id, patch) };
	return (
		<ui.box style={{ flex: 1, height: "100%", minHeight: 0, minWidth: 0, width: "100%", gap: 0 }} keys={ISSUE_KEYS} onKeyDown={(key) => onIssueKey(flux, issue, key)}>
			<SyncBars flux={flux} />
			<ui.box style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
				<ui.box style={{ flexDirection: "row", alignItems: "flex-start", width: "100%", maxWidth: 672, alignSelf: "center", paddingLeft: 16, paddingRight: 16, paddingTop: 24, paddingBottom: 96, media: [{ minWidth: 700, style: { paddingLeft: 32, paddingRight: 32, paddingTop: 40 } }, { minWidth: 900, style: { maxWidth: 928 } }] }}>
					<ui.box style={{ flex: 1, minWidth: 0, gap: 0 }}>
						{editingTitle === issue.id && (titleBefore?.id === issue.id || (titleBefore = { id: issue.id, title: issue.title })) ? (
							<ui.field
								key={titleKey}
								multiline
								value={drafted(titleKey, issue.title)}
								placeholder="Issue title"
								autoFocus
								// A title is one line however it wraps: Enter keeps it, Escape leaves it as it was.
								keys={["Enter", "Escape"]}
								onKeyDown={(key) => {
									const before = titleBefore?.id === issue.id ? titleBefore.title : issue.title;
									if (key.key === "Escape") {
										clearDraft(titleKey);
										void saveTitle(flux, issue, before);
									} else void saveTitle(flux, issue, drafted(titleKey, issue.title));
									editingTitle = "";
									titleBefore = null;
								}}
								onChange={(value) => editDraft(titleKey, value.replace(/\n/g, " "), (next) => saveTitle(flux, issue, next))}
								style={{ ...titleStyle, minHeight: 0, padding: 0, backgroundColor: "transparent", boxShadow: "none" }}
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
						<ui.box style={{ marginTop: 24 }}>
							<DescriptionEditor flux={flux} issue={issue} markdown={detail.descriptionMarkdown} html={detail.descriptionHtml} image={image} />
						</ui.box>
						<SubIssues flux={flux} issue={issue} subs={detail.subIssues} />
						<ui.box style={{ height: 1, backgroundColor: "divider", marginTop: 32 }} />
						<ui.text style={{ fontSize: 14, fontWeight: 500, marginTop: 24 }}>Activity</ui.text>
						<ui.box style={{ gap: 20, marginTop: 20 }}>
							<ActivityRow member={members.find((member) => member.id === issue.creatorId)} when={issue.createdAt} text="created the issue" />
							{detail.comments.map((comment) => <Comment key={comment.id} flux={flux} comment={comment} members={members} image={image} />)}
							<CommentEditor flux={flux} issue={issue} image={image} />
						</ui.box>
					</ui.box>
					<ui.box style={{ display: "none", position: "sticky", top: 0, width: 240, flexShrink: 0, media: [{ minWidth: 900, style: { display: "flex" } }] }}>
						<PropertyRail flux={flux} issue={issue} project={project} members={members} />
					</ui.box>
				</ui.box>
			</ui.box>
		</ui.box>
	);
}

/**
 * An issue's title bar: its project, where the board's picker is and drawn
 * as it is, back to the board; its key and title; Open in Flux, its menu,
 * and the bar's end.
 */
function IssueHead({ flux, issueKey }: { flux: Flux; issueKey: string }) {
	const issue = flux.findIssue(issueKey) ?? flux.issue(shownIds.get(issueKey) ?? "") ?? undefined;
	const project = issue ? flux.projects().find((item) => item.id === issue.projectId) : undefined;
	const back = () => openList(project ? `p/${project.key}` : "");
	return (
		<ui.box style={bar} keys={issue ? ISSUE_KEYS : undefined} onKeyDown={issue ? (key) => onIssueKey(flux, issue, key) : undefined}>
			<ui.pressable label={`Back to ${project?.name ?? "All projects"}`} tooltip={`Back to ${project?.name ?? "All projects"}`} onClick={back} style={{ ...ghostChip, minWidth: 0, flexShrink: 1, color: "text2", transition: { duration: 100, colors: true }, hover: { backgroundColor: "hover", color: "text" } }}>
				{project ? <ProjectMark project={project} size={16} /> : <FluxMark size={16} />}
				<ui.text style={{ fontSize: 14, minWidth: 0, color: "currentColor" }} maxLines={1}>{project?.name ?? "All projects"}</ui.text>
			</ui.pressable>
			<ui.icon icon="chevron-right" style={{ width: 12, height: 12, color: "text3", flexShrink: 0 }} />
			{/* The key the page is at: moved, the breadcrumb follows as the page does. */}
			<ui.text style={{ fontSize: 14, color: "text2", flexShrink: 0, paddingLeft: 2 }}>{issueKey}</ui.text>
			<ui.text style={{ fontSize: 14, fontWeight: 500, flex: 1, minWidth: 0 }} maxLines={1}>{issue ? issue.title.trim() || "Untitled" : ""}</ui.text>
			{issue ? <ui.iconButton icon="external" label="Open in Flux" href={flux.issueUrl(issue)} disabled={!flux.issueUrl(issue)} style={{ width: 28, height: 28 }} /> : null}
			{issue ? <IssueMenu flux={flux} issue={issue} onDelete={back} /> : null}
			<BarEnd onCreate={() => openCreate(flux, issue?.projectId ?? project?.id)} />
		</ui.box>
	);
}

/** The title as it was when its editing began, which Escape puts back. */
let titleBefore: { id: string; title: string } | null = null;

const titleStyle: Style = { fontSize: 30, lineHeight: "38px", fontWeight: 600, letterSpacing: -0.4, media: [{ maxWidth: 699, style: { fontSize: 24, lineHeight: "30px" } }] };
let editingTitle = "";

/**
 * Saves an issue's title, when it's not that already. issue is the copy the
 * page was rendered with, which a draft saved since may have changed: Escape
 * right after the draft went puts the title back all the same.
 */
async function saveTitle(flux: Flux, issue: Issue, value: string) {
	const next = value.trim();
	const now = flux.issue(issue.id)?.title ?? issue.title;
	if (next && next !== now) await flux.updateIssue(issue.id, { title: next });
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

// Sub-issues' display, as Flux keeps it across issues: their order and what each row shows.
const SUB_ORDERINGS = ["created", "priority", "status"] as const;
type SubOrdering = (typeof SUB_ORDERINGS)[number];
const SUB_PROPERTIES = ["id", "priority", "assignee", "labels"] as const;
type SubProperty = (typeof SUB_PROPERTIES)[number];
const SUB_ORDERING_LABELS: Record<SubOrdering, string> = { created: "Created", priority: "Priority", status: "Status" };
const SUB_PROPERTY_LABELS: Record<SubProperty, string> = { id: "ID", priority: "Priority", assignee: "Assignee", labels: "Labels" };

function subDisplay(): { ordering: SubOrdering; properties: SubProperty[] } {
	const raw = storage.get<{ ordering?: unknown; properties?: unknown }>("subDisplay") ?? {};
	const ordering = (SUB_ORDERINGS as readonly unknown[]).includes(raw.ordering) ? (raw.ordering as SubOrdering) : "created";
	const properties = Array.isArray(raw.properties) ? SUB_PROPERTIES.filter((p) => (raw.properties as unknown[]).includes(p)) : (["assignee"] as SubProperty[]);
	return { ordering, properties };
}

function orderSubs(subs: Issue[], ordering: SubOrdering): Issue[] {
	const created = (a: Issue, b: Issue) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
	const out = [...subs].sort(created);
	if (ordering === "priority") out.sort((a, b) => PRIORITY_LEVEL[b.priority] - PRIORITY_LEVEL[a.priority] || created(a, b));
	if (ordering === "status") out.sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || created(a, b));
	return out;
}

// The composer open under an issue's sub-issues, and what it files next: Flux's defaults.
let composing: { parent: string; title: string; status: Status; priority: Priority; assigneeIds: string[]; labelIds: string[] } | null = null;
// Sub-issues file one at a time, so a pasted list keeps its order in Flux.
let filing: Promise<unknown> = Promise.resolve();

/** Opens the composer under issue's sub-issues, as ⌘⇧O and every Add sub-issue do on its page. */
function composeSub(flux: Flux, parent: Issue) {
	subsOpen = true;
	if (composing?.parent === parent.id) return;
	const me = flux.me?.id;
	const siblings = flux.issues().filter((i) => i.parentId === parent.id);
	// Flux's: the parent's assignees when you're one, or when every sibling has just them.
	const same = (ids: string[]) => ids.length === parent.assigneeIds.length && ids.every((id) => parent.assigneeIds.includes(id));
	const inherit = parent.assigneeIds.length > 0 && ((!!me && parent.assigneeIds.includes(me)) || (siblings.length > 0 && siblings.every((s) => same(s.assigneeIds))));
	composing = { parent: parent.id, title: "", status: "todo", priority: parent.priority, assigneeIds: inherit ? [...parent.assigneeIds] : [], labelIds: [] };
}

/** Files a sub-issue of what the composer holds, titled title; false when it's blank. */
function fileSub(flux: Flux, parent: Issue, title: string): boolean {
	const c = composing;
	const trimmed = title.trim();
	if (!c || !trimmed) return false;
	const input = { projectId: parent.projectId, parentId: parent.id, title: trimmed, status: c.status, priority: c.priority, assigneeIds: c.assigneeIds, labelIds: c.labelIds };
	filing = filing.then(() => flux.createIssue(input).catch((e: unknown) => failed(`Couldn't create “${trimmed}”`, e)));
	return true;
}

function SubIssues({ flux, issue, subs }: { flux: Flux; issue: Issue; subs: Issue[] }) {
	const members = flux.memberList();
	const display = subDisplay();
	const ordered = orderSubs(subs, display.ordering);
	const done = subs.filter((sub) => CLOSED_STATUSES.has(sub.status)).length;
	const open = composing?.parent === issue.id;
	const setDisplay = (patch: Partial<ReturnType<typeof subDisplay>>) => storage.set("subDisplay", { ...display, ...patch });
	return (
		<ui.box style={{ marginTop: 32, gap: 0 }}>
			{subs.length > 0 ? (
				<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", height: 32 }}>
					<ui.pressable label="Sub-issues" checked={subsOpen} onClick={() => { subsOpen = !subsOpen; }} style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 6, alignItems: "center", height: 32, paddingLeft: 6, paddingRight: 6, borderRadius: "control", transition: { duration: 100, colors: true }, hover: { backgroundColor: "hover" } }}>
						<ui.icon icon="chevron-right" style={{ width: 12, height: 12, color: "text2", transform: subsOpen ? "rotate(90deg)" : "none", transition: { duration: 150 } }} />
						<ui.text style={{ fontSize: 14, fontWeight: 500 }}>Sub-issues</ui.text>
						<SubIssueChip done={done} total={subs.length} />
					</ui.pressable>
					<ui.menu label="Sub-issue display options" tooltip="Display options" style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: "control", color: "text2", backgroundColor: "transparent", hover: { backgroundColor: "hover", color: "text" }, checked: { backgroundColor: "press", color: "text" } }}>
						<ui.icon icon="sliders" style={{ width: 16, height: 16, color: "currentColor" }} />
						<ui.heading>Ordering</ui.heading>
						{SUB_ORDERINGS.map((o) => <ui.item key={"o-" + o} checked={display.ordering === o} onClick={() => setDisplay({ ordering: o })}>{SUB_ORDERING_LABELS[o]}</ui.item>)}
						<ui.separator />
						<ui.heading>Display properties</ui.heading>
						{SUB_PROPERTIES.map((p) => {
							const on = display.properties.includes(p);
							return <ui.item key={"p-" + p} checked={on} onClick={() => setDisplay({ properties: on ? display.properties.filter((x) => x !== p) : SUB_PROPERTIES.filter((x) => x === p || display.properties.includes(x)) })}>{SUB_PROPERTY_LABELS[p]}</ui.item>;
						})}
					</ui.menu>
					<ui.iconButton icon="plus" label="Add sub-issue" tooltip="Add sub-issue (⌘⇧O)" style={{ width: 28, height: 28 }} onClick={() => composeSub(flux, issue)} />
				</ui.box>
			) : !open ? (
				<ui.pressable label="Add sub-issues" onClick={() => composeSub(flux, issue)} style={{ flexDirection: "row", gap: 8, alignItems: "center", alignSelf: "flex-start", height: 32, paddingLeft: 6, paddingRight: 8, borderRadius: "control", color: "text2", transition: { duration: 100, colors: true }, hover: { backgroundColor: "hover", color: "text" } }}>
					<ui.icon icon="plus" style={{ width: 14, height: 14, color: "currentColor" }} />
					<ui.text style={{ fontSize: 14, color: "currentColor" }}>Add sub-issues</ui.text>
				</ui.pressable>
			) : null}
			{subsOpen && subs.length > 0 ? (
				<ui.box style={{ marginTop: 4 }}>
					{ordered.map((sub) => <SubRow key={sub.id} flux={flux} sub={sub} members={members} properties={display.properties} />)}
				</ui.box>
			) : null}
			{open ? <SubComposer flux={flux} parent={issue} /> : null}
		</ui.box>
	);
}

function SubRow({ flux, sub, members, properties }: { flux: Flux; sub: Issue; members: Member[]; properties: SubProperty[] }) {
	const closed = CLOSED_STATUSES.has(sub.status);
	const shown = (p: SubProperty) => properties.includes(p);
	const who = members.filter((member) => sub.assigneeIds.includes(member.id));
	const labels = flux.labels().filter((l) => sub.labelIds.includes(l.id)).slice(0, 2);
	const cell = { width: 24, height: 24, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 6, backgroundColor: "transparent" } as const;
	return (
		<ui.box label={`${sub.key} ${sub.title}`} onClick={() => openIssue(sub.key)} style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 36, paddingLeft: 6, paddingRight: 6, borderRadius: "control", transition: { duration: 100, colors: true }, hover: { backgroundColor: "hover" } }}>
			<IssueContextMenu flux={flux} issue={sub} />
			<Picker label={`Status: ${STATUS_LABELS[sub.status]}`} style={cell}><StatusIcon status={sub.status} size={14} />{pickerItems(flux, sub, "status")}</Picker>
			{shown("id") ? <ui.text style={{ fontSize: 12, color: "text2", flexShrink: 0 }}>{sub.key}</ui.text> : null}
			{shown("priority") && sub.priority !== "none" ? <PriorityIcon priority={sub.priority} size={14} /> : null}
			<ui.text style={{ fontSize: 14, flex: 1, minWidth: 0, color: closed ? "text2" : "text", textDecoration: closed ? "line-through" : "none" }} maxLines={1}>{sub.title.trim() || "Untitled"}</ui.text>
			{shown("labels") && labels.length ? <ui.box style={{ ...from(SM), flexDirection: "row", gap: 4, flexShrink: 0 }}>{labels.map((l) => <ui.box key={l.id} style={field}>{tagContent(l)}</ui.box>)}</ui.box> : null}
			{shown("assignee") ? <Picker label={who.length ? `Assignees: ${who.map((m) => m.name).join(", ")}` : "No assignee"} style={{ ...cell, width: "auto", minWidth: 24, paddingLeft: 2, paddingRight: 2 }}>{who.length ? <AvatarStack members={who} size={20} /> : <Unassigned size={20} />}{pickerItems(flux, sub, "assignees")}</Picker> : null}
		</ui.box>
	);
}

/** Flux's inline composer: one sub-issue per Enter, or per pasted line; ⌘⇧Enter files it and closes. */
function SubComposer({ flux, parent }: { flux: Flux; parent: Issue }) {
	const c = composing!;
	const members = flux.memberList();
	const me = flux.me?.id;
	const close = () => { composing = null; };
	const submit = (andClose: boolean) => {
		if (!fileSub(flux, parent, c.title)) return;
		c.title = "";
		if (andClose) close();
	};
	const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
	const who = members.filter((m) => c.assigneeIds.includes(m.id));
	const chosen = flux.labels().filter((l) => c.labelIds.includes(l.id));
	const chip: Style = { flexDirection: "row", gap: 6, alignItems: "center", height: 28, maxWidth: 224, minWidth: 0, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 6, border: "1px solid border", backgroundColor: "overlay", transition: { duration: 100, colors: true }, hover: { backgroundColor: "hover" }, checked: { backgroundColor: "press" } };
	const chipText = (text: string, muted: boolean) => <ui.text style={{ fontSize: 14, minWidth: 0, color: muted ? "text2" : "text" }} maxLines={1}>{text}</ui.text>;
	return (
		<ui.box style={{ paddingTop: 8, animation: { name: "slideIn" } }}>
			<ui.box label="New sub-issue" keys={["Escape"]} onKeyDown={close} style={{ padding: 8, borderRadius: 8, border: "1px solid border", backgroundColor: "overlay", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
				<ui.field
					key={"sub-title-" + parent.id}
					multiline
					autoFocus
					value={c.title}
					placeholder="Sub-issue title"
					keys={["Enter", "Mod+Shift+Enter", "Escape"]}
					onKeyDown={(key) => {
						if (key.key === "Escape") close();
						else submit(key.mod && key.shift);
					}}
					onChange={(value) => {
						// Several lines, pasted, make one sub-issue each, as Flux's.
						const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
						if (value.includes("\n") && lines.length > 1) {
							for (const line of lines) fileSub(flux, parent, line);
							c.title = "";
						} else c.title = value.replace(/\r?\n/g, " ");
					}}
					style={{ minHeight: 0, height: 32, paddingLeft: 6, paddingRight: 6, fontSize: 14, backgroundColor: "transparent", boxShadow: "none" }}
				/>
				<ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 4 }}>
					<ui.menu label={`Status: ${STATUS_LABELS[c.status]}`} style={chip}>
						<StatusIcon status={c.status} size={14} />
						{chipText(STATUS_LABELS[c.status], false)}
						{STATUSES.map((st) => <ui.item key={st} {...statusMark(st)} checked={c.status === st} onClick={() => { c.status = st; }}>{STATUS_LABELS[st]}</ui.item>)}
					</ui.menu>
					<ui.menu label={`Priority: ${PRIORITY_LABELS[c.priority]}`} style={chip}>
						<PriorityIcon priority={c.priority} size={14} />
						{chipText(c.priority === "none" ? "Priority" : PRIORITY_LABELS[c.priority], c.priority === "none")}
						{[...PRIORITIES.filter((p) => p === "none"), ...PRIORITIES.filter((p) => p !== "none")].map((p) => <ui.item key={p} {...priorityMark(p)} checked={c.priority === p} onClick={() => { c.priority = p; }}>{PRIORITY_LABELS[p]}</ui.item>)}
					</ui.menu>
					<ui.menu label={who.length ? `Assignees: ${who.map((m) => m.name).join(", ")}` : "Assignee"} style={chip}>
						{who.length ? <AvatarStack members={who} size={16} ring="overlay" /> : <ui.icon icon="user" style={{ width: 14, height: 14, color: "text2" }} />}
						{chipText(who.length ? who.map((m) => m.name).join(", ") : "Assignee", who.length === 0)}
						{() => [...members].sort((a, b) => Number(b.id === me) - Number(a.id === me)).map((m) => <ui.item key={m.id} {...memberMark(m)} detail={"@" + m.username} checked={c.assigneeIds.includes(m.id)} onClick={() => { c.assigneeIds = toggle(c.assigneeIds, m.id); }}>{m.id === me ? `${m.name} (you)` : m.name}</ui.item>)}
					</ui.menu>
					<ui.menu label={chosen.length ? `Labels: ${chosen.map((l) => l.name).join(", ")}` : "Labels"} style={chip}>
						{chosen.length ? (
							<ui.box style={{ flexDirection: "row" }}>
								{chosen.map((l, n) => <ui.box key={l.id} style={{ width: 10, height: 10, borderRadius: "full", marginLeft: n ? -2 : 0, backgroundColor: colorOf[l.color] ?? "text2", boxShadow: "0 0 0 2px overlay" }} />)}
							</ui.box>
						) : <ui.icon icon="tag" style={{ width: 14, height: 14, color: "text2" }} />}
						{chipText(chosen.length ? `${chosen.length} ${chosen.length === 1 ? "label" : "labels"}` : "Labels", chosen.length === 0)}
						{() => flux.labels().map((l) => <ui.item key={l.id} {...labelMark(l.color)} checked={c.labelIds.includes(l.id)} onClick={() => { c.labelIds = toggle(c.labelIds, l.id); }}>{l.name}</ui.item>)}
					</ui.menu>
					<ui.box style={{ flex: 1 }} />
					<ui.button kind="ghost" size="sm" onClick={close}>Cancel</ui.button>
					<ui.button kind="primary" size="sm" disabled={!c.title.trim()} tooltip={"⌘ Enter to submit and draft a similar issue\n⌘ ⇧ Enter to submit issue"} onClick={() => submit(false)}>Create</ui.button>
				</ui.box>
			</ui.box>
		</ui.box>
	);
}

/** Flux's "…" menu on the issue page, item for item. */
function IssueMenu({ flux, issue, onDelete }: { flux: Flux; issue: Issue; onDelete: () => void }) {
	const projects = flux.projects();
	const url = flux.issueUrl(issue);
	return (
		<ui.menu label="" icon="more" tooltip="Issue actions">
			<ui.item icon="copy" shortcut="D" onClick={() => duplicate(flux, issue.id, (copy) => openIssue(copy.key))}>Duplicate</ui.item>
			<ui.item icon="external" shortcut="Mod+Shift+," disabled={!url} onClick={() => ui.copy(url)}>Copy link</ui.item>
			<ui.item icon="copy" onClick={() => ui.copy(issue.key)}>Copy ID</ui.item>
			{projects.length >= 2 ? (
				<ui.menu label="Move to project" icon="folder" shortcut="Shift+P">
					{projects.map((project) => <ui.item key={project.id} {...navMark(project)} checked={issue.projectId === project.id} onClick={() => apply(flux, issue.id, { projectId: project.id })}>{project.name}</ui.item>)}
				</ui.menu>
			) : null}
			<ui.separator />
			<ui.item icon="plus" shortcut="Mod+Shift+O" onClick={() => composeSub(flux, issue)}>Add sub-issue</ui.item>
			<ui.item icon="branch" shortcut="Mod+Shift+P" onClick={() => openPalette("parent", [issue.id], (id, patch) => apply(flux, id, patch))}>Set parent</ui.item>
			{issue.parentId ? <ui.item onClick={() => apply(flux, issue.id, { parentId: null })}>Remove parent</ui.item> : null}
			<ui.separator />
			<ui.item icon="trash" danger shortcut="Mod+Backspace" onClick={() => askDelete(flux, [issue.id], onDelete)}>Delete</ui.item>
		</ui.menu>
	);
}

/** What an @name in a comment is, as Flux chips it: a member, or a project that opens. */
function mentionOf(flux: Flux): MentionOf {
	return (name) => {
		const lower = name.toLowerCase();
		if (flux.memberList().some((m) => m.username.toLowerCase() === lower)) return { kind: "member" };
		const project = flux.projects().find((p) => p.key.toLowerCase() === lower);
		return project ? { kind: "project", open: () => openList(`p/${project.key}`) } : null;
	};
}

/** A time as Flux's activity has it: "5d", the whole date and time on hover. */
function When({ iso, prefix = " · " }: { iso: string; prefix?: string }) {
	return <ui.text style={{ fontSize: 14, color: "text2", flexShrink: 0 }} tooltip={new Date(iso).toLocaleString()}>{prefix + ago(iso)}</ui.text>;
}

function Comment({ flux, comment, members, image }: { flux: Flux; comment: IssueComment; members: Member[]; image: ImageOf }) {
	const author = members.find((member) => member.id === comment.authorId);
	const mine = comment.authorId === flux.me?.id && !comment.agent;
	const editing = editingComment === comment.id;
	const edited = new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000;
	const agent = comment.agent;
	return (
		<ui.box style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", hover: { backgroundColor: "transparent" } }}>
			{agent ? (
				<ui.box style={{ marginTop: 2 }}><AgentAvatar agent={agent} size={20} /></ui.box>
			) : <ui.box style={{ marginTop: 2 }}><Avatar member={author} size={20} /></ui.box>}
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", minHeight: 24 }}>
					<ui.box style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
						{agent?.threadId ? (
							<ui.pressable label={agent.name} tooltip="Open the agent's thread" onClick={() => ui.openThread(agent.threadId!)} style={{ hover: { textDecoration: "underline" } }}>
								<ui.text style={{ fontSize: 14, fontWeight: 500 }}>{agent.name}</ui.text>
							</ui.pressable>
						) : <ui.text style={{ fontSize: 14, fontWeight: 500 }}>{agent?.name ?? author?.name ?? "Someone"}</ui.text>}
						{agent ? <ui.text style={{ fontSize: 14, color: "text2" }}>{` for ${author?.name ?? "someone"}`}</ui.text> : null}
						<When iso={comment.createdAt} />
						{edited ? <ui.text style={{ fontSize: 14, color: "text2" }} tooltip={`Edited ${new Date(comment.updatedAt).toLocaleString()}`}>{" · Edited"}</ui.text> : null}
					</ui.box>
					{mine && !editing ? (
						<ui.menu label="Comment actions" tooltip="Comment actions" style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: "control", color: "text2", backgroundColor: "transparent", opacity: 0, transition: { duration: 100 }, groupHover: { opacity: 1 }, focus: { opacity: 1 }, hover: { backgroundColor: "hover", color: "text" }, checked: { opacity: 1, backgroundColor: "press" } }}>
							<ui.icon icon="more" style={{ width: 14, height: 14, color: "currentColor" }} />
							<ui.item icon="pencil" onClick={() => { editingComment = comment.id; commentBody = comment.markdown; }}>Edit</ui.item>
							<ui.separator />
							<ui.item icon="trash" danger onClick={() => confirm("Delete this comment?", "This cannot be undone.", "Delete", () => flux.deleteComment(comment.id))}>Delete</ui.item>
						</ui.menu>
					) : null}
				</ui.box>
				{editing ? (
					<ui.box label="Edit comment" keys={["Escape"]} onKeyDown={() => { editingComment = ""; }} style={{ marginTop: 4, gap: 0, borderRadius: 8, border: "1px solid border", backgroundColor: "overlay", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", focus: { borderColor: "borderStrong" } }}>
						<ui.box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 6 }}>
							<ui.editor key={"edit-" + comment.id} value={commentBody} label="Edit comment" placeholder="Edit comment…" options={mentionOptions(flux)} onChange={(value) => { commentBody = value; }} onSubmit={() => saveComment(flux, comment.id)} style={{ padding: 0 }} />
						</ui.box>
						<ui.box style={{ flexDirection: "row", gap: 6, justifyContent: "flex-end", paddingLeft: 6, paddingRight: 6, paddingBottom: 6 }}>
							<ui.button size="sm" kind="ghost" onClick={() => { editingComment = ""; }}>Cancel</ui.button>
							<ui.button size="sm" kind="primary" disabled={!commentBody.trim()} onClick={() => saveComment(flux, comment.id)}>Save</ui.button>
						</ui.box>
					</ui.box>
				) : (
					<Markdown md={comment.markdown} image={image} mention={mentionOf(flux)} />
				)}
			</ui.box>
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
		<ui.box style={{ flexDirection: "row", gap: 10, alignItems: "center", minHeight: 24 }}>
			<Avatar member={member} size={20} />
			<ui.box style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
				<ui.text style={{ fontSize: 14, fontWeight: 500 }}>{member?.name ?? "Someone"}</ui.text>
				<ui.text style={{ fontSize: 14, color: "text2" }}>{` ${text}`}</ui.text>
				<When iso={when} />
			</ui.box>
		</ui.box>
	);
}

const railHeading = { fontSize: 12, fontWeight: 500, color: "text2", paddingLeft: 6, paddingRight: 6, paddingBottom: 8 } as const;

function PropertyRail({ flux, issue, project, members }: { flux: Flux; issue: Issue; project?: Project; members: Member[] }) {
	const labels = flux.labels().filter((item) => issue.labelIds.includes(item.id));
	const assignees = members.filter((member) => issue.assigneeIds.includes(member.id));
	const edits = { update: (patch: IssuePatch) => apply(flux, issue.id, patch) };
	const labelItems = () => pickerItems(flux, issue, "labels");
	const another = issue.threadIds.length > 0;
	return (
		<ui.box style={{ width: 240, flexShrink: 0, gap: 32, paddingLeft: 40 }}>
			<ui.box style={{ gap: 2 }}>
				<ui.text style={railHeading}>Properties</ui.text>
				<RailRow icon={<ProjectMark project={project} />} label="Project" value={project?.name ?? "None"} menu={"Project: " + (project?.name ?? "None")}>
					{() => flux.projects().map((item) => <ui.item key={item.id} {...navMark(item)} checked={item.id === issue.projectId} onClick={() => edits.update({ projectId: item.id })}>{item.name}</ui.item>)}
				</RailRow>
				<RailRow icon={<StatusIcon status={issue.status} />} label="Status" value={STATUS_LABELS[issue.status]} menu={"Status: " + STATUS_LABELS[issue.status]}>
					{() => pickerItems(flux, issue, "status")}
				</RailRow>
				<RailRow icon={<PriorityIcon priority={issue.priority} />} label="Priority" value={issue.priority === "none" ? "Set priority" : PRIORITY_LABELS[issue.priority]} muted={issue.priority === "none"} menu={"Priority: " + PRIORITY_LABELS[issue.priority]}>
					{() => pickerItems(flux, issue, "priority")}
				</RailRow>
				<RailRow icon={assignees.length ? <AvatarStack members={assignees} size={14} ring="bg" /> : <ui.icon icon="user" style={{ width: 14, height: 14, color: "text2" }} />} label="Assignee" value={assignees.length > 1 ? `${assignees[0]!.name} +${assignees.length - 1}` : assignees[0]?.name ?? "Assign"} muted={assignees.length === 0} menu={assignees.length ? "Assignees: " + assignees.map((m) => m.name).join(", ") : "Assign"}>
					{() => pickerItems(flux, issue, "assignees")}
				</RailRow>
				<RailRow icon={<ui.icon icon="calendar" style={{ width: 14, height: 14, color: issue.dueDate ? dueTone(issue.dueDate) : "text2" }} />} label="Due date" value={issue.dueDate ? dueLabel(issue.dueDate) : "Due date"} menu={issue.dueDate ? "Due " + issue.dueDate : "Due date"}>
					{() => dueItems(issue.dueDate, (dueDate) => edits.update({ dueDate }))}
				</RailRow>
			</ui.box>
			<ui.box style={{ gap: 2 }}>
				<ui.text style={railHeading}>Labels</ui.text>
				{labels.length === 0 ? (
					<ui.menu label="Add label" style={{ flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "flex-start", alignSelf: "flex-start", height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: "control", backgroundColor: "transparent", hover: { backgroundColor: "hover" }, checked: { backgroundColor: "hover" } }}>
						<ui.icon icon="tag" style={{ width: 14, height: 14, color: "text2" }} />
						<ui.text style={{ fontSize: 14, color: "text2" }}>Add label</ui.text>
						{labelItems}
					</ui.menu>
				) : (
					<ui.box style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center", paddingLeft: 2 }}>
						{labels.map((item) => (
							<ui.menu key={item.id} label={`Labels: ${item.name}`} style={{ ...field, height: 28, paddingLeft: 8, paddingRight: 8, backgroundColor: "transparent", hover: { backgroundColor: "hover" }, checked: { backgroundColor: "hover" } }}>
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
							<ui.iconButton icon="x" label="Detach thread" onClick={() => { flux.detach(issue.id, id); ui.toast(`Detached from ${issue.key}.`); }} />
						</ui.box>
					);
				})}
				<ui.button size="sm" kind={another ? "secondary" : "primary"} icon="bot" onClick={() => startAgent(issue.id)} style={{ marginTop: 4, width: "100%" }}>{another ? "Start another agent" : "Start agent"}</ui.button>
			</ui.box>
		</ui.box>
	);
}

function RailRow({ icon, value, menu, muted, children }: { icon: Child; label: string; value: string; menu: string; muted?: boolean; children?: MenuChild }) {
	return (
		<ui.menu label={menu} style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 32, paddingLeft: 6, paddingRight: 6, borderRadius: "control", backgroundColor: "transparent", transition: { duration: 100, colors: true }, hover: { backgroundColor: "hover" }, checked: { backgroundColor: "press" } }}>
			{icon}
			<ui.text style={{ fontSize: 14, flex: 1, minWidth: 0, color: muted ? "text2" : "text" }} maxLines={1}>{value}</ui.text>
			{children}
		</ui.menu>
	);
}

/** A workspace's color, as Flux keeps it. */
function workspaceColor(flux: Flux): ColorName {
	const c = flux.workspace?.color;
	return (COLORS as readonly string[]).includes(c ?? "") ? (c as ColorName) : "gray";
}

/** A workspace's initial, as Flux's WorkspaceAvatar draws it without a logo. */
function workspaceInitial(flux: Flux): string {
	return (flux.workspace?.name || flux.baseUrl || "F").replace(/^https?:\/\//, "").trim().slice(0, 1).toUpperCase();
}

/** A workspace's mark, as Flux's WorkspaceAvatar: its logo, else its initial on its color, in a rounded square. */
function WorkspaceMark({ flux, size }: { flux: Flux; size: number }) {
	const box = { width: size, height: size, flexShrink: 0, borderRadius: Math.round(size / 4), overflow: "hidden", alignItems: "center", justifyContent: "center" } as const;
	const logo = flux === hub.active ? pictureBytes(flux.workspace?.imageUrl) : null;
	if (logo) return <ui.image src={logo} alt="" style={{ ...box, objectFit: "cover" }} />;
	return (
		<ui.box style={{ ...box, backgroundColor: colorOf[workspaceColor(flux)] }}>
			<ui.text style={{ color: "white", fontSize: Math.round(size * 0.6), fontWeight: 600 }}>{workspaceInitial(flux)}</ui.text>
		</ui.box>
	);
}

/** The same, as a menu item's mark. */
function workspaceMark(flux: Flux): { mark: Uint8Array } | { initial: string; tint: string } {
	const logo = flux === hub.active ? pictureBytes(flux.workspace?.imageUrl) : null;
	return logo ? { mark: logo } : { initial: workspaceInitial(flux), tint: MARK_HEX[workspaceColor(flux)] };
}

/**
 * Which Flux, beside Flux's name in the sidebar: changed seldom, it has no
 * place on the bar. Its dot says whether it's reachable; its name gives way
 * to the sidebar's title, cut short.
 */
function WorkspaceSwitcher() {
	const list = hub.connected();
	const active = hub.active;
	const name = active.workspace?.name || active.baseUrl || "Flux";
	const ready = active.connection().state === "ready";
	return (
		<ui.menu label={`Workspace: ${name}${ready ? "" : " (offline)"}`} tooltip={ready ? `Workspace: ${name}` : `${name} can't be reached`} style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 24, minWidth: 0, maxWidth: "100%", paddingLeft: 4, paddingRight: 4, borderRadius: "control", color: "text2", backgroundColor: "transparent", transition: { duration: 100, colors: true }, hover: { backgroundColor: "hover", color: "text" }, checked: { backgroundColor: "hover", color: "text" } }}>
			<WorkspaceMark flux={active} size={16} />
			<ui.text style={{ fontSize: 13, minWidth: 0, color: "currentColor" }} maxLines={1}>{name}</ui.text>
			{/* Away, it says so; reachable, the mark is enough. */}
			{ready ? null : <ui.box style={{ width: 6, height: 6, flexShrink: 0, borderRadius: "full", backgroundColor: "amber" }} />}
			<ui.icon icon="chevron-down" style={{ width: 12, height: 12, flexShrink: 0, color: "text3" }} />
			{list.map((item) => {
				const connection = item.connection();
				const title = connection.workspace?.name || connection.baseUrl || item.url || "Not connected";
				return <ui.item key={item.id} {...workspaceMark(item)} checked={item.id === active.id} onClick={() => hub.use(item.id)}>{title}</ui.item>;
			})}
			<ui.separator />
			<ui.item icon="settings" href={SETTINGS}>Flux settings…</ui.item>
		</ui.menu>
	);
}

/** Flux's page of Settings, which connects another Flux and links projects. */
const SETTINGS = "swarm://settings/flux/flux";

function CantLoad({ flux }: { flux: Flux }) {
	const connection = flux.connection();
	return (
		<ui.box style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
			<IssuesArt />
			<ui.text style={{ marginTop: 32, fontSize: 20, lineHeight: "28px", fontWeight: 500, letterSpacing: -0.2, textAlign: "center" }}>{connection.state === "offline" ? "Can't reach Flux" : "Can't load Flux"}</ui.text>
			<ui.text style={{ marginTop: 6, fontSize: 14, color: "text2", textAlign: "center", maxWidth: 480 }} selectable>{connection.state === "offline" ? offline(connection.message, false) : connection.message}</ui.text>
			<ui.box style={{ flexDirection: "row", gap: 16, alignItems: "center", marginTop: 24 }}>
				<ui.button kind="secondary" onClick={() => void flux.resync().catch(() => {})}>Try again</ui.button>
				<ui.link label="Flux settings" href={SETTINGS} />
			</ui.box>
		</ui.box>
	);
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
				<ui.box style={{ padding: 16, borderRadius: "card", backgroundColor: "raised", border: "1px solid border" }}>
					<ConnectForm name="setup" target={refused ? flux.id : null} url={flux.url} />
				</ui.box>
			</ui.box>
		</ui.box>
	);
}

export function unstarted(flux: Flux, projectId?: string): Issue[] {
	const me = flux.me?.id ?? "";
	return flux.issues()
		.filter((issue) => (!projectId || issue.projectId === projectId) && !CLOSED_STATUSES.has(issue.status) && issue.status !== "review" && issue.threadIds.length === 0 && (issue.assigneeIds.length === 0 || issue.assigneeIds.includes(me)))
		.sort((left, right) => Number(right.assigneeIds.includes(me)) - Number(left.assigneeIds.includes(me)) || PRIORITY_LEVEL[right.priority] - PRIORITY_LEVEL[left.priority] || right.updatedAt.localeCompare(left.updatedAt))
		.slice(0, 5);
}
