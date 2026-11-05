// Descriptions and comments, in the editor Swarm draws. Typing stays in
// the window; what it reports is written into the issue, descriptions
// through the live Yjs document.
import swarm, { call, ui } from "swarm";
import { Avatar, Markdown, type ImageOf } from "./view";
import { clearDraft, drafted, editDraft, finishUpload, setDraft } from "./drafts";
import type { Flux } from "./service";
import type { Issue } from "./contract";
import { startPrompt } from "./prompt";
import { imageSources } from "./markdown";
import { StatusIcon } from "./view";
import { DEFAULT_ID, addConfig, freshName, same, saveConfig, spawnConfig, spawnConfigs, type Choice } from "./spawn";

export function mentionOptions(flux: Flux) {
	return [
		...flux.memberList().map((member) => ({ value: member.username, label: `${member.name} (@${member.username})` })),
		...flux.projects().map((project) => ({ value: project.key, label: `${project.name} (@${project.key})` })),
	];
}

export function editorImages(markdown: string, image: ImageOf) {
	const images: { url: string; src: string }[] = [];
	for (const url of imageSources(markdown)) {
		const got = image(url);
		// The editor keeps picture bytes by reference; the type is the recording's string.
		if (got instanceof Uint8Array) images.push({ url, src: got as unknown as string });
	}
	return images;
}

export type EditorFile = { id: string; name: string; type: string; base64: string };

/** Placeholder for a picture that's still uploading: the editor inserts it, and Flux won't take it. */
export const uploading = (markdown: string) => markdown.includes("flux-local:");

/**
 * Uploads a picture an editor took (pasted, dropped, or picked with /Image)
 * into a draft kept in the page's store, read with get and written with set:
 * its URL replaces the editor's placeholder, or the picture comes out when
 * it can't upload.
 */
export function uploadInto(flux: Flux, file: EditorFile, entity: "issue_image" | "comment_image", get: () => string, set: (markdown: string) => void) {
	const placeholder = "flux-local:" + file.id;
	void flux.uploadImage(Uint8Array.fromBase64(file.base64), file.type, file.name, entity).then(
		(url) => set(get().replaceAll(placeholder, url)),
		(error: unknown) => {
			set(get().replace(new RegExp(`!\\[[^\\]]*\\]\\(${placeholder}\\)`, "g"), ""));
			ui.toast(error instanceof Error ? error.message : String(error));
		},
	);
}

function upload(flux: Flux, key: string, file: { id: string; name: string; type: string; base64: string }, entity: "issue_image" | "comment_image", save: (markdown: string) => Promise<void>, keep = false) {
	const bytes = Uint8Array.fromBase64(file.base64);
	void flux.uploadImage(bytes, file.type, file.name, entity).then(
		(url) => finishUpload(key, file.id, url, save, keep),
		(error: unknown) => ui.toast(error instanceof Error ? error.message : String(error)),
	);
}

/**
 * What of a description Swarm's editor can't keep: Flux's tables and
 * callouts, which its Markdown flattens. Saved from Swarm, they'd change
 * in Flux, so such a description shows as it is, to edit in Flux.
 */
function unkept(html: string): string | null {
	const table = /<table[\s>]/i.test(html);
	const callout = /data-type="callout"/i.test(html);
	if (table && callout) return "a table and a callout";
	if (table) return "a table";
	if (callout) return "a callout";
	return null;
}

