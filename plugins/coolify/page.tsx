// Coolify's page of the rail. Its sidebar has the views: the overview (what
// needs you, what deploys, what deployed), every deployment, each of
// Coolify's projects, and the servers. A resource opens beside the view,
// with its tabs: its facts, its deployments (and rollbacks), its logs as
// they come, and its environment's variables.
//
// The path is the view ("", deployments, p/<project>, servers), then
// r/<resource> for the one opened: "p/abc/r/xyz", or "r/xyz" beside the
// overview.
import { ui, type Child, type RenderContext } from "swarm";
import * as api from "./coolify";
import type { Deployment, Resource } from "./coolify";
import { environmentTab } from "./env";
import { agentsCanSetUp, ask, fixPrompt, lookPrompt, setupPrompt } from "./agent";
import {
	allRecent,
	cancelDeployment,
	conn,
	deployingNow,
	fresh,
	lastDeployment,
	navItems,
	openedOf,
	PAGE,
	placeOf,
	press,
	projectsOf,
	readDeployments,
	readEnvs,
	readImages,
	readList,
	readLog,
	readLogs,
	readRecent,
	readServerResources,
	readServers,
	resource,
	STALE,
	state,
	type Dep,
	type Opened,
} from "./store";
import { badge, columnStyle, deploymentTitle, empty, errorLine, fact, faint, fitted, howDeployed, iconOf, line, logBox, phone, phoneCard, problem, list, refresh, rowOf, searchField, sectionHead, setPhone, sourceText, top, loading, stats } from "./view";

type View = { kind: "overview" } | { kind: "deployments" } | { kind: "project"; uuid: string } | { kind: "servers" };

export function parsePath(path: string): { view: View; base: string; open: string } {
	const m = /^(.*?)(?:^|\/)r\/([^/]+)$/.exec(path);
	const base = m ? m[1]! : path;
	const open = m ? decodeURIComponent(m[2]!) : "";
	const parts = base.split("/").filter(Boolean);
	let view: View = { kind: "overview" };
	if (parts[0] === "deployments") view = { kind: "deployments" };
	else if (parts[0] === "servers") view = { kind: "servers" };
	else if (parts[0] === "p" && parts[1]) view = { kind: "project", uuid: decodeURIComponent(parts[1]) };
	return { view, base: parts.join("/"), open };
}

const join = (base: string, open: string) => (open ? (base ? `${base}/r/${open}` : `r/${open}`) : base);
const openIn = (base: string, uuid: string) => ui.navTo(PAGE, join(base, uuid));

// ---- Rows ----

