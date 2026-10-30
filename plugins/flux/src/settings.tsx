// Flux's page of Settings, as bb's settings.tsx: each Flux it's connected
// to, how it stands and what to do with it, another to add, and which
// Swarm project each Flux project's agents work in.
import { call, ui, type ColorValue } from "swarm";
import { ConnectForm } from "./connect";
import { hub } from "./hub";
import type { Flux, State } from "./service";
import { Avatar } from "./view";
import { MarkPicker, confirmDelete, keyNote, markOf, moveProject, openNewProject, openProjectSettings, setMark } from "./projects";

/** The Fluxes whose Change form is open, and whether Add another is. */
const editing = new Set<string>();
let adding = false;

/** Swarm's projects, for the links; null until they're read. */
let swarmProjects: { id: string; name: string }[] | null = null;
let reading = false;

/** Reads Swarm's projects again, as one is added, renamed or removed. */
export function refreshProjects() {
	if (reading) return;
	reading = true;
	call("Projects", {})
		.then((projects) => {
			swarmProjects = projects.map((project) => ({ id: project.id, name: project.name }));
		})
		.catch(() => {
			swarmProjects = [];
		})
		.finally(() => {
			reading = false;
			ui.update();
		});
}

const card = { gap: 14, padding: 16, borderRadius: "card", backgroundColor: "raised", border: "1px solid border" } as const;

export function FluxSettings() {
	const list = hub.connected();
	if (list.length === 0) {
		return (
			<ui.box style={{ gap: 16, maxWidth: 640 }}>
				<ui.text style={{ color: "text2" }}>Flux issues in Swarm: agents read and update them with swarm flux, and a thread started on an issue keeps it current.</ui.text>
				<ui.box style={card}>
					<ui.text style={{ fontWeight: 600 }}>Connect Flux</ui.text>
					<ConnectForm name="first" target={null} />
				</ui.box>
			</ui.box>
		);
	}
	const active = hub.active;
	const several = list.length > 1;
	const connection = active.connection();
	return (
		<ui.box style={{ gap: 24, maxWidth: 640 }}>
			<ui.box style={{ gap: 12 }}>
				{list.map((flux) => <ConnectionCard key={flux.id} flux={flux} active={several ? flux.id === active.id : null} />)}
				{adding ? (
					<ui.box style={card}>
						<ui.text style={{ fontWeight: 600 }}>Add another Flux</ui.text>
						<ConnectForm name="another" target={null} done={() => { adding = false; }} cancel={() => { adding = false; }} />
					</ui.box>
				) : (
					<ui.button kind="secondary" size="sm" icon="plus" onClick={() => { adding = true; }} style={{ alignSelf: "flex-start" }}>Add another Flux</ui.button>
				)}
			</ui.box>
			{connection.state === "ready" || active.projects().length > 0 ? <ProjectLinks flux={active} /> : null}
		</ui.box>
	);
}

const DOT: Record<State, ColorValue> = {
	ready: "green",
	connecting: "amber",
	offline: "amber",
	unauthorized: "red",
	error: "red",
	unconfigured: "text3",
};

