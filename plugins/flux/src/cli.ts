// `swarm flux …`: what agents (and people) read and update Flux with, as
// bb's `bb flux` (its src/server/cli.ts), the same commands, options and
// output. Run from an agent's shell, a command knows its thread
// (io.thread): an issue's key defaults to the thread's issue, a comment is
// its agent's, and start attaches the thread.
import { call, command, type CommandIO } from "swarm";
import type { CommentAgent } from "./agent";
import { describe } from "./client";
import type { Issue, IssuePatch, Label } from "./contract";
import { CLOSED_STATUSES, COLORS, PRIORITIES, PRIORITY_LABELS, PRIORITY_LEVEL, STATUS_DISPLAY_ORDER, STATUS_LABELS, parsePriority, parseStatus, type ColorName, type Priority, type Status } from "./flux";
import { issueContext, memberName, type Lookup } from "./prompt";
import { FluxNotFoundError, FluxNotReadyError, type Flux } from "./service";

export class CliError extends Error {
	constructor(message: string, readonly hint = "") {
		super(message);
	}
}

const STATUS_GLYPH: Record<Status, string> = { backlog: "◌", todo: "○", progress: "◐", review: "◑", complete: "●", canceled: "⊘" };
const PRIORITY_GLYPH: Record<Priority, string> = { urgent: "!!", high: "▲", medium: "■", low: "▼", none: "·" };
const STATUS_VALUES = "backlog, todo, progress, review, complete, canceled (aliases: in_progress, in_review, done, …)";

const pad = (v: string, w: number) => {
	const n = [...v].length;
	return n >= w ? v : v + " ".repeat(w - n);
};
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// ---- Arguments ----

interface Spec {
	[name: string]: { type: "string" | "boolean" | "list"; short?: string; aliases?: string[] };
}