function resourceRow(r: Resource, base: string, open: string, why?: string): Child {
	const s = api.statusOf(r.status);
	const going = deployingNow(r.uuid);
	const sub = why ?? (api.domains(r.fqdn)[0]?.replace(/^https?:\/\//, "") || sourceText(r));
	const linked = projectsOf(r);
	return (
		<ui.pressable key={r.uuid} label={`${api.displayName(r)}, ${going ? "Deploying" : s.label}`} checked={open === r.uuid} onClick={() => openIn(base, open === r.uuid ? "" : r.uuid)} style={rowOf()}>
			<ui.icon icon={iconOf(r)} style={{ width: 15, height: 15, color: "text2", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<ui.text style={{ fontWeight: 500, ...line }}>{api.displayName(r)}</ui.text>
				<ui.text style={{ ...faint, ...line, color: why ? "amber" : "text3" }}>{sub}</ui.text>
			</ui.box>
			{linked.length && !phone.on ? (
				<ui.box tooltip={`Built from ${linked.map((p) => p.name).join(", ")}`} style={{ flexDirection: "row", gap: 4, alignItems: "center", flexShrink: 0 }}>
					<ui.icon icon="folder" style={{ width: 12, height: 12, color: "text3" }} />
					<ui.text style={faint}>{linked[0]!.name}</ui.text>
				</ui.box>
			) : null}
			{going ? badge("accent", "Deploying") : badge(s.tone, s.label)}
		</ui.pressable>
	);
}

/** A deployment in a list of every application's: the application, the commit, how and when. */
function feedRow(d: Dep, base: string, open: string): Child {
	const r = resource(d.app);
	const s = api.deploymentStatus(d.status);
	const go = () => {
		if (!r) return;
		const o = openedOf(r);
		o.tab = "deployments";
		o.expanded = d.deployment_uuid;
		o.log = undefined;
		openIn(base, r.uuid);
	};
	return (
		<ui.pressable key={d.deployment_uuid} label={`${r ? api.displayName(r) : d.application_name ?? ""}: ${deploymentTitle(d, r)}, ${s.label}`} checked={open === d.app && !!r && state.opened.get(r.uuid)?.expanded === d.deployment_uuid} onClick={go} style={rowOf()}>
			<ui.icon icon={api.deploying(d) ? "rocket" : d.status === "failed" ? "alert-circle" : "check-circle"} style={{ width: 15, height: 15, color: api.deploying(d) ? "accent" : d.status === "failed" ? "red" : "text3", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "baseline", minWidth: 0 }}>
					<ui.text style={phone.on ? { fontWeight: 500, ...line, flexShrink: 0, maxWidth: "60%" } : { fontWeight: 500, flexShrink: 0 }}>{r ? api.displayName(r) : (d.application_name ?? "")}</ui.text>
					{d.commit && d.commit !== "HEAD" ? <ui.text style={{ fontFamily: "mono", fontSize: 12, color: "text2", flexShrink: 0 }}>{d.commit.slice(0, 7)}</ui.text> : null}
					<ui.text style={{ ...line, color: "text2" }}>{deploymentTitle(d, r)}</ui.text>
				</ui.box>
				<ui.text style={fitted(faint)}>{[r ? placeOf(r)?.project : "", howDeployed(d), api.ago(d.created_at), api.took(d)].filter(Boolean).join(" · ")}</ui.text>
			</ui.box>
			{badge(s.tone, s.label)}
		</ui.pressable>
	);
}


// ---- The views ----

/** The page's title bar (a bare page's head): the view's name and count, and what acts on it at its end, as Flux's. */
function titleBar(title: string, count: string, ...end: Child[]): Child {
	const c = conn();
	return (
		<ui.box style={{ flex: 1, minWidth: 0, height: "100%", flexDirection: "row", gap: 6, alignItems: "center", paddingLeft: 16, paddingRight: 16 }}>
			<ui.text style={{ fontSize: 14, fontWeight: 600, ...line }}>{title}</ui.text>
			{count ? <ui.text style={{ fontSize: 14, color: "text3", flexShrink: 0 }}>{count}</ui.text> : null}
			<ui.spacer />
			{end}
			{c ? <ui.iconButton icon="external" label="Open Coolify" href={api.baseOf(c.url)} /> : null}
			<ui.iconButton icon="settings" label="Coolify settings" href={`swarm://settings/${PAGE}/${PAGE}`} />
		</ui.box>
	);
}

/**
 * A phone's head, drawn at the end of its bar, which has the page's title
 * and Back: Refresh, and a menu of the rest (New app, Coolify itself,
 * Settings).
 */
function phoneHead(end: Child[]): Child {
	const c = conn();
	const setup = agentsCanSetUp();
	return (
		<ui.box style={{ flexDirection: "row", gap: 2, alignItems: "center", flexShrink: 0 }}>
			{c ? end : null}
			<ui.menu label="" icon="more" kind="ghost" tooltip="More">
				{c && setup ? <ui.item icon="plus" label="New app" detail="Set one up with an agent" onClick={() => ask(undefined, setupPrompt())} /> : null}
				{c ? <ui.item icon="external" label="Open Coolify" href={api.baseOf(c.url)} /> : null}
				<ui.item icon="settings" label="Coolify settings" href={`swarm://settings/${PAGE}/${PAGE}`} />
			</ui.menu>
		</ui.box>
	);
}

/** A phone's way to the other views, which a desktop's sidebar lists: a row each, as a phone's settings are. */
function browse(): Child {
	const items = navItems().filter((it) => it.id !== "overview");
	return (
		<ui.box style={{ gap: 6 }}>
			{sectionHead("Browse")}
			{list(
				items.map((it) => (
					<ui.pressable key={it.id} label={it.title} onClick={() => ui.navTo(PAGE, it.path, { title: it.title })} style={rowOf()}>
						<ui.icon icon={it.icon} style={{ width: 16, height: 16, color: "text2", flexShrink: 0 }} />
						<ui.text style={{ flex: 1, ...line }}>{it.title}</ui.text>
						{it.badge ? <ui.text style={{ ...faint, color: it.badge.endsWith("!") ? "red" : "text3" }}>{it.badge.replace("!", " down")}</ui.text> : null}
						<ui.icon icon="chevron-right" style={{ width: 14, height: 14, color: "text3", flexShrink: 0 }} />
					</ui.pressable>
				)),
			)}
		</ui.box>
	);
}

const matches = (r: Resource, q: string) => {
	const p = placeOf(r);
	return [r.name, r.fqdn ?? "", sourceText(r), p?.project ?? "", r.uuid].some((s) => s.toLowerCase().includes(q));
};

function overview(base: string, open: string): Child {
	const all = state.list ?? [];
	const q = state.search.trim().toLowerCase();
	if (q) {
		const hits = all.filter((r) => matches(r, q));
		return (
			<ui.box style={{ gap: 6 }}>
				{sectionHead(`${hits.length} found`)}
				{hits.length ? list(hits.map((r) => resourceRow(r, base, open))) : <ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>{`Nothing matches ${state.search.trim()}.`}</ui.text>}
			</ui.box>
		);
	}
	const running = all.filter((r) => api.statusOf(r.status).running).length;
	const failedApps = all.filter((r) => r.type === "application" && lastDeployment(r.uuid)?.status === "failed");
	const attention: { r: Resource; why: string }[] = [
		...all.filter((r) => api.trouble(r.status) === 2).map((r) => ({ r, why: `${api.statusOf(r.status).label}: ${r.status}` })),
		...failedApps.filter((r) => api.trouble(r.status) !== 2).map((r) => ({ r, why: `Last deployment failed ${api.ago(lastDeployment(r.uuid)?.created_at)}` })),
	];
	const recent = allRecent();
	const live = recent.filter(api.deploying);
	const done = recent.filter((d) => !api.deploying(d)).slice(0, 8);
	const day = Date.now() - 86_400_000;
	const failedToday = recent.filter((d) => d.status === "failed" && (api.parseTime(d.created_at) || 0) > day).length;
	return (
		<ui.box style={{ gap: 18 }}>
			{stats([
				{ value: `${running}/${all.length}`, label: "Running", tone: running === all.length ? "green" : undefined },
				{ value: String(attention.length), label: "Attention", tone: attention.length ? "amber" : undefined },
				{ value: String(live.length), label: "Deploying", tone: live.length ? "accent" : undefined },
				{ value: String(failedToday), label: "Failed today", tone: failedToday ? "red" : undefined },
			])}
			{attention.length ? (
				<ui.box style={{ gap: 6 }}>
					{sectionHead("Needs attention")}
					{list(attention.map(({ r, why }) => resourceRow(r, base, open, why)))}
				</ui.box>
			) : null}
			{live.length ? (
				<ui.box style={{ gap: 6 }}>
					{sectionHead("Deploying now")}
					{list(live.map((d) => feedRow(d, base, open)))}
				</ui.box>
			) : null}
			<ui.box style={{ gap: 6 }}>
				{sectionHead("Recent deployments", <ui.link key="all" label="All deployments" onClick={() => ui.navTo(PAGE, "deployments")} style={{ fontSize: "small" }} />)}
				{done.length ? list(done.map((d) => feedRow(d, base, open))) : state.recentReading ? loading("Reading deployments…") : <ui.text style={{ color: "text3", padding: 12 }}>No deployments yet.</ui.text>}
			</ui.box>
			{linkedSection(base, open)}
			{phone.on ? browse() : null}
		</ui.box>
	);
}

/** Swarm's projects and the applications built from them. */
function linkedSection(base: string, open: string): Child {
	const rows = state.projects
		.map((p) => ({ p, apps: (state.list ?? []).filter((r) => r.type === "application" && p.repo && api.builtFrom(r, p.repo)) }))
		.filter((x) => x.apps.length)
		.sort((a, b) => a.p.name.localeCompare(b.p.name));
	if (!rows.length) return null;
	return (
		<ui.box style={{ gap: 6 }}>
			{sectionHead("Your projects on Coolify")}
			{list(
				rows.map(({ p, apps }) => (
					<ui.box key={p.id} style={phone.on ? { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: "12 14", flexWrap: "wrap" } : { flexDirection: "row", gap: 10, alignItems: "center", padding: "s4 s5" }}>
						<ui.projectIcon project={p.id} />
						<ui.text style={{ fontWeight: 500, flexShrink: 0 }}>{p.name}</ui.text>
						<ui.box style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
							{apps.map((r) => (
								<ui.pressable key={r.uuid} label={`${api.displayName(r)}, ${api.statusOf(r.status).label}`} onClick={() => openIn(base, r.uuid)} style={{ flexDirection: "row", gap: 6, alignItems: "center", padding: phone.on ? "6 8" : "2 6", minHeight: phone.on ? 36 : undefined, borderRadius: "control", hover: { backgroundColor: "hover" } }}>
									<ui.text style={{ fontSize: "small" }}>{api.displayName(r)}</ui.text>
									{badge(deployingNow(r.uuid) ? "accent" : api.statusOf(r.status).tone, deployingNow(r.uuid) ? "Deploying" : api.statusOf(r.status).label)}
								</ui.pressable>
							))}
						</ui.box>
					</ui.box>
				)),
			)}
		</ui.box>
	);
}

function shownDeployments(): Dep[] {
	const q = state.search.trim().toLowerCase();
	return allRecent().filter((d) => {
		if (!q) return true;
		const r = resource(d.app);
		return [r?.name ?? d.application_name ?? "", d.commit ?? "", d.commit_message ?? "", r ? (placeOf(r)?.project ?? "") : ""].some((s) => s.toLowerCase().includes(q));
	});
}

/**
 * Every deployment on a phone: one virtualized list that is the page's
 * scroll, so a long feed draws only the rows on screen; its sections'
 * headings stay at its top as it scrolls past them.
 */
function phoneDeployments(base: string, open: string): Child {
	const all = shownDeployments();
	const q = state.search.trim();
	if (!all.length) return state.recentReading ? loading("Reading deployments…") : <ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>{q ? `Nothing matches ${q}.` : "No deployments yet."}</ui.text>;
	const live = all.filter(api.deploying);
	const rest = all.filter((d) => !api.deploying(d));
	const rows: ({ head: string } | { d: Dep; last: boolean })[] = [];
	const headers: number[] = [];
	const section = (head: string, ds: Dep[]) => {
		if (!ds.length) return;
		headers.push(rows.length);
		rows.push({ head });
		ds.forEach((d, i) => rows.push({ d, last: i === ds.length - 1 }));
	};
	section("Now", live);
	section("Each application's last five", rest);
	return (
		<ui.list
			key="phone-deployments"
			count={rows.length}
			rowHeight={60}
			headers={headers}
			rowKey={(i) => {
				const x = rows[i]!;
				return "head" in x ? "h-" + x.head : x.d.deployment_uuid;
			}}
			row={(i) => {
				const x = rows[i]!;
				if ("head" in x) return <ui.box style={{ width: "100%", padding: "14 16 6", backgroundColor: "bg" }}>{sectionHead(x.head)}</ui.box>;
				return (
					<ui.box style={{ width: "100%", paddingLeft: 2, paddingRight: 2 }}>
						{feedRow(x.d, base, open)}
						{x.last ? null : <ui.box style={{ height: 1, marginLeft: 16, backgroundColor: "divider" }} />}
					</ui.box>
				);
			}}
			style={{ flexGrow: 1, minHeight: 0 }}
		/>
	);
}

function deploymentsView(base: string, open: string): Child {
	const q = state.search.trim().toLowerCase();
	const all = shownDeployments();
	const live = all.filter(api.deploying);
	const rest = all.filter((d) => !api.deploying(d));
	if (!all.length) return state.recentReading ? loading("Reading deployments…") : <ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>{q ? `Nothing matches ${state.search.trim()}.` : "No deployments yet."}</ui.text>;
	return (
		<ui.box style={{ gap: 18 }}>
			{live.length ? (
				<ui.box style={{ gap: 6 }}>
					{sectionHead("Now")}
					{list(live.map((d) => feedRow(d, base, open)))}
				</ui.box>
			) : null}
			<ui.box style={{ gap: 6 }}>
				{sectionHead("Each application's last five")}
				{list(rest.map((d) => feedRow(d, base, open)))}
			</ui.box>
		</ui.box>
	);
}

function projectView(uuid: string, base: string, open: string): Child {
	const q = state.search.trim().toLowerCase();
	const mine = (state.list ?? []).filter((r) => placeOf(r)?.projectUuid === uuid && (!q || matches(r, q)));
	const envs = new Map<string, Resource[]>();
	for (const r of mine) {
		const e = placeOf(r)!.environment;
		envs.set(e, [...(envs.get(e) ?? []), r]);
	}
	if (!mine.length) return <ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>{q ? `Nothing matches ${state.search.trim()}.` : "Nothing in this project yet."}</ui.text>;
	const order = (e: string) => (e === "production" ? 0 : 1);
	return (
		<ui.box style={{ gap: 18 }}>
			{[...envs]
				.sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
				.map(([env, rs]) => (
					<ui.box key={env} style={{ gap: 6 }}>
						{sectionHead(env.charAt(0).toUpperCase() + env.slice(1))}
						{list(rs.sort((a, b) => a.name.localeCompare(b.name)).map((r) => resourceRow(r, base, open)))}
					</ui.box>
				))}
		</ui.box>
	);
}

const openServers = new Set<string>();

function serversView(base: string, open: string): Child {
	if (!state.servers && !state.serversErr) {
		if (!state.serversAt) void readServers();
		return loading("Reading servers…");
	}
	if (state.serversErr && !state.servers) return problem(state.serversErr);
	const servers = state.servers ?? [];
	if (!servers.length) return <ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>No servers this token may see.</ui.text>;
	return list(
		servers.map((s) => {
			const reachable = s.settings?.is_reachable !== false && s.settings?.is_usable !== false;
			const expanded = openServers.has(s.uuid);
			const res = state.serverRes.get(s.uuid);
			return (
				<ui.box key={s.uuid} >
					<ui.pressable
						label={`${s.name}, ${reachable ? "Reachable" : "Unreachable"}`}
						checked={expanded}
						onClick={() => {
							if (expanded) openServers.delete(s.uuid);
							else {
								openServers.add(s.uuid);
								if (!res) void readServerResources(s.uuid);
							}
						}}
						style={{ ...rowOf(), checked: {} }}
					>
						<ui.icon icon="server" style={{ width: 15, height: 15, color: "text2", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
						<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
							<ui.text style={{ fontWeight: 500, ...line }}>{s.name}</ui.text>
							<ui.text style={{ ...faint, ...line }}>{[phone.on && s.settings?.is_build_server ? "Build server" : "", s.ip && s.ip !== "host.docker.internal" ? s.ip : "This machine", s.proxy_type && s.proxy_type !== "NONE" ? `${s.proxy_type.charAt(0) + s.proxy_type.slice(1).toLowerCase()} proxy` : "", s.settings?.concurrent_builds ? `${s.settings.concurrent_builds} builds at once` : ""].filter(Boolean).join(" · ")}</ui.text>
						</ui.box>
						{s.settings?.is_build_server && !phone.on ? badge("muted", "Build server") : null}
						{badge(reachable ? "green" : "red", reachable ? "Reachable" : "Unreachable")}
						<ui.icon icon={expanded ? "chevron-down" : "chevron-right"} style={{ width: 12, height: 12, color: "text3" }} />
					</ui.pressable>
					{expanded ? (
						<ui.box style={phone.on ? { paddingLeft: 8, paddingRight: 8, paddingBottom: 8, gap: 0 } : { paddingLeft: 36, paddingRight: 12, paddingBottom: 10, gap: 2 }}>
							{res === undefined ? loading() : typeof res === "string" ? problem(res) : res.length === 0 ? <ui.text style={faint}>Nothing runs here.</ui.text> : null}
							{Array.isArray(res)
								? res.map((x) => {
										const r = resource(x.uuid);
										const st = api.statusOf(x.status);
										return (
											<ui.pressable key={x.uuid} label={`${api.displayName(x)}, ${st.label}`} onClick={() => r && openIn(base, r.uuid)} style={{ flexDirection: "row", width: "100%", gap: 8, alignItems: "center", padding: "s2 s3", minHeight: phone.on ? 40 : undefined, borderRadius: "control", hover: { backgroundColor: "hover" } }}>
												<ui.icon icon={iconOf(x)} style={{ width: 13, height: 13, color: "text3" }} />
												<ui.text style={{ ...line, flex: 1 }}>{api.displayName(x)}</ui.text>
												<ui.text style={fitted(faint)}>{r ? (placeOf(r)?.project ?? "") : api.typeLabel(x.type)}</ui.text>
												{badge(st.tone, st.label)}
											</ui.pressable>
										);
									})
								: null}
						</ui.box>
					) : null}
				</ui.box>
			);
		}),
	);
}

function board(view: View, base: string, open: string, head = false): Child {
	const c = conn();
	let title = "Overview";
	let count = "";
	let body: Child;
	let search = true;
	let end: Child[] = [refresh(state.reading || state.recentReading, () => void readList().then(() => readRecent()))];
	if (view.kind === "deployments") title = "Deployments";
	else if (view.kind === "servers") {
		title = "Servers";
		search = false;
		end = [refresh(false, () => void readServers().then(() => [...openServers].forEach((s) => void readServerResources(s))))];
		count = state.servers ? String(state.servers.length) : "";
	} else if (view.kind === "project") {
		const any = (state.list ?? []).find((r) => placeOf(r)?.projectUuid === view.uuid);
		title = any ? placeOf(any)!.project : "Project";
		count = String((state.list ?? []).filter((r) => placeOf(r)?.projectUuid === view.uuid).length);
	} else {
		if (agentsCanSetUp() && !phone.on) end.unshift(
			<ui.box key="new" style={{ flexShrink: 0, justifyContent: "center", marginRight: 4 }}>
				<ui.button kind="primary" size="sm" icon="plus" tooltip="Set up a new app with an agent" onClick={() => ask(undefined, setupPrompt())}>New app</ui.button>
			</ui.box>,
		);
	}
	if (head) return phone.on ? phoneHead(end) : titleBar(title, count, ...(c ? end : []));
	if (!c) {
		body = empty("coolify.svg", "Connect Coolify", "Give its URL and an API token, and its applications, services and databases show here.", <ui.link label="Connect in Settings…" href={`swarm://settings/${PAGE}/${PAGE}`} />);
		search = false;
		end = [];
	} else if (state.err && !state.list) {
		body = empty("alert-circle", "Coolify didn't answer", state.err, <ui.button onClick={() => void readList()}>Try again</ui.button>);
		search = false;
	} else if (!state.list) {
		body = loading("Reading Coolify…", true);
	} else if (state.list.length === 0 && view.kind !== "servers") {
		body = empty("cube", "Nothing deployed yet", "Coolify has nothing this token may see.", agentsCanSetUp() ? <ui.button onClick={() => ask(undefined, setupPrompt())}>Set up an app with an agent…</ui.button> : undefined);
	} else if (phone.on && view.kind === "deployments") {
		body = (
			<ui.box style={{ flexGrow: 1, minHeight: 0 }}>
				{state.err ? <ui.box style={{ ...columnStyle(), paddingBottom: 8 }}>{problem(state.err)}</ui.box> : null}
				{phoneDeployments(base, open)}
			</ui.box>
		);
	} else {
		const inner = view.kind === "overview" ? overview(base, open) : view.kind === "deployments" ? deploymentsView(base, open) : view.kind === "project" ? projectView(view.uuid, base, open) : serversView(base, open);
		body = (
			<ui.scroll style={{ flexGrow: 1, minHeight: 0 }}>
				<ui.box style={{ ...columnStyle(), gap: phone.on ? 20 : 16, paddingBottom: phone.on ? 32 : 24 }}>
					{state.err ? problem(state.err) : null}
					{inner}
				</ui.box>
			</ui.scroll>
		);
	}
	return (
		<ui.box style={{ flexGrow: 1, minHeight: 0 }}>
			{search && state.list ? (
				<ui.box style={{ ...columnStyle(), flexShrink: 0, paddingTop: phone.on ? 8 : 20, paddingBottom: 12 }}>
					{searchField("search", state.search, view.kind === "deployments" ? "Search deployments" : "Search apps, domains, projects", (v) => void (state.search = v))}
				</ui.box>
			) : (
				<ui.box style={{ height: phone.on ? 8 : 20, flexShrink: 0 }} />
			)}
			{body}
		</ui.box>
	);
}

// ---- A resource opened ----

function deploymentRow(r: Resource, d: Deployment, o: Opened): Child {
	const s = api.deploymentStatus(d.status);
	const open = o.expanded === d.deployment_uuid;
	const toggle = () => {
		o.expanded = open ? "" : d.deployment_uuid;
		o.log = undefined;
		o.logErr = "";
		if (!open) {
			if (d.logs) o.log = d;
			else void readLog(d.deployment_uuid, o);
		}
	};
	return (
		<ui.box key={d.deployment_uuid} style={{ minWidth: 0 }}>
			<ui.pressable label={`${s.label} deployment ${d.commit?.slice(0, 7) ?? ""}`} checked={open} onClick={toggle} style={{ ...rowOf(), checked: {} }}>
				<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "baseline", minWidth: 0 }}>
						{d.commit && d.commit !== "HEAD" ? <ui.text style={{ fontFamily: "mono", fontSize: 12, flexShrink: 0 }}>{d.commit.slice(0, 7)}</ui.text> : null}
						<ui.text style={line}>{deploymentTitle(d, r)}</ui.text>
					</ui.box>
					<ui.text style={fitted(faint)}>{[howDeployed(d), api.ago(d.created_at), api.took(d)].filter(Boolean).join(" · ")}</ui.text>
				</ui.box>
				{badge(s.tone, s.label)}
				<ui.icon icon={open ? "chevron-down" : "chevron-right"} style={{ width: 12, height: 12, color: "text3" }} />
			</ui.pressable>
			{open ? deploymentLog(r, d, o) : null}
		</ui.box>
	);
}

function deploymentLog(r: Resource, d: Deployment, o: Opened): Child {
	if (o.logErr) return <ui.box style={{ padding: "s3 s5" }}>{problem(o.logErr)}</ui.box>;
	if (!o.log) return loading("Reading the log…");
	const lines = api.logLines(o.log.logs);
	const image = o.images?.find((i) => api.sameCommit(d.commit, i.tag));
	const actions: Child[] = [];
	// On a phone the actions are a finger's size, the width of the row.
	const size = phone.on ? "md" : "sm";
	const wide = phone.on ? { flex: 1 } : undefined;
	if (d.status === "failed") actions.push(<ui.button key="fix" size={size} kind="primary" icon="sparkle" onClick={() => ask(r, fixPrompt(r, d, o.log))} style={wide}>Ask an agent to fix it</ui.button>);
	if (api.deploying(d)) actions.push(<ui.button key="cancel" size={size} kind={phone.on ? "secondary" : "ghost"} onClick={() => void cancelDeployment(d, o)} style={wide}>Cancel deployment</ui.button>);
	if (image && !image.is_current && d.status === "finished") actions.push(<ui.button key="rollback" size={size} icon="undo" disabled={!!o.busy} onClick={() => void press(r, o, { rollback: image.tag })} style={wide}>{o.busy === "rollback" ? "Rolling back…" : "Roll back to this"}</ui.button>);
	if (image?.is_current) actions.push(<ui.tag key="current" tone="green">Running now</ui.tag>);
	const text = api.logText(lines.map((l) => l.output).join("\n"));
	const title = `${api.displayName(r)}: ${deploymentTitle(d, r)}${d.commit && d.commit !== "HEAD" ? ` (${d.commit.slice(0, 7)})` : ""}`;
	return (
		<ui.box style={{ gap: 8, padding: phone.on ? "4 12 14" : "s2 s5 s4", minWidth: 0 }}>
			{actions.length ? <ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>{actions}</ui.box> : null}
			{lines.length ? logBox(`deplog-${d.deployment_uuid}`, text, 360, { title }) : <ui.text style={faint}>{o.log.logs == null ? "The token may not read logs: give it read:sensitive in Coolify." : "No lines yet."}</ui.text>}
		</ui.box>
	);
}

function overviewTab(r: Resource, o: Opened): Child {
	const s = api.statusOf(r.status);
	const last = lastDeployment(r.uuid) ?? o.deps?.[0];
	const lastDone = (o.deps ?? []).find((d) => d.status === "finished");
	const facts: Child[] = [fact("Status", [badge(s.tone, s.label), <ui.text key="raw" style={faint}>{r.status}</ui.text>])];
	const doms = api.domains(r.fqdn);
	if (doms.length) facts.push(fact("Domains", doms.map((d) => <ui.link key={d} label={d.replace(/^https?:\/\//, "")} href={/^https?:\/\//.test(d) ? d : `https://${d}`} />)));
	if (r.type === "application") {
		facts.push(fact("Source", <ui.text style={{ ...line, color: "text2" }} selectable>{sourceText(r)}</ui.text>));
		if (r.build_pack) facts.push(fact("Build pack", <ui.text style={{ color: "text2" }}>{r.build_pack}</ui.text>));
		if (lastDone?.commit && lastDone.commit !== "HEAD") facts.push(fact("Running commit", [<ui.text key="sha" style={{ fontFamily: "mono", fontSize: 12 }}>{lastDone.commit.slice(0, 7)}</ui.text>, <ui.text key="msg" style={{ ...line, color: "text2" }}>{lastDone.commit_message?.split("\n")[0] ?? ""}</ui.text>]));
		if (last) facts.push(fact("Last deployment", [badge(api.deploymentStatus(last.status).tone, api.deploymentStatus(last.status).label), <ui.text key="when" style={faint}>{[howDeployed(last), api.ago(last.created_at), api.took(last)].filter(Boolean).join(" · ")}</ui.text>]));
		if (r.ports_exposes) facts.push(fact("Ports", <ui.text style={{ fontFamily: "mono", fontSize: 12 }}>{r.ports_exposes}</ui.text>));
		facts.push(fact("Health check", <ui.text style={{ color: "text2" }}>{r.health_check_enabled ? `On, ${r.health_check_path || "/"}` : "Off"}</ui.text>));
	}
	if (r.type === "service") {
		const parts = [...(r.applications ?? []), ...(r.databases ?? [])];
		if (r.service_type) facts.push(fact("Template", <ui.text style={{ color: "text2" }}>{r.service_type}</ui.text>));
		if (parts.length)
			facts.push(
				fact(
					"Containers",
					<ui.box style={{ gap: 4, flex: 1 }}>
						{parts.map((p) => (
							phone.on ? (
								// On a phone, the image under the name: beside it, both were cut to a few letters.
								<ui.box key={p.name} style={{ flexDirection: "row", gap: 8, alignItems: "center", width: "100%" }}>
									<ui.box style={{ flex: 1, minWidth: 0, gap: 1 }}>
										<ui.text style={line}>{p.name}</ui.text>
										{p.image ? <ui.text style={{ ...faint, ...line }}>{p.image}</ui.text> : null}
									</ui.box>
									{p.status ? badge(api.statusOf(p.status).tone, api.statusOf(p.status).label) : null}
								</ui.box>
							) : (
							<ui.box key={p.name} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
								<ui.text style={{ ...line, flex: 1 }}>{p.name}</ui.text>
								{p.image ? <ui.text style={{ ...faint, ...line }}>{p.image}</ui.text> : null}
								{p.status ? badge(api.statusOf(p.status).tone, api.statusOf(p.status).label) : null}
							</ui.box>
							)
						))}
					</ui.box>,
				),
			);
	}
	if (r.type.startsWith("standalone-")) {
		if (r.image) facts.push(fact("Image", <ui.text style={{ fontFamily: "mono", fontSize: 12 }}>{r.image}</ui.text>));
		facts.push(fact("Reached from", <ui.text style={{ color: "text2" }}>{r.is_public ? `Outside, on port ${r.public_port ?? "?"}` : "Its network only"}</ui.text>));
	}
	if (r.last_online_at) facts.push(fact("Last online", <ui.text style={{ color: "text2" }}>{api.ago(r.last_online_at)}</ui.text>));
	const linked = projectsOf(r);
	facts.push(
		fact(
			"Swarm project",
			linked.length
				? linked.map((p) => (
						<ui.pressable key={p.id} label={`New thread in ${p.name}`} onClick={() => ui.prefill({ project: p.id })} style={{ flexDirection: "row", gap: 6, alignItems: "center", padding: "2 6", borderRadius: "control", hover: { backgroundColor: "hover" } }}>
							<ui.projectIcon project={p.id} />
							<ui.text>{p.name}</ui.text>
						</ui.pressable>
					))
				: <ui.text style={faint}>{r.type === "application" ? "None of your projects is its repository" : "—"}</ui.text>,
		),
	);
	facts.push(fact("uuid", [<ui.text key="u" style={{ fontFamily: "mono", fontSize: 12, color: "text2" }} selectable>{r.uuid}</ui.text>, <ui.iconButton key="c" icon="copy" label="Copy uuid" onClick={() => ui.copy(r.uuid)} style={{ width: 20, height: 20 }} />]));
	return list(facts);
}

function deploymentsTab(r: Resource, o: Opened): Child {
	if (o.images === undefined) {
		o.images = [];
		void readImages(r.uuid, o);
	}
	let body: Child;
	if (o.depsErr && !o.deps) body = problem(o.depsErr);
	else if (!o.deps) body = loading("Reading deployments…");
	else if (o.deps.length === 0) body = <ui.text style={{ color: "text3", padding: 12 }}>Never deployed.</ui.text>;
	else body = list(o.deps.map((d) => deploymentRow(r, d, o)));
	return (
		<ui.box style={{ gap: 6 }}>
			{sectionHead("Last deployments", refresh(o.depsReading, () => void readDeployments(r.uuid, o)))}
			{body}
		</ui.box>
	);
}

let liveTimer: number | undefined;
let liveFor = "";

/** Reads the shown logs again every few seconds while Live is on. */
function keepLive(r: Resource, o: Opened, on: boolean) {
	if (!on) {
		if (liveFor === r.uuid && liveTimer !== undefined) clearTimeout(liveTimer);
		if (liveFor === r.uuid) liveTimer = undefined;
		return;
	}
	if (liveTimer !== undefined && liveFor === r.uuid) return;
	if (liveTimer !== undefined) clearTimeout(liveTimer);
	liveFor = r.uuid;
	liveTimer = setTimeout(() => {
		liveTimer = undefined;
		if (state.shown === r.uuid && o.tab === "logs" && o.live) void readLogs(r, o);
	}, 5000);
}

function logsTab(r: Resource, o: Opened): Child {
	if (o.logs === undefined && !o.logsReading && !o.logsErr) void readLogs(r, o);
	keepLive(r, o, o.live && state.shown === r.uuid);
	const all = api.logText(o.logs ?? "", 1 << 30).split("\n").filter((l, i, a) => l || i < a.length - 1);
	const errors = all.filter(errorLine).length;
	const q = o.filter.trim().toLowerCase();
	const lines = all.filter((l) => (!o.errorsOnly || errorLine(l)) && (!q || l.toLowerCase().includes(q)));
	const text = api.logText(lines.join("\n"));
	const said = [`The last ${o.lines.toLocaleString()} lines`, q || o.errorsOnly ? `${lines.length} shown` : "", text.length < lines.join("\n").length ? "the newest 30 KB of them" : ""].filter(Boolean).join(", ");
	let body: Child;
	if (o.logsErr) body = problem(/permission|may not|sensitive/i.test(o.logsErr) ? `${o.logsErr} Logs need a token with read:sensitive.` : o.logsErr);
	else if (o.logs === undefined) body = loading("Reading logs…");
	else if (!all.length) body = <ui.text style={{ color: "text3", padding: 12 }}>No lines: it may not be running.</ui.text>;
	else if (!lines.length) body = <ui.text style={{ color: "text3", padding: 12 }}>{o.errorsOnly && !q ? "No errors in these lines." : `No line has ${o.filter.trim()}.`}</ui.text>;
	else body = logBox(`logs-${r.uuid}`, text, 560, { title: `${api.displayName(r)}: its containers' last lines` });
	return (
		<ui.box style={{ gap: phone.on ? 10 : 8, minWidth: 0 }}>
			{/* On a phone the filter takes the row; what sets the lines goes under it. */}
			{phone.on ? searchField("logfilter", o.filter, "Filter lines", (v) => void (o.filter = v)) : null}
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
				{phone.on ? null : <ui.box style={{ flex: 1, minWidth: 120 }}>{searchField("logfilter", o.filter, "Filter lines", (v) => void (o.filter = v))}</ui.box>}
				<ui.select
					value={String(o.lines)}
					options={[{ value: "100", label: "100 lines" }, { value: "500", label: "500 lines" }, { value: "2000", label: "2,000 lines" }]}
					onChange={(v) => {
						o.lines = Number(v);
						void readLogs(r, o);
					}}
				/>
				<ui.box tooltip="Read them again every 5 seconds" style={{ flexShrink: 0 }}>
					<ui.toggle checked={o.live} label="Live" onChange={(v) => void (o.live = v)} />
				</ui.box>
				{phone.on ? <ui.spacer /> : null}
				{refresh(o.logsReading, () => void readLogs(r, o))}
			</ui.box>
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", minHeight: phone.on ? 36 : 24 }}>
				<ui.checkbox label={errors ? `Errors only (${errors})` : "Errors only"} checked={o.errorsOnly} disabled={!errors && !o.errorsOnly} onChange={(v) => void (o.errorsOnly = v)} />
				<ui.spacer />
			</ui.box>
			{body}
			{all.length ? <ui.text style={phone.on ? { ...faint, whiteSpace: "normal" } : faint}>{`${said}. Select to copy part; the newest are at the end.`}</ui.text> : null}
		</ui.box>
	);
}

function resourcePane(r: Resource | undefined, uuid: string, base: string): Child {
	const c = conn();
	const head = (
		<ui.box dragWindow style={top}>
			<ui.iconButton icon="x" label="Close" onClick={() => ui.navTo(PAGE, base)} />
			<ui.spacer />
			{r && c ? <ui.iconButton icon="external" label="Open in Coolify" href={api.dashboardUrl(c, r, placeOf(r))} /> : null}
		</ui.box>
	);
	if (!r || !c) {
		return (
			<ui.box style={{ flexGrow: 1, minHeight: 0 }}>
				{head}
				{state.list ? empty("cube", "Not in Coolify", `Coolify has no resource ${uuid}, or this token can't see it.`) : loading("Reading Coolify…", true)}
			</ui.box>
		);
	}
	const o = openedOf(r);
	const s = api.statusOf(r.status);
	const app = r.type === "application";
	const deployable = app || r.type === "service";
	const doing = (what: string) => o.busy === what;
	const place = placeOf(r);
	const going = deployingNow(r.uuid);
	const last = lastDeployment(r.uuid) ?? o.deps?.[0];
	// On a phone the actions share the row's width.
	const wide = phone.on ? { flex: 1 } : undefined;
	// A phone's tabs fill its width, in words short enough that four fit.
	const tabs = [{ value: "overview", label: "Overview" }, ...(app ? [{ value: "deployments", label: phone.on ? "Deploys" : "Deployments" }] : []), ...(r.type !== "service" ? [{ value: "logs", label: "Logs" }] : []), { value: "environment", label: phone.on ? "Variables" : "Environment" }];
	if (!tabs.some((t) => t.value === o.tab)) o.tab = "overview";
	return (
		<ui.box style={{ flexGrow: 1, minHeight: 0 }}>
			<ui.scroll style={{ flexGrow: 1, minHeight: 0, minWidth: 0 }}>
				<ui.box style={{ padding: phone.on ? "8 16 32" : "s6 s7 s7", gap: phone.on ? 16 : 14, width: "100%", minWidth: 0 }}>
					<ui.box style={{ gap: 4 }}>
						<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
							<ui.icon icon={iconOf(r)} style={{ width: 18, height: 18, color: "text2" }} />
							<ui.text style={{ fontSize: 20, fontWeight: 500, ...line }} selectable>{api.displayName(r)}</ui.text>
							<ui.spacer />
							<ui.iconButton icon="external" label="Open in Coolify" href={api.dashboardUrl(c, r, placeOf(r))} />
							{/* A phone's bar has Back, which closes it. */}
							{phone.on ? null : <ui.iconButton icon="x" label="Close" onClick={() => ui.navTo(PAGE, base)} />}
						</ui.box>
						<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
							{going ? badge("accent", "Deploying") : badge(s.tone, s.label)}
							<ui.text style={faint}>{[api.typeLabel(r.type), place ? `${place.project} / ${place.environment}` : ""].filter(Boolean).join(" · ")}</ui.text>
						</ui.box>
						{r.description ? <ui.text style={{ color: "text2", marginTop: 4 }}>{r.description}</ui.text> : null}
					</ui.box>

					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
						{deployable ? (
							<ui.button kind="primary" icon="rocket" disabled={!!o.busy || going} onClick={() => void press(r, o, "deploy")} style={wide}>{doing("deploy") || going ? "Deploying…" : app ? "Deploy" : "Redeploy"}</ui.button>
						) : s.running ? null : (
							<ui.button kind="primary" icon="play" disabled={!!o.busy} onClick={() => void press(r, o, "start")} style={wide}>{doing("start") ? "Starting…" : "Start"}</ui.button>
						)}
						{s.running ? <ui.button icon="refresh" disabled={!!o.busy} onClick={() => void press(r, o, "restart")} style={wide}>{doing("restart") ? "Restarting…" : "Restart"}</ui.button> : null}
						<ui.menu label={phone.on ? "" : "More actions"} tooltip="More actions" icon="more" kind={phone.on ? "secondary" : "ghost"}>
							{app ? <ui.item icon="hammer" label="Rebuild without cache" onClick={() => void press(r, o, "force")} /> : null}
							{deployable && !s.running ? <ui.item icon="play" label="Start" onClick={() => void press(r, o, "start")} /> : null}
							<ui.item icon="sparkle" label="Ask an agent about it…" onClick={() => ask(r, lookPrompt(r))} />
							<ui.item icon="copy" label="Copy uuid" onClick={() => ui.copy(r.uuid)} />
							{s.running ? <ui.separator /> : null}
							{s.running ? <ui.item icon="stop" label="Stop…" danger onClick={() => void (o.confirmStop = true)} /> : null}
						</ui.menu>
					</ui.box>
					{o.confirmStop && s.running ? (
						// Stopping takes it offline: asked, as Swarm asks before what can't be undone at once.
						<ui.box style={{ flexDirection: "row", gap: "s4", alignItems: "flex-start", padding: "s4 s5", borderRadius: "card", backgroundColor: "redSoft" }}>
							<ui.icon icon="stop" style={{ width: 15, height: 15, color: "red", flexShrink: 0 }} />
							<ui.box style={{ flex: 1, minWidth: 0, gap: 8 }}>
								<ui.text style={{ fontWeight: 500 }}>{`Stop ${api.displayName(r)}?`}</ui.text>
								<ui.text style={{ fontSize: "small", color: "text2" }}>{`${api.domains(r.fqdn).length ? `${api.domains(r.fqdn).map((d) => d.replace(/^https?:\/\//, "")).join(", ")} stop${api.domains(r.fqdn).length === 1 ? "s" : ""} answering` : "It goes offline"} until it's started again.`}</ui.text>
								<ui.box style={{ flexDirection: "row", gap: 6 }}>
									<ui.button kind="danger" size="sm" disabled={!!o.busy} onClick={() => { o.confirmStop = false; void press(r, o, "stop"); }}>{`Stop ${api.displayName(r)}`}</ui.button>
									<ui.button kind="ghost" size="sm" onClick={() => void (o.confirmStop = false)}>Keep it running</ui.button>
								</ui.box>
							</ui.box>
						</ui.box>
					) : null}
					{o.actErr ? problem(o.actErr) : null}

					{app && last?.status === "failed" && !going ? (
						// Swarm's own error row (thread.go): the icon at the top, beside what it says.
						<ui.box style={{ flexDirection: "row", gap: "s4", alignItems: "flex-start", padding: "s4 s5", borderRadius: "card", backgroundColor: "redSoft" }}>
							<ui.icon icon="alert-circle" style={{ width: 15, height: 15, color: "red", flexShrink: 0 }} />
							<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
								<ui.text style={{ fontWeight: 500 }}>{`The last deployment failed ${api.ago(last.created_at)}`}</ui.text>
								<ui.text style={{ fontSize: "small", color: "text2" }}>{deploymentTitle(last, r)}</ui.text>
								<ui.box style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
									<ui.button size="sm" kind="primary" icon="sparkle" onClick={async () => { const c2 = conn(); const log = c2 ? await api.deployment(c2, last.deployment_uuid).catch(() => undefined) : undefined; ask(r, fixPrompt(r, last, log)); }}>Ask an agent to fix it</ui.button>
									<ui.button size="sm" kind="ghost" onClick={() => { o.tab = "deployments"; o.expanded = last.deployment_uuid; o.log = undefined; void readLog(last.deployment_uuid, o); }}>See the log</ui.button>
								</ui.box>
							</ui.box>
						</ui.box>
					) : null}

					<ui.segmented style={{ alignSelf: phone.on ? "stretch" : "flex-start" }} label="Tabs" value={o.tab} options={tabs} onChange={(v) => void (o.tab = v as Opened["tab"])} />
					{o.tab === "overview" ? overviewTab(r, o) : null}
					{o.tab === "deployments" ? deploymentsTab(r, o) : null}
					{o.tab === "logs" ? logsTab(r, o) : null}
					{o.tab === "environment" ? environmentTab(r, o) : null}
				</ui.box>
			</ui.scroll>
		</ui.box>
	);
}

export function renderPage({ args }: RenderContext): Child {
	setPhone(args);
	let { view, base, open } = parsePath(args.path ?? "");
	// A project Coolify no longer has (deleted, or another team's token
	// now), as the window reopens the page where it was: the overview,
	// which the sidebar shows chosen as it has no row for it.
	if (view.kind === "project" && state.list && state.places.size && ![...state.places.values()].some((p) => p.projectUuid === (view as { uuid: string }).uuid)) {
		view = { kind: "overview" };
		base = "";
	}
	// A bare page draws its own title bar: the view's name, and its buttons.
	if (args.slot === "head") return board(view, base, open, true);
	if (args.slot) return null;
	state.shown = open;
	fresh();
	if (view.kind === "servers" && conn() && Date.now() - state.serversAt > STALE) void readServers();
	const r = open ? resource(open) : undefined;
	return (
		<ui.box style={{ flexDirection: "row", flexGrow: 1, minHeight: 0, alignItems: "stretch" }}>
			<ui.box key="list" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, display: open ? "none" : "flex", media: [{ minWidth: 900, style: { display: "flex" } }] }}>
				{board(view, base, open)}
			</ui.box>
			{open ? <ui.box key="split" style={{ width: 1, flexShrink: 0, backgroundColor: "divider", display: "none", media: [{ minWidth: 900, style: { display: "flex" } }] }} /> : null}
			{open ? (
				<ui.box key="resource" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, media: [{ minWidth: 900, style: { flexGrow: 0, flexBasis: "56%" } }] }}>
					{resourcePane(r, open, base)}
				</ui.box>
			) : null}
		</ui.box>
	);
}