/** A Flux's address without its scheme, as its card names it. */
function hostOf(flux: Flux): string {
	return (flux.baseUrl || flux.url || "Flux").replace(/^https?:\/\//, "");
}

function headline(flux: Flux): string {
	const c = flux.connection();
	const host = hostOf(flux);
	switch (c.state) {
		case "ready":
			return `Connected to ${c.workspace?.name ?? "Flux"}`;
		case "connecting":
			return `Connecting to ${host}…`;
		case "offline":
			return `Can't reach ${host}`;
		case "unauthorized":
			return `${host} needs a new API token`;
		case "error":
			return `Can't connect to ${host}`;
		default:
			return "Not connected";
	}
}

function detail(flux: Flux): string {
	const c = flux.connection();
	const issues = `${c.issueCount} ${c.issueCount === 1 ? "issue" : "issues"}`;
	if (c.state === "ready") return [c.me?.name, hostOf(flux), `${issues} synced`].filter(Boolean).join(" · ");
	if (c.state === "offline" && c.issueCount > 0) return `Offline · showing the ${issues} last synced`;
	return c.message || hostOf(flux);
}

/** One Flux: how it stands, Use, Resync and Change, and Disconnect. */
function ConnectionCard({ flux, active }: { flux: Flux; active: boolean | null }) {
	const c = flux.connection();
	// The form is up while there's something to fix; offline only waits.
	const mustAct = c.state === "unauthorized" || c.state === "error";
	const open = mustAct || editing.has(flux.id);
	const name = `${headline(flux)}, ${detail(flux)}`;
	return (
		<ui.box label={name} style={card}>
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
				{c.me ? <Avatar member={{ id: c.me.id, name: c.me.name, username: c.me.username, email: c.me.email, avatarUrl: c.me.avatarUrl ?? null, avatarColor: "gray" }} size={32} /> : null}
				<ui.box style={{ flex: 1, minWidth: 160, gap: 2 }}>
					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
						<ui.box style={{ width: 8, height: 8, borderRadius: "full", flexShrink: 0, backgroundColor: DOT[c.state], ...(c.state === "connecting" ? { animation: { name: "pulse" } } : {}) }} />
						<ui.text style={{ fontWeight: 500, minWidth: 0 }} maxLines={1}>{headline(flux)}</ui.text>
						{active ? (
							<ui.box style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1, borderRadius: 4, backgroundColor: "hover" }}>
								<ui.text style={{ fontSize: 11, color: "text2" }}>Active</ui.text>
							</ui.box>
						) : null}
					</ui.box>
					<ui.text style={{ fontSize: "small", color: "text2" }} maxLines={2}>{detail(flux)}</ui.text>
				</ui.box>
				<ui.box style={{ flexDirection: "row", gap: 8 }}>
					{active === false ? <ui.button kind="secondary" size="sm" tooltip={`Use ${hostOf(flux)} for the board and swarm flux`} onClick={() => { hub.use(flux.id); ui.toast(`Switched to ${c.workspace?.name ?? hostOf(flux)}.`); }}>Use</ui.button> : null}
					{/* Offline, it would drop the copy that's showing. */}
					{c.state === "ready" || c.state === "error" ? <ui.button kind="secondary" size="sm" tooltip="Pull everything from Flux again" onClick={() => resync(flux)}>Resync</ui.button> : null}
					{(c.state === "ready" || c.state === "offline") ? (
						<ui.button kind="secondary" size="sm" tooltip={editing.has(flux.id) ? undefined : "Change its URL or token"} onClick={() => void (editing.has(flux.id) ? editing.delete(flux.id) : editing.add(flux.id))}>{editing.has(flux.id) ? "Cancel" : "Change"}</ui.button>
					) : null}
				</ui.box>
			</ui.box>
			{open ? <ConnectForm name={"change-" + flux.id} target={flux.id} url={flux.baseUrl || flux.url} done={() => void editing.delete(flux.id)} /> : null}
			<ui.pressable label={`Disconnect ${hostOf(flux)}`} role="link" onClick={() => disconnect(flux)} style={{ alignSelf: "flex-start", color: "text2", hover: { color: "text" } }}>
				<ui.text style={{ fontSize: "small", textDecoration: "underline" }}>Disconnect and forget the token</ui.text>
			</ui.pressable>
		</ui.box>
	);
}

function resync(flux: Flux) {
	ui.toast("Resyncing from Flux.");
	flux.resync().catch(() => {});
}

function disconnect(flux: Flux) {
	const was = flux.connection().workspace?.name ?? hostOf(flux);
	editing.delete(flux.id);
	hub.disconnect(flux.id);
	ui.toast(`Disconnected from ${was}.`);
}

/**
 * Flux's projects, as its own Settings list them, and which Swarm project
 * each one's agents work in: each one's mark, which Swarm's gallery
 * changes at once, its name and key, the Swarm project, and a menu of its
 * settings, its place in the order and Delete; New project at the top.
 */
