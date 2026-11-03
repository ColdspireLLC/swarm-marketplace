// The form that connects a Flux, as bb's connect.tsx: its URL and an API
// token, tried with Flux before anything is kept, and kept on the
// workspace it's on. A token for all its account's workspaces that
// reaches several lists them, to tick the ones to add: each is a
// connection of its own, on its workspace, with the token. Setup and the plugin's page of Settings show it.
import { storage, ui } from "swarm";
import { FluxClient, describe, normalizeBaseUrl, type WorkspaceChoice } from "./client";
import { hub } from "./hub";
import type { PictureSource } from "./pictures";
import { checkFlux } from "./service";
import { WorkspaceLogo } from "./view";

/** The workspaces a token reaches, once Flux has said, to pick from. */
interface Pick {
	url: string;
	token: string;
	baseUrl: string;
	account: string;
	workspaces: WorkspaceChoice[];
	/** The ids ticked. */
	chosen: string[];
}

interface Form {
	url: string;
	token: string;
	busy: boolean;
	error: string;
	pick: Pick | null;
}

// Tracked: each form's fields, as they're typed and as it connects.
const forms = ui.store(new Map<string, Form>());

// Not tracked: a client per workspace listed, which reads its logo.
const sources = new Map<string, PictureSource>();

function formOf(key: string, url: string): Form {
	if (!forms.has(key)) forms.set(key, { url, token: "", busy: false, error: "", pick: null });
	return forms.get(key)!;
}

function close(name: string) {
	forms.delete(name);
	for (const key of sources.keys()) if (key.startsWith(name + "\n")) sources.delete(key);
}

/** Whether a connection is on that workspace of that Flux already, other than except. */
function connectedTo(baseUrl: string, workspace: string, except: string | null = null) {
	return hub.connected().some((flux) => flux.id !== except && flux.baseUrl === baseUrl && flux.workspaceId === workspace);
}

function sameFlux(url: string, baseUrl: string) {
	try {
		return normalizeBaseUrl(url) === baseUrl;
	} catch {
		return false;
	}
}

function sourceOf(name: string, pick: Pick, workspace: string): PictureSource {
	const key = `${name}\n${pick.baseUrl}\n${workspace}`;
	let source = sources.get(key);
	if (!source) {
		const client = new FluxClient({ baseUrl: pick.baseUrl, token: pick.token, deviceId: storage.get<string>("deviceId") ?? "", workspaceId: workspace });
		source = { baseUrl: client.baseUrl, requireClient: () => client };
		sources.set(key, source);
	}
	return source;
}

/**
 * name keeps each form's text apart. target is the Flux whose URL and token
 * it replaces, or null for a new one. done runs once it's connected.
 */
