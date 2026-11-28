// Proxmox VE's API (/api2/json), as much of it as the plugin uses: the
// cluster's resources (nodes, VMs, containers, storage), a node's and a
// guest's status, configuration and graphs, the power actions, snapshots,
// and tasks with their logs.
//
// It's reached with an API token (Datacenter, Permissions, API Tokens),
// which needs no CSRF token. Proxmox makes its own certificate as it's
// installed: the user trusts it once, by its fingerprint, and every fetch
// carries it (Swarm's init.certificate).

/** A Proxmox to reach: its address, an API token's ID and secret, and the certificate trusted, if it's its own. */
export interface Conn {
	url: string;
	/** USER@REALM!TOKENID, as root@pam!swarm. */
	tokenId: string;
	secret: string;
	/** sha256:… of the certificate trusted in place of a certificate authority's, or "". */
	certificate: string;
}

/** What Proxmox said no to: its HTTP status (0 for none reached) and why; certificate is the one it showed, when that's why. */
export class PveError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly certificate = "",
	) {
		super(message);
	}
}

/** A VM (qemu) or a container (lxc). */
export type GuestType = "qemu" | "lxc";

/** A row of /cluster/resources: a node, a guest, a storage, a pool or an SDN zone. */
export interface Resource {
	/** qemu/100, lxc/101, node/pve, storage/pve/local. */
	id: string;
	type: "qemu" | "lxc" | "node" | "storage" | "pool" | "sdn" | string;
	node?: string;
	vmid?: number;
	name?: string;
	/** A guest's running, stopped (paused shows in its qmpstatus); a node's online, offline; a storage's available. */
	status?: string;
	/** A fraction of maxcpu. */
	cpu?: number;
	maxcpu?: number;
	mem?: number;
	maxmem?: number;
	disk?: number;
	maxdisk?: number;
	uptime?: number;
	template?: number;
	/** Tags, ; separated. */
	tags?: string;
	hastate?: string;
	lock?: string;
	netin?: number;
	netout?: number;
	/** A storage's name, its plugin type (dir, lvmthin, zfspool, nfs…), what it holds, and whether it's shared. */
	storage?: string;
	plugintype?: string;
	content?: string;
	shared?: number;
	pool?: string;
}

/** A guest of the cluster, from its resource. */
export interface Guest extends Resource {
	type: GuestType;
	node: string;
	vmid: number;
}

export interface ClusterStatus {
	type: "cluster" | "node";
	name: string;
	quorate?: number;
	nodes?: number;
	online?: number;
	ip?: string;
	local?: number;
}

export interface NodeStatus {
	cpu?: number;
	wait?: number;
	cpuinfo?: { model?: string; cpus?: number; sockets?: number; cores?: number; mhz?: string };
	loadavg?: string[];
	memory?: { total: number; used: number; free?: number };
	swap?: { total: number; used: number; free?: number };
	rootfs?: { total: number; used: number; avail?: number };
	uptime?: number;
	pveversion?: string;
	kversion?: string;
}

export interface GuestStatus {
	status: string;
	qmpstatus?: string;
	uptime?: number;
	cpu?: number;
	cpus?: number;
	mem?: number;
	maxmem?: number;
	disk?: number;
	maxdisk?: number;
	netin?: number;
	netout?: number;
	agent?: number;
	lock?: string;
	ha?: { managed?: number; state?: string };
	name?: string;
}

/** A point of a graph (rrddata): whichever of these the guest or node has. */
export interface Point {
	time: number;
	cpu?: number;
	maxcpu?: number;
	mem?: number;
	maxmem?: number;
	memused?: number;
	memtotal?: number;
	netin?: number;
	netout?: number;
	diskread?: number;
	diskwrite?: number;
	iowait?: number;
	loadavg?: number;
}

export interface Snapshot {
	name: string;
	description?: string;
	snaptime?: number;
	vmstate?: number;
	parent?: string;
	running?: number;
}

export interface Task {
	upid: string;
	node: string;
	type: string;
	/** The guest's vmid, or what else it's of; "" for none. */
	id?: string;
	user?: string;
	starttime: number;
	endtime?: number;
	/** OK, or why it failed; none while it runs. */
	status?: string;
}