function ProjectLinks({ flux }: { flux: Flux }) {
	if (swarmProjects === null) refreshProjects();
	const projects = flux.projects();
	const known = swarmProjects ?? [];
	const column = { fontSize: 12, fontWeight: 500, color: "text3" } as const;
	return (
		<ui.box style={{ gap: 12 }}>
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
				<ui.box style={{ flex: 1, minWidth: 0, gap: 4 }}>
					<ui.text style={{ fontWeight: 600 }}>Projects</ui.text>
					<ui.text style={{ fontSize: "small", color: "text2" }}>Each project's icon, name and key, as Flux shows them. An agent started on an issue works in its project's Swarm project, and swarm flux in that Swarm project's threads uses that Flux project when a command names none.</ui.text>
				</ui.box>
				<ui.button kind="secondary" size="sm" icon="plus" onClick={openNewProject}>New project</ui.button>
			</ui.box>
			{projects.length === 0 ? (
				<ui.text style={{ color: "text3" }}>{`${flux.connection().workspace?.name ?? "This Flux"} has no projects yet.`}</ui.text>
			) : (
				<ui.box style={{ borderRadius: "card", border: "1px solid border", backgroundColor: "raised", overflow: "hidden" }}>
					<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingLeft: 10, paddingRight: 8, height: 32, borderBottom: "1px solid divider" }}>
						<ui.text style={{ ...column, flex: 1, paddingLeft: 40 }}>Name</ui.text>
						<ui.text style={{ ...column, width: 52 }}>Key</ui.text>
						<ui.text style={{ ...column, width: 240 }}>Where agents work</ui.text>
					</ui.box>
					{projects.map((project, i) => {
						const linked = project.swarmProjectId;
						const shown = linked ? (known.find((p) => p.id === linked)?.name ?? (swarmProjects ? "A removed project" : "…")) : "Not linked";
						return (
							<ui.box key={project.id} style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingLeft: 10, paddingRight: 8, height: 44, borderTop: i === 0 ? "none" : "1px solid divider" }}>
								<MarkPicker label={`Icon of ${project.name}`} value={markOf(project)} onChange={(next) => setMark(flux, project, next)} />
								<ui.text style={{ flex: 1, minWidth: 0 }} maxLines={1}>{project.name}</ui.text>
								<ui.text style={{ width: 52, fontSize: 12, fontFamily: "mono", color: "text2" }} tooltip={keyNote(flux, project)}>{project.key}</ui.text>
								<ui.menu label={`Swarm project for ${project.name}: ${shown}`} style={{ flexDirection: "row", gap: 6, alignItems: "center", width: 200, height: 28, paddingLeft: 10, paddingRight: 8, borderRadius: "control", border: "1px solid border", backgroundColor: "field", hover: { backgroundColor: "hover" }, checked: { backgroundColor: "hover" } }}>
									<ui.text style={{ flex: 1, minWidth: 0, fontSize: 13, color: linked ? "text" : "text3" }} maxLines={1}>{shown}</ui.text>
									<ui.icon icon="chevron-down" style={{ width: 12, height: 12, color: "text3" }} />
									<ui.item checked={!linked} onClick={() => flux.link(project.id, null)}>Not linked</ui.item>
									{known.length ? <ui.separator /> : null}
									{known.map((p) => <ui.item key={p.id} checked={p.id === linked} onClick={() => flux.link(project.id, p.id)}>{p.name}</ui.item>)}
								</ui.menu>
								<ui.menu label={`Actions for ${project.name}`} tooltip="Project actions" style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: "control", color: "text2", hover: { backgroundColor: "hover", color: "text" }, checked: { backgroundColor: "hover", color: "text" } }}>
									<ui.icon icon="more" style={{ width: 14, height: 14, color: "currentColor" }} />
									<ui.item icon="settings" onClick={() => openProjectSettings(project)}>Project settings…</ui.item>
									<ui.item icon="up" disabled={i === 0} onClick={() => moveProject(flux, project, -1)}>Move up</ui.item>
									<ui.item icon="down" disabled={i === projects.length - 1} onClick={() => moveProject(flux, project, 1)}>Move down</ui.item>
									<ui.separator />
									<ui.item icon="trash" danger onClick={() => confirmDelete(flux, project)}>Delete project…</ui.item>
								</ui.menu>
							</ui.box>
						);
					})}
				</ui.box>
			)}
		</ui.box>
	);
}