export function ConnectForm({ name, target, url = "", done, cancel }: { name: string; target: string | null; url?: string; done?: () => void; cancel?: () => void }) {
	const form = formOf(name, url);
	if (form.pick) return <Picker name={name} form={form} pick={form.pick} done={done} cancel={cancel} />;
	const go = () => void connect(name, form, target, done);
	const tokens = /^https?:\/\/[^/\s]+/.exec(form.url.trim())?.[0];
	return (
		<ui.box style={{ gap: 14 }}>
			<ui.box style={{ gap: 6 }}>
				<ui.text style={{ fontWeight: 500 }}>Flux URL</ui.text>
				<ui.field key={name + "-url"} value={form.url} placeholder="https://flux.example.com" onChange={(value) => { form.url = value; form.error = ""; }} onSubmit={go} />
			</ui.box>
			<ui.box style={{ gap: 6 }}>
				<ui.text style={{ fontWeight: 500 }}>API token</ui.text>
				<ui.field key={name + "-token"} secret value={form.token} placeholder="flux_…" onChange={(value) => { form.token = value; form.error = ""; }} onSubmit={go} style={{ fontFamily: "mono" }} />
				<ui.box style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
					<ui.text style={{ fontSize: "small", color: "text3" }}>Make one in Flux, under</ui.text>
					{tokens ? <ui.link label="Settings, API tokens." href={`${tokens}/settings/tokens`} style={{ fontSize: "small" }} /> : <ui.text style={{ fontSize: "small", color: "text3" }}>Settings, API tokens.</ui.text>}
				</ui.box>
			</ui.box>
			{form.error ? (
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", padding: "s3 s4", borderRadius: "control", backgroundColor: "redSoft" }}>
					<ui.icon icon="alert-circle" style={{ width: 14, height: 14, color: "red", flexShrink: 0, marginTop: 2 }} />
					<ui.text style={{ flex: 1, minWidth: 0 }}>{form.error}</ui.text>
				</ui.box>
			) : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				{cancel ? <ui.button kind="ghost" onClick={() => { close(name); cancel(); }}>Cancel</ui.button> : null}
				<ui.button kind="primary" disabled={form.busy} onClick={go}>{form.busy ? "Connecting…" : "Connect"}</ui.button>
			</ui.box>
		</ui.box>
	);
}

/** The workspaces a token reaches, each with its mark, to tick the ones to add. */
function Picker({ name, form, pick, done, cancel }: { name: string; form: Form; pick: Pick; done?: () => void; cancel?: () => void }) {
	const fresh = pick.chosen.filter((id) => !connectedTo(pick.baseUrl, id));
	const add = () => {
		const picked = pick.workspaces.filter((ws) => fresh.includes(ws.id));
		if (picked.length === 0) return;
		const ids = picked.map((ws) => hub.save(null, pick.url, pick.token, ws.id));
		// The first one picked is the one in use.
		hub.use(ids[0]!);
		close(name);
		ui.toast(picked.length === 1 ? `Connected to ${picked[0]!.name} as ${pick.account}.` : `Connected to ${picked.length} workspaces as ${pick.account}.`);
		done?.();
	};
	return (
		<ui.box style={{ gap: 14 }}>
			<ui.box style={{ gap: 4 }}>
				<ui.text style={{ fontWeight: 500 }}>Workspaces</ui.text>
				<ui.text style={{ fontSize: "small", color: "text2" }}>{`${pick.account}'s token reaches ${pick.workspaces.length} workspaces. Each one ticked is added on its own, with this token.`}</ui.text>
			</ui.box>
			<ui.box style={{ gap: 2 }}>
				{pick.workspaces.map((ws) => {
					const already = connectedTo(pick.baseUrl, ws.id);
					const on = already || pick.chosen.includes(ws.id);
					return (
						<ui.box key={ws.id} style={{ flexDirection: "row", gap: 10, alignItems: "center", height: 36, paddingLeft: 8, paddingRight: 8, borderRadius: "control" }}>
							<ui.checkbox tooltip={already ? `${ws.name} is connected already` : `Add ${ws.name}`} checked={on} disabled={already} onChange={(value) => { pick.chosen = value ? [...pick.chosen.filter((id) => id !== ws.id), ws.id] : pick.chosen.filter((id) => id !== ws.id); }} />
							<WorkspaceLogo workspace={ws} fallback={pick.baseUrl} from={sourceOf(name, pick, ws.id)} size={20} />
							<ui.text style={{ flex: 1, minWidth: 0, color: already ? "text2" : "text" }} maxLines={1}>{ws.name}</ui.text>
							{already ? (
								<ui.box style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1, borderRadius: 4, backgroundColor: "hover", flexShrink: 0 }}>
									<ui.text style={{ fontSize: 11, color: "text2" }}>Connected</ui.text>
								</ui.box>
							) : null}
						</ui.box>
					);
				})}
			</ui.box>
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				<ui.button kind="ghost" onClick={() => { form.pick = null; }}>Back</ui.button>
				{cancel ? <ui.button kind="ghost" onClick={() => { close(name); cancel(); }}>Cancel</ui.button> : null}
				<ui.button kind="primary" disabled={fresh.length === 0} onClick={add}>{fresh.length > 1 ? `Add ${fresh.length} workspaces` : fresh.length === 1 ? "Add 1 workspace" : "Add"}</ui.button>
			</ui.box>
		</ui.box>
	);
}

async function connect(name: string, form: Form, target: string | null, done?: () => void) {
	const url = form.url.trim();
	const token = form.token.trim();
	if (form.busy) return;
	if (!url || !token) {
		form.error = !url ? "Give Flux's URL: the address you open Flux at." : "Give an API token: make one in Flux, under Settings, API tokens.";
		return;
	}
	form.busy = true;
	form.error = "";
	try {
		// A connection being changed stays on its workspace, at the same Flux.
		const changing = target ? hub.all().find((flux) => flux.id === target) : undefined;
		const pinned = changing && sameFlux(url, changing.baseUrl) ? changing.workspaceId ?? "" : "";
		const found = await checkFlux(url, token, pinned);
		if (target === null && found.workspaces.length > 1) {
			const fresh = found.workspaces.filter((ws) => !connectedTo(found.baseUrl, ws.id)).map((ws) => ws.id);
			form.pick = { url, token, baseUrl: found.baseUrl, account: found.account, workspaces: found.workspaces, chosen: fresh };
			return;
		}
		if (connectedTo(found.baseUrl, found.workspace.id, target)) throw new Error(`${found.workspace.name} at ${found.baseUrl} is connected already: change its token there.`);
		hub.save(target, url, token, found.workspace.id);
		close(name);
		ui.toast(`Connected to ${found.workspace.name} as ${found.account}.`);
		done?.();
	} catch (e) {
		form.error = describe(e);
	} finally {
		form.busy = false;
	}
}