export function DescriptionEditor({ flux, issue, markdown, html = "", image }: { flux: Flux; issue: Issue; markdown: string; html?: string; image: ImageOf }) {
	const has = unkept(html);
	if (has) {
		return (
			<ui.box style={{ gap: 14, minHeight: "50vh" }}>
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", padding: "s3 s4", borderRadius: "control", backgroundColor: "hover" }}>
					<ui.icon icon="info" style={{ width: 14, height: 14, color: "text2", flexShrink: 0, marginTop: 1 }} />
					<ui.text style={{ flex: 1, minWidth: 0, fontSize: "small", color: "text2" }}>{`This description has ${has}, which Swarm can't edit without changing. Edit it in Flux.`}</ui.text>
					<ui.link label="Edit in Flux" href={flux.issueUrl(issue)} style={{ fontSize: "small" }} />
				</ui.box>
				<Markdown md={markdown} image={image} />
			</ui.box>
		);
	}
	const key = `desc:${flux.id}:${issue.id}`;
	const save = (md: string) => flux.replaceDescription(issue.id, md);
	return (
		<ui.editor
			key={key}
			value={drafted(key, markdown)}
			placeholder="Add description…"
			label="Description"
			options={mentionOptions(flux)}
			images={editorImages(drafted(key, markdown), image)}
			onChange={(value) => editDraft(key, value, save)}
			onUpload={(file) => upload(flux, key, file, "issue_image", save)}
			// As Flux's (min-h-[50vh]): the description is the page's, and a click anywhere in it writes there.
			style={{ minHeight: "50vh", fontSize: 15, boxShadow: "none" }}
		/>
	);
}

export function CommentEditor({ flux, issue, image }: { flux: Flux; issue: Issue; image: ImageOf }) {
	const key = `comment:${flux.id}:${issue.id}`;
	const value = drafted(key, "");
	const me = flux.me ? flux.memberList().find((member) => member.id === flux.me?.id) : undefined;
	const send = () => {
		const text = drafted(key, "").trim();
		if (!text) return;
		void flux.addComment(issue.id, text).then(() => {
			clearDraft(key);
		}, (error: unknown) => ui.toast(error instanceof Error ? error.message : String(error)));
	};
	const keep = async (markdown: string) => { setDraft(key, markdown); };
	return (
		<ui.box style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
			<ui.box style={{ marginTop: 8, flexShrink: 0 }}>
				<Avatar member={me} size={20} />
			</ui.box>
			<ui.box style={{ flex: 1, minWidth: 0, gap: 0, borderRadius: "control", border: "1px solid border", backgroundColor: "raised" }}>
				<ui.box style={{ padding: 8 }}>
					<ui.editor
						key={key}
						value={value}
						placeholder="Leave a comment…"
						label="Comment"
						options={mentionOptions(flux)}
						images={editorImages(value, image)}
						onChange={(next) => setDraft(key, next)}
						onSubmit={send}
						onUpload={(file) => upload(flux, key, file, "comment_image", keep, true)}
						style={{ padding: 0 }}
					/>
				</ui.box>
				<ui.box style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingLeft: 8, paddingRight: 8, paddingBottom: 8 }}>
					<ui.button size="sm" kind="secondary" label="Comment" disabled={!value.trim()} onClick={send}>Comment  ⌘↵</ui.button>
				</ui.box>
			</ui.box>
		</ui.box>
	);
}

// Start agent's dialog, tracked: the pickers' choices, the agent
// configuration they came from, and the name of one being saved (null
// while none is), the prompt, the
// issue it's for and was seeded from, whether it's starting; the Swarm
// project it starts in (the Flux project's link, else one of its name,
// else the only one), and Swarm's projects, null until read.
const st = ui.store({
	provider: "",
	model: "",
	effort: "",
	approval: "",
	config: DEFAULT_ID,
	naming: null as string | null,
	branch: "",
	prompt: "",
	seeded: "",
	imageIds: [] as string[],
	starting: null as string | null,
	busy: false,
	swarmProject: "",
	swarmProjects: null as { id: string; name: string }[] | null,
});

/** Reads Swarm's projects ahead, so Start agent opens with its project chosen, not a moment after. */
export function warmStart() {
	void call("Projects", {}).then(
		(list) => {
			st.swarmProjects = list.map((p) => ({ id: p.id, name: p.name }));
		},
		() => {},
	);
}

