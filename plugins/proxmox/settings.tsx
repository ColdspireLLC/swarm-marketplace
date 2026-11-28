// Proxmox's page of Settings: the servers, each with its address and how
// it signs in (an API token, or a user's password, with a TOTP code where
// it has a second factor), tried before it's kept. A Proxmox with a
// certificate of its own (as every one has until it's given another) is
// shown with that certificate's fingerprint, to compare with the one under
// its Certificates, and trusted once the user says so: that one, and no
// other after.
import { ui, type Child, type RenderContext } from "swarm";
import * as api from "./pve";
import { connOf, current, newId, removeServer, saveServer, servers, setCurrent, trial, trustCertificate, type Server } from "./servers";
import { conn, forget, message, PAGE, readList, state } from "./store";
import { line, phone, problem, setPhone } from "./view";

type Form = {
	/** The server changed; "" for a new one. */
	id: string;
	name: string;
	url: string;
	auth: "token" | "password";
	who: string;
	secret: string;
	otp: string;
	/** Proxmox asked for a code. */
	needsCode: boolean;
	busy: boolean;
	error: string;
	certificate: string;
	changed: boolean;
};

let form: Form | undefined;
const confirmRemove = { id: "" };

const blank = (): Form => ({ id: "", name: "", url: "", auth: "token", who: "", secret: "", otp: "", needsCode: false, busy: false, error: "", certificate: "", changed: false });

/** A fingerprint as Proxmox shows it, under its node's Certificates: AB:CD:… */
export function shownFingerprint(fp: string): string {
	return fp.replace(/^sha256:/, "").toUpperCase().match(/../g)?.join(":") ?? fp;
}

const userProblem = (u: string) => (!u.trim() ? "Give the user, as Proxmox signs in: root@pam." : /^[^@\s]+@[^@\s!]+$/.test(u.trim()) ? "" : `${u.trim()} isn't a user: it's USER@REALM, as root@pam.`);

async function connect(f: Form, trust = "") {
	if (f.busy) return;
	const url = api.baseOf(f.url);
	const who = f.who.trim();
	const was = f.id ? servers().find((s) => s.id === f.id) : undefined;
	// Changing a server, an empty secret keeps the one it has.
	const kept = was && !f.secret.trim() && was.auth === f.auth ? connOf(was) : null;
	const secret = f.secret.trim() || (kept ? (kept.auth.kind === "token" ? kept.auth.secret : kept.auth.password) : "");
	f.error =
		api.urlProblem(f.url) ||
		(f.auth === "token" ? api.tokenIdProblem(who) : userProblem(who)) ||
		(!secret ? (f.auth === "token" ? "Give the token's secret: Proxmox shows it once, as the token's made." : "Give the password.") : "") ||
		(servers().some((s) => s.id !== f.id && s.name.toLowerCase() === (f.name.trim() || hostOf(url)).toLowerCase()) ? "Another server has that name." : "");
	if (f.error) return ui.update();
	f.busy = true;
	ui.update();
	// The certificate trusted before, for the same address, stays trusted.
	const certificate = trust || (was && api.baseOf(was.url) === url ? was.certificate : "");
	const s: Server = { id: f.id || newId(), name: f.name.trim() || hostOf(url), url, certificate, auth: f.auth, who };
	const c = trial(s, secret);
	try {
		if (c.auth.kind === "password") await api.login(c, f.otp);
		const v = await api.version(c);
		// /version answers anyone signed in: the resources say it may see the cluster.
		await api.resources(c);
		saveServer(s, c);
		if (!f.id || servers().length === 1) setCurrent(s.id);
		form = undefined;
		forget();
		state.version = v.version;
		ui.toast(`Connected to ${s.name}, Proxmox VE ${v.version}.`);
		void readList();
	} catch (e) {
		if (e instanceof api.PveError && e.certificate) {
			f.certificate = e.certificate;
			f.changed = !!certificate;
			f.error = "";
		} else if (e instanceof api.PveError && e.code === "tfa") {
			f.needsCode = true;
			f.error = f.otp ? message(e) : "";
		} else f.error = message(e);
	}
	f.busy = false;
	ui.update();
}

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
};

/** The current server's code, as a sign-in that lapsed asks it. */
const signIn = { otp: "", busy: false, error: "" };

async function signInAgain() {
	const c = conn();
	if (!c || signIn.busy) return;
	signIn.busy = true;
	signIn.error = "";
	ui.update();
	try {
		await api.login(c, signIn.otp, true);
		signIn.otp = "";
		state.err = "";
		state.needsCode = false;
		void readList();
	} catch (e) {
		signIn.error = message(e);
	}
	signIn.busy = false;
	ui.update();
}

