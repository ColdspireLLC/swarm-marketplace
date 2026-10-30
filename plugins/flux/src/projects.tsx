// Flux's projects, made and kept from Swarm as Flux's own app does
// (create-project-dialog.tsx, settings.tsx): New project's dialog, its
// name, its key, Flux's way from the name until one's typed, and its
// mark, from Swarm's gallery of icons and emoji in Flux's colors; the
// same dialog for a project's settings, which keeps an old key as an
// alias; the sidebar's order, and Delete, which Flux does to the project alone.
// From the board's project menu, the palette, and Flux's page of
// Settings.
import { RAISED_HOVER } from "./view";
import { ui, type Child, type UIMark } from "swarm";
import type { Project } from "./contract";
import { confirm } from "./confirm";
import { GALLERY_COLORS, GALLERY_ICONS } from "./gallery";
import { normalizeProjectKey, uniqueProjectKey } from "./keys";
import { PROJECT_NAME_MAX, type Flux, type ProjectMarkValue } from "./service";
import { COLORS, type ColorName } from "./flux";

/** Flux's mark for a new project: its folder, gray. */
const DEFAULT_MARK: ProjectMarkValue = { type: "icon", value: "folder", color: "gray" };

/** The dialog open: a new project's (id null) or a project's settings; follow, whether it was opened on that project's board, which then follows it. */
let open: { id: string | null; follow: boolean } | null = null;
let name = "";
/** The key typed; "" while it's the name's. */
let keyDraft = "";
let mark: ProjectMarkValue | null = DEFAULT_MARK;
let busy = false;

/** Opens New project's dialog. */
export function openNewProject() {
	open = { id: null, follow: true };
	name = "";
	keyDraft = "";
	mark = DEFAULT_MARK;
	busy = false;
	ui.showOverlay("flux-project");
}

/** Opens a project's settings; follow, from its board, which follows it to a new key. */
export function openProjectSettings(project: Project, follow = false) {
	open = { id: project.id, follow };
	name = project.name;
	keyDraft = project.key;
	mark = markOf(project);
	busy = false;
	ui.showOverlay("flux-project");
}

function close() {
	closeProject();
	ui.hideOverlay("flux-project");
}

/** Forgets the project the dialog was for, as Swarm closes it. */
export function closeProject() {
	open = null;
}

/** A project's mark as Flux keeps it; null for one of its key's letter on its color, which the gallery has none of. */
export function markOf(project: Project): ProjectMarkValue | null {
	if (project.emoji) return { type: "emoji", value: project.emoji };
	if (project.icon) return { type: "icon", value: project.icon, color: project.color };
	return null;
}

/** A mark as Swarm's picker shows it. */
function asPicked(m: ProjectMarkValue | null): UIMark | null {
	if (!m) return null;
	return m.type === "emoji" ? { emoji: m.value } : { icon: m.value, color: m.color };
}

/** The mark Swarm's picker picked, as Flux keeps it. */
function fromPicked(m: UIMark): ProjectMarkValue {
	if (m.emoji) return { type: "emoji", value: m.emoji };
	const color = (COLORS as readonly string[]).includes(m.color ?? "") ? (m.color as ColorName) : "gray";
	return { type: "icon", value: m.icon ?? "folder", color };
}

/** Swarm's gallery, Flux's icons in Flux's colors, from a square showing the mark. */
export function MarkPicker({ value, label, size = 28, bordered = false, onChange }: { value: ProjectMarkValue | null; label: string; size?: number; bordered?: boolean; onChange: (mark: ProjectMarkValue) => void }) {
	return (
		<ui.iconPicker
			label={label}
			value={asPicked(value)}
			icons={GALLERY_ICONS}
			colors={GALLERY_COLORS}
			onChange={(m) => onChange(fromPicked(m))}
			style={{
				width: size, height: size, flexShrink: 0, borderRadius: "control",
				...(bordered ? { border: "1px solid border", backgroundColor: "raised" } : {}),
				hover: { backgroundColor: bordered ? RAISED_HOVER : "hover" }, checked: { backgroundColor: bordered ? RAISED_HOVER : "hover" },
				transition: { duration: 110, colors: true },
			}}
		/>
	);
}