/** The Swarm project an issue's agent starts in, from what's known now: its Flux project's link, one of its name, the only one. */
function knownProject(flux: Flux, issue: Issue): string {
	const linked = flux.projects().find((project) => project.id === issue.projectId);
	if (linked?.swarmProjectId) return linked.swarmProjectId;
	const name = linked?.name.trim().toLowerCase();
	const match = name ? st.swarmProjects?.find((project) => project.name.trim().toLowerCase() === name) : undefined;
	return match?.id ?? (st.swarmProjects?.length === 1 ? st.swarmProjects[0]!.id : "");
}

/** Opens Start agent's dialog for the issue, as bb's: over whatever shows it. */
export function startAgent(issueId: string) {
	st.starting = issueId;
	st.seeded = "";
	ui.showOverlay("flux-start");
}

function closeStart() {
	forgetStart();
	ui.hideOverlay("flux-start");
}

/** Forgets the issue Start agent was for, as Swarm closes its dialog. */
export function forgetStart() {
	st.starting = null;
}

/** Start agent's dialog: the issue it's for, what starting does, Swarm's pickers and the issue's prompt. */
export function StartAgentDialog({ flux }: { flux: Flux }) {
	const issue = st.starting ? flux.issue(st.starting) : undefined;
	if (!issue) return null;
	return <StartAgent flux={flux} issue={issue} />;
}

function StartAgent({ flux, issue }: { flux: Flux; issue: Issue }) {
	if (st.seeded !== issue.id) {
		st.seeded = issue.id;
		useConfig(DEFAULT_ID);
		// bb's prompt: the issue, its description with its images numbered, and where the rest is.
		const start = startPrompt(flux.detail(issue.id), flux.baseUrl);
		st.prompt = start.prompt;
		st.imageIds = start.imageIds;
		// Chosen as it opens, from what's read already; read again behind it.
		st.swarmProject = knownProject(flux, issue);
		void loadProjects(flux, issue);
	}
	const fluxProject = flux.projects().find((p) => p.id === issue.projectId);
	const shown = st.swarmProjects?.find((p) => p.id === st.swarmProject)?.name ?? (st.swarmProjects ? "Choose a project" : "…");
	const moves = issue.status === "backlog" || issue.status === "todo";
	const images = st.imageIds.length;
	return (
		<ui.box label={`Start an agent on ${issue.key}`} style={{ position: "relative", gap: 14, padding: 20 }}>
			<ui.iconButton icon="x" label="Close" style={{ position: "absolute", top: 14, right: 14, width: 28, height: 28 }} onClick={closeStart} />
			<ui.box style={{ gap: 6 }}>
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingRight: 32 }}>
					<StatusIcon status={issue.status} size={16} />
					<ui.text style={{ fontSize: 17, fontWeight: 600, color: "text2", flexShrink: 0 }}>{issue.key}</ui.text>
					<ui.text style={{ fontSize: 17, fontWeight: 600, minWidth: 0, flexShrink: 1 }} maxLines={1}>{issue.title.trim() || "Untitled"}</ui.text>
				</ui.box>
				<ui.text style={{ fontSize: 14, color: "text2" }}>
					{`The agent gets this issue and keeps it updated as it works.${moves ? " Starting moves it to In Progress." : ""}${images ? ` Its ${images === 1 ? "image goes" : `${images} images go`} along as ${images === 1 ? "an attachment" : "attachments"}.` : ""}`}
				</ui.text>
			</ui.box>
			<ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
				<ui.menu label={`Swarm project: ${shown}`} search="Choose a Swarm project…" tooltip={fluxProject && !fluxProject.swarmProjectId ? `Remembered for ${fluxProject.name} once it starts` : undefined} style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: "control", backgroundColor: "transparent", color: "text2", hover: { backgroundColor: "hover", color: "text" }, checked: { backgroundColor: "press", color: "text" } }}>
					<ui.icon icon="folder" style={{ width: 14, height: 14, color: "currentColor" }} />
					<ui.text style={{ fontSize: 13, color: "currentColor" }} maxLines={1}>{shown}</ui.text>
					<ui.icon icon="chevron-down" style={{ width: 12, height: 12, color: "text2" }} />
					{(st.swarmProjects ?? []).map((p) => <ui.item key={p.id} checked={p.id === st.swarmProject} onClick={() => { st.swarmProject = p.id; }}>{p.name}</ui.item>)}
				</ui.menu>
				<ConfigMenu />
				{ui.agentPicker({ provider: st.provider, value: st.model, effort: st.effort, onChange: (value) => { st.provider = value.provider; st.model = value.model; st.effort = value.effort ?? ""; } })}
				{ui.modePicker({ provider: st.provider, value: st.approval, onChange: (value) => { st.approval = value; } })}
				{ui.branchPicker({ value: st.branch, onChange: (value) => { st.branch = value; } })}
			</ui.box>
			{st.naming !== null ? <SaveConfig /> : null}
			<ui.field key={"agent-prompt-" + issue.id} value={st.prompt} multiline autoFocus placeholder="What should the agent do?" keys={["Mod+Enter"]} onKeyDown={() => void run(flux, issue)} onChange={(value) => { st.prompt = value; }} style={{ minHeight: 160, maxHeight: "46vh", fontSize: 14 }} />
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
				<ui.button kind="ghost" size="sm" onClick={closeStart}>Cancel</ui.button>
				<ui.button kind="primary" size="sm" icon="bot" disabled={st.busy || !st.prompt.trim()} tooltip="⌘ Enter" onClick={() => void run(flux, issue)}>{st.busy ? "Starting…" : "Start"}</ui.button>
			</ui.box>
		</ui.box>
	);
}

