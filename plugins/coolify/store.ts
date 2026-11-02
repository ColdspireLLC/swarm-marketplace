// What the plugin knows of Coolify, read as the page and the threads need
// it, and kept current: the resources and their projects, every
// deployment that runs (whoever started it: a button, an agent, a push's
// webhook), each application's last deployments, the servers, and which
// of Swarm's projects each application is built from.
import { call, settings, ui } from "swarm";
import * as api from "./coolify";
import type { Conn, Deployment, EnvVar, Place, Resource, RollbackImage, Server, ServerResource } from "./coolify";

export const PAGE = "coolify";
/** How old what the page shows is read again as it shows it. */
export const STALE = 30_000;
/** How often what runs is asked about: while something deploys, and while nothing does. */
export const POLL = { busy: 3000, idle: 20_000 };

export function conn(): Conn | null {
	const url = String(settings.get("url") ?? "").trim();
	const token = String(settings.get("token") ?? "").trim();
	return url && token ? { url, token } : null;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A deployment, with the application it's of. */
export interface Dep extends Deployment {
	app: string;
}

/** What's read of a resource opened. */
export interface Opened {
	deps?: Deployment[];
	depsErr: string;
	depsReading: boolean;
	logs?: string;
	logsErr: string;
	logsReading: boolean;
	/** Logs read again every few seconds while they show. */
	live: boolean;
	filter: string;
	/** How many of the containers' last lines are read, and whether only errors show. */
	lines: number;
	errorsOnly: boolean;
	/** Stop asked for, waiting for the user to confirm. */
	confirmStop: boolean;
	/** The deployment whose log shows, and its log. */
	expanded: string;
	log?: Deployment;
	logErr: string;
	envs?: EnvVar[];
	envsErr: string;
	envsReading: boolean;
	shown: Set<string>;
	images?: RollbackImage[];
	tab: "overview" | "deployments" | "logs" | "environment";
	/** The action under way: deploy, restart… */
	busy: string;
	actErr: string;
}

/** A project of Swarm's, and the repository it's a checkout of. */
export interface SwarmProject {
	id: string;
	name: string;
	path: string;
	repo: string;
}

export const state = {
	list: undefined as Resource[] | undefined,
	places: new Map<number, Place>(),
	err: "",
	reading: false,
	at: 0,
	search: "",
	opened: new Map<string, Opened>(),
	/** Deployments queued or in progress, by uuid, as Coolify last said. */
	live: new Map<string, Deployment>(),
	/** Deployments started here: they're asked after at once, before Coolify lists them as running. */
	started: new Map<string, string>(),
	/** Each application's last deployments, newest first, as the overview and the threads show them. */
	recent: new Map<string, Deployment[]>(),
	recentAt: 0,
	recentReading: false,
	servers: undefined as Server[] | undefined,
	serversErr: "",
	serversAt: 0,
	serverRes: new Map<string, ServerResource[] | string>(),
	/** Swarm's projects, and when they were read. */
	projects: [] as SwarmProject[],
	projectsAt: 0,
	/** Each thread's project, as Swarm said. */
	threads: new Map<string, string>(),
	threadsAt: 0,
	/** The resource the page shows. */
	shown: "",
};

export const placeOf = (r: Resource) => (r.environment_id !== undefined ? state.places.get(r.environment_id) : undefined);
export const resource = (uuid: string) => state.list?.find((r) => r.uuid === uuid);
export const apps = () => (state.list ?? []).filter((r) => r.type === "application");

/** Reads the resources and their projects; then what isn't fresh of the rest. */
export async function readList() {
	const c = conn();
	if (!c || state.reading) return;
	state.reading = true;
	state.at = Date.now();
	try {
		const [list, places] = await Promise.all([api.resources(c), api.places(c).catch(() => state.places)]);
		state.list = list;
		state.places = places;
		state.err = "";
	} catch (e) {
		state.err = message(e);
	}
	state.reading = false;
	syncNav();
	ui.update();
	if (state.list && Date.now() - state.recentAt > STALE) void readRecent();
	if (Date.now() - state.projectsAt > 5 * 60_000) void readProjects();
}

/** Reads what's stale as a view shows. */
export function fresh() {
	if (!conn()) return;
	if (!state.reading && (!state.list || Date.now() - state.at > STALE)) void readList();
}

/** Every application's last few deployments, a few at a time. */
export async function readRecent() {
	const c = conn();
	if (!c || state.recentReading) return;
	state.recentReading = true;
	state.recentAt = Date.now();
	const queue = apps().map((r) => r.uuid);
	const work = async () => {
		for (let uuid = queue.shift(); uuid; uuid = queue.shift()) {
			try {
				state.recent.set(uuid, await api.deployments(c, uuid, 5));
			} catch {
				// One application's failing leaves the others.
			}
		}
	};
	await Promise.all([work(), work(), work(), work()]);
	state.recentReading = false;
	ui.update();
}

/** Every application's deployments in one list, newest first. */
export function allRecent(): Dep[] {
	const out: Dep[] = [];
	for (const [app, deps] of state.recent) for (const d of deps) out.push({ ...d, app });
	for (const [uuid, d] of state.live) if (!out.some((x) => x.deployment_uuid === uuid)) out.push({ ...d, app: appOfDeployment(d) });
	return out.sort((a, b) => (api.parseTime(b.created_at) || 0) - (api.parseTime(a.created_at) || 0));
}

/** The application a deployment is of: Coolify's running list names it, not its uuid. */
function appOfDeployment(d: Deployment & { application_id?: number | string; application_uuid?: string }): string {
	if (d.application_uuid) return d.application_uuid;
	const started = state.started.get(d.deployment_uuid);
	if (started) return started;
	const byId = d.application_id !== undefined ? apps().find((r) => r.id !== undefined && String(r.id) === String(d.application_id)) : undefined;
	if (byId) return byId.uuid;
	const byName = apps().filter((r) => r.name === d.application_name);
	return byName.length === 1 ? byName[0]!.uuid : "";
}

/** An application's last deployment. */
export const lastDeployment = (app: string) => state.recent.get(app)?.[0];

export async function readServers() {
	const c = conn();
	if (!c) return;
	state.serversAt = Date.now();
	try {
		state.servers = await api.servers(c);
		state.serversErr = "";
	} catch (e) {
		state.serversErr = message(e);
	}
	ui.update();
}

export async function readServerResources(uuid: string) {
	const c = conn();
	if (!c) return;
	try {
		state.serverRes.set(uuid, await api.serverResources(c, uuid));
	} catch (e) {
		state.serverRes.set(uuid, message(e));
	}
	ui.update();
}

// ---- A resource opened ----

export function openedOf(r: Resource): Opened {
	let o = state.opened.get(r.uuid);
	if (!o) {
		o = { depsErr: "", depsReading: false, logsErr: "", logsReading: false, live: false, filter: "", lines: 500, errorsOnly: false, confirmStop: false, expanded: "", logErr: "", envsErr: "", envsReading: false, shown: new Set(), tab: "overview", busy: "", actErr: "" };
		state.opened.set(r.uuid, o);
		if (r.type === "application") void readDeployments(r.uuid, o);
	}
	return o;
}

export async function readDeployments(app: string, o: Opened) {
	const c = conn();
	if (!c) return;
	o.depsReading = true;
	try {
		o.deps = await api.deployments(c, app, 15);
		state.recent.set(app, o.deps.slice(0, 5));
		o.depsErr = "";
		const going = o.deps.find(api.deploying);
		if (going && !o.expanded) o.expanded = going.deployment_uuid;
		const open = o.deps.find((d) => d.deployment_uuid === o.expanded);
		if (open?.logs) o.log = open;
		else if (open) void readLog(open.deployment_uuid, o);
	} catch (e) {
		o.depsErr = message(e);
	}
	o.depsReading = false;
	ui.update();
}

export async function readLog(uuid: string, o: Opened) {
	const c = conn();
	if (!c) return;
	try {
		const d = await api.deployment(c, uuid);
		if (o.expanded === uuid) o.log = d;
		o.logErr = "";
	} catch (e) {
		o.logErr = message(e);
	}
	ui.update();
}

export async function readLogs(r: Resource, o: Opened) {
	const c = conn();
	if (!c || r.type === "service" || o.logsReading) return;
	o.logsReading = true;
	try {
		o.logs = await api.logs(c, api.kindOf(r.type), r.uuid, o.lines);
		o.logsErr = "";
	} catch (e) {
		o.logsErr = message(e);
	}
	o.logsReading = false;
	ui.update();
}

export async function readEnvs(r: Resource, o: Opened) {
	const c = conn();
	if (!c || o.envsReading) return;
	o.envsReading = true;
	try {
		o.envs = await api.envs(c, api.kindOf(r.type), r.uuid);
		o.envsErr = "";
	} catch (e) {
		o.envsErr = message(e);
	}
	o.envsReading = false;
	ui.update();
}

export async function readImages(app: string, o: Opened) {
	const c = conn();
	if (!c) return;
	try {
		o.images = await api.rollbackImages(c, app);
	} catch {
		o.images = [];
	}
	ui.update();
}

// ---- Watching what deploys ----

let timer: number | undefined;
let stopped = false;

/** Starts watching: every deployment that runs, until it ends, and a toast as it does. */
export function watch(now = false) {
	if (stopped) return;
	if (timer !== undefined) clearTimeout(timer);
	const busy = state.live.size > 0 || state.started.size > 0;
	timer = setTimeout(
		() => {
			timer = undefined;
			void tick().finally(() => watch());
		},
		now ? 0 : busy ? POLL.busy : POLL.idle,
	);
}

export function stopWatching() {
	stopped = true;
	if (timer !== undefined) clearTimeout(timer);
}

async function tick() {
	const c = conn();
	if (!c) return;
	let running: Deployment[];
	try {
		running = await api.running(c);
	} catch {
		return; // Unreachable for now: asked again later.
	}
	const was = new Set([...state.live.keys(), ...state.started.keys()]);
	state.live = new Map(running.map((d) => [d.deployment_uuid, d]));
	for (const d of running) state.started.delete(d.deployment_uuid);
	const ended = [...was].filter((uuid) => !state.live.has(uuid));
	for (const uuid of ended) {
		const app = state.started.get(uuid);
		state.started.delete(uuid);
		let d: Deployment;
		try {
			d = await api.deployment(c, uuid);
		} catch {
			continue;
		}
		if (api.deploying(d)) {
			// Not listed yet: Coolify queues it a moment after.
			state.started.set(uuid, app ?? "");
			continue;
		}
		finished({ ...d, app: app || appOfDeployment(d) });
	}
	const shown = state.opened.get(state.shown);
	if (shown?.deps?.some(api.deploying) || (ended.length && shown)) {
		const r = resource(state.shown);
		if (r?.type === "application") await readDeployments(r.uuid, shown!);
	}
	if (ended.length) {
		state.at = 0;
		state.recentAt = 0;
		void readList();
	}
	syncNav();
	ui.update();
}

/** Says a deployment ended, how, with a way to it. */
function finished(d: Dep) {
	const r = d.app ? resource(d.app) : undefined;
	const name = r ? api.displayName(r) : d.application_name || "A deployment";
	const word = d.status === "finished" ? "deployed" : d.status === "failed" ? "failed to deploy" : "stopped deploying";
	ui.toast(`${name} ${word}${d.commit && d.commit !== "HEAD" ? ` ${d.commit.slice(0, 7)}` : ""}.`, d.app ? { action: d.status === "failed" ? "See why" : "Open", href: `swarm://plugin/${PAGE}/deployments/r/${d.app}` } : undefined);
	if (d.app && d.status === "failed") {
		const o = state.opened.get(d.app);
		if (o) {
			o.tab = "deployments";
			o.expanded = d.deployment_uuid;
			o.log = undefined;
		}
	}
}

/** Whether a resource has a deployment running. */
export const deployingNow = (uuid: string) => [...state.started.values()].includes(uuid) || [...state.live.values()].some((d) => appOfDeployment(d) === uuid);

// ---- Acting ----

export type What = "deploy" | "force" | api.Action;

/** Runs an action on a resource, as a button or a command asks. */
export async function run(c: Conn, r: Resource, what: What): Promise<{ message: string; deployment?: string }> {
	const res = what === "deploy" || what === "force" ? await api.deploy(c, r.uuid, what === "force") : await api.action(c, api.kindOf(r.type), r.uuid, what);
	if (res.deployment) {
		state.started.set(res.deployment, r.uuid);
		watch(true);
	}
	return res;
}

export async function press(r: Resource, o: Opened, what: What | { rollback: string }) {
	const c = conn();
	if (!c || o.busy) return;
	o.busy = typeof what === "string" ? what : "rollback";
	o.actErr = "";
	ui.update();
	try {
		let res: { message: string; deployment?: string };
		if (typeof what === "string") res = await run(c, r, what);
		else {
			res = await api.rollback(c, r.uuid, what.rollback);
			if (res.deployment) {
				state.started.set(res.deployment, r.uuid);
				watch(true);
			}
		}
		ui.toast(res.message);
		if (res.deployment) {
			o.expanded = res.deployment;
			o.log = undefined;
			o.tab = "deployments";
		}
		if (r.type === "application") void readDeployments(r.uuid, o);
		// Coolify's status follows a moment after.
		setTimeout(() => void readList(), 2000);
	} catch (e) {
		o.actErr = message(e);
	}
	o.busy = "";
	ui.update();
}

export async function cancelDeployment(d: Deployment, o: Opened) {
	const c = conn();
	if (!c) return;
	try {
		ui.toast((await api.cancel(c, d.deployment_uuid)).message ?? "Cancelled.");
	} catch (e) {
		o.actErr = message(e);
	}
	watch(true);
}

// ---- Swarm's projects, and the applications built from them ----

/** Reads Swarm's projects and the repository each is a checkout of. */
export async function readProjects() {
	state.projectsAt = Date.now();
	try {
		const ps = await call("Projects", {});
		const out: SwarmProject[] = [];
		await Promise.all(
			ps
				.filter((p) => !p.noGit)
				.map(async (p) => {
					let repo = "";
					try {
						repo = api.repoPath((await call("Repo", { project: p.id })).Origin);
					} catch {
						// No remote, or not this machine's.
					}
					out.push({ id: p.id, name: p.title || p.name, path: p.path, repo });
				}),
		);
		state.projects = out;
		ui.update();
	} catch {
		// Not granted See your threads: no links.
	}
}

/** The applications built from a Swarm project's repository, production first. */
export function linkedTo(project: string): Resource[] {
	const p = state.projects.find((x) => x.id === project);
	if (!p?.repo) return [];
	const prod = (r: Resource) => (placeOf(r)?.environment === "production" ? 0 : 1);
	return apps()
		.filter((r) => api.builtFrom(r, p.repo))
		.sort((a, b) => prod(a) - prod(b) || a.name.localeCompare(b.name));
}

/** The Swarm projects an application is built from. */
export const projectsOf = (r: Resource) => state.projects.filter((p) => p.repo && api.builtFrom(r, p.repo));

/** The Swarm project a folder is in. */
export function projectAt(dir: string): SwarmProject | undefined {
	const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	const d = norm(dir);
	return state.projects.filter((p) => d === norm(p.path) || d.startsWith(norm(p.path) + "/")).sort((a, b) => b.path.length - a.path.length)[0];
}

/** A thread's project, asked of Swarm when it isn't known yet. */
export async function threadProjectNow(thread: string): Promise<string> {
	if (!state.threads.has(thread)) {
		try {
			for (const t of await call("Threads", {})) state.threads.set(t.id, t.project);
		} catch {
			// Not granted See your threads.
		}
	}
	return state.threads.get(thread) ?? "";
}

/** A thread's project, as Swarm last said; asks again, now and then, for a thread it hasn't heard of. */
export function threadProject(thread: string): string {
	const p = state.threads.get(thread);
	if (p === undefined && Date.now() - state.threadsAt > 5000) {
		state.threadsAt = Date.now();
		void call("Threads", {})
			.then((ts) => {
				for (const t of ts) state.threads.set(t.id, t.project);
				ui.update();
			})
			.catch(() => undefined);
	}
	return p ?? "";
}

// ---- The sidebar ----

/** The page's rows in the sidebar: the overview, the deployments, each project, the servers. */
export function navItems() {
	const list = state.list ?? [];
	const unhealthy = list.filter((r) => api.trouble(r.status) === 2).length;
	const projects = new Map<string, { name: string; count: number; bad: number }>();
	for (const r of list) {
		const p = placeOf(r);
		if (!p) continue;
		const e = projects.get(p.projectUuid) ?? { name: p.project, count: 0, bad: 0 };
		e.count++;
		if (api.trouble(r.status) === 2) e.bad++;
		projects.set(p.projectUuid, e);
	}
	const live = state.live.size + state.started.size;
	return [
		{ id: "overview", title: "Overview", icon: "house" as const, path: "", badge: unhealthy ? String(unhealthy) : undefined },
		{ id: "deployments", title: "Deployments", icon: "rocket" as const, path: "deployments", badge: live ? String(live) : undefined },
		...[...projects]
			.sort((a, b) => a[1].name.localeCompare(b[1].name))
			.map(([uuid, p]) => ({ id: "p-" + uuid, title: p.name, icon: "folder" as const, path: `p/${uuid}`, section: "Projects", badge: p.bad ? `${p.bad}!` : String(p.count) })),
		{ id: "servers", title: "Servers", icon: "server" as const, path: "servers", section: "Infrastructure" },
	];
}

export function syncNav() {
	try {
		ui.navItems(PAGE, conn() ? navItems() : []);
		const live = state.live.size + state.started.size;
		ui.navBadge(PAGE, live ? { text: String(live) } : null);
	} catch {
		// The page is registered a moment later.
	}
}

export function forget() {
	state.list = undefined;
	state.err = "";
	state.opened.clear();
	state.live.clear();
	state.started.clear();
	state.recent.clear();
	state.servers = undefined;
	state.serverRes.clear();
	syncNav();
}