export interface TaskStatus {
	status: "running" | "stopped";
	exitstatus?: string;
	type?: string;
	id?: string;
	node?: string;
}

/** An address a guest has, from its agent (a VM) or itself (a container). */
export interface Address {
	iface: string;
	ip: string;
	v6: boolean;
}

/** The power actions, as the API names them. */
export type Power = "start" | "stop" | "shutdown" | "reboot" | "suspend" | "resume";

/**
 * The address the API's under, from what the user gave. A bare host
 * (pve.local, 192.168.1.10) is Proxmox's own https on :8006; an address
 * with its scheme is taken as it is, as one behind a proxy on 443.
 */
export function baseOf(url: string): string {
	let u = url.trim().replace(/\/+$/, "").replace(/\/api2\/json$/, "");
	if (!u) return "";
	if (!/^https?:\/\//i.test(u)) {
		u = "https://" + u;
		try {
			const p = new URL(u);
			if (!p.port && p.pathname === "/") u = `https://${p.host}:8006`;
		} catch {
			// What urlProblem says.
		}
	}
	return u;
}

/** What's wrong with an address the user typed, or "". */
export function urlProblem(url: string): string {
	if (!url.trim()) return "Give Proxmox's address, as you open it in a browser: https://pve.local:8006.";
	try {
		const u = new URL(baseOf(url));
		if (u.protocol !== "https:" && u.protocol !== "http:") return "Proxmox's address starts with https://.";
	} catch {
		return `${url.trim()} isn't an address.`;
	}
	return "";
}

/** What an API token's ID looks like: USER@REALM!NAME. */
export function tokenIdProblem(id: string): string {
	if (!id.trim()) return "Give the API token's ID, as Proxmox shows it: root@pam!swarm.";
	if (!/^[^@!\s]+@[^@!\s]+![^@!\s]+$/.test(id.trim())) return `${id.trim()} isn't a token ID: it's USER@REALM!NAME, as root@pam!swarm.`;
	return "";
}

const plain = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Asks Proxmox: GET, or POST/PUT/DELETE with a form. Its data, or a PveError. */
export async function req<T>(c: Conn, method: string, path: string, form?: Record<string, string | number | boolean | undefined>): Promise<T> {
	const url = `${baseOf(c.url)}/api2/json${path}`;
	const headers: Record<string, string> = { Authorization: `PVEAPIToken=${c.tokenId.trim()}=${c.secret.trim()}`, Accept: "application/json" };
	let body: string | undefined;
	if (form) {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(form)) if (v !== undefined) p.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
		body = p.toString();
		headers["Content-Type"] = "application/x-www-form-urlencoded";
	}
	let res: Response;
	try {
		res = await fetch(url, { method, headers, body, timeout: 30_000, ...(c.certificate ? { certificate: c.certificate } : {}) });
	} catch (e) {
		const cert = (e as { certificate?: string }).certificate ?? "";
		if (cert) {
			const changed = /isn't the one trusted/.test(plain(e));
			throw new PveError(changed ? "Proxmox's certificate isn't the one you trusted: it may have made a new one, or someone may be in the way." : "Proxmox's certificate is its own, which no certificate authority signed.", 0, cert);
		}
		throw new PveError(`Proxmox didn't answer at ${baseOf(c.url)}: ${plain(e)}`, 0);
	}
	const text = await res.text();
	if (!res.ok) {
		// Proxmox says why in its status line; a parameter's in errors.
		let why = res.statusText || `HTTP ${res.status}`;
		try {
			const j = JSON.parse(text) as { errors?: Record<string, string>; message?: string };
			if (j.errors) why += ": " + Object.entries(j.errors).map(([k, v]) => `${k}: ${String(v).trim()}`).join("; ");
			else if (j.message) why = j.message.trim();
		} catch {
			// Not JSON.
		}
		if (res.status === 401) throw new PveError("Proxmox refused the token: check its ID and secret.", 401);
		if (res.status === 403 || /permission check failed/i.test(why)) throw new PveError(`The token may not do that: ${why}. Give it the role in Proxmox, Datacenter, Permissions (or turn off its privilege separation).`, 403);
		throw new PveError(why, res.status);
	}
	try {
		return (JSON.parse(text) as { data: T }).data;
	} catch {
		throw new PveError(`Proxmox answered with something not JSON: ${text.slice(0, 120)}`, res.status);
	}
}

