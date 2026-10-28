// Descriptions and comments, in the editor Swarm draws. Typing stays in
// the window; what it reports is written into the issue, descriptions
// through the live Yjs document.
import swarm, { call, ui } from "swarm";
import { Avatar, type ImageOf } from "./view";
import { clearDraft, drafted, editDraft, finishUpload, setDraft } from "./drafts";
import type { Flux } from "./service";
import type { Issue } from "./contract";

export function mentionOptions(flux: Flux) {
	return [
		...flux.memberList().map((member) => ({ value: member.username, label: `${member.name} (@${member.username})` })),
		...flux.projects().map((project) => ({ value: project.key, label: `${project.name} (@${project.key})` })),
	];
}

export function editorImages(markdown: string, image: ImageOf) {
	const images: { url: string; src: string }[] = [];
	for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
		const url = match[1]!;
		const got = image(url);
		// The editor keeps picture bytes by reference; the type is the recording's string.
		if (got instanceof Uint8Array) images.push({ url, src: got as unknown as string });
	}
	return images;
}

function upload(flux: Flux, key: string, file: { id: string; name: string; type: string; base64: string }, entity: "issue_image" | "comment_image", save: (markdown: string) => Promise<void>, keep = false) {
	const bytes = Uint8Array.fromBase64(file.base64);
	void flux.uploadImage(bytes, file.type, file.name, entity).then(
		(url) => finishUpload(key, file.id, url, save, keep),
		(error: unknown) => ui.toast(error instanceof Error ? error.message : String(error)),
	);
}

export function DescriptionEditor({ flux, issue, markdown, image }: { flux: Flux; issue: Issue; markdown: string; image: ImageOf }) {
	const key = `desc:${flux.id}:${issue.id}`;
	const save = (md: string) => flux.replaceDescription(issue.id, md);
	return (
		<ui.editor
			key={key}
			value={drafted(key, markdown)}
			placeholder="Add description..."
			label="Description"
			options={mentionOptions(flux)}
			images={editorImages(drafted(key, markdown), image)}
			onChange={(value) => editDraft(key, value, save)}
			onUpload={(file) => upload(flux, key, file, "issue_image", save)}
			style={{ minHeight: 96, fontSize: 15 }}
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
			ui.update();
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

let provider = "";
let model = "";
let effort = "";
let approval = "";
let branch = "";
let prompt = "";
let seeded = "";
let starting: string | null = null;
let busy = false;

export function startAgent(issueId: string | null) {
	starting = issueId;
	seeded = "";
}

export function isStarting(issueId: string) {
	return starting === issueId;
}

/** Swarm's pickers, then a thread linked to the issue both ways. */
export function StartAgent({ flux, issue, markdown }: { flux: Flux; issue: Issue; markdown: string }) {
	if (seeded !== issue.id) {
		seeded = issue.id;
		prompt = `Work on ${issue.key}: ${issue.title}\n\n${markdown.trim()}\n\nKeep the Flux issue current as you work. Move it to review when the work is ready to look at.`;
	}
	return (
		<ui.box style={{ gap: 10, padding: "s4", borderRadius: "card", border: "1px solid border", backgroundColor: "raised" }}>
			<ui.text style={{ fontWeight: 600 }}>Start an agent</ui.text>
			<ui.text style={{ fontSize: "small", color: "text2" }}>The thread is linked to {issue.key}. Its merge request moves the issue to review, and merging completes it.</ui.text>
			<ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
				{ui.agentPicker({ provider, value: model, effort, onChange: (value) => { provider = value.provider; model = value.model; effort = value.effort ?? ""; } })}
				{ui.modePicker({ provider, value: approval, onChange: (value) => { approval = value; } })}
				{ui.branchPicker({ value: branch, onChange: (value) => { branch = value; } })}
			</ui.box>
			<ui.field key="agent-prompt" value={prompt} multiline placeholder="What should the agent do?" onChange={(value) => { prompt = value; }} />
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				<ui.button kind="ghost" onClick={() => { starting = null; }}>Cancel</ui.button>
				<ui.button kind="primary" disabled={busy || !prompt.trim()} onClick={() => void run(flux, issue)}>{busy ? "Starting…" : "Start"}</ui.button>
			</ui.box>
		</ui.box>
	);
}

async function run(flux: Flux, issue: Issue) {
	if (busy) return;
	busy = true;
	ui.update();
	try {
		const project = await projectFor(flux, issue);
		const text = prompt.trim();
		const spawned = await swarm.threads.spawn({
			project,
			provider: provider || undefined,
			model: model || undefined,
			effort: effort || undefined,
			approval: approval || undefined,
			worktree: true,
			branch: branch || undefined,
			title: `${issue.key} ${issue.title}`,
			prompt: text,
			metadata: { issueId: issue.id, issueKey: issue.key, connectionId: flux.id },
		});
		await flux.attach(issue.id, spawned.id, true);
		await flux.addComment(issue.id, `Started an agent on this issue.`, { name: provider || "Agent", provider: provider || "swarm", threadId: spawned.id }).catch(() => {});
		starting = null;
		prompt = "";
		ui.openThread(spawned.id);
		ui.toast(`Started on ${issue.key}.`);
	} catch (error) {
		ui.toast(error instanceof Error ? error.message : String(error));
	} finally {
		busy = false;
		ui.update();
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