/** Asks the current server's TOTP code, where its ticket lapsed: on the page and in Settings. */
export function codeCard(): Child {
	const s = current();
	if (!s) return null;
	return (
		<ui.card padding="s5 s6" gap="s4" style={{ maxWidth: 420, alignSelf: "center", width: "100%" }}>
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
				<ui.icon icon="lock" style={{ width: 16, height: 16, color: "text2", marginTop: 1, flexShrink: 0 }} />
				<ui.box style={{ flex: 1, minWidth: 0, gap: 4 }}>
					<ui.text style={{ fontWeight: 500 }}>{`Sign in to ${s.name} again`}</ui.text>
					<ui.text style={{ fontSize: "small", color: "text2" }}>{`Its sign-in lapsed while Swarm was closed. Give ${s.who}'s code from your authenticator app.`}</ui.text>
				</ui.box>
			</ui.box>
			<ui.field key="signin-otp" autoFocus value={signIn.otp} placeholder="123456" onChange={(v) => void (signIn.otp = v)} onSubmit={() => void signInAgain()} style={{ fontFamily: "mono" }} />
			{signIn.error ? problem(signIn.error) : null}
			<ui.box style={{ flexDirection: "row", justifyContent: "flex-end" }}>
				<ui.button kind="primary" disabled={signIn.busy || !signIn.otp.trim()} onClick={() => void signInAgain()}>{signIn.busy ? "Signing in…" : "Sign in"}</ui.button>
			</ui.box>
		</ui.card>
	);
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

function formView(f: Form): Child {
	if (f.certificate) return <ui.box style={{ gap: 14, maxWidth: 560 }}>{certCard(f.certificate, f.changed, () => void connect(f, f.certificate), () => void (f.certificate = ""))}</ui.box>;
	const field = (title: string, children: Child, hint?: string) => (
		<ui.box key={title} style={{ gap: 6 }}>
			<ui.text style={{ fontWeight: 500 }}>{title}</ui.text>
			{children}
			{hint ? <ui.text style={{ fontSize: "small", color: "text3" }}>{hint}</ui.text> : null}
		</ui.box>
	);
	const editing = !!f.id;
	const first = !servers().length;
	const set = (k: "name" | "url" | "who" | "secret" | "otp") => (v: string) => {
		f[k] = v;
		f.error = "";
	};
	return (
		<ui.box style={{ gap: 14, maxWidth: 520 }}>
			{first ? <ui.text style={{ color: "text2" }}>Connect your Proxmox VE server or cluster to see its nodes, VMs and containers, start and stop them, open their consoles, take snapshots and backups and follow their tasks, here and from an agent's command line.</ui.text> : <ui.text style={{ fontWeight: 600 }}>{editing ? `Change ${f.name}` : "Add a server"}</ui.text>}
			{field("Address", <ui.field key="url" value={f.url} placeholder="https://pve.local:8006" onChange={set("url")} onSubmit={() => void connect(f)} />, "As you open Proxmox in a browser. Any node of a cluster reaches all of it.")}
			{field("Name", <ui.field key="name" value={f.name} placeholder={f.url ? hostOf(api.baseOf(f.url)) : "homelab"} onChange={set("name")} onSubmit={() => void connect(f)} />)}
			{field(
				"Sign in with",
				<ui.segmented key="auth" label="Sign in with" value={f.auth} options={[{ value: "token", label: "API token" }, { value: "password", label: "Password" }]} onChange={(v) => { f.auth = v as Form["auth"]; f.who = ""; f.secret = ""; f.error = ""; f.needsCode = false; }} style={{ alignSelf: "flex-start" }} />,
			)}
			{f.auth === "token"
				? [
						field("API token ID", <ui.field key="tokenId" value={f.who} placeholder="root@pam!swarm" onChange={set("who")} onSubmit={() => void connect(f)} style={{ fontFamily: "mono" }} />),
						field(
							"Secret",
							<ui.field key="secret" secret value={f.secret} placeholder={editing ? "Unchanged" : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"} onChange={set("secret")} onSubmit={() => void connect(f)} style={{ fontFamily: "mono" }} />,
							"Make a token in Proxmox, under Datacenter, Permissions, API Tokens. Turn off its privilege separation to give it your user's rights, or give it a role (PVEVMAdmin to start and stop, PVEAuditor to look). The secret is kept in your keychain.",
						),
					]
				: [
						field("User", <ui.field key="user" value={f.who} placeholder="root@pam" onChange={set("who")} onSubmit={() => void connect(f)} style={{ fontFamily: "mono" }} />),
						field("Password", <ui.field key="password" secret value={f.secret} placeholder={editing ? "Unchanged" : "Its password"} onChange={set("secret")} onSubmit={() => void connect(f)} />, "Kept in your keychain. Swarm signs in again with it as its session lapses."),
						f.needsCode ? field("Code", <ui.field key="otp" autoFocus value={f.otp} placeholder="123456" onChange={set("otp")} onSubmit={() => void connect(f)} style={{ fontFamily: "mono" }} />, "From your authenticator app: Proxmox asks for a second factor. Swarm asks again only if its session lapses, as when it's been closed for two hours.") : null,
					]}
			{f.error ? problem(f.error) : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				{first ? null : <ui.button kind={phone.on ? "secondary" : "ghost"} onClick={() => void (form = undefined)} style={phone.on ? { flex: 1 } : undefined}>Cancel</ui.button>}
				<ui.button kind="primary" disabled={f.busy} onClick={() => void connect(f)} style={phone.on ? { flex: 1 } : undefined}>{f.busy ? "Connecting…" : editing ? "Save" : "Connect"}</ui.button>
			</ui.box>
		</ui.box>
	);
}

function serverRow(s: Server, isCurrent: boolean): Child {
	const edit = () => void (form = { ...blank(), id: s.id, name: s.name, url: s.url, auth: s.auth, who: s.who });
	return (
		<ui.box key={s.id} style={{ borderTop: "1px solid divider" }}>
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: "s4 s6" }}>
				<ui.icon icon="server" style={{ width: 16, height: 16, color: "text2", alignSelf: "flex-start", marginTop: 1, flexShrink: 0 }} />
				<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
						<ui.text style={{ fontWeight: 500, ...line }}>{s.name}</ui.text>
						{isCurrent && servers().length > 1 ? <ui.tag tone="accent">Shown</ui.tag> : null}
					</ui.box>
					<ui.text style={{ fontSize: "small", color: "text2", ...line }}>{[api.baseOf(s.url), isCurrent && state.version ? `Proxmox VE ${state.version}` : "", s.certificate ? "its own certificate, trusted" : ""].filter(Boolean).join(" · ")}</ui.text>
					<ui.text style={{ fontSize: "small", color: "text3", ...line }}>{`As ${s.who}${s.auth === "password" ? ", with its password" : ""}`}</ui.text>
				</ui.box>
				<ui.menu label="" icon="more" kind="ghost" tooltip={`Act on ${s.name}`}>
					{isCurrent ? null : <ui.item icon="eye" label="Show it" onClick={() => setCurrent(s.id)} />}
					<ui.item icon="pencil" label="Change…" onClick={edit} />
					<ui.item icon="trash" label="Remove…" danger onClick={() => void (confirmRemove.id = s.id)} />
				</ui.menu>
			</ui.box>
			{confirmRemove.id === s.id ? (
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", padding: "0 s6 s4", flexWrap: "wrap" }}>
					<ui.text style={{ flex: 1, fontSize: "small", color: "text2", minWidth: 160 }}>{`Swarm forgets ${s.name} and its ${s.auth === "token" ? "token" : "password"}. Proxmox keeps everything.`}</ui.text>
					<ui.button kind="ghost" size="sm" onClick={() => void (confirmRemove.id = "")}>Keep it</ui.button>
					<ui.button kind="danger" size="sm" onClick={() => { confirmRemove.id = ""; removeServer(s.id); forget(); }}>{`Remove ${s.name}`}</ui.button>
				</ui.box>
			) : null}
		</ui.box>
	);
}

export function settingsPage({ args }: RenderContext): Child {
	setPhone(args);
	const all = servers();
	if (!all.length) form ??= blank();
	if (form) return formView(form);
	const cur = current();
	return (
		<ui.box style={{ gap: 16 }}>
			<ui.card padding="s0" gap="s0">
				<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: "s4 s6" }}>
					<ui.text style={{ fontWeight: 500, flex: 1 }}>{all.length === 1 ? "Server" : "Servers"}</ui.text>
					<ui.button size="sm" icon="plus" onClick={() => void (form = blank())}>Add server</ui.button>
				</ui.box>
				{all.map((s) => serverRow(s, s.id === cur?.id))}
			</ui.card>
			{state.needsCode ? codeCard() : state.certificate && cur ? certCard(state.certificate, true, () => { trustCertificate(cur.id, state.certificate); state.certificate = ""; state.err = ""; void readList(); }) : state.err ? problem(state.err) : null}
			<ui.box style={{ flexDirection: "row" }}>
				<ui.link label="Open the Proxmox page" href={`swarm://plugin/${PAGE}`} />
			</ui.box>
		</ui.box>
	);
}