/** The project page a path's key names: by its key, or by an old one, as Flux finds it. */
export function projectAt(flux: Flux, key: string | null): Project | null {
	if (!key) return null;
	return flux.projects().find((p) => p.key === key) ?? flux.findProject(key);
}

/** The board's project menu's own items: New project, and the settings of the project it's on. */
export function projectMenuItems(project: Project | null): Child[] {
	return [
		<ui.separator key="projects-sep" />,
		<ui.item key="new-project" icon="plus" onClick={openNewProject}>New project…</ui.item>,
		project ? <ui.item key="project-settings" icon="settings" onClick={() => openProjectSettings(project, true)}>Project settings…</ui.item> : null,
	];
}

/** Asks before deleting a project, saying what Flux does with its issues; after runs once it's gone. */
export function confirmDelete(flux: Flux, project: Project, after?: () => void) {
	const n = flux.issues().filter((i) => i.projectId === project.id).length;
	const issues = n === 0 ? "It has no issues." : `Flux keeps its ${n === 1 ? "issue" : `${n} issues`}, without a project: ${n === 1 ? "it loses its" : "they lose their"} ${project.key} ${n === 1 ? "key" : "keys"}, and only All projects lists ${n === 1 ? "it" : "them"}.`;
	confirm(`Delete ${project.name}?`, `${issues} This can't be undone.`, "Delete", async () => {
		await flux.deleteProject(project.id);
		after?.();
		ui.toast(`Deleted ${project.name}.`);
	});
}

/** A copy of a project, as Flux's Duplicate: its mark and key, no issues; then its board. */
export async function duplicateProject(flux: Flux, project: Project) {
	try {
		const copy = await flux.createProject({ name: `${project.name} copy`.slice(0, 60), keyFrom: project.key, mark: markOf(project) ?? undefined });
		ui.navTo("flux", `p/${copy.key}`);
	} catch (e) {
		ui.toast(`Couldn't duplicate ${project.name}: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** Moves a project to a place in the list, saying so if Flux won't have it. */
export function moveProject(flux: Flux, project: Project, to: number) {
	void flux.moveProject(project.id, to).catch((e: unknown) => ui.toast(`Couldn't move ${project.name}: ${e instanceof Error ? e.message : String(e)}`));
}

/** A project's mark changed from a list, at once, as Flux's settings do. */
export function setMark(flux: Flux, project: Project, next: ProjectMarkValue) {
	void flux.updateProject(project.id, { mark: next }).catch((e: unknown) => ui.toast(`Couldn't change ${project.name}'s icon: ${e instanceof Error ? e.message : String(e)}`));
}

/** New project's dialog, and a project's settings: its mark and name, then its key and what it numbers. */
export function ProjectDialog({ flux }: { flux: Flux }) {
	const o = open;
	if (!o) return null;
	const projects = flux.projects();
	const editing = o.id ? projects.find((p) => p.id === o.id) : undefined;
	// Deleted meanwhile, in Flux or here.
	if (o.id && !editing) return null;
	const keyed = flux.keyed();
	const derived = name.trim() ? uniqueProjectKey(keyed, name, o.id ?? undefined) : "";
	const key = keyDraft || derived;
	const problem = keyDraft ? flux.keyProblem(keyDraft, o.id ?? undefined) : null;
	const ready = !!name.trim() && !problem && !busy && (!editing || key.length >= 2);
	const changes = editing && key !== editing.key;
	const hint = !key ? "" : changes ? `Issues become ${key}-1, ${key}-2, …; ${editing.key}-1 still finds its issue` : `Issues numbered ${key}-1, ${key}-2, …`;
	const old = editing ? (keyed.find((p) => p.id === editing.id)?.aliases ?? []) : [];
	return (
		<ui.box
			label={editing ? `Settings of ${editing.name}` : "New project"}
			keys={["Mod+Enter"]}
			onKeyDown={() => void submit(flux)}
			style={{ gap: 0 }}
		>
			<ui.box style={{ gap: 4, paddingLeft: 20, paddingRight: 20, paddingTop: 16 }}>
				<ui.text style={{ fontSize: 12, fontWeight: 500, color: "text3" }}>{editing ? "Project settings" : "New project"}</ui.text>
			</ui.box>
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingLeft: 20, paddingRight: 20, paddingTop: 10, paddingBottom: 18 }}>
				<MarkPicker label="Project icon" value={mark} size={36} bordered onChange={(next) => { mark = next; }} />
				<ui.field
					key={"project-name-" + (o.id ?? "new")}
					autoFocus
					value={name}
					placeholder="Project name"
					onChange={(value) => { name = value.slice(0, PROJECT_NAME_MAX); }}
					onSubmit={() => void submit(flux)}
					style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 500, lineHeight: "28px", backgroundColor: "transparent", boxShadow: "none", padding: 0 }}
				/>
			</ui.box>
			<ui.box style={{ height: 1, backgroundColor: "divider" }} />
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12 }}>
				<ui.box
					label="Project key"
					tooltip={old.length ? `Old ${old.length === 1 ? "key" : "keys"}, which still find ${editing!.name}'s issues: ${old.join(", ")}` : undefined}
					style={{ flexDirection: "row", gap: 4, alignItems: "center", height: 28, flexShrink: 0, paddingLeft: 7, paddingRight: 6, borderRadius: "control", backgroundColor: "field", border: problem ? "1px solid red" : "1px solid border", boxShadow: problem ? "0 0 0 3px redSoft" : "none", transition: { duration: 120, colors: true } }}
				>
					<ui.text style={{ width: 10, fontFamily: "mono", fontSize: 12, color: "text3", textAlign: "center" }}>#</ui.text>
					<ui.field
						key={"project-key-" + (o.id ?? "new")}
						value={key}
						placeholder="KEY"
						onChange={(value) => { keyDraft = normalizeProjectKey(value); }}
						onSubmit={() => void submit(flux)}
						style={{ width: 52, fontFamily: "mono", fontSize: 12, letterSpacing: 0.5, backgroundColor: "transparent", boxShadow: "none", padding: 0 }}
					/>
				</ui.box>
				<ui.text style={{ flex: 1, minWidth: 0, fontSize: 12, color: problem ? "red" : "text2" }} maxLines={1} tooltip={problem ?? hint}>{problem ?? hint}</ui.text>
				{editing ? (
					<ui.button kind="ghost" size="sm" onClick={() => { close(); confirmDelete(flux, editing, o.follow ? () => ui.navTo("flux", "") : undefined); }} style={{ color: "red" }}>Delete…</ui.button>
				) : null}
				<ui.button kind="primary" disabled={!ready} onClick={() => void submit(flux)}>{`${busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save" : "Create"}  ⌘↵`}</ui.button>
			</ui.box>
		</ui.box>
	);
}

