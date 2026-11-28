// What the plugin knows of Proxmox, read as the page needs it and kept
// current while it shows: the cluster's resources, its status, the recent
// tasks, and what's read of a guest or a node opened. The tasks started
// here are watched until they end, with a toast as each does.
import { ui } from "swarm";
import { openConsole, type ConsoleOf, type OpenConsole } from "./console";
import { connOf, current, servers } from "./servers";
import * as api from "./pve";
import type { Address, Backup, BackupMode, ClusterStatus, Conn, Guest, GuestStatus, NodeStatus, NodeStorage, Point, Power, Resource, Snapshot, Task } from "./pve";

export const PAGE = "proxmox";
/** How old the resources are read again, while the page shows. */
export const STALE = 10_000;

/** The current server's Conn, or null with none. */
export function conn(): Conn | null {
	const s = current();
	return s ? connOf(s) : null;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Timeframe = "hour" | "day" | "week";

/** What's read of a guest opened. */
/** A form open over a guest's tabs: what it asks, as typed. */
export type GuestForm =
	| { kind: "backup"; storage: string; mode: BackupMode }
	| { kind: "clone"; newid: string; name: string; full: boolean; target: string }
	| { kind: "migrate"; target: string }
	| { kind: "edit"; name: string; cores: string; memory: string; onboot: boolean; tags: string }
	| { kind: "restore"; volid: string; asNew: boolean; newid: string };

export interface OpenedGuest {
	tab: "summary" | "console" | "hardware" | "snapshots" | "backups" | "tasks";
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
	backups?: Backup[];
	backupsErr: string;
	form?: GuestForm;
}

/** What's read of a node opened. */
export interface OpenedNode {
	tab: "summary" | "shell" | "guests" | "disks" | "syslog";
	disks?: api.Disk[];
	disksErr: string;
	/** Each disk's SMART, as read, or why it couldn't be; the one opened. */
	smart: Map<string, api.Smart | string>;
	openDisk: string;
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
	/** The current server's ticket lapsed and Proxmox wants a TOTP code to sign in again. */
	needsCode: false,
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
	/** Every guest's backups, for the Backups view. */
	backups: undefined as Backup[] | undefined,
	backupsErr: "",
	backupsAt: 0,
	backupsReading: false,
	/** Each node's storages that take backups, as the Back up form offers them. */
	backupStores: new Map<string, NodeStorage[]>(),
	/** Disks of the online nodes that are failing or worn out, read every ten minutes, for the overview. */
	badDisks: [] as { node: string; devpath: string; label: string }[],
	disksAt: 0,
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
		state.needsCode = false;
	} catch (e) {
		state.err = message(e);
		state.certificate = e instanceof api.PveError ? e.certificate : "";
		state.needsCode = e instanceof api.PveError && e.code === "tfa";
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
		o = { tab: "summary", configErr: "", rrdFor: "", timeframe: "hour", snapsErr: "", backupsErr: "", at: 0, busy: "", actErr: "", confirm: "" };
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
		api.guestRrd(c, g, o.timeframe).then(
			(r) => {
				o.rrd = r;
				o.rrdFor = o.timeframe;
			},
			// None to draw: "No data yet", not a spinner for ever.
			() => {
				o.rrd = [];
				o.rrdFor = o.timeframe;
			},
		),
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

/**
 * Runs an action on a guest that starts a task, follows it to its end,
 * and reads again what it changed: busy names it while it runs; onOk
 * runs as it ends well (a form closes, the page goes to what it made),
 * then done is the toast, last, so that what comes after it starts from
 * where the action left the page.
 */
export async function act(g: Guest, o: OpenedGuest, busy: string, start: (c: Conn) => Promise<string | null>, done: string, after?: () => Promise<unknown>, onOk?: () => void) {
	const c = conn();
	if (!c || o.busy) return false;
	o.busy = busy;
	o.actErr = "";
	o.confirm = "";
	ui.update();
	let ok = false;
	try {
		const upid = await start(c);
		if (upid) await follow(c, upid, busy);
		ok = true;
	} catch (e) {
		o.actErr = message(e);
	}
	o.busy = "";
	await readList();
	await Promise.all([readGuest(g, o, false), after?.()]);
	if (ok) {
		onOk?.();
		ui.toast(`${done}.`);
	}
	return ok;
}

/** Runs a power action on a guest, and follows its task to its end. */
export function press(g: Guest, o: OpenedGuest, what: Power) {
	return act(g, o, what, (c) => api.power(c, g, what), `${api.guestName(g)} ${powerWords[what][1]}`);
}

/** Takes, rolls back to or deletes a snapshot, following its task. */
export async function snapAction(g: Guest, o: OpenedGuest, what: "take" | "rollback" | "delete", name: string, description = "", vmstate = false) {
	const done = what === "take" ? `Took snapshot ${name} of ${api.guestName(g)}` : what === "rollback" ? `Rolled ${api.guestName(g)} back to ${name}` : `Deleted snapshot ${name} of ${api.guestName(g)}`;
	await act(
		g,
		o,
		`${what}:${name}`,
		(c) => (what === "take" ? api.snapshot(c, g, name, description, vmstate) : what === "rollback" ? api.rollback(c, g, name) : api.deleteSnapshot(c, g, name)),
		done,
		() => readSnapshots(g, o),
		() => void (what === "take" && (o.snapForm = undefined)),
	);
}

// ---- Backups ----

/** A guest's backups, on every storage its node reaches. */
export async function readGuestBackups(g: Guest, o: OpenedGuest) {
	const c = conn();
	if (!c) return;
	try {
		o.backups = await api.backups(c, [g.node], g.vmid);
		o.backupsErr = "";
	} catch (e) {
		o.backupsErr = message(e);
	}
	ui.update();
}

/** Every guest's backups, on every storage the online nodes reach. */
export async function readAllBackups() {
	const c = conn();
	if (!c || state.backupsReading) return;
	state.backupsReading = true;
	state.backupsAt = Date.now();
	ui.update();
	try {
		state.backups = await api.backups(c, nodes().filter((n) => n.status === "online").map((n) => n.node!));
		state.backupsErr = "";
	} catch (e) {
		state.backupsErr = message(e);
	}
	state.backupsReading = false;
	ui.update();
}

/** The storages a node backs up to, read once. */
export async function readBackupStores(node: string) {
	const c = conn();
	if (!c || state.backupStores.has(node)) return;
	state.backupStores.set(node, []);
	try {
		state.backupStores.set(node, (await api.nodeStorages(c, node, "backup")).filter((s) => s.active !== 0));
	} catch {
		state.backupStores.delete(node);
	}
	ui.update();
}

/** Follows a task started here to its end: an error that says why, when it failed. */
async function follow(c: Conn, upid: string, doing: string) {
	state.started.set(upid, doing);
	syncNav();
	ui.update();
	try {
		const exit = await api.waitTask(c, upid, undefined, TASK_POLL.every);
		if (!api.taskOk({ status: exit })) throw new Error(exit);
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
		o = { tab: "summary", statusErr: "", rrdFor: "", timeframe: "hour", syslogErr: "", disksErr: "", smart: new Map(), openDisk: "", at: 0, busy: "", actErr: "", confirm: "" };
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
		api.nodeRrd(c, node, o.timeframe).then(
			(r) => {
				o.rrd = r;
				o.rrdFor = o.timeframe;
			},
			() => {
				o.rrd = [];
				o.rrdFor = o.timeframe;
			},
		),
	]);
	ui.update();
}

export async function readDisks(node: string, o: OpenedNode) {
	const c = conn();
	if (!c) return;
	try {
		o.disks = (await api.disks(c, node)).sort((a, b) => a.devpath.localeCompare(b.devpath, undefined, { numeric: true }));
		o.disksErr = "";
	} catch (e) {
		o.disksErr = message(e);
	}
	ui.update();
}

/** Every online node's disks, for those failing or worn out. A node it may not read is left out. */
export async function readBadDisks() {
	const c = conn();
	if (!c) return;
	state.disksAt = Date.now();
	const bad: typeof state.badDisks = [];
	for (const n of nodes().filter((x) => x.status === "online")) {
		const ds = await api.disks(c, n.node!).catch(() => [] as api.Disk[]);
		for (const d of ds) {
			const st = api.diskState(d);
			if (st.bad) bad.push({ node: n.node!, devpath: d.devpath, label: st.label });
		}
	}
	state.badDisks = bad;
	ui.update();
}

export async function readSmart(node: string, o: OpenedNode, disk: string) {
	const c = conn();
	if (!c) return;
	try {
		o.smart.set(disk, await api.smart(c, node, disk));
	} catch (e) {
		o.smart.set(disk, message(e));
	}
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

// ---- Consoles ----

/** The consoles open, by what they're of (lxc/101, qemu/100, node/pve1), as their pages show them; the ones opening. */
export const consoles = new Map<string, OpenConsole>();
export const opening = new Set<string>();

export const consoleKey = (of: ConsoleOf) => (of.kind === "node" ? `node/${of.node}` : `${of.kind}/${of.vmid}`);

/** Opens a console, shown where its guest or node is; fail says why it couldn't. One a guest has open already is shown again. */
export async function startConsole(of: ConsoleOf, fail: (why: string) => void, shown?: () => void) {
	const c = conn();
	const key = consoleKey(of);
	if (!c || opening.has(key)) return;
	if (consoles.has(key)) return shown?.();
	opening.add(key);
	ui.update();
	try {
		const open = await openConsole(c, of, () => {
			if (consoles.get(key) === open) consoles.delete(key);
			ui.update();
		});
		consoles.set(key, open);
		shown?.();
	} catch (e) {
		fail(/permission check failed|may not/i.test(message(e)) ? `${message(e)} A console needs VM.Console (Sys.Console for a node's shell).` : message(e));
	}
	opening.delete(key);
	ui.update();
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
		{ id: "backups", title: "Backups", icon: "archive" as const, path: "backups" },
		{ id: "storage", title: "Storage", icon: "hard-drive" as const, path: "storage" },
		...nodes().map((n) => ({ id: "n-" + n.node, title: n.node ?? "", icon: "server" as const, path: `n/${encodeURIComponent(n.node ?? "")}`, section: "Nodes", badge: n.status !== "online" ? "Offline" : undefined })),
		// With more than one, each server: choosing one shows it.
		...(servers().length > 1 ? servers().map((s) => ({ id: "s-" + s.id, title: s.name, icon: "house-cloud" as const, path: `server/${s.id}`, section: "Servers", badge: s.id === current()?.id ? "Shown" : undefined })) : []),
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
	state.needsCode = false;
	state.tasks = undefined;
	state.guests.clear();
	state.nodes.clear();
	state.backups = undefined;
	state.backupStores.clear();
	state.badDisks = [];
	state.disksAt = 0;
	state.started.clear();
	// Another server's consoles: closed.
	for (const c of consoles.values()) c.close();
	consoles.clear();
	syncNav();
}
