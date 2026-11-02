// Coolify's page of Settings: Coolify's URL and an API token, tried before
// they're kept; and the agents' access to Coolify's own MCP server.
import { call, http, settings, ui, type Child } from "swarm";
import * as api from "./coolify";
import { conn, forget, message, PAGE, readList, state, watch } from "./store";
import { line, problem } from "./view";

// ---- Its page of Settings ----

const form = { url: "", token: "", busy: false, error: "", version: "", editing: false };

async function connect() {
	const url = api.baseOf(form.url);
	const token = form.token.trim();
	if (form.busy) return;
	form.error = api.urlProblem(form.url) || (!token ? "Give an API token: make one in Coolify, under Keys & Tokens, API tokens." : "");
	if (form.error) return ui.update();
	form.busy = true;
	ui.update();
	try {
		const v = await api.version({ url, token });
		// /version alone needs only read: the list tells the token reaches the team's resources.
		await api.resources({ url, token });
		settings.set({ url, token });
		mcp.state = "";
		form.version = v;
		form.token = "";
		form.editing = false;
		forget();
		ui.toast(`Connected to Coolify ${v}.`);
		void readList();
		watch(true);
	} catch (e) {
		form.error = message(e);
	}
	form.busy = false;
	ui.update();
}

// ---- Coolify's MCP server, for the agents ----
//
// Coolify (4.5 on) has an MCP server of its own at /mcp: some 90 tools that
// set things up (applications from a repository, databases, services from
// templates, env vars, domains, backups) under the token's abilities. The
// agents reach it through the plugin's route, which adds the Coolify token
// itself: their configuration holds only the address of this machine's
// route and a key of the plugin's, which a turn off and on again replaces,
// never the Coolify token.

const MCP_NAME = "coolify";
/** Swarm's agents, by ID, which the server is added to where they take remote servers. */
const AGENTS: { [id: string]: string } = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", grok: "Grok Build" };

const mcp = { state: "" as string, checking: false, busy: false, err: "" };

const mcpKey = () => String(settings.get("mcpKey") ?? "");
const hooked = () => String(settings.get("mcpAgents") ?? "").split(",").filter(Boolean);

async function checkMcp() {
	const c = conn();
	if (!c || mcp.checking) return;
	mcp.checking = true;
	mcp.state = await api.mcpState(c);
	mcp.checking = false;
	ui.update();
}

/** The route the agents' MCP requests come to: the plugin's key, then on to Coolify with its token. */
export async function mcpRoute(req: { method: string; headers: { [name: string]: string }; body?: string }) {
	const json = { "content-type": "application/json" };
	const auth = Object.entries(req.headers).find(([k]) => k.toLowerCase() === "authorization")?.[1] ?? "";
	const key = mcpKey();
	if (!key || auth !== `Bearer ${key}`) return { status: 401, headers: json, body: JSON.stringify({ error: "Not this plugin's key: turn Coolify's agents on again in Swarm, Settings, Coolify." }) };
	const c = conn();
	if (!c) return { status: 503, headers: json, body: JSON.stringify({ error: "Coolify isn't connected: connect it in Swarm, Settings, Coolify." }) };
	return api.forwardMcp(c, req);
}