const enc = encodeURIComponent;
const guestPath = (g: { node: string; type: GuestType; vmid: number }) => `/nodes/${enc(g.node)}/${g.type}/${g.vmid}`;

export const version = (c: Conn) => req<{ version: string; release?: string }>(c, "GET", "/version");
export const resources = (c: Conn) => req<Resource[]>(c, "GET", "/cluster/resources");
export const clusterStatus = (c: Conn) => req<ClusterStatus[]>(c, "GET", "/cluster/status");
export const tasks = (c: Conn) => req<Task[]>(c, "GET", "/cluster/tasks");
export const nodeStatus = (c: Conn, node: string) => req<NodeStatus>(c, "GET", `/nodes/${enc(node)}/status`);
export const nodeRrd = (c: Conn, node: string, timeframe = "hour") => req<Point[]>(c, "GET", `/nodes/${enc(node)}/rrddata?timeframe=${timeframe}&cf=AVERAGE`);
export const nodeSyslog = (c: Conn, node: string, limit = 300) => req<{ n: number; t: string }[]>(c, "GET", `/nodes/${enc(node)}/syslog?limit=${limit}`);
export const nodePower = (c: Conn, node: string, command: "reboot" | "shutdown") => req<null>(c, "POST", `/nodes/${enc(node)}/status`, { command });
export const guestStatus = (c: Conn, g: Guest) => req<GuestStatus>(c, "GET", `${guestPath(g)}/status/current`);
export const guestConfig = (c: Conn, g: Guest) => req<Record<string, string | number>>(c, "GET", `${guestPath(g)}/config`);
export const guestRrd = (c: Conn, g: Guest, timeframe = "hour") => req<Point[]>(c, "GET", `${guestPath(g)}/rrddata?timeframe=${timeframe}&cf=AVERAGE`);
/** Starts a power action: its task's UPID. */
export const power = (c: Conn, g: Guest, what: Power) => req<string>(c, "POST", `${guestPath(g)}/status/${what}`, {});
export const snapshots = (c: Conn, g: Guest) => req<Snapshot[]>(c, "GET", `${guestPath(g)}/snapshot`);
export const snapshot = (c: Conn, g: Guest, name: string, description: string, vmstate: boolean) =>
	req<string>(c, "POST", `${guestPath(g)}/snapshot`, { snapname: name, description: description || undefined, vmstate: g.type === "qemu" && vmstate ? true : undefined });
export const rollback = (c: Conn, g: Guest, name: string) => req<string>(c, "POST", `${guestPath(g)}/snapshot/${enc(name)}/rollback`, {});
export const deleteSnapshot = (c: Conn, g: Guest, name: string) => req<string>(c, "DELETE", `${guestPath(g)}/snapshot/${enc(name)}`);
export const taskStatus = (c: Conn, upid: string) => req<TaskStatus>(c, "GET", `/nodes/${enc(nodeOfUpid(upid))}/tasks/${enc(upid)}/status`);
export const taskLog = (c: Conn, upid: string, limit = 1000) => req<{ n: number; t: string }[]>(c, "GET", `/nodes/${enc(nodeOfUpid(upid))}/tasks/${enc(upid)}/log?start=0&limit=${limit}`);

