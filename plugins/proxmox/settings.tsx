// Proxmox's page of Settings: its address and an API token, tried before
// they're kept. A Proxmox with a certificate of its own (as every one has
// until it's given another) is shown with that certificate's fingerprint,
// to compare with the one under its Certificates, and trusted once the
// user says so: that one, and no other after.
import { settings, ui, type Child, type RenderContext } from "swarm";
import * as api from "./pve";
import { conn, forget, message, PAGE, readList, state } from "./store";
import { line, phone, problem, setPhone } from "./view";

const form = { url: "", tokenId: "", secret: "", busy: false, error: "", editing: false, certificate: "", changed: false };

/** A fingerprint as Proxmox shows it, under its node's Certificates: AB:CD:… */
export function shownFingerprint(fp: string): string {
	return fp.replace(/^sha256:/, "").toUpperCase().match(/../g)?.join(":") ?? fp;
}

async function connect(trust = "") {
	if (form.busy) return;
	const url = api.baseOf(form.url);
	const tokenId = form.tokenId.trim();
	const secret = form.secret.trim();
	form.error = api.urlProblem(form.url) || api.tokenIdProblem(tokenId) || (!secret ? "Give the token's secret: Proxmox shows it once, as the token's made." : "");
	if (form.error) return ui.update();
	form.busy = true;
	ui.update();
	// The certificate trusted before, for the same address, stays trusted.
	const was = conn();
	const certificate = trust || (was && api.baseOf(was.url) === url ? was.certificate : "");
	const c = { url, tokenId, secret, certificate };
	try {
		const v = await api.version(c);
		// /version answers any token: the resources say it may see the cluster.
		await api.resources(c);
		settings.set({ url, tokenId, secret, certificate: certificate || null });
		form.secret = "";
		form.editing = false;
		form.certificate = "";
		forget();
		state.version = v.version;
		ui.toast(`Connected to Proxmox VE ${v.version}.`);
		void readList();
	} catch (e) {
		if (e instanceof api.PveError && e.certificate) {
			form.certificate = e.certificate;
			form.changed = !!certificate;
			form.error = "";
		} else form.error = message(e);
	}
	form.busy = false;
	ui.update();
}

/** Trusts the certificate a connected Proxmox now shows, after the user compared it. */
function trustNew(fp: string) {
	settings.set({ certificate: fp });
	state.certificate = "";
	state.err = "";
	void readList();
}

function certCard(fp: string, changed: boolean, onTrust: () => void, onCancel?: () => void): Child {
	return (
		<ui.card padding="s5 s6" gap="s4" tone={changed ? "red" : undefined}>
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
				<ui.icon icon={changed ? "alert" : "shield"} style={{ width: 16, height: 16, color: changed ? "red" : "amber", marginTop: 1, flexShrink: 0 }} />
				<ui.box style={{ flex: 1, minWidth: 0, gap: 4 }}>
					<ui.text style={{ fontWeight: 500 }}>{changed ? "Proxmox shows another certificate" : "Trust Proxmox's own certificate?"}</ui.text>
					<ui.text style={{ fontSize: "small", color: "text2" }}>
						{changed
							? "It isn't the one you trusted. If you gave Proxmox a new certificate, or it made one, compare its fingerprint below and trust it. If not, someone may be in the way: don't."
							: "Proxmox made its certificate itself as it was installed, so no certificate authority vouches for it. Compare its fingerprint with the one in Proxmox, under the node's System, Certificates (pve-ssl.pem), and trust it if they're the same. Swarm then trusts that one alone."}
					</ui.text>
				</ui.box>
			</ui.box>
			<ui.box style={{ padding: "s3 s4", borderRadius: "control", backgroundColor: "field" }}>
				<ui.text selectable style={{ fontFamily: "mono", fontSize: 12, color: "text2", whiteSpace: "normal" }}>{shownFingerprint(fp)}</ui.text>
			</ui.box>
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				{onCancel ? <ui.button kind="ghost" onClick={onCancel} style={phone.on ? { flex: 1 } : undefined}>Cancel</ui.button> : null}
				<ui.button kind={changed ? "danger" : "primary"} onClick={onTrust} style={phone.on ? { flex: 1 } : undefined}>{changed ? "Trust the new one" : "Trust and connect"}</ui.button>
			</ui.box>
		</ui.card>
	);
}