function newKey(): string {
	const b = new Uint8Array(32);
	crypto.getRandomValues(b);
	return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Adds Coolify's server to each agent that takes a remote one, with a new key. */
async function hookAgents() {
	const key = newKey();
	settings.set({ mcpKey: key });
	const added: string[] = [];
	const failed: string[] = [];
	for (const id of Object.keys(AGENTS)) {
		let caps;
		try {
			caps = await call("MCPCaps", { provider: id });
		} catch {
			continue; // Not an agent of this Swarm.
		}
		if (!caps?.remote || !(caps.scopes ?? []).includes("user")) continue;
		try {
			await call("RemoveMCP", { provider: id, server: { name: MCP_NAME, scope: "user" } }).catch(() => undefined);
			await call("AddMCP", { provider: id, mcp: { name: MCP_NAME, scope: "user", url: http.url("/mcp"), transport: "http", headers: [{ name: "Authorization", value: `Bearer ${key}` }] } });
			added.push(id);
		} catch (e) {
			failed.push(`${AGENTS[id]}: ${message(e)}`);
		}
	}
	settings.set({ mcpAgents: added.join(",") });
	if (failed.length) throw new Error(failed.join("; "));
	if (!added.length) throw new Error("None of your agents takes a remote MCP server.");
}

export async function unhookAgents() {
	for (const id of hooked()) await call("RemoveMCP", { provider: id, server: { name: MCP_NAME, scope: "user" } }).catch((e) => console.warn(`Taking Coolify from ${id}: ${message(e)}`));
	settings.set({ mcpAgents: null, mcpKey: null });
}

async function toggleAgents(on: boolean) {
	if (mcp.busy) return;
	mcp.busy = true;
	mcp.err = "";
	ui.update();
	try {
		if (on) await hookAgents();
		else await unhookAgents();
	} catch (e) {
		mcp.err = message(e).includes("may not") || message(e).includes("grant") ? `${message(e)} It needs Configure the agents, in Plugins, Coolify.` : message(e);
	}
	mcp.busy = false;
	ui.update();
}

async function turnOnMcp() {
	const c = conn();
	if (!c || mcp.busy) return;
	mcp.busy = true;
	mcp.err = "";
	ui.update();
	try {
		await api.enableMcp(c);
		mcp.state = await api.mcpState(c);
	} catch (e) {
		mcp.err = e instanceof api.CoolifyError && e.status === 403 ? "Only a token of Coolify's root team may turn it on: an admin turns it on in Coolify, under Settings, Advanced." : message(e);
	}
	mcp.busy = false;
	ui.update();
}

function agentsCard(): Child {
	if (!mcp.state && !mcp.checking) void checkMcp();
	const on = hooked();
	let detail: string;
	if (mcp.checking || !mcp.state) detail = "Asking Coolify whether its MCP server is on…";
	else if (mcp.state === "off") detail = "Coolify's MCP server is off. Turn it on in Coolify, under Settings, Advanced, or here with a token of its root team.";
	else if (mcp.state !== "on") detail = mcp.state;
	else if (on.length) detail = `On for ${on.map((id) => AGENTS[id] ?? id).join(", ")}. They can create and change applications, databases and services, as far as the token may: read, deploy, write.`;
	else detail = "Agents get Coolify's own tools: apps from a repository, databases, services from templates, env vars, domains, backups. They go through Swarm, so the token stays in your keychain.";
	return (
		<ui.card padding="s5 s6" gap="s4">
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
				<ui.icon icon="bot" style={{ width: 16, height: 16, color: "text2" }} />
				<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
					<ui.text style={{ fontWeight: 500 }}>Let agents set things up</ui.text>
					<ui.text style={{ fontSize: "small", color: "text2" }}>{detail}</ui.text>
				</ui.box>
				{mcp.state === "off" ? <ui.button kind="secondary" disabled={mcp.busy} onClick={() => void turnOnMcp()}>{mcp.busy ? "Turning on…" : "Turn it on"}</ui.button> : null}
				{mcp.state && mcp.state !== "on" && mcp.state !== "off" ? <ui.button kind="ghost" onClick={() => void checkMcp()}>Try again</ui.button> : null}
				<ui.toggle tooltip="Let agents use Coolify's MCP server" checked={on.length > 0} disabled={mcp.busy || (mcp.state !== "on" && on.length === 0)} onChange={(v) => void toggleAgents(v)} />
			</ui.box>
			{mcp.err ? problem(mcp.err) : null}
		</ui.card>
	);
}

// ---- What the token may do ----

const token = { abilities: undefined as api.Abilities | undefined, checking: false, for: "" };

async function checkToken() {
	const c = conn();
	if (!c || token.checking) return;
	token.checking = true;
	token.for = c.token;
	ui.update();
	try {
		token.abilities = await api.abilities(c, state.list ?? (await api.resources(c)));
	} catch {
		token.abilities = undefined;
	}
	token.checking = false;
	ui.update();
}

/** What the token may do, each with what it opens up, as far as Coolify tells. */
function tokenCard(): Child {
	const c = conn();
	if (c && token.for !== c.token && !token.checking) void checkToken();
	const a = token.abilities;
	const rows: [keyof api.Abilities, string, string][] = [
		["read", "Read", "See every application, service, database, deployment and server."],
		["deploy", "Deploy", "Deploy, restart, stop, start and roll back."],
		["sensitive", "Read sensitive", "Containers' logs, build logs, and variables' values."],
		["write", "Write", "Change environment variables; agents create and change apps."],
	];
	return (
		<ui.card padding="s0" gap="s0">
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: "s4 s6" }}>
				<ui.icon icon="key" style={{ width: 16, height: 16, color: "text2" }} />
				<ui.text style={{ fontWeight: 500, flex: 1 }}>What the token may do</ui.text>
				<ui.iconButton icon="refresh" label="Ask again" busy={token.checking} onClick={() => void checkToken()} />
			</ui.box>
			{rows.map(([k, title, what]) => {
				const v = a ? a[k] : null;
				const mark = !a ? (token.checking ? "Asking…" : "") : v === true ? "Yes" : v === false ? "No" : "Not known";
				return (
					<ui.box key={k} style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: "s3 s6", borderTop: "1px solid divider" }}>
						<ui.icon icon={v === true ? "check-circle" : v === false ? "x" : "help"} style={{ width: 14, height: 14, color: v === true ? "green" : v === false ? "red" : "text3", flexShrink: 0 }} />
						<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
							<ui.text style={{ fontWeight: 500 }}>{title}</ui.text>
							<ui.text style={{ fontSize: "small", color: "text2" }}>{what}</ui.text>
						</ui.box>
						<ui.text style={{ fontSize: "small", color: v === true ? "green" : v === false ? "red" : "text3", flexShrink: 0 }}>{mark}</ui.text>
					</ui.box>
				);
			})}
			{a && (a.deploy === null || a.write === null) ? (
				<ui.box style={{ padding: "s3 s6 s4", borderTop: "1px solid divider" }}>
					<ui.text style={{ fontSize: "small", color: "text3" }}>Coolify says whether a token may deploy or write only through its MCP server: turn that on below to see, or Coolify will say as you use them. A token's abilities are set in Coolify, under Keys & Tokens.</ui.text>
				</ui.box>
			) : null}
		</ui.card>
	);
}

