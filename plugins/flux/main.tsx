// Flux: issues from a Flux tracker in Swarm, ported from bb's Flux plugin
// (SWARM-132). Agents read and update issues with `swarm flux …` (its
// skill tells them how) and see an issue's images with its tool; a thread
// attached to an issue is told to keep it current; each thread has a Flux
// panel to attach one, see it and move it along; ::flux{key="ABC-12"} in
// a reply shows an issue's card.
import swarm, { call, hook, on, settings, tool, ui, type Child } from "swarm";
import { imageOf } from "./src/pictures";
import { DuePicker } from "./src/due";
import { Confirm } from "./src/confirm";
import { Palette } from "./src/palette";
import { registerCli } from "./src/cli";
import type { Issue } from "./src/contract";
import { CommentEditor, DescriptionEditor, StartAgentDialog } from "./src/edit";
import { CLOSED_STATUSES, PRIORITY_LEVEL, STATUS_LABELS, type Status } from "./src/flux";
import { watchMergeRequests } from "./src/follow";
import { hub } from "./src/hub";
import { issueImages } from "./src/images";
import { FluxPage, NewIssue, navItems, syncNav, unstarted } from "./src/page";
import { threadInstructions } from "./src/prompt";
import { FluxSettings, refreshProjects } from "./src/settings";
import { setThreads, threadInfo } from "./src/threads";
import type { Flux } from "./src/service";
import { Avatar, IssueView, PriorityIcon, ProjectMark, StatusIcon, colorOf, tickTask } from "./src/view";

// The page and the commands use whichever Flux is active.
const flux = new Proxy({} as Flux, {
	get(_target, prop) {
		const current = hub.active;
		const value = Reflect.get(current, prop, current) as unknown;
		return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(current) : value;
	},
});

const TONE: Record<Status, "muted" | "faint" | "accent" | "amber" | "green" | "violet"> = {
	backlog: "faint",
	todo: "muted",
	progress: "accent",
	review: "violet",
	complete: "green",
	canceled: "faint",
};

/** Threads told of their issue since it was attached, by thread and issue. */
const told = new Set<string>();

function badges() {
	const links = flux.issues().flatMap((i) => i.threadIds.map((t) => [t, i] as const));
	const seen = new Set<string>();
	for (const [thread, issue] of links) {
		if (seen.has(thread)) continue;
		seen.add(thread);
		ui.badge(thread, { text: issue.key, tone: TONE[issue.status] === "faint" ? "muted" : TONE[issue.status], tooltip: `${issue.key} · ${issue.title} (${STATUS_LABELS[issue.status]})` });
	}
	for (const t of shownBadges) if (!seen.has(t)) ui.badge(t, null);
	shownBadges = seen;
}
let shownBadges = new Set<string>();

function connect() {
	hub.fromSettings();
}

/** Threads' titles, and whether their agents are working now, as the core last said. */
async function refreshWorking() {
	try {
		if (setThreads(await call("Threads", {}))) ui.update();
	} catch {
		// Not granted the read scope: no Working chip.
	}
}


/** The issue each thread's panel shows, when the user went to another (a parent, a sub-issue). */
const viewing = new Map<string, string>();

/** An issue as bb's panel shows it, in Swarm's look. */
function issueView(issue: Issue, thread?: string): Child {
	const d = flux.detail(issue.id);
	const project = flux.projects().find((p) => p.id === issue.projectId);
	return (
		<IssueView
			key={issue.id}
			detail={d}
			project={project}
			members={flux.memberList()}
			labels={flux.labels()}
			me={flux.me?.id}
			url={flux.issueUrl(issue)}
			working={issue.threadIds.some((t) => threadInfo(t)?.working)}
			edits={{ update: (patch) => flux.updateIssue(issue.id, patch) }}
			onTask={(n, done) => flux.replaceDescription(issue.id, tickTask(d.descriptionMarkdown, n, done))}
			detach={thread && issue.threadIds.includes(thread) ? () => flux.detach(issue.id, thread) : undefined}
			start={thread && !issue.threadIds.includes(thread) ? async () => void (await flux.attach(issue.id, thread, true)) : undefined}
			open={thread ? (other) => void viewing.set(thread, other.id) : undefined}
			image={imageOf}
			description={<DescriptionEditor flux={flux} issue={issue} markdown={d.descriptionMarkdown} html={d.descriptionHtml} image={imageOf} />}
			comment={<CommentEditor flux={flux} issue={issue} image={imageOf} />}
		/>
	);
}

