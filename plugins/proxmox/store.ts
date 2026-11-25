// What the plugin knows of Proxmox, read as the page needs it and kept
// current while it shows: the cluster's resources, its status, the recent
// tasks, and what's read of a guest or a node opened. The tasks started
// here are watched until they end, with a toast as each does.
import { settings, ui } from "swarm";
import * as api from "./pve";
import type { Conn, Guest, GuestStatus, NodeStatus, Point, Resource, Snapshot, Task, Address, ClusterStatus, Power } from "./pve";

export const PAGE = "proxmox";
/** How old the resources are read again, while the page shows. */
export const STALE = 10_000;

export function conn(): Conn | null {
	const url = String(settings.get("url") ?? "").trim();
	const tokenId = String(settings.get("tokenId") ?? "").trim();
	const secret = String(settings.get("secret") ?? "").trim();
	const certificate = String(settings.get("certificate") ?? "").trim();
	return url && tokenId && secret ? { url, tokenId, secret, certificate } : null;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Timeframe = "hour" | "day" | "week";

/** What's read of a guest opened. */
export interface OpenedGuest {
	tab: "summary" | "hardware" | "snapshots" | "tasks";
	status?: GuestStatus;
	config?: Record<string, string | number>;
	configErr: string;
	rrd?: Point[];
	rrdFor: string;
	timeframe: Timeframe;
	addrs?: Address[];
	snaps?: Snapshot[];
	snapsErr: string;
	at: number;
	/** The action under way: its name. */
	busy: string;
	actErr: string;
	/** An action that asks first: stop, reboot, rollback:NAME, delete:NAME. */
	confirm: string;
	snapForm?: { name: string; description: string; vmstate: boolean };
}

/** What's read of a node opened. */
export interface OpenedNode {
	tab: "summary" | "guests" | "syslog";
	status?: NodeStatus;
	statusErr: string;
	rrd?: Point[];
	rrdFor: string;
	timeframe: Timeframe;
	syslog?: string;
	syslogErr: string;
	at: number;
	busy: string;
	actErr: string;
	confirm: string;
}

export const state = {
	list: undefined as Resource[] | undefined,
	cluster: [] as ClusterStatus[],
	version: "",
	err: "",
	/** Why the certificate stopped the last read: the one Proxmox showed, for Settings to offer. */
	certificate: "",
	reading: false,
	at: 0,
	search: "",
	tasks: undefined as Task[] | undefined,
	tasksErr: "",
	tasksAt: 0,
	guests: new Map<string, OpenedGuest>(),
	nodes: new Map<string, OpenedNode>(),
	/** Tasks started here, until they end: what they do, in words. */
	started: new Map<string, string>(),
	/** A task's log opened, in the Tasks view: its UPID and lines. */
	taskLog: { upid: "", text: "", err: "" },
	/** When the page last drew: it's kept current while it shows. */
	shownAt: 0,
};

export const guests = (): Guest[] => (state.list ?? []).filter(api.isGuest);
export const nodes = () => (state.list ?? []).filter((r) => r.type === "node").sort((a, b) => (a.node ?? "").localeCompare(b.node ?? "", undefined, { numeric: true }));
export const storages = () => (state.list ?? []).filter((r) => r.type === "storage");
export const guestById = (id: string) => guests().find((g) => g.id === id);
export const nodeByName = (n: string) => nodes().find((r) => r.node === n);
export const clusterName = () => state.cluster.find((c) => c.type === "cluster")?.name ?? "";

/** Reads the resources, the cluster's status and its version. */
export async function readList() {
	const c = conn();
	if (!c || state.reading) return;
	state.reading = true;
	state.at = Date.now();
	try {
		const [list, cluster, v] = await Promise.all([api.resources(c), api.clusterStatus(c).catch(() => state.cluster), state.version ? Promise.resolve({ version: state.version }) : api.version(c).catch(() => ({ version: "" }))]);
		state.list = list;
		state.cluster = cluster;
		state.version = v.version;
		state.err = "";
		state.certificate = "";
	} catch (e) {
		state.err = message(e);
		state.certificate = e instanceof api.PveError ? e.certificate : "";
	}
	state.reading = false;
	syncNav();
	ui.update();
}

/** Reads what's stale as a view shows, and keeps it current while it does. */
export function fresh() {
	state.shownAt = Date.now();
	if (!conn()) return;
	if (!state.reading && (!state.list || Date.now() - state.at > STALE)) void readList();
	keepCurrent();
}

let timer: number | undefined;
let stopped = false;

/** Reads again every STALE while the page has drawn lately: Proxmox has no events to follow. */
function keepCurrent() {
	if (stopped || timer !== undefined) return;
	timer = setTimeout(() => {
		timer = undefined;
		if (Date.now() - state.shownAt > 2 * STALE) return;
		void readList();
		for (const [id, o] of state.guests) {
			const g = guestById(id);
			if (g && o === state.guests.get(id) && shown.guest === id) void readGuest(g, o, false);
		}
		if (shown.node) {
			const o = state.nodes.get(shown.node);
			if (o) void readNode(shown.node, o, false);
		}
		if (shown.tasks) void readTasks();
		keepCurrent();
	}, STALE);
}

/** What the page shows: the guest or node opened, and whether the tasks are. */
export const shown = { guest: "", node: "", tasks: false };

export function stopAll() {
	stopped = true;
	if (timer !== undefined) clearTimeout(timer);
	timer = undefined;
}

export async function readTasks() {
	const c = conn();
	if (!c) return;
	state.tasksAt = Date.now();
	try {
		state.tasks = (await api.tasks(c)).sort((a, b) => b.starttime - a.starttime);
		state.tasksErr = "";
	} catch (e) {
		state.tasksErr = message(e);
	}
	ui.update();
}

export async function readTaskLog(upid: string) {
	const c = conn();
	if (!c) return;
	state.taskLog = { upid, text: "", err: "" };
	ui.update();
	try {
		const lines = await api.taskLog(c, upid);
		if (state.taskLog.upid === upid) state.taskLog.text = lines.map((l) => l.t).join("\n");
	} catch (e) {
		if (state.taskLog.upid === upid) state.taskLog.err = message(e);
	}
	ui.update();
}

// ---- A guest opened ----

export function openedGuest(g: Guest): OpenedGuest {
	let o = state.guests.get(g.id);
	if (!o) {
		o = { tab: "summary", configErr: "", rrdFor: "", timeframe: "hour", snapsErr: "", at: 0, busy: "", actErr: "", confirm: "" };
		state.guests.set(g.id, o);
	}
	return o;
}

/** Reads a guest's status, its configuration and its graph; its addresses as it runs. */
export async function readGuest(g: Guest, o: OpenedGuest, all = true) {
	const c = conn();
	if (!c) return;
	o.at = Date.now();
	const jobs: Promise<unknown>[] = [
		api.guestStatus(c, g).then((s) => void (o.status = s)).catch(() => undefined),
		api.guestRrd(c, g, o.timeframe).then((r) => {
			o.rrd = r;
			o.rrdFor = o.timeframe;
		}).catch(() => undefined),
	];
	if (all || !o.config)
		jobs.push(
			api.guestConfig(c, g).then((cfg) => {
				o.config = cfg;
				o.configErr = "";
			}).catch((e) => void (o.configErr = message(e))),
		);
	if (g.status === "running" && (all || !o.addrs)) jobs.push(api.addresses(c, g).then((a) => void (o.addrs = a)).catch(() => void (o.addrs ??= [])));
	await Promise.all(jobs);
	ui.update();
}

export async function readSnapshots(g: Guest, o: OpenedGuest) {
	const c = conn();
	if (!c) return;
	try {
		o.snaps = (await api.snapshots(c, g)).filter((s) => s.name !== "current").sort((a, b) => (b.snaptime ?? 0) - (a.snaptime ?? 0));
		o.snapsErr = "";
	} catch (e) {
		o.snapsErr = message(e);
	}
	ui.update();
}

const powerWords: Record<Power, [string, string]> = {
	start: ["Starting", "started"],
	stop: ["Stopping", "stopped"],
	shutdown: ["Shutting down", "shut down"],
	reboot: ["Rebooting", "rebooted"],
	suspend: ["Pausing", "paused"],
	resume: ["Resuming", "resumed"],
};

/** Runs a power action on a guest, and follows its task to its end. */
export async function press(g: Guest, o: OpenedGuest, what: Power) {
	const c = conn();
	if (!c || o.busy) return;
	o.busy = what;
	o.actErr = "";
	o.confirm = "";
	ui.update();
	try {
		const upid = await api.power(c, g, what);
		await follow(c, upid, `${api.guestName(g)} ${powerWords[what][1]}`, `${powerWords[what][0]} ${api.guestName(g)}`);
	} catch (e) {
		o.actErr = message(e);
	}
	o.busy = "";
	await readList();
	await readGuest(g, o, false);
}

/** Takes, rolls back to or deletes a snapshot, following its task. */
export async function snapAction(g: Guest, o: OpenedGuest, what: "take" | "rollback" | "delete", name: string, description = "", vmstate = false) {
	const c = conn();
	if (!c || o.busy) return;
	o.busy = `${what}:${name}`;
	o.actErr = "";
	o.confirm = "";
	ui.update();
	try {
		const upid = what === "take" ? await api.snapshot(c, g, name, description, vmstate) : what === "rollback" ? await api.rollback(c, g, name) : await api.deleteSnapshot(c, g, name);
		const done = what === "take" ? `Took snapshot ${name} of ${api.guestName(g)}` : what === "rollback" ? `Rolled ${api.guestName(g)} back to ${name}` : `Deleted snapshot ${name} of ${api.guestName(g)}`;
		await follow(c, upid, done, done);
		if (what === "take") o.snapForm = undefined;
	} catch (e) {
		o.actErr = message(e);
	}
	o.busy = "";
	await readSnapshots(g, o);
	void readList();
}

/**
 * Follows a task started here to its end: a toast saying how it ended,
 * and an error that says why it failed.
 */
async function follow(c: Conn, upid: string, done: string, doing: string) {
	state.started.set(upid, doing);
	syncNav();
	ui.update();
	try {
		const exit = await api.waitTask(c, upid, undefined, TASK_POLL.every);
		if (!api.taskOk({ status: exit })) throw new Error(exit);
		ui.toast(`${done}.`);
	} finally {
		state.started.delete(upid);
		syncNav();
		if (shown.tasks) void readTasks();
	}
}

/** How often a task started here is asked after: a test shortens it. */
export const TASK_POLL = { every: 1000 };

// ---- A node opened ----

export function openedNode(node: string): OpenedNode {
	let o = state.nodes.get(node);
	if (!o) {
		o = { tab: "summary", statusErr: "", rrdFor: "", timeframe: "hour", syslogErr: "", at: 0, busy: "", actErr: "", confirm: "" };
		state.nodes.set(node, o);
	}
	return o;
}

export async function readNode(node: string, o: OpenedNode, _all = true) {
	const c = conn();
	if (!c) return;
	o.at = Date.now();
	await Promise.all([
		api.nodeStatus(c, node).then((s) => {
			o.status = s;
			o.statusErr = "";
		}).catch((e) => void (o.statusErr = message(e))),
		api.nodeRrd(c, node, o.timeframe).then((r) => {
			o.rrd = r;
			o.rrdFor = o.timeframe;
		}).catch(() => undefined),
	]);
	ui.update();
}

export async function readSyslog(node: string, o: OpenedNode) {
	const c = conn();
	if (!c) return;
	try {
		o.syslog = (await api.nodeSyslog(c, node, 500)).map((l) => l.t).join("\n");
		o.syslogErr = "";
	} catch (e) {
		o.syslogErr = message(e);
	}
	ui.update();
}

export async function nodePower(node: string, o: OpenedNode, command: "reboot" | "shutdown") {
	const c = conn();
	if (!c || o.busy) return;
	o.busy = command;
	o.actErr = "";
	o.confirm = "";
	ui.update();
	try {
		await api.nodePower(c, node, command);
		ui.toast(command === "reboot" ? `${node} is rebooting.` : `${node} is shutting down.`);
	} catch (e) {
		o.actErr = message(e);
	}
	o.busy = "";
	void readList();
}

// ---- The sidebar ----

/** The page's rows in the sidebar: the overview, the guests, each node, storage, tasks. */
export function navItems() {
	const list = guests();
	const running = list.filter((g) => g.status === "running" && !g.template).length;
	return [
		{ id: "overview", title: "Overview", icon: "house" as const, path: "" },
		{ id: "guests", title: "VMs & containers", icon: "cubes" as const, path: "guests", badge: list.length ? `${running}/${list.filter((g) => !g.template).length}` : undefined },
		{ id: "tasks", title: "Tasks", icon: "tasks" as const, path: "tasks", badge: state.started.size ? String(state.started.size) : undefined },
		{ id: "storage", title: "Storage", icon: "hard-drive" as const, path: "storage" },
		...nodes().map((n) => ({ id: "n-" + n.node, title: n.node ?? "", icon: "server" as const, path: `n/${encodeURIComponent(n.node ?? "")}`, section: "Nodes", badge: n.status !== "online" ? "Offline" : undefined })),
	];
}

export function syncNav() {
	try {
		ui.navItems(PAGE, conn() ? navItems() : []);
		ui.navBadge(PAGE, state.started.size ? { text: String(state.started.size) } : null);
	} catch {
		// The page is registered a moment later.
	}
}

export function forget() {
	state.list = undefined;
	state.cluster = [];
	state.version = "";
	state.err = "";
	state.certificate = "";
	state.tasks = undefined;
	state.guests.clear();
	state.nodes.clear();
	state.started.clear();
	syncNav();
}