export function settingsPage(): Child {
	const c = conn();
	const field = (title: string, children: Child, hint?: Child) => (
		<ui.box style={{ gap: 6 }}>
			<ui.text style={{ fontWeight: 500 }}>{title}</ui.text>
			{children}
			{hint}
		</ui.box>
	);
	if (c && !form.editing) {
		return (
			<ui.box style={{ gap: 16 }}>
				<ui.card padding="s5 s6" gap="s5" style={{ flexDirection: "row", alignItems: "center" }}>
					<ui.icon icon="check-circle" style={{ width: 16, height: 16, color: "green" }} />
					<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
						<ui.text style={{ fontWeight: 500 }}>Connected</ui.text>
						<ui.text style={{ fontSize: "small", color: "text2", ...line }}>{api.baseOf(c.url) + (form.version ? ` · ${form.version}` : "")}</ui.text>
					</ui.box>
					<ui.button kind="ghost" onClick={() => { form.url = c.url; form.token = ""; form.error = ""; form.editing = true; }}>Change…</ui.button>
					<ui.button kind="ghost" onClick={() => { void unhookAgents(); settings.set({ url: null, token: null }); mcp.state = ""; forget(); form.version = ""; }}>Disconnect</ui.button>
				</ui.card>
				{tokenCard()}
				{agentsCard()}
				<ui.box style={{ flexDirection: "row" }}>
					<ui.link label="Open the Coolify page" href={`swarm://plugin/${PAGE}`} />
				</ui.box>
			</ui.box>
		);
	}
	const base = api.urlProblem(form.url) ? "" : api.baseOf(form.url);
	return (
		<ui.box style={{ gap: 14, maxWidth: 520 }}>
			<ui.text style={{ color: "text2" }}>Connect your Coolify to see its applications, services and databases, deploy them and read their logs here and from an agent's command line.</ui.text>
			{field("Coolify URL", <ui.field key="url" value={form.url} placeholder="https://coolify.example.com" onChange={(v) => { form.url = v; form.error = ""; }} onSubmit={() => void connect()} />)}
			{field(
				"API token",
				<ui.field key="token" secret value={form.token} placeholder="1|abc…" onChange={(v) => { form.token = v; form.error = ""; }} onSubmit={() => void connect()} style={{ fontFamily: "mono" }} />,
				<ui.box style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
					<ui.text style={{ fontSize: "small", color: "text3" }}>Make one in Coolify, under</ui.text>
					{base ? <ui.link label="Keys & Tokens, API tokens." href={`${base}/security/api-tokens`} style={{ fontSize: "small" }} /> : <ui.text style={{ fontSize: "small", color: "text3" }}>Keys & Tokens, API tokens.</ui.text>}
					<ui.text style={{ fontSize: "small", color: "text3" }}>Give it read and deploy; read:sensitive shows logs too. Turn the API on in Settings, Advanced, if it's off.</ui.text>
				</ui.box>,
			)}
			{form.error ? problem(form.error) : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				{c ? <ui.button kind="ghost" onClick={() => { form.editing = false; form.error = ""; }}>Cancel</ui.button> : null}
				<ui.button kind="primary" disabled={form.busy} onClick={() => void connect()}>{form.busy ? "Connecting…" : "Connect"}</ui.button>
			</ui.box>
		</ui.box>
	);
}