async function submit(flux: Flux) {
	const o = open;
	if (!o || busy) return;
	if (!name.trim()) {
		ui.toast("Give the project a name.");
		return;
	}
	busy = true;
	ui.update();
	try {
		if (o.id) {
			const before = flux.projects().find((p) => p.id === o.id);
			if (!before) return close();
			const was = markOf(before);
			const marked = mark && JSON.stringify(mark) !== JSON.stringify(was) ? mark : undefined;
			const project = await flux.updateProject(o.id, { name, key: keyDraft || before.key, mark: marked });
			close();
			// Its board follows it to its new key.
			if (o.follow && project.key !== before.key) ui.navTo("flux", `p/${project.key}`);
			ui.toast(project.key !== before.key ? `${project.name} is ${project.key} now. ${before.key}-… still finds its issues.` : `Saved ${project.name}.`);
		} else {
			const project = await flux.createProject({ name, key: keyDraft || undefined, mark: mark ?? DEFAULT_MARK });
			close();
			ui.navTo("flux", `p/${project.key}`);
			ui.toast(`Created ${project.name}.`);
		}
	} catch (e) {
		ui.toast(e instanceof Error ? e.message : String(e));
	} finally {
		busy = false;
		ui.update();
	}
}

/** Whose a key is, for a list's tooltip: its own, or an old one's. */
export function keyNote(flux: Flux, project: Project): string | undefined {
	const old = flux.keyed().find((p) => p.id === project.id)?.aliases ?? [];
	return old.length ? `${project.key}, and before: ${old.join(", ")}` : undefined;
}