/** A guest's addresses: a VM's from its guest agent (none without one), a container's from itself. Loopback and link-local left out. */
export async function addresses(c: Conn, g: Guest): Promise<Address[]> {
	const out: Address[] = [];
	const keep = (ip: string) => ip && !/^127\.|^::1$|^fe80:/i.test(ip);
	if (g.type === "qemu") {
		const r = await req<{ result?: { name: string; "ip-addresses"?: { "ip-address": string; "ip-address-type": string }[] }[] }>(c, "GET", `${guestPath(g)}/agent/network-get-interfaces`);
		for (const i of r.result ?? []) for (const a of i["ip-addresses"] ?? []) if (keep(a["ip-address"])) out.push({ iface: i.name, ip: a["ip-address"], v6: a["ip-address-type"] === "ipv6" });
	} else {
		const r = await req<{ name: string; inet?: string; inet6?: string }[]>(c, "GET", `${guestPath(g)}/interfaces`);
		for (const i of r ?? []) {
			const v4 = i.inet?.split("/")[0] ?? "";
			const v6 = i.inet6?.split("/")[0] ?? "";
			if (keep(v4)) out.push({ iface: i.name, ip: v4, v6: false });
			if (keep(v6)) out.push({ iface: i.name, ip: v6, v6: true });
		}
	}
	return out;
}

/** Waits for a task to end: its exit status, OK or why it failed. */
export async function waitTask(c: Conn, upid: string, signal?: AbortSignal, every = 1000): Promise<string> {
	for (;;) {
		if (signal?.aborted) throw new PveError("Stopped waiting.", 0);
		const s = await taskStatus(c, upid);
		if (s.status === "stopped") return s.exitstatus ?? "OK";
		await new Promise((done) => setTimeout(done, every));
	}
}

// ---- What's worked out from its answers ----

/** UPID:node:pid:pstart:starttime:type:id:user: */
export function nodeOfUpid(upid: string): string {
	return upid.split(":")[1] ?? "";
}

export const isGuest = (r: Resource): r is Guest => (r.type === "qemu" || r.type === "lxc") && r.vmid !== undefined && !!r.node;
export const guestName = (g: { name?: string; vmid: number }) => g.name || `${g.vmid}`;
export const kindOf = (t: string) => (t === "qemu" ? "VM" : t === "lxc" ? "Container" : t);

export type Tone = "green" | "amber" | "red" | "muted";

/** A guest's state, as a badge says it. */
export function guestState(g: { status?: string; template?: number; lock?: string; hastate?: string }, qmp?: string): { label: string; tone: Tone; running: boolean } {
	if (g.template) return { label: "Template", tone: "muted", running: false };
	if (g.lock) return { label: lockLabel(g.lock), tone: "amber", running: g.status === "running" };
	if (qmp === "paused" || qmp === "suspended") return { label: "Paused", tone: "amber", running: false };
	if (g.status === "running") return { label: "Running", tone: "green", running: true };
	if (g.status === "stopped") return { label: "Stopped", tone: "muted", running: false };
	if (g.status === "paused") return { label: "Paused", tone: "amber", running: false };
	return { label: g.status ? cap(g.status) : "Unknown", tone: "red", running: false };
}

function lockLabel(lock: string): string {
	const known: Record<string, string> = { backup: "Backing up", snapshot: "Snapshotting", rollback: "Rolling back", migrate: "Migrating", clone: "Cloning", create: "Creating", "snapshot-delete": "Deleting snapshot", suspending: "Suspending", suspended: "Suspended", disk: "Disk busy", mounted: "Mounted" };
	return known[lock] ?? `Locked: ${lock}`;
}

