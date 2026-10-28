// How the Flux page lays issues out: Flux's display options and the groups
// they produce. The board and the list both use this.
import type { Issue, IssuePatch, Label, Member, Project } from "./contract";
import { CLOSED_STATUSES, PRIORITIES, PRIORITY_LABELS, PRIORITY_LEVEL, STATUSES, STATUS_LABELS, type Priority, type Status } from "./flux";

export const LAYOUTS = ["list", "board"] as const;
export type Layout = (typeof LAYOUTS)[number];
export const GROUPINGS = ["status", "assignee", "priority", "label", "project", "none"] as const;
export type Grouping = (typeof GROUPINGS)[number];
export const GROUPING_LABELS: Record<Grouping, string> = {
	status: "Status",
	assignee: "Assignee",
	priority: "Priority",
	label: "Label",
	project: "Project",
	none: "No grouping",
};
export const ORDERINGS = ["manual", "priority", "dueDate", "created", "updated"] as const;
export type Ordering = (typeof ORDERINGS)[number];
export const ORDERING_LABELS: Record<Ordering, string> = {
	manual: "Manual",
	priority: "Priority",
	dueDate: "Due date",
	created: "Last created",
	updated: "Last updated",
};
export const PROPERTIES = ["id", "status", "priority", "assignee", "labels", "dueDate", "created", "agents", "updated"] as const;
export type Property = (typeof PROPERTIES)[number];
export const PROPERTY_LABELS: Record<Property, string> = {
	id: "ID",
	status: "Status",
	priority: "Priority",
	assignee: "Assignee",
	labels: "Labels",
	dueDate: "Due date",
	created: "Created",
	agents: "Agents",
	updated: "Updated",
};
export const SCOPES = ["mine", "active", "all"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<Scope, string> = { mine: "My issues", active: "Active", all: "All issues" };

export interface DisplayOptions {
	layout: Layout;
	grouping: Grouping;
	ordering: Ordering;
	properties: Property[];
	showClosed: boolean;
	showEmptyGroups: boolean;
	showSubIssues: boolean;
}

export const DEFAULT_DISPLAY: DisplayOptions = {
	layout: "board",
	grouping: "status",
	ordering: "priority",
	properties: [...PROPERTIES],
	showClosed: false,
	showEmptyGroups: false,
	showSubIssues: true,
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseDisplay(raw: unknown): DisplayOptions {
	const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const properties = Array.isArray(value.properties) ? PROPERTIES.filter((property) => (value.properties as unknown[]).includes(property)) : DEFAULT_DISPLAY.properties;
	const flag = (key: keyof DisplayOptions) => (typeof value[key] === "boolean" ? (value[key] as boolean) : (DEFAULT_DISPLAY[key] as boolean));
	return {
		layout: oneOf(value.layout, LAYOUTS, DEFAULT_DISPLAY.layout),
		grouping: oneOf(value.grouping, GROUPINGS, DEFAULT_DISPLAY.grouping),
		ordering: oneOf(value.ordering, ORDERINGS, DEFAULT_DISPLAY.ordering),
		properties: properties.length ? properties : [...PROPERTIES],
		showClosed: flag("showClosed"),
		showEmptyGroups: flag("showEmptyGroups"),
		showSubIssues: flag("showSubIssues"),
	};
}

export function shows(options: DisplayOptions, property: Property): boolean {
	return options.properties.includes(property);
}

export function effectiveGrouping(options: DisplayOptions, singleProject: boolean): Grouping {
	if (options.grouping === "project" && singleProject) return "status";
	if (options.layout === "board" && options.grouping === "none") return "status";
	return options.grouping;
}

export function matchesScope(issue: Issue, scope: Scope, me: string | undefined): boolean {
	if (scope === "mine") return !!me && issue.assigneeIds.includes(me);
	if (scope === "active") return issue.status === "progress" || issue.status === "review";
	return true;
}

export function matchesQuery(issue: Issue, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return issue.key.toLowerCase().includes(needle) || issue.title.toLowerCase().includes(needle);
}

function compareManual(left: Issue, right: Issue): number {
	return left.position - right.position || left.createdAt.localeCompare(right.createdAt);
}

export function sortIssues(issues: Issue[], ordering: Ordering): Issue[] {
	const next = [...issues];
	switch (ordering) {
		case "priority":
			next.sort((left, right) => PRIORITY_LEVEL[right.priority] - PRIORITY_LEVEL[left.priority] || compareManual(left, right));
			break;
		case "created":
			next.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || compareManual(left, right));
			break;
		case "updated":
			next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || compareManual(left, right));
			break;
		case "dueDate":
			next.sort((left, right) => (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31") || compareManual(left, right));
			break;
		default:
			next.sort(compareManual);
	}
	return next;
}

export type GroupKey =
	| { kind: "status"; status: Status }
	| { kind: "priority"; priority: Priority }
	| { kind: "assignee"; memberId: string | null }
	| { kind: "label"; labelId: string | null }
	| { kind: "project"; projectId: string }
	| { kind: "none" };

export interface IssueGroup {
	id: string;
	title: string;
	key: GroupKey;
	issues: Issue[];
}

function groupIdFor(grouping: Grouping, issue: Issue): string {
	switch (grouping) {
		case "status":
			return `status:${issue.status}`;
		case "priority":
			return `priority:${issue.priority}`;
		case "assignee":
			return `assignee:${issue.assigneeIds[0] ?? ""}`;
		case "label":
			return `label:${issue.labelIds[0] ?? ""}`;
		case "project":
			return `project:${issue.projectId}`;
		case "none":
			return "all";
	}
}

export function buildGroups(args: {
	issues: readonly Issue[];
	grouping: Grouping;
	ordering: Ordering;
	showEmptyGroups: boolean;
	showClosed: boolean;
	members: Member[];
	labels: Label[];
	projects: Project[];
	me?: string;
}): IssueGroup[] {
	const byGroup = new Map<string, Issue[]>();
	for (const issue of args.issues) {
		const id = groupIdFor(args.grouping, issue);
		const list = byGroup.get(id);
		if (list) list.push(issue);
		else byGroup.set(id, [issue]);
	}
	const groups: IssueGroup[] = [];
	const push = (id: string, title: string, key: GroupKey, always = false) => {
		const list = byGroup.get(id) ?? [];
		if (list.length === 0 && !args.showEmptyGroups && !always) return;
		groups.push({ id, title, key, issues: sortIssues(list, args.ordering) });
	};
	switch (args.grouping) {
		case "none":
			push("all", "Issues", { kind: "none" }, true);
			break;
		case "status":
			for (const status of STATUSES) {
				if (CLOSED_STATUSES.has(status) && !args.showClosed) continue;
				push(`status:${status}`, STATUS_LABELS[status], { kind: "status", status });
			}
			break;
		case "priority":
			for (const priority of PRIORITIES) push(`priority:${priority}`, PRIORITY_LABELS[priority], { kind: "priority", priority });
			break;
		case "assignee": {
			const members = [...args.members].sort((left, right) => (left.id === args.me ? -1 : right.id === args.me ? 1 : left.name.localeCompare(right.name)));
			for (const member of members) push(`assignee:${member.id}`, member.name, { kind: "assignee", memberId: member.id });
			push("assignee:", "No assignee", { kind: "assignee", memberId: null });
			break;
		}
		case "label": {
			for (const label of [...args.labels].sort((left, right) => left.name.localeCompare(right.name))) {
				push(`label:${label.id}`, label.name, { kind: "label", labelId: label.id });
			}
			push("label:", "No label", { kind: "label", labelId: null });
			break;
		}
		case "project":
			for (const project of args.projects) push(`project:${project.id}`, project.name, { kind: "project", projectId: project.id });
			break;
	}
	return groups;
}

export function patchForMove(issue: Issue, from: GroupKey, target: GroupKey): IssuePatch | null {
	switch (target.kind) {
		case "status":
			return issue.status === target.status ? null : { status: target.status };
		case "priority":
			return issue.priority === target.priority ? null : { priority: target.priority };
		case "assignee": {
			const source = from.kind === "assignee" ? from.memberId : null;
			if (source === target.memberId) return null;
			const kept = issue.assigneeIds.filter((id) => id !== source);
			if (target.memberId === null) return { assigneeIds: [] };
			return { assigneeIds: [target.memberId, ...kept.filter((id) => id !== target.memberId)] };
		}
		case "label": {
			const source = from.kind === "label" ? from.labelId : null;
			if (source === target.labelId) return null;
			const kept = issue.labelIds.filter((id) => id !== source);
			if (target.labelId === null) return { labelIds: [] };
			return { labelIds: [target.labelId, ...kept.filter((id) => id !== target.labelId)] };
		}
		case "project":
			return issue.projectId === target.projectId ? null : { projectId: target.projectId };
		case "none":
			return null;
	}
}

export function positionBetween(before: Issue | undefined, after: Issue | undefined): number {
	if (before && after) return (before.position + after.position) / 2;
	if (before) return before.position + 1;
	if (after) return after.position - 1;
	return 0;
}

export function draftForGroup(key: GroupKey): { status?: Status; priority?: Priority; assigneeIds?: string[]; labelIds?: string[]; projectId?: string } {
	switch (key.kind) {
		case "status":
			return { status: key.status };
		case "priority":
			return { priority: key.priority };
		case "assignee":
			return key.memberId ? { assigneeIds: [key.memberId] } : {};
		case "label":
			return key.labelId ? { labelIds: [key.labelId] } : {};
		case "project":
			return { projectId: key.projectId };
		case "none":
			return {};
	}
}

export function scopeOf(path: string): Scope {
	if (path === "mine" || path === "active") return path;
	return "all";
}