/** The pickers' choices now. */
function choice(): Choice {
	return { provider: st.provider, model: st.model, effort: st.effort, approval: st.approval };
}

/** Sets the pickers to a configuration's choices. */
function useConfig(id: string) {
	const config = spawnConfig(id);
	st.config = config.id;
	st.provider = config.provider;
	st.model = config.model;
	st.effort = config.effort;
	st.approval = config.approval;
	st.naming = null;
}

/**
 * The configuration the pickers came from, marked once they're changed,
 * and a menu of the others, saving into it, saving as a new one, and
 * Settings, where they're kept.
 */
function ConfigMenu() {
	const config = spawnConfig(st.config);
	const changed = !same(config, choice());
	const shown = changed ? `${config.name} (changed)` : config.name;
	return (
		<ui.menu label={`Configuration: ${shown}`} tooltip="Agent configuration" wide style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: "control", backgroundColor: "transparent", color: "text2", hover: { backgroundColor: "hover", color: "text" }, checked: { backgroundColor: "press", color: "text" } }}>
			<ui.icon icon="sliders" style={{ width: 14, height: 14, color: "currentColor" }} />
			<ui.text style={{ fontSize: 13, color: "currentColor" }} maxLines={1}>{shown}</ui.text>
			<ui.icon icon="chevron-down" style={{ width: 12, height: 12, color: "text2" }} />
			{spawnConfigs().map((c) => <ui.item key={c.id} checked={c.id === config.id} onClick={() => useConfig(c.id)}>{c.name}</ui.item>)}
			<ui.separator />
			<ui.item icon="check" disabled={!changed} onClick={() => { saveConfig(config.id, choice()); ui.toast(`Saved ${config.name}.`); }}>{`Save to ${config.name}`}</ui.item>
			<ui.item icon="plus" onClick={() => { st.naming = ""; }}>Save as new configuration…</ui.item>
			<ui.item icon="settings" href="swarm://settings/flux/flux">Manage configurations</ui.item>
		</ui.menu>
	);
}

/** Save as new configuration's name, under the pickers. */
function SaveConfig() {
	const fresh = freshName();
	const save = () => {
		const name = (st.naming ?? "").trim() || fresh;
		st.config = addConfig(name, choice());
		st.naming = null;
		ui.toast(`Saved ${name}.`);
	};
	return (
		<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
			<ui.field key="config-name" label="Configuration name" value={st.naming ?? ""} autoFocus placeholder={fresh} onChange={(value) => { st.naming = value; }} onSubmit={save} style={{ flex: 1, minWidth: 0, height: 28 }} />
			<ui.button kind="ghost" size="sm" onClick={() => { st.naming = null; }}>Cancel</ui.button>
			<ui.button kind="secondary" size="sm" onClick={save}>Save configuration</ui.button>
		</ui.box>
	);
}

