// The form that connects a Flux, as bb's connect.tsx: its URL and an API
// token, tried with Flux before anything is kept. Setup and the plugin's
// page of Settings show it.
import { ui } from "swarm";
import { describe } from "./client";
import { hub } from "./hub";
import { checkFlux } from "./service";

interface Form {
	url: string;
	token: string;
	busy: boolean;
	error: string;
}

const forms = new Map<string, Form>();

function formOf(key: string, url: string): Form {
	let form = forms.get(key);
	if (!form) forms.set(key, (form = { url, token: "", busy: false, error: "" }));
	return form;
}

/**
 * name keeps each form's text apart. target is the Flux whose URL and token
 * it replaces, or null for a new one. done runs once it's connected.
 */
export function ConnectForm({ name, target, url = "", done, cancel }: { name: string; target: string | null; url?: string; done?: () => void; cancel?: () => void }) {
	const form = formOf(name, url);
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
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", padding: "s3 s4", borderRadius: "control", backgroundColor: "redSoft" }}>
					<ui.icon icon="alert-circle" style={{ width: 14, height: 14, color: "red", flexShrink: 0 }} />
					<ui.text style={{ flex: 1, minWidth: 0 }}>{form.error}</ui.text>
				</ui.box>
			) : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				{cancel ? <ui.button kind="ghost" onClick={() => { forms.delete(name); cancel(); }}>Cancel</ui.button> : null}
				<ui.button kind="primary" disabled={form.busy} onClick={go}>{form.busy ? "Connecting…" : "Connect"}</ui.button>
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
		ui.update();
		return;
	}
	form.busy = true;
	form.error = "";
	ui.update();
	try {
		const found = await checkFlux(url, token);
		const twin = hub.connected().find((flux) => flux.id !== target && flux.baseUrl === found.baseUrl && flux.workspace?.id === found.workspace.id);
		if (twin) throw new Error(`${found.workspace.name} at ${found.baseUrl} is connected already: change its token there.`);
		hub.save(target, url, token);
		forms.delete(name);
		ui.toast(`Connected to ${found.workspace.name} as ${found.account}.`);
		done?.();
	} catch (e) {
		form.error = describe(e);
	} finally {
		form.busy = false;
		ui.update();
	}
}