export function settingsPage({ args }: RenderContext): Child {
	setPhone(args);
	const c = conn();
	const field = (title: string, children: Child, hint?: Child) => (
		<ui.box style={{ gap: 6 }}>
			<ui.text style={{ fontWeight: 500 }}>{title}</ui.text>
			{children}
			{hint}
		</ui.box>
	);
	const hint = (text: string) => <ui.text style={{ fontSize: "small", color: "text3" }}>{text}</ui.text>;
	if (c && !form.editing) {
		const disconnect = () => {
			settings.set({ url: null, tokenId: null, secret: null, certificate: null });
			forget();
		};
		const change = () => {
			form.url = c.url;
			form.tokenId = c.tokenId;
			form.secret = "";
			form.error = "";
			form.certificate = "";
			form.editing = true;
		};
		const detail = [api.baseOf(c.url), state.version ? `Proxmox VE ${state.version}` : "", c.certificate ? "its own certificate, trusted" : ""].filter(Boolean).join(" · ");
		return (
			<ui.box style={{ gap: 16 }}>
				<ui.card padding="s5 s6" gap="s5" style={phone.on ? undefined : { flexDirection: "row", alignItems: "center" }}>
					<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center", flex: 1, minWidth: 0 }}>
						<ui.icon icon="check-circle" style={{ width: 16, height: 16, color: "green", alignSelf: "flex-start", marginTop: 1, flexShrink: 0 }} />
						<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
							<ui.text style={{ fontWeight: 500 }}>Connected</ui.text>
							<ui.text style={{ fontSize: "small", color: "text2", ...line }}>{detail}</ui.text>
							<ui.text style={{ fontSize: "small", color: "text3", ...line }}>{`As ${c.tokenId}`}</ui.text>
						</ui.box>
					</ui.box>
					<ui.box style={{ flexDirection: "row", gap: 8 }}>
						<ui.button kind={phone.on ? "secondary" : "ghost"} onClick={change} style={phone.on ? { flex: 1 } : undefined}>Change…</ui.button>
						<ui.button kind={phone.on ? "secondary" : "ghost"} onClick={disconnect} style={phone.on ? { flex: 1 } : undefined}>Disconnect</ui.button>
					</ui.box>
				</ui.card>
				{state.certificate ? certCard(state.certificate, true, () => trustNew(state.certificate)) : state.err ? problem(state.err) : null}
				<ui.box style={{ flexDirection: "row" }}>
					<ui.link label="Open the Proxmox page" href={`swarm://plugin/${PAGE}`} />
				</ui.box>
			</ui.box>
		);
	}
	if (form.certificate)
		return (
			<ui.box style={{ gap: 14, maxWidth: 560 }}>
				{certCard(form.certificate, form.changed, () => void connect(form.certificate), () => void (form.certificate = ""))}
			</ui.box>
		);
	return (
		<ui.box style={{ gap: 14, maxWidth: 520 }}>
			<ui.text style={{ color: "text2" }}>Connect your Proxmox VE server or cluster to see its nodes, VMs and containers, start and stop them, take snapshots and follow their tasks, here and from an agent's command line.</ui.text>
			{field("Address", <ui.field key="url" value={form.url} placeholder="https://pve.local:8006" onChange={(v) => { form.url = v; form.error = ""; }} onSubmit={() => void connect()} />, hint("As you open Proxmox in a browser. Any node of a cluster reaches all of it."))}
			{field("API token ID", <ui.field key="tokenId" value={form.tokenId} placeholder="root@pam!swarm" onChange={(v) => { form.tokenId = v; form.error = ""; }} onSubmit={() => void connect()} style={{ fontFamily: "mono" }} />)}
			{field(
				"Secret",
				<ui.field key="secret" secret value={form.secret} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={(v) => { form.secret = v; form.error = ""; }} onSubmit={() => void connect()} style={{ fontFamily: "mono" }} />,
				hint("Make a token in Proxmox, under Datacenter, Permissions, API Tokens. Turn off its privilege separation to give it your user's rights, or give it a role (PVEVMAdmin to start and stop, PVEAuditor to look). The secret is kept in your keychain."),
			)}
			{form.error ? problem(form.error) : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				{c ? <ui.button kind={phone.on ? "secondary" : "ghost"} onClick={() => { form.editing = false; form.error = ""; }} style={phone.on ? { flex: 1 } : undefined}>Cancel</ui.button> : null}
				<ui.button kind="primary" disabled={form.busy} onClick={() => void connect()} style={phone.on ? { flex: 1 } : undefined}>{form.busy ? "Connecting…" : "Connect"}</ui.button>
			</ui.box>
		</ui.box>
	);
}