async function loadProjects(flux: Flux, issue: Issue) {
	let projects: { id: string; name: string }[] = [];
	try {
		projects = (await call("Projects", {})).map((p) => ({ id: p.id, name: p.name }));
	} catch {
		// None to pick from.
	}
	const found = (await projectFor(flux, issue)) ?? "";
	// Another issue's Start agent opened meanwhile: this answer isn't its.
	if (st.seeded !== issue.id) return;
	st.swarmProjects = projects;
	if (!st.swarmProject) st.swarmProject = found;
}

async function run(flux: Flux, issue: Issue) {
	if (st.busy || !st.prompt.trim()) return;
	st.busy = true;
	try {
		const project = st.swarmProject || (await projectFor(flux, issue));
		// Flux shows its images only to its members: they go along as the prompt's pictures, where it numbers them.
		const pictures: { type: string; data: Uint8Array }[] = [];
		// The prompt's [Image N], by N, to its picture's place among those that came.
		const placed = new Map<number, number>();
		for (const [i, id] of st.imageIds.entries()) {
			try {
				const asset = await flux.requireClient().asset(id);
				// What a thread starts with: PNG, JPEG, GIF or WebP, 5 MB at most; the rest stay mentions.
				const type = asset.contentType.split(";")[0]!.trim().toLowerCase();
				if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type) || asset.bytes.byteLength > 5 << 20) continue;
				pictures.push({ type, data: new Uint8Array(asset.bytes) });
				placed.set(i + 1, pictures.length);
			} catch {
				// Said below; its mention stays as it was.
			}
		}
		const failed = st.imageIds.length - pictures.length;
		const text = st.prompt.trim().replace(/\[Image (\d+)\]/g, (whole, num: string) => {
			const at = placed.get(Number(num));
			return at ? `[Image #${at}]` : whole;
		});
		const spawned = await swarm.threads.spawn({
			project,
			provider: st.provider || undefined,
			model: st.model || undefined,
			effort: st.effort || undefined,
			approval: st.approval || undefined,
			worktree: true,
			branch: st.branch || undefined,
			title: `${issue.key} · ${issue.title}`,
			prompt: text,
			images: pictures,
			metadata: { issueId: issue.id, issueKey: issue.key, connectionId: flux.id },
		});
		if (failed) ui.toast(failed === st.imageIds.length ? `${issue.key}'s images weren't attached.` : `${failed} of ${issue.key}'s images weren't attached.`);
		try {
			await flux.attach(issue.id, spawned.id, true);
			// Where this project's work happens, for next time.
			const fluxProject = flux.projects().find((p) => p.id === issue.projectId);
			if (fluxProject && !fluxProject.swarmProjectId && project && st.swarmProjects?.some((p) => p.id === project)) flux.link(fluxProject.id, project);
		} catch (e) {
			ui.toast(`The agent started, but ${issue.key} wasn't updated: ${e instanceof Error ? e.message : String(e)}`);
		}
		closeStart();
		ui.openThread(spawned.id);
		ui.toast(`Agent started on ${issue.key}.`);
	} catch (error) {
		ui.toast(error instanceof Error ? error.message : String(error));
	} finally {
		st.busy = false;
	}
}

async function projectFor(flux: Flux, issue: Issue): Promise<string | undefined> {
	const linked = flux.projects().find((project) => project.id === issue.projectId);
	if (linked?.swarmProjectId) return linked.swarmProjectId;
	try {
		const projects = await call("Projects", {});
		const name = linked?.name.trim().toLowerCase();
		const match = name ? projects.find((project) => project.name.trim().toLowerCase() === name) : undefined;
		return match?.id ?? (projects.length === 1 ? projects[0]!.id : undefined);
	} catch {
		return undefined;
	}
}