export function nodeState(n: { status?: string }): { label: string; tone: Tone; online: boolean } {
	if (n.status === "online") return { label: "Online", tone: "green", online: true };
	if (n.status === "offline") return { label: "Offline", tone: "red", online: false };
	return { label: n.status ? cap(n.status) : "Unknown", tone: "amber", online: false };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Tags as a list. */
export const tagsOf = (r: { tags?: string }) => (r.tags ?? "").split(/[;,\s]+/).filter(Boolean);

/** A task's type, in words. */
export function taskLabel(type: string): string {
	const map: Record<string, string> = {
		qmstart: "Start", qmstop: "Stop", qmshutdown: "Shutdown", qmreboot: "Reboot", qmsuspend: "Suspend", qmresume: "Resume", qmpause: "Pause",
		qmsnapshot: "Snapshot", qmrollback: "Rollback", qmdelsnapshot: "Delete snapshot", qmclone: "Clone", qmigrate: "Migrate", qmcreate: "Create", qmdestroy: "Destroy", qmconfig: "Configure", qmmove: "Move disk", qmrestore: "Restore",
		vzstart: "Start", vzstop: "Stop", vzshutdown: "Shutdown", vzreboot: "Reboot", vzsuspend: "Suspend", vzresume: "Resume",
		vzsnapshot: "Snapshot", vzrollback: "Rollback", vzdelsnapshot: "Delete snapshot", vzclone: "Clone", vzmigrate: "Migrate", vzcreate: "Create", vzdestroy: "Destroy", vzrestore: "Restore",
		vzdump: "Backup", startall: "Start all", stopall: "Stop all", migrateall: "Migrate all", aptupdate: "Update package lists", imgcopy: "Copy image", download: "Download", srvreload: "Reload service", srvrestart: "Restart service", spiceproxy: "SPICE console", vncproxy: "Console", vncshell: "Shell", termproxy: "Shell", zfscreate: "Create ZFS pool", lvmcreate: "Create LVM", dircreate: "Create directory", diskinit: "Initialize disk", reboot: "Reboot node", shutdown: "Shut down node",
	};
	return map[type] ?? type;
}

/** Whether a task ended well: none while it runs. */
export const taskOk = (t: { status?: string }) => (t.status === undefined ? undefined : t.status === "OK" || /^WARNINGS/.test(t.status));

export function bytes(n: number | undefined): string {
	if (n === undefined || !isFinite(n)) return "—";
	const u = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
	let i = 0;
	let v = n;
	while (v >= 1024 && i < u.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function rate(n: number | undefined): string {
	return n === undefined ? "—" : `${bytes(n)}/s`;
}

export const pct = (f: number | undefined) => (f === undefined || !isFinite(f) ? "—" : `${(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`);
export const frac = (used?: number, total?: number) => (used !== undefined && total ? used / total : undefined);

export function uptime(s: number | undefined): string {
	if (!s) return "—";
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d) return `${d}d ${h}h`;
	if (h) return `${h}h ${m}m`;
	return `${m}m`;
}

export function ago(t: number | undefined, now = Date.now()): string {
	if (!t) return "";
	const s = Math.max(0, Math.round(now / 1000 - t));
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

export function took(t: { starttime: number; endtime?: number }): string {
	if (!t.endtime) return "";
	const s = t.endtime - t.starttime;
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The guest a name or vmid names: one, or a PveError naming those it could be. */
export function findGuest(list: Resource[], what: string): Guest {
	const guests = list.filter(isGuest);
	const w = what.trim();
	if (/^\d+$/.test(w)) {
		const g = guests.find((x) => x.vmid === Number(w));
		if (g) return g;
	}
	const exact = guests.filter((g) => g.name === w);
	if (exact.length === 1) return exact[0]!;
	if (exact.length > 1) throw new PveError(`${exact.length} guests are named ${w}: give the vmid, one of ${exact.map((g) => g.vmid).join(", ")}.`, 0);
	const near = guests.filter((g) => (g.name ?? "").toLowerCase().includes(w.toLowerCase()));
	if (near.length === 1) return near[0]!;
	if (near.length > 1) throw new PveError(`${w} could be ${near.map((g) => `${g.name} (${g.vmid})`).join(", ")}: give the vmid or the whole name.`, 0);
	throw new PveError(`No VM or container is ${w}.`, 404);
}

/** The link that opens a guest's console in Proxmox's own page: noVNC for a VM, xterm.js for a container. */
export function consoleUrl(c: Conn, g: Guest): string {
	const q = g.type === "qemu" ? `console=kvm&novnc=1&vmid=${g.vmid}&vmname=${enc(g.name ?? "")}&node=${enc(g.node)}&resize=off` : `console=lxc&xtermjs=1&vmid=${g.vmid}&vmname=${enc(g.name ?? "")}&node=${enc(g.node)}`;
	return `${baseOf(c.url)}/?${q}`;
}

export const nodeShellUrl = (c: Conn, node: string) => `${baseOf(c.url)}/?console=shell&xtermjs=1&vmid=0&node=${enc(node)}`;
export const guestUrl = (c: Conn, g: Guest) => `${baseOf(c.url)}/#v1:0:=${g.type}%2F${g.vmid}:4:::::::`;
export const nodeUrl = (c: Conn, node: string) => `${baseOf(c.url)}/#v1:0:=node%2F${enc(node)}:4:::::::`;

/** A disk or network line of a guest's configuration (scsi0, net0…), parsed: its first value and its options. */
export function parseOpts(v: string): { head: string; opts: Record<string, string> } {
	const parts = String(v).split(",");
	const opts: Record<string, string> = {};
	let head = "";
	parts.forEach((p, i) => {
		const eq = p.indexOf("=");
		if (eq < 0) {
			if (i === 0) head = p;
			return;
		}
		if (i === 0 && !head) head = p;
		opts[p.slice(0, eq)] = p.slice(eq + 1);
	});
	return { head, opts };
}

/** What a guest's configuration says, as rows to show: CPU, memory, disks, networks, and the rest that matters. */
export function configRows(type: GuestType, cfg: Record<string, string | number>): { label: string; value: string }[] {
	const rows: { label: string; value: string }[] = [];
	const s = (k: string) => (cfg[k] === undefined ? "" : String(cfg[k]));
	const cores = Number(cfg.cores ?? 1) * Number(cfg.sockets ?? 1);
	rows.push({ label: "CPU", value: `${cores} ${cores === 1 ? "core" : "cores"}${cfg.sockets && Number(cfg.sockets) > 1 ? ` (${cfg.sockets} sockets)` : ""}${s("cpu") ? `, ${parseOpts(s("cpu")).head}` : ""}${s("cpulimit") ? `, limit ${s("cpulimit")}` : ""}` });
	const mem = Number(cfg.memory ?? 512);
	rows.push({ label: "Memory", value: `${bytes(mem * 1024 * 1024)}${type === "qemu" && cfg.balloon !== undefined && Number(cfg.balloon) > 0 && Number(cfg.balloon) !== mem ? `, ballooning from ${bytes(Number(cfg.balloon) * 1024 * 1024)}` : ""}${type === "lxc" && cfg.swap !== undefined ? `, ${bytes(Number(cfg.swap) * 1024 * 1024)} swap` : ""}` });
	const diskKeys = Object.keys(cfg).filter((k) => /^(rootfs|mp\d+|scsi\d+|virtio\d+|sata\d+|ide\d+|efidisk\d+|tpmstate\d+)$/.test(k)).sort(diskOrder);
	for (const k of diskKeys) {
		const { head, opts } = parseOpts(s(k));
		if (opts.media === "cdrom") {
			rows.push({ label: `CD/DVD (${k})`, value: head === "none" ? "Empty" : head });
			continue;
		}
		rows.push({ label: k === "rootfs" ? "Root disk" : /^mp/.test(k) ? `Mount point (${k})` : `Disk (${k})`, value: [head, opts.size, opts.mp ? `at ${opts.mp}` : ""].filter(Boolean).join(", ") });
	}
	for (const k of Object.keys(cfg).filter((k) => /^net\d+$/.test(k)).sort(diskOrder)) {
		const { head, opts } = parseOpts(s(k));
		const model = type === "qemu" ? head.split("=")[0] : opts.name;
		rows.push({ label: `Network (${k})`, value: [model, opts.bridge ? `on ${opts.bridge}` : "", opts.tag ? `VLAN ${opts.tag}` : "", opts.ip ? `IP ${opts.ip}` : "", opts.firewall === "1" ? "firewall" : ""].filter(Boolean).join(", ") });
	}
	if (s("ostype")) rows.push({ label: "OS type", value: osLabel(s("ostype")) });
	if (type === "qemu" && s("bios")) rows.push({ label: "BIOS", value: s("bios") === "ovmf" ? "UEFI (OVMF)" : "SeaBIOS" });
	if (type === "qemu") rows.push({ label: "Guest agent", value: parseOpts(s("agent")).head === "1" || /enabled=1/.test(s("agent")) ? "On" : "Off" });
	if (type === "lxc") rows.push({ label: "Unprivileged", value: s("unprivileged") === "1" ? "Yes" : "No" });
	rows.push({ label: "Start at boot", value: s("onboot") === "1" ? "Yes" : "No" });
	return rows;
}

function diskOrder(a: string, b: string): number {
	const order = (k: string) => (k === "rootfs" ? 0 : /^efidisk/.test(k) ? 9 : /^tpm/.test(k) ? 10 : 1);
	return order(a) - order(b) || a.localeCompare(b, undefined, { numeric: true });
}

function osLabel(t: string): string {
	const map: Record<string, string> = { l26: "Linux 2.6 – 6.x", l24: "Linux 2.4", win11: "Windows 11/2022/2025", win10: "Windows 10/2016/2019", win8: "Windows 8/2012", win7: "Windows 7/2008 R2", other: "Other", solaris: "Solaris", debian: "Debian", ubuntu: "Ubuntu", alpine: "Alpine", centos: "CentOS", fedora: "Fedora", archlinux: "Arch Linux", nixos: "NixOS", opensuse: "openSUSE", unmanaged: "Unmanaged" };
	return map[t] ?? t;
}

// ---- Backups, clones, migrations, configuration ----

/** A backup, as a storage lists it. */
export interface Backup {
	/** local:backup/vzdump-qemu-100-2026_11_25-04_00_01.vma.zst, or pbs:backup/vm/100/2026-11-25T04:00:01Z. */
	volid: string;
	vmid?: number;
	size?: number;
	ctime?: number;
	format?: string;
	/** qemu or lxc. */
	subtype?: string;
	notes?: string;
	protected?: number;
	verification?: { state?: string };
	/** Which storage, and a node it's read from. */
	storage: string;
	node: string;
}

/** A storage of a node: what it holds and how full it is. */
export interface NodeStorage {
	storage: string;
	type: string;
	content: string;
	active?: number;
	enabled?: number;
	shared?: number;
	avail?: number;
	total?: number;
	used?: number;
}

export type BackupMode = "snapshot" | "suspend" | "stop";

export const nextId = async (c: Conn) => Number(await req<string | number>(c, "GET", "/cluster/nextid"));
export const nodeStorages = (c: Conn, node: string, content?: string) => req<NodeStorage[]>(c, "GET", `/nodes/${enc(node)}/storage${content ? `?content=${content}&enabled=1` : ""}`);

/** A storage's backups, of one guest or every one. */
export async function storageBackups(c: Conn, node: string, storage: string, vmid?: number): Promise<Backup[]> {
	const list = await req<Omit<Backup, "storage" | "node">[]>(c, "GET", `/nodes/${enc(node)}/storage/${enc(storage)}/content?content=backup${vmid ? `&vmid=${vmid}` : ""}`);
	return list.map((b) => ({ ...b, vmid: b.vmid !== undefined ? Number(b.vmid) : vmidOfVolid(b.volid), storage, node }));
}

/**
 * Every backup the nodes given can reach, of one guest or all, newest
 * first: each storage that holds backups, once, though a shared one
 * (Proxmox Backup Server, NFS) shows on every node.
 */
export async function backups(c: Conn, nodes: string[], vmid?: number): Promise<Backup[]> {
	const seen = new Set<string>();
	const out: Backup[] = [];
	for (const node of nodes) {
		const stores = (await nodeStorages(c, node, "backup").catch(() => [] as NodeStorage[])).filter((s) => s.active !== 0);
		for (const s of stores) {
			if (s.shared && seen.has(`store:${s.storage}`)) continue;
			seen.add(`store:${s.storage}`);
			for (const b of await storageBackups(c, node, s.storage, vmid).catch(() => [] as Backup[])) {
				if (seen.has(b.volid)) continue;
				seen.add(b.volid);
				out.push(b);
			}
		}
	}
	return out.sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0));
}

/** The vmid a backup's name says, where its storage doesn't. */
export function vmidOfVolid(volid: string): number | undefined {
	const m = /vzdump-(?:qemu|lxc|openvz)-(\d+)-/.exec(volid) ?? /backup\/(?:vm|ct)\/(\d+)\//.exec(volid);
	return m ? Number(m[1]) : undefined;
}

/** Backs a guest up now, to a storage: its task's UPID. Proxmox Backup Server compresses on its own. */
export const backupNow = (c: Conn, g: Guest, storage: string, mode: BackupMode, pbs: boolean, notes = "{{guestname}}") =>
	req<string>(c, "POST", `/nodes/${enc(g.node)}/vzdump`, { vmid: g.vmid, storage, mode, compress: pbs ? undefined : "zstd", "notes-template": notes || undefined, remove: 0 });

/**
 * Restores a backup: over the guest of its vmid (force, which must be
 * stopped), or as a new guest of a new vmid. A container needs a storage
 * for its root disk; a VM's disks go back where they were.
 */
export function restore(c: Conn, node: string, type: GuestType, volid: string, vmid: number, opts: { force?: boolean; storage?: string; unique?: boolean }) {
	if (type === "qemu") return req<string>(c, "POST", `/nodes/${enc(node)}/qemu`, { vmid, archive: volid, force: opts.force || undefined, unique: opts.unique || undefined, storage: opts.storage || undefined });
	return req<string>(c, "POST", `/nodes/${enc(node)}/lxc`, { vmid, ostemplate: volid, restore: 1, force: opts.force || undefined, unique: opts.unique || undefined, storage: opts.storage || undefined });
}

/** Deletes a backup: a task's UPID, or null where Proxmox does it at once. */
export const deleteBackup = (c: Conn, b: Backup) => req<string | null>(c, "DELETE", `/nodes/${enc(b.node)}/storage/${enc(b.storage)}/content/${enc(b.volid)}`);

/** Clones a guest to a new vmid: a full copy, or linked to a template's disks. */
export const clone = (c: Conn, g: Guest, newid: number, name: string, full: boolean, target?: string) =>
	req<string>(c, "POST", `${guestPath(g)}/clone`, { newid, [g.type === "qemu" ? "name" : "hostname"]: name || undefined, full: full ? 1 : 0, target: target && target !== g.node ? target : undefined });

/** Moves a guest to another node: a running VM live, a running container by restarting it there. */
export const migrate = (c: Conn, g: Guest, target: string, running: boolean) =>
	req<string>(c, "POST", `${guestPath(g)}/migrate`, g.type === "qemu" ? { target, online: running ? 1 : undefined, "with-local-disks": 1 } : { target, restart: running ? 1 : undefined });

/** What can be changed of a guest here. */
export interface Changes {
	cores?: number;
	memory?: number;
	onboot?: boolean;
	tags?: string[];
	name?: string;
}

/** Changes a guest's configuration. A running VM takes cores and memory at its next start, unless it hotplugs them. */
export function setConfig(c: Conn, g: Guest, ch: Changes) {
	const form: Record<string, string | number | boolean | undefined> = {
		cores: ch.cores,
		memory: ch.memory,
		onboot: ch.onboot,
		tags: ch.tags ? ch.tags.join(";") : undefined,
		[g.type === "qemu" ? "name" : "hostname"]: ch.name || undefined,
	};
	if (ch.tags && !ch.tags.length) {
		form.tags = undefined;
		form.delete = "tags";
	}
	return req<null>(c, "PUT", `${guestPath(g)}/config`, form);
}

/** The storage a container's root disk is on, from its configuration (local-lvm:vm-101-disk-0,size=8G). */
export const rootStorage = (cfg: Record<string, string | number> | undefined) => (cfg?.rootfs ? String(cfg.rootfs).split(":")[0] : undefined);

/** A backup's name, in words: when it was taken. */
export const backupWhen = (b: Backup) => (b.ctime ? new Date(b.ctime * 1000).toLocaleString() : b.volid.split("/").pop() ?? b.volid);

/** Whether a tag is one Proxmox takes: letters, digits and - _ + . */
export const tagOk = (t: string) => /^[a-z0-9_][a-z0-9_\-+.]*$/i.test(t);