/** An issue as a card in a reply: its project, key and status, its title, and its properties as chips. */
function issueCard(issue: Issue): Child {
	const members = flux.memberList();
	const project = flux.projects().find((p) => p.id === issue.projectId);
	const parent = issue.parentId ? flux.issue(issue.parentId) : undefined;
	const labels = flux.labels().filter((label) => issue.labelIds.includes(label.id));
	const chip = { flexDirection: "row", gap: 4, alignItems: "center", height: 22, paddingLeft: 6, paddingRight: 6, borderRadius: "control", border: "1px solid border" } as const;
	return (
		<ui.box key={issue.id} label={`${issue.key} ${issue.title}`} onClick={() => ui.navTo("flux", `issues/${encodeURIComponent(issue.key)}`)} style={{ padding: "10px 12px", gap: 4, borderRadius: "card", backgroundColor: "raised", border: "1px solid border", maxWidth: 512 }}>
			<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
				<ProjectMark project={project} size={13} />
				{parent ? <ui.text style={{ fontSize: 11, color: "text3" }}>{`${parent.key} ›`}</ui.text> : null}
				<ui.text style={{ fontSize: 11, color: "text3", flex: 1 }}>{issue.key}</ui.text>
				<StatusIcon status={issue.status} size={12} />
				<ui.text style={{ fontSize: 12, color: "text2" }}>{STATUS_LABELS[issue.status]}</ui.text>
			</ui.box>
			<ui.text style={{ fontSize: 14, fontWeight: 500 }} maxLines={2}>{issue.title}</ui.text>
			<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
				<ui.box style={{ ...chip, width: 22, paddingLeft: 0, paddingRight: 0, justifyContent: "center" }}><PriorityIcon priority={issue.priority} size={12} /></ui.box>
				{issue.dueDate ? <ui.box style={chip}><ui.icon icon="calendar" style={{ width: 11, height: 11, color: "text2" }} /><ui.text style={{ fontSize: 12 }}>{issue.dueDate}</ui.text></ui.box> : null}
				{issue.subIssueCount > 0 ? <ui.box style={chip}><ui.text style={{ fontSize: 12 }}>{`${issue.subIssueDoneCount}/${issue.subIssueCount}`}</ui.text></ui.box> : null}
				{labels.map((label) => <ui.box key={label.id} style={chip}><ui.box style={{ width: 6, height: 6, borderRadius: "full", backgroundColor: colorOf[label.color] ?? "text3" }} /><ui.text style={{ fontSize: 12 }}>{label.name}</ui.text></ui.box>)}
				{issue.threadIds.length > 0 ? <ui.box style={chip}><ui.icon icon="bot" style={{ width: 11, height: 11, color: "text2" }} /><ui.text style={{ fontSize: 12 }}>{issue.threadIds.length === 1 ? "Agent" : `${issue.threadIds.length} agents`}</ui.text></ui.box> : null}
				<ui.box style={{ flex: 1 }} />
				{issue.assigneeIds.map((id) => <Avatar key={id} member={members.find((m) => m.id === id)} size={20} />)}
			</ui.box>
		</ui.box>
	);
}