/** Parses argv by spec: --name value, --name=value, -s value, lists repeatable and comma-split. */
export function parse(argv: string[], spec: Spec) {
	const values: Record<string, string | boolean | string[] | undefined> = {};
	const positionals: string[] = [];
	const byName = new Map<string, string>();
	for (const [name, s] of Object.entries(spec)) {
		byName.set(`--${name}`, name);
		if (s.short) byName.set(`-${s.short}`, name);
		for (const a of s.aliases ?? []) byName.set(`--${a}`, name);
		if (s.type === "list") values[name] = [];
		if (s.type === "boolean") values[name] = false;
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--") {
			positionals.push(...argv.slice(i + 1));
			break;
		}
		if (!arg.startsWith("-") || arg === "-") {
			positionals.push(arg);
			continue;
		}
		let [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
		const name = byName.get(flag!);
		if (!name) throw new CliError(`unknown option ${flag}`, "Run swarm flux help for the commands and their options.");
		const s = spec[name]!;
		if (s.type === "boolean") {
			values[name] = inline === undefined ? true : inline !== "false";
			continue;
		}
		const value = inline ?? argv[++i];
		if (value === undefined) throw new CliError(`${flag} takes a value`);
		if (s.type === "list") (values[name] as string[]).push(...value.split(",").map((v) => v.trim()).filter(Boolean));
		else values[name] = value;
	}
	return { values, positionals };
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

// ---- The commands ----

export interface Context {
	thread: string;
	/** The Swarm project of the thread, "" for none. */
	project: string;
	agent: CommentAgent | null;
}

/** What a thread is, for its commands: its project, and its agent for comments. */
async function context(io: CommandIO): Promise<Context> {
	if (!io.thread) return { thread: "", project: "", agent: null };
	try {
		const d = await call("Thread", { thread: io.thread });
		const names: Record<string, string> = { claude: "Claude Code", cursor: "Cursor", grok: "Grok Build", fake: "Demo agent" };
		return {
			thread: io.thread,
			project: d.info.project,
			agent: { name: names[d.info.provider] ?? d.info.provider, provider: d.info.provider, threadId: io.thread },
		};
	} catch {
		return { thread: io.thread, project: "", agent: null };
	}
}

function statusOrThrow(v: string): Status {
	const s = parseStatus(v);
	if (!s) throw new CliError(`unknown status "${v}"`, `Use one of: ${STATUS_VALUES}.`);
	return s;
}

function priorityOrThrow(v: string): Priority {
	const p = parsePriority(v);
	if (!p) throw new CliError(`unknown priority "${v}"`, `Use one of: ${PRIORITIES.join(", ")}.`);
	return p;
}

export function issueLine(issue: Issue, names: Lookup): string {
	const assignees = issue.assigneeIds
		.map((id) => names.members.find((m) => m.id === id)?.username)
		.filter(Boolean)
		.map((u) => `@${u}`)
		.join(" ");
	const labels = issue.labelIds
		.map((id) => names.labels.find((l) => l.id === id)?.name)
		.filter(Boolean)
		.map((n) => `[${n}]`)
		.join(" ");
	const subs = issue.subIssueCount ? ` (${issue.subIssueDoneCount}/${issue.subIssueCount})` : "";
	const agents = issue.threadIds.length ? " ⚡" : "";
	return [pad(issue.key, 9), `${STATUS_GLYPH[issue.status]} ${pad(STATUS_LABELS[issue.status], 11)}`, pad(PRIORITY_GLYPH[issue.priority], 2), `${issue.title}${subs}${agents}`, assignees, labels].filter(Boolean).join("  ");
}

export const USAGE = `swarm flux — Read and update Flux issues

Issue keys look like ABC-12. Run from an agent's thread attached to an
issue, commands that take a key default to that issue.

Commands:
  swarm flux status             The Flux connection, workspace, and signed-in account
  swarm flux list               Issues, open ones first, grouped by status
  swarm flux show [ISSUE]       An issue with its description, sub-issues, and comments
  swarm flux create             Create an issue
  swarm flux update [ISSUE]     Change an issue's status, priority, assignees, labels, title, description, due date, or parent
  swarm flux comment [ISSUE]    Comment on an issue in Markdown; @username notifies people
  swarm flux start ISSUE        Attach this thread to an issue and move it to In Progress
  swarm flux detach [ISSUE]     Detach this thread from an issue
  swarm flux projects           Flux projects and the Swarm projects they're linked to
  swarm flux link KEY           Link a Flux project to this thread's Swarm project (--none to unlink)
  swarm flux labels [create NAME [--color C]]  Workspace labels, or make one
  swarm flux members            Workspace members and their @usernames
  swarm flux open [ISSUE]       Print an issue's link in Flux

Every command takes --json, and --flux NAME to use one connection.`;

export function registerCli(resolve: (name?: string) => Flux) {
	let picked: string | undefined;
	const flux: Flux = new Proxy({} as Flux, {
		get(_target, prop) {
			const current = resolve(picked);
			const value = Reflect.get(current, prop, current) as unknown;
			return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(current) : value;
		},
	});
	const json = (io: CommandIO, v: unknown) => io.print(JSON.stringify(v, null, 2));

	/** Runs a command, Flux's errors said as the command line's. */
	const guarded = (name: string, fn: (args: string[], io: CommandIO, ctx: Context) => Promise<void | number>) => {
		command(name, async (args, io) => {
			try {
				const taken = takeFlux(args);
				picked = taken.name;
				args = taken.args;
				const ctx = await context(io);
				if (name !== "status") await flux.whenReady();
				return await fn(args, io, ctx);
			} catch (e) {
				if (e instanceof CliError) {
					io.error(`Error: ${e.message}${e.hint ? `\n${e.hint}` : ""}`);
					return 2;
				}
				if (e instanceof FluxNotReadyError) io.error(`Error: ${e.message}\nSet Flux's URL and an API token in Settings, Plugins, Flux, then run swarm flux status.`);
				else if (e instanceof FluxNotFoundError) io.error(`Error: ${e.message}`);
				else io.error(`Error: ${describe(e)}`);
				return 1;
			} finally {
				picked = undefined;
			}
		});
	};

function takeFlux(args: string[]): { name?: string; args: string[] } {
	const rest: string[] = [];
	let name: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === "--flux" || arg === "--connection") {
			name = args[++i];
			if (!name) throw new CliError("--flux takes the connection's name");
			continue;
		}
		if (arg.startsWith("--flux=")) {
			name = arg.slice("--flux=".length);
			continue;
		}
		rest.push(arg);
	}
	return { name, args: rest };
}

	const lookup = (): Lookup => ({ baseUrl: flux.baseUrl, members: flux.memberList(), labels: flux.labels(), projects: flux.projects() });

	const issueFromArg = (ref: string | undefined, ctx: Context): Issue => {
		if (ref) return flux.requireIssue(ref);
		const attached = ctx.thread ? flux.issuesOfThread(ctx.thread) : [];
		if (attached.length === 1) return attached[0]!;
		throw new CliError(attached.length > 1 ? `this thread is attached to ${attached.map((i) => i.key).join(", ")}; say which one` : "missing issue key", "Pass an issue key such as ABC-12.");
	};

	const projectFromOption = (v: string | undefined, ctx: Context) => {
		if (v) {
			const p = flux.findProject(v);
			if (!p) throw new CliError(`no Flux project "${v}"`, "Run `swarm flux projects` to list project keys.");
			return p;
		}
		return ctx.project ? flux.projectOfSwarm(ctx.project) : null;
	};

	const memberIds = (values: string[]) =>
		values.map((v) => {
			if (v.toLowerCase() === "none") return "";
			const m = flux.findMember(v);
			if (!m) throw new CliError(`no workspace member "${v}"`, "Run `swarm flux members` for usernames; `me` means you.");
			return m.id;
		});

	const labelIds = (values: string[], hint = "Run `swarm flux labels` to list labels.") =>
		values.map((v) => {
			const l = flux.findLabel(v);
			if (!l) throw new CliError(`no label "${v}"`, hint);
			return l.id;
		});

	const addedLabelIds = async (values: string[], create: boolean) => {
		if (!create) return { ids: labelIds(values, "Run `swarm flux labels` to list labels, or add --create-labels to create it."), created: [] as Label[] };
		const ids: string[] = [];
		const created: Label[] = [];
		for (const v of values) {
			let l = flux.findLabel(v);
			if (!l) {
				l = await flux.createLabel(v);
				created.push(l);
			}
			ids.push(l.id);
		}
		return { ids, created };
	};
	const createdLine = (created: Label[]) => (created.length ? [`Created ${created.length === 1 ? "label" : "labels"} ${created.map((l) => l.name).join(", ")}.`] : []);

	command("help", (_a, io) => io.print(USAGE));

	guarded("status", async (args, io) => {
		const c = flux.connection();
		if (args.includes("--json")) return json(io, c);
		const lines = [`Flux: ${c.state}${c.message ? ` — ${c.message}` : ""}`];
		if (c.baseUrl) lines.push(`Server: ${c.baseUrl}`);
		if (c.workspace) lines.push(`Workspace: ${c.workspace.name}`);
		if (c.me) lines.push(`Signed in as: ${c.me.name} (@${c.me.username})`);
		lines.push(`Issues synced: ${c.issueCount}`);
		io.print(lines.join("\n"));
	});

	guarded("list", async (args, io, ctx) => {
		const { values: o } = parse(args, {
			project: { type: "string" },
			status: { type: "list" },
			assignee: { type: "list", aliases: ["assigned"] },
			label: { type: "list" },
			priority: { type: "list" },
			search: { type: "string", short: "q", aliases: ["query"] },
			all: { type: "boolean" },
			"all-projects": { type: "boolean" },
			limit: { type: "string" },
			json: { type: "boolean" },
		});
		const project = o["all-projects"] ? null : projectFromOption(str(o.project), ctx);
		const statuses = new Set(list(o.status).map(statusOrThrow));
		const priorities = new Set(list(o.priority).map(priorityOrThrow));
		const assignees = new Set(memberIds(list(o.assignee)));
		const labels = labelIds(list(o.label));
		const needle = str(o.search)?.trim().toLowerCase();
		const limit = Math.min(Math.max(Number(str(o.limit) ?? 50) || 50, 1), 500);
		let issues = flux.issues().filter((i) => {
			if (project && i.projectId !== project.id) return false;
			if (statuses.size > 0) {
				if (!statuses.has(i.status)) return false;
			} else if (!o.all && CLOSED_STATUSES.has(i.status)) return false;
			if (priorities.size > 0 && !priorities.has(i.priority)) return false;
			if (assignees.size > 0) {
				const unassigned = assignees.has("") && i.assigneeIds.length === 0;
				if (!unassigned && !i.assigneeIds.some((id) => assignees.has(id))) return false;
			}
			if (labels.some((id) => !i.labelIds.includes(id))) return false;
			if (needle && !i.key.toLowerCase().includes(needle) && !i.title.toLowerCase().includes(needle)) return false;
			return true;
		});
		issues.sort((a, b) => STATUS_DISPLAY_ORDER.indexOf(a.status) - STATUS_DISPLAY_ORDER.indexOf(b.status) || PRIORITY_LEVEL[b.priority] - PRIORITY_LEVEL[a.priority] || b.updatedAt.localeCompare(a.updatedAt));
		const total = issues.length;
		issues = issues.slice(0, limit);
		if (o.json) return json(io, { issues, total, project: project?.key ?? null });
		if (total === 0) return io.print(project ? `No matching issues in ${project.key}.${o.all ? "" : " Add --all to include closed ones."}` : "No matching issues.");
		const names = lookup();
		const lines = [project ? `${project.name} (${project.key})` : "All projects", "", ...issues.map((i) => issueLine(i, names))];
		if (total > issues.length) lines.push("", `…and ${total - issues.length} more. Raise --limit or narrow the filters.`);
		io.print(lines.join("\n"));
	});

	guarded("show", async (args, io, ctx) => {
		const { values: o, positionals } = parse(args, { json: { type: "boolean" } });
		const issue = issueFromArg(positionals[0], ctx);
		const detail = flux.detail(issue.id);
		if (o.json) return json(io, detail);
		io.print(issueContext(detail, lookup()) + (issue.threadIds.length ? `\n\nSwarm threads: ${issue.threadIds.join(", ")}` : ""));
	});

	guarded("create", async (args, io, ctx) => {
		const { values: o } = parse(args, {
			title: { type: "string", short: "t" },
			project: { type: "string" },
			description: { type: "string", short: "d", aliases: ["body"] },
			status: { type: "string" },
			priority: { type: "string" },
			assignee: { type: "list", aliases: ["assign", "assignees"] },
			label: { type: "list" },
			"create-labels": { type: "boolean", aliases: ["create-label"] },
			parent: { type: "string" },
			json: { type: "boolean" },
		});
		const title = str(o.title)?.trim();
		if (!title) throw new CliError("--title is required", 'swarm flux create --title "…" [--project KEY]');
		if (o["create-labels"] && list(o.label).length === 0) throw new CliError("--create-labels needs --label");
		const parent = str(o.parent) ? flux.requireIssue(str(o.parent)!) : null;
		const project = projectFromOption(str(o.project), ctx) ?? (parent ? flux.projects().find((p) => p.id === parent.projectId) ?? null : null);
		if (!project) throw new CliError("which project?", "Add --project <KEY>. `swarm flux projects` lists them; `swarm flux link KEY` makes one this Swarm project's default.");
		const status = str(o.status) ? statusOrThrow(str(o.status)!) : undefined;
		const priority = str(o.priority) ? priorityOrThrow(str(o.priority)!) : undefined;
		const assigneeIds = memberIds(list(o.assignee)).filter(Boolean);
		const labels = await addedLabelIds(list(o.label), !!o["create-labels"]);
		const issue = await flux.createIssue({ projectId: project.id, title, descriptionMarkdown: str(o.description), status, priority, assigneeIds, labelIds: labels.ids, parentId: parent?.id ?? null });
		if (o.json) return json(io, issue);
		io.print([...createdLine(labels.created), `Created ${issue.key} · ${issue.title}`, flux.issueUrl(issue)].join("\n"));
	});

	guarded("update", async (args, io, ctx) => {
		const { values: o, positionals } = parse(args, {
			status: { type: "string", short: "s" },
			priority: { type: "string", short: "p" },
			title: { type: "string" },
			description: { type: "string", short: "d" },
			assign: { type: "list", aliases: ["assignee", "add-assignee"] },
			unassign: { type: "list", aliases: ["remove-assignee"] },
			"add-label": { type: "list", aliases: ["label"] },
			"create-labels": { type: "boolean", aliases: ["create-label"] },
			"remove-label": { type: "list" },
			due: { type: "string" },
			parent: { type: "string" },
			json: { type: "boolean" },
		});
		const issue = issueFromArg(positionals[0], ctx);
		const patch: IssuePatch = {};
		const desc = str(o.description);
		if (str(o.status)) patch.status = statusOrThrow(str(o.status)!);
		if (str(o.priority)) patch.priority = priorityOrThrow(str(o.priority)!);
		if (str(o.title)) patch.title = str(o.title)!.trim();
		if (list(o.assign).length || list(o.unassign).length) {
			const clearAll = list(o.unassign).some((v) => v.toLowerCase() === "all");
			const removed = new Set(memberIds(list(o.unassign).filter((v) => v.toLowerCase() !== "all")));
			patch.assigneeIds = [...(clearAll ? [] : issue.assigneeIds.filter((id) => !removed.has(id))), ...memberIds(list(o.assign)).filter(Boolean)];
		}
		const due = str(o.due);
		if (due) {
			if (due.toLowerCase() === "none") patch.dueDate = null;
			else if (/^\d{4}-\d{2}-\d{2}$/.test(due)) patch.dueDate = due;
			else throw new CliError(`invalid due date "${due}"`, "Use YYYY-MM-DD or `none`.");
		}
		if (str(o.parent)) patch.parentId = str(o.parent)!.toLowerCase() === "none" ? null : flux.requireIssue(str(o.parent)!).id;
		let created: Label[] = [];
		if (list(o["add-label"]).length || list(o["remove-label"]).length) {
			const removed = new Set(labelIds(list(o["remove-label"])));
			const added = await addedLabelIds(list(o["add-label"]), !!o["create-labels"]);
			created = added.created;
			patch.labelIds = [...issue.labelIds.filter((id) => !removed.has(id)), ...added.ids];
		}
		if (Object.keys(patch).length === 0 && desc === undefined) {
			throw new CliError("nothing to change", "Give --status, --priority, --title, --description, --assign, --unassign, --add-label, --remove-label, --due or --parent.");
		}
		if (desc !== undefined) await flux.replaceDescription(issue.id, desc);
		const updated = Object.keys(patch).length ? await flux.updateIssue(issue.id, patch) : flux.issue(issue.id)!;
		if (o.json) return json(io, updated);
		const names = lookup();
		const changes = [
			desc !== undefined && "description",
			patch.status && `status → ${STATUS_LABELS[updated.status]}`,
			patch.priority && `priority → ${PRIORITY_LABELS[updated.priority]}`,
			patch.title && `title → ${updated.title}`,
			patch.assigneeIds && `assignees → ${updated.assigneeIds.length ? updated.assigneeIds.map((id) => memberName(names, id)).join(", ") : "none"}`,
			patch.labelIds && `labels → ${updated.labelIds.map((id) => flux.labels().find((l) => l.id === id)?.name).filter(Boolean).join(", ") || "none"}`,
			patch.dueDate !== undefined && `due → ${updated.dueDate ?? "none"}`,
			patch.parentId !== undefined && `parent → ${updated.parentId ? flux.issue(updated.parentId)?.key : "none"}`,
		].filter(Boolean);
		io.print([...createdLine(created), `Updated ${updated.key}: ${changes.join("; ")}`].join("\n"));
	});

	guarded("comment", async (args, io, ctx) => {
		const { values: o, positionals } = parse(args, { body: { type: "string", short: "b", aliases: ["message", "text"] }, m: { type: "string" }, json: { type: "boolean" } });
		const issue = issueFromArg(positionals[0], ctx);
		const body = str(o.body) ?? str(o.m) ?? "";
		if (!body.trim()) throw new CliError("comment body is empty", 'swarm flux comment ABC-12 --body "…"');
		const comment = await flux.addComment(issue.id, body, ctx.agent);
		if (o.json) return json(io, comment);
		io.print(`Commented on ${issue.key} (${comment.markdown.length} characters). ${flux.issueUrl(issue)}`);
	});

	guarded("start", async (args, io, ctx) => {
		const { values: o, positionals } = parse(args, { "keep-status": { type: "boolean" }, json: { type: "boolean" } });
		if (!ctx.thread) throw new CliError("not running in a Swarm thread", "Run this from an agent's thread, or attach from the thread's Flux panel.");
		if (!positionals[0]) throw new CliError("missing issue key", "Pass an issue key such as ABC-12.");
		const issue = flux.requireIssue(positionals[0]);
		const updated = await flux.attach(issue.id, ctx.thread, !o["keep-status"]);
		if (o.json) return json(io, updated);
		io.print(`Attached this thread to ${updated.key} (${STATUS_LABELS[updated.status]}). Run \`swarm flux show\` to read it.`);
	});

	guarded("detach", async (args, io, ctx) => {
		const { values: o, positionals } = parse(args, { thread: { type: "string" } });
		const thread = str(o.thread) ?? ctx.thread;
		if (!thread) throw new CliError("which thread?", "Run this from the thread, or pass --thread ID.");
		const issue = positionals[0] ? flux.requireIssue(positionals[0]) : issueFromArg(undefined, { ...ctx, thread });
		flux.detach(issue.id, thread);
		io.print(`Detached ${thread} from ${issue.key}.`);
	});

	guarded("projects", async (args, io) => {
		const projects = flux.projects();
		if (args.includes("--json")) return json(io, { projects });
		const issues = flux.issues();
		io.print(
			projects
				.map((p) => {
					const open = issues.filter((i) => i.projectId === p.id && !CLOSED_STATUSES.has(i.status)).length;
					return `${pad(p.key, 6)} ${pad(p.name, 28)} ${pad(`${open} open`, 9)} ${p.swarmProjectId ? `→ ${p.swarmProjectId}` : ""}`.trimEnd();
				})
				.join("\n") || "No projects.",
		);
	});

	guarded("link", async (args, io, ctx) => {
		const { values: o, positionals } = parse(args, { project: { type: "string" }, none: { type: "boolean" } });
		const p = positionals[0] ? flux.findProject(positionals[0]) : null;
		if (!p) throw new CliError(positionals[0] ? `no Flux project "${positionals[0]}"` : "which Flux project?", "Run `swarm flux projects` to list project keys.");
		if (o.none) {
			flux.link(p.id, null);
			return io.print(`Unlinked ${p.key}.`);
		}
		const swarmProject = str(o.project) ?? ctx.project;
		if (!swarmProject) throw new CliError("which Swarm project?", "Run this from a thread of the project, or pass --project ID.");
		flux.link(p.id, swarmProject);
		io.print(`Linked ${p.key} to ${swarmProject}.`);
	});

	guarded("labels", async (args, io) => {
		const { values: o, positionals } = parse(args, { color: { type: "string" }, json: { type: "boolean" } });
		if (positionals[0] === "create" || positionals[0] === "new" || positionals[0] === "add") {
			const name = positionals.slice(1).join(" ").trim();
			if (!name) throw new CliError("label name is empty");
			if (name.includes(",")) throw new CliError(`label name "${name}" has a comma`, "--label splits on commas, so it couldn't name this label.");
			const color = str(o.color);
			if (color && !(COLORS as readonly string[]).includes(color)) throw new CliError(`unknown color "${color}"`, `Use one of: ${COLORS.join(", ")}.`);
			const existing = flux.findLabel(name);
			const label = existing ?? (await flux.createLabel(name, color as ColorName | undefined));
			if (o.json) return json(io, { label, created: !existing });
			return io.print(existing ? `Label ${label.name} already exists (${label.color}).` : `Created label ${label.name} (${label.color}).`);
		}
		const labels = flux.labels();
		if (o.json) return json(io, { labels });
		io.print(labels.length ? labels.map((l) => l.name).join("\n") : "No labels.");
	});

	guarded("members", async (args, io) => {
		const members = flux.memberList();
		if (args.includes("--json")) return json(io, { members });
		io.print(members.map((m) => `${pad(`@${m.username}`, 20)} ${m.name}${m.id === flux.me?.id ? " (you)" : ""}`).join("\n"));
	});

	guarded("open", async (args, io, ctx) => {
		const issue = issueFromArg(args.find((a) => !a.startsWith("-")), ctx);
		io.print(flux.issueUrl(issue));
	});
}