export function activate() {
	hub.onChange = () => {
		badges();
		syncNav(flux);
		ui.update();
		void refreshWorking();
	};
	watchMergeRequests(hub);
	setInterval(() => void refreshWorking(), 5000);
	connect();
	settings.onChange(connect);
	registerCli((name) => hub.get(name));

	tool<{ issue: string; images?: number[] }>("issue_images", (params) => issueImages(flux, params));

	// A thread attached to an issue is told to keep it current, with its
	// next message after it's attached.
	hook("message", ({ thread }) => {
		const issues = flux.issuesOfThread(thread);
		const fresh = issues.filter((i) => !told.has(`${thread} ${i.id}`));
		if (fresh.length === 0) return;
		for (const i of fresh) told.add(`${thread} ${i.id}`);
		return { context: fresh.map((i) => threadInstructions(i.key)).join("\n\n") };
	});
	// Its threads gone, their links go too.
	on("event", (e) => {
		if (e.type === "project.added" || e.type === "project.renamed" || e.type === "project.removed") refreshProjects();
		if (e.type !== "thread.deleted" || !e.thread) return;
		for (const i of flux.issuesOfThread(e.thread)) flux.detach(i.id, e.thread);
	});

	// ::flux{key="ABC-12"}: an issue's card in a reply.
	ui.shareIcon({ id: "mark", path: "icon.svg" });
	// Its page of Settings: the Fluxes it's connected to, and where their agents work.
	ui.page({ id: "flux", title: "Flux", icon: "flux:mark", render: () => <FluxSettings /> });
	ui.nav({
		id: "flux",
		title: "Flux",
		icon: "flux:mark",
		fill: true,
		search: "Find a view",
		items: navItems(flux),
		render: ({ args }) => <FluxPage path={args.path ?? ""} slot={args.slot ?? ""} image={imageOf} />,
	});
	syncNav(flux);

	ui.overlay({ id: "flux-palette", width: 480, bare: true, render: () => <Palette /> });
	ui.overlay({ id: "flux-confirm", width: 400, bare: true, render: () => <Confirm /> });
	ui.overlay({ id: "flux-due", title: "Due date", width: 300, bare: true, render: () => <DuePicker /> });
	ui.overlay({ id: "flux-start", title: "Start an agent", width: 720, bare: true, render: () => <StartAgentDialog flux={flux} /> });

	ui.overlay({
		id: "flux-new",
		title: "New issue",
		width: 672,
		bare: true,
		render: () => <NewIssue flux={flux} />,
	});

	ui.header({
		id: "flux-issue",
		render: ({ thread }) => {
			const issue = thread ? flux.issuesOfThread(thread)[0] : undefined;
			if (!issue) return null;
			return (
				<ui.pressable label={`Flux issue ${issue.key}, ${STATUS_LABELS[issue.status]}`} tooltip={`${issue.key} · ${issue.title} (${STATUS_LABELS[issue.status]})`} href="swarm://panel/flux/flux" style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 26, maxWidth: 240, paddingLeft: 8, paddingRight: 8, borderRadius: "control", border: "1px solid border", hover: { backgroundColor: "hover" } }}>
					<StatusIcon status={issue.status} size={12} />
					<ui.text style={{ fontSize: 12, fontWeight: 500, color: "text2", flexShrink: 0 }}>{issue.key}</ui.text>
					<ui.text style={{ fontSize: 12, color: "text2", maxWidth: 144, minWidth: 0 }} maxLines={1}>{issue.title}</ui.text>
				</ui.pressable>
			);
		},
	});

	ui.home({
		id: "flux-open",
		title: "Flux issues",
		icon: "flux:mark",
		// Open issues nobody's agent has started, yours first, one click from the prompt; the form's project's, where it's linked to one.
		render: (context) => {
			if (flux.projects().length === 0) {
				return (
					<ui.pressable label="Connect Flux" onClick={() => ui.navTo("flux", "")} style={{ alignSelf: "flex-start", color: "text2", hover: { color: "text" } }}>
						<ui.text style={{ fontSize: 14, color: "currentColor" }}>Connect Flux to pick up issues from here →</ui.text>
					</ui.pressable>
				);
			}
			const linked = context.args.project ? flux.projectOfSwarm(context.args.project) : null;
			const open = unstarted(flux, linked?.id);
			const me = flux.me?.id;
			if (open.length === 0) {
				return (
					<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
						<ui.text style={{ fontSize: 14, color: "text2" }}>{`Nothing waiting${linked ? ` in ${linked.name}` : ""}.`}</ui.text>
						<ui.link label="Browse Flux" href={linked ? `swarm://plugin/flux/p/${linked.key}` : "swarm://plugin/flux"} />
					</ui.box>
				);
			}
			return (
				<ui.box style={{ gap: 0, marginLeft: -4, marginRight: -4 }}>
					{open.map((issue) => (
						<ui.pressable
							key={issue.id}
							label={`${issue.key} ${issue.title}`}
							tooltip="Add to the prompt"
							// As bb's: the issue as a mention after what's typed, and how the thread tracks it.
							onClick={() => ui.prefill({ append: true, prompt: `Work on @flux-issues:${issue.key} (${issue.title}). Run \`swarm flux start ${issue.key}\` first so the issue tracks this thread.` })}
							style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 32, paddingLeft: 4, paddingRight: 4, borderRadius: "control", transition: { duration: 100, colors: true }, hover: { backgroundColor: "hover" } }}
						>
							<PriorityIcon priority={issue.priority} size={14} />
							<StatusIcon status={issue.status} size={14} />
							<ui.text style={{ fontSize: 12, color: "text2", flexShrink: 0, minWidth: 56 }}>{issue.key}</ui.text>
							<ui.text style={{ fontSize: 14, flex: 1, minWidth: 0 }} maxLines={1}>{issue.title}</ui.text>
							<ui.text style={{ fontSize: 12, color: "text2", flexShrink: 0 }}>{me && issue.assigneeIds.includes(me) ? "Yours" : "Unassigned"}</ui.text>
							<ui.icon icon="external" style={{ width: 14, height: 14, color: "text2", flexShrink: 0, opacity: 0, transition: { duration: 100 }, groupHover: { opacity: 1 } }} />
						</ui.pressable>
					))}
				</ui.box>
			);
		},
	});

	try {
		swarm.mentions.provide({
			id: "flux-issues",
			label: "Flux issues",
			search: (query) => {
				const needle = query.trim().toLowerCase();
				return flux.issues()
					.filter((issue) => !needle || issue.key.toLowerCase().includes(needle) || issue.title.toLowerCase().includes(needle))
					.slice(0, 8)
					.map((issue) => ({ id: issue.key, title: `${issue.key} ${issue.title}`, subtitle: STATUS_LABELS[issue.status] }));
			},
			resolve: (id) => {
				const issue = flux.findIssue(id);
				if (!issue) return null;
				return { context: `Flux issue ${issue.key}: ${issue.title} (${STATUS_LABELS[issue.status]}).` };
			},
		});
	} catch {
		// Mentions stay off until the grant is there. The rest of Flux still runs.
	}

	ui.directive({
		name: "flux",
		render: ({ args }) => {
			const issue = args.key ? flux.findIssue(args.key) : null;
			return issue ? issueCard(issue) : <ui.text tone="faint">{`No Flux issue ${args.key ?? ""}.`}</ui.text>;
		},
	});

	// Each thread's Flux panel: its issue, or one to attach.
	let search = "";
	ui.panel({
		id: "flux",
		title: "Flux issue",
		icon: "list",
		render: ({ thread }) => {
			const c = flux.connection();
			if (c.state === "unconfigured" || c.state === "unauthorized" || (c.state !== "ready" && c.issueCount === 0)) {
				return (
					<ui.column gap="s3" padding="s4">
						<ui.text weight={600}>Flux</ui.text>
						{c.state !== "unconfigured" && <ui.text tone="muted">{c.message || `Flux is ${c.state}.`}</ui.text>}
						{(c.state === "unconfigured" || c.state === "unauthorized") && <ui.text tone="faint">Set Flux's URL and an API token (Flux: Settings, API tokens) in Settings, Plugins, Flux.</ui.text>}
						{(c.state === "unconfigured" || c.state === "unauthorized") && <ui.link label="Open Flux settings" href="swarm://settings/flux/flux" />}
					</ui.column>
				);
			}
			const attached = flux.issuesOfThread(thread);
			const shown = viewing.has(thread) ? flux.issue(viewing.get(thread)!) : null;
			const needle = search.trim().toLowerCase();
			const me = flux.me?.id ?? "";
			const open = flux
				.issues()
				.filter((i) => !CLOSED_STATUSES.has(i.status) && !attached.some((a) => a.id === i.id))
				.filter((i) => !needle || i.key.toLowerCase().includes(needle) || i.title.toLowerCase().includes(needle))
				.sort((a, b) => Number(b.assigneeIds.includes(me)) - Number(a.assigneeIds.includes(me)) || PRIORITY_LEVEL[b.priority] - PRIORITY_LEVEL[a.priority] || b.updatedAt.localeCompare(a.updatedAt))
				.slice(0, 30);
			return (
				<ui.scroll style={{ flex: 1 }}>
					<ui.box style={{ padding: "s6 s6 s8 s6", gap: 16 }}>
						{c.state !== "ready" && (
							<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", padding: "s3 s4", borderRadius: "control", backgroundColor: "amberSoft" }}>
								<ui.icon icon="alert" style={{ color: "amber", width: 13, height: 13 }} />
								<ui.text style={{ fontSize: "small", flex: 1 }}>{c.message || `Flux is ${c.state}: what shows is as it was.`}</ui.text>
							</ui.box>
						)}
						{shown ? (
							<ui.box style={{ gap: 12 }}>
								<ui.pressable label="Back" onClick={() => void viewing.delete(thread)} style={{ flexDirection: "row", gap: 5, alignItems: "center", alignSelf: "flex-start", color: "text2", hover: { color: "text" } }}>
									<ui.icon icon="chevron-right" style={{ width: 12, height: 12, transform: "rotate(180deg)" }} />
									<ui.text style={{ fontSize: "small" }}>{attached.length ? "Back to " + attached[0]!.key : "Back"}</ui.text>
								</ui.pressable>
								{issueView(shown, thread)}
							</ui.box>
						) : (
							attached.map((i) => issueView(i, thread))
						)}
						{attached.length || shown ? null : (
							<ui.box style={{ gap: 10 }}>
								<ui.box style={{ gap: 2 }}>
									<ui.text style={{ fontSize: 13, fontWeight: 500 }}>Attach a Flux issue</ui.text>
									<ui.text style={{ fontSize: 12, color: "text2" }}>The agent in this thread will report progress to it.</ui.text>
								</ui.box>
								<ui.field key="search" value={search} placeholder="Search issues" onChange={(v) => void (search = v)} />
								<ui.list
									key="issues"
									count={open.length}
									rowHeight={36}
									rowKey={(n) => open[n]!.id}
									row={(n) => {
										const i = open[n]!;
										return (
											<ui.pressable label={`Attach ${i.key} ${i.title}`} onClick={() => void flux.attach(i.id, thread, false).then(() => ui.toast(`Attached to ${i.key}.`), (e: unknown) => ui.toast(`Couldn't attach ${i.key}: ${e instanceof Error ? e.message : String(e)}`))} style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 36, paddingLeft: 8, paddingRight: 8, borderRadius: "control", hover: { backgroundColor: "hover" } }}>
												<StatusIcon status={i.status} size={13} />
												<ui.text style={{ fontSize: 12, color: "text2", width: 72 }}>{i.key}</ui.text>
												<ui.text style={{ fontSize: 13, flex: 1, minWidth: 0 }} maxLines={1}>{i.title}</ui.text>
											</ui.pressable>
										);
									}}
								/>
							</ui.box>
						)}
					</ui.box>
				</ui.scroll>
			);
		},
	});
}

export function deactivate() {
	hub.stop();
}
