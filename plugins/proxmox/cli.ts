// The command line: swarm proxmox …, for the agents and the user.
import { cliCommand, defineCli, PluginCliError, type CommandIO } from "swarm";
import * as api from "./pve";
import type { Conn, Guest, Power, Resource } from "./pve";
import { conn, TASK_POLL } from "./store";

function need(): Conn {
	const c = conn();
	if (!c) throw new PluginCliError("Proxmox isn't connected.", { code: "not_connected", hint: "Connect it in Swarm: Settings, Proxmox." });
	return c;
}

const json = { json: { type: "boolean", description: "Print JSON, for a script or another command to read." } } as const;
const guestArg = { name: "guest", description: "A VM's or container's vmid or name", required: true };

/** Wraps a command's run: Proxmox's refusals as the CLI's errors. */
function guard<A extends unknown[]>(fn: (...a: A) => Promise<void | number>) {
	return async (...a: A) => {
		try {
			return await fn(...a);
		} catch (e) {
			if (e instanceof api.PveError) {
				const code = e.certificate ? "certificate" : e.status === 401 ? "unauthorized" : e.status === 403 ? "forbidden" : e.status === 404 ? "not_found" : "proxmox_error";
				throw new PluginCliError(e.message, { code, hint: e.certificate ? "Trust its certificate in Swarm: Settings, Proxmox." : undefined });
			}
			throw e;
		}
	};
}

async function guestOf(c: Conn, what: string): Promise<Guest> {
	return api.findGuest(await api.resources(c), what);
}

const guestJson = (g: Guest) => ({
	vmid: g.vmid,
	name: g.name ?? null,
	type: g.type === "qemu" ? "vm" : "container",
	node: g.node,
	status: api.guestState(g).label.toLowerCase(),
	template: !!g.template,
	tags: api.tagsOf(g),
	cpu: g.cpu ?? null,
	cpus: g.maxcpu ?? null,
	memory: g.mem ?? null,
	maxMemory: g.maxmem ?? null,
	disk: g.maxdisk ?? null,
	uptime: g.uptime ?? null,
});

const guestLine = (g: Guest) => {
	const s = api.guestState(g);
	return [String(g.vmid).padEnd(6), (g.name ?? "").padEnd(22), (g.type === "qemu" ? "VM" : "CT").padEnd(3), s.label.padEnd(9), g.node.padEnd(10), s.running ? `CPU ${api.pct(g.cpu)}, ${api.bytes(g.mem)} of ${api.bytes(g.maxmem)}` : "", api.tagsOf(g).length ? `[${api.tagsOf(g).join(", ")}]` : ""].join(" ").trimEnd();
};

/** Starts a task, and waits for it unless told not to: its exit code, 0 when it ended well. */
async function runTask(c: Conn, upid: string, done: string, wait: boolean, io: CommandIO): Promise<number> {
	if (!wait) {
		io.print(`Started: ${upid}`);
		return 0;
	}
	const exit = await api.waitTask(c, upid, io.signal, TASK_POLL.every);
	if (api.taskOk({ status: exit })) {
		io.print(exit === "OK" ? `${done}.` : `${done}, with ${exit.toLowerCase()}.`);
		return 0;
	}
	io.print(`Failed: ${exit}`);
	io.print(`Its log: swarm proxmox task-log ${upid}`);
	return 1;
}

const noWait = { "no-wait": { type: "boolean", description: "Return once Proxmox has started it, with its task's UPID, not once it's done." } } as const;

function powerCommand(what: Power, summary: string, done: string) {
	return cliCommand({
		summary,
		positionals: [guestArg],
		options: noWait,
		run: guard(async ({ positionals, options }, io) => {
			const c = need();
			const g = await guestOf(c, positionals.guest as string);
			const upid = await api.power(c, g, what);
			return runTask(c, upid, `${api.guestName(g)} (${g.vmid}) ${done}`, !options["no-wait"], io);
		}),
	});
}

export function registerCli() {
	defineCli({
		summary: "Your Proxmox VE: its nodes, VMs and containers; start, shut down, reboot and stop them; snapshots, backups, clones, moves and settings; and tasks with their logs. GUEST is a vmid or a name.",
		commands: {
			status: cliCommand({
				summary: "Whether Proxmox is connected, its version, and how its nodes and guests stand",
				options: json,
				run: guard(async ({ options }, io) => {
					const c = conn();
					if (!c) {
						if (options.json) return io.print(JSON.stringify({ connected: false }));
						return io.print("Not connected: connect it in Swarm, Settings, Proxmox.");
					}
					const [v, list, cluster] = await Promise.all([api.version(c), api.resources(c), api.clusterStatus(c).catch(() => [])]);
					const nodes = list.filter((r) => r.type === "node");
					const guests = list.filter(api.isGuest).filter((g) => !g.template);
					const name = cluster.find((x) => x.type === "cluster")?.name ?? null;
					const out = { connected: true, url: api.baseOf(c.url), version: v.version, cluster: name, nodes: { online: nodes.filter((n) => n.status === "online").length, total: nodes.length }, guests: { running: guests.filter((g) => g.status === "running").length, total: guests.length } };
					if (options.json) return io.print(JSON.stringify(out));
					io.print(`Connected to ${out.url}, Proxmox VE ${v.version}${name ? `, cluster ${name}` : ""}.`);
					io.print(`${out.nodes.online} of ${out.nodes.total} nodes online; ${out.guests.running} of ${out.guests.total} VMs and containers running.`);
				}),
			}),
			list: cliCommand({
				summary: "Every VM and container: vmid, name, type, state, node, use",
				options: {
					...json,
					node: { type: "string", description: "Only those on this node" },
					running: { type: "boolean", description: "Only those running" },
					stopped: { type: "boolean", description: "Only those not running" },
				},
				run: guard(async ({ options }, io) => {
					const c = need();
					let gs = (await api.resources(c)).filter(api.isGuest).sort((a, b) => a.vmid - b.vmid);
					if (options.node) gs = gs.filter((g) => g.node === options.node);
					if (options.running) gs = gs.filter((g) => g.status === "running");
					if (options.stopped) gs = gs.filter((g) => g.status !== "running");
					if (options.json) return io.print(JSON.stringify(gs.map(guestJson)));
					if (!gs.length) return io.print("No VMs or containers.");
					for (const g of gs) io.print(guestLine(g));
				}),
			}),
			show: cliCommand({
				summary: "A guest's state, use, addresses, hardware and snapshots",
				positionals: [guestArg],
				options: json,
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const g = await guestOf(c, positionals.guest as string);
					const [st, cfg, snaps, addrs] = await Promise.all([
						api.guestStatus(c, g),
						api.guestConfig(c, g).catch(() => ({}) as Record<string, string | number>),
						api.snapshots(c, g).catch(() => []),
						g.status === "running" ? api.addresses(c, g).catch(() => []) : Promise.resolve([]),
					]);
					const snapList = snaps.filter((s) => s.name !== "current");
					const hw = api.configRows(g.type, cfg);
					if (options.json) return io.print(JSON.stringify({ ...guestJson(g), status: api.guestState(g, st.qmpstatus).label.toLowerCase(), addresses: addrs.map((a) => a.ip), hardware: Object.fromEntries(hw.map((r) => [r.label, r.value])), snapshots: snapList.map((s) => ({ name: s.name, description: s.description ?? "", time: s.snaptime ?? null, memory: !!s.vmstate })) }));
					const s = api.guestState(g, st.qmpstatus);
					io.print(`${api.guestName(g)} (${g.vmid}), ${api.kindOf(g.type)} on ${g.node}: ${s.label}${s.running ? `, up ${api.uptime(st.uptime)}` : ""}`);
					if (s.running) io.print(`CPU ${api.pct(st.cpu)} of ${st.cpus ?? g.maxcpu} cores; memory ${api.bytes(st.mem)} of ${api.bytes(st.maxmem)}`);
					if (addrs.length) io.print(`Addresses: ${addrs.map((a) => a.ip).join(", ")}`);
					if (api.tagsOf(g).length) io.print(`Tags: ${api.tagsOf(g).join(", ")}`);
					for (const r of hw) io.print(`  ${r.label}: ${r.value}`);
					io.print(snapList.length ? `Snapshots: ${snapList.map((x) => x.name).join(", ")}` : "No snapshots.");
				}),
			}),
			start: powerCommand("start", "Start a guest", "started"),
			shutdown: powerCommand("shutdown", "Shut a guest down, as its power button would", "shut down"),
			reboot: powerCommand("reboot", "Reboot a guest", "rebooted"),
			stop: powerCommand("stop", "Stop a guest at once, as pulling its plug: prefer shutdown", "stopped"),
			suspend: powerCommand("suspend", "Pause a VM", "paused"),
			resume: powerCommand("resume", "Resume a paused VM", "resumed"),
			snapshots: cliCommand({
				summary: "A guest's snapshots",
				positionals: [guestArg],
				options: json,
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const g = await guestOf(c, positionals.guest as string);
					const snaps = (await api.snapshots(c, g)).filter((s) => s.name !== "current").sort((a, b) => (a.snaptime ?? 0) - (b.snaptime ?? 0));
					if (options.json) return io.print(JSON.stringify(snaps.map((s) => ({ name: s.name, description: s.description ?? "", time: s.snaptime ?? null, memory: !!s.vmstate, parent: s.parent ?? null }))));
					if (!snaps.length) return io.print(`${api.guestName(g)} has no snapshots.`);
					for (const s of snaps) io.print(`${s.name.padEnd(24)} ${s.snaptime ? new Date(s.snaptime * 1000).toISOString().replace("T", " ").slice(0, 16) : ""}${s.vmstate ? "  with memory" : ""}${s.description?.trim() ? `  ${s.description.trim().split("\n")[0]}` : ""}`);
				}),
			}),
			snapshot: cliCommand({
				summary: "Take a snapshot of a guest",
				positionals: [guestArg, { name: "name", description: "Its name: a letter, then letters, digits, - or _", required: true }],
				options: { ...noWait, description: { type: "string", description: "What it's before" }, memory: { type: "boolean", description: "A running VM's memory too, so a rollback resumes it running" } },
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const g = await guestOf(c, positionals.guest as string);
					const name = positionals.name as string;
					if (!/^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(name)) throw new PluginCliError(`${name} isn't a snapshot's name: a letter, then letters, digits, - or _, 2 to 40 of them.`, { code: "bad_name" });
					const upid = await api.snapshot(c, g, name, (options.description as string) ?? "", !!options.memory);
					return runTask(c, upid, `Took snapshot ${name} of ${api.guestName(g)}`, !options["no-wait"], io);
				}),
			}),
			rollback: cliCommand({
				summary: "Roll a guest back to a snapshot: what changed since is lost",
				positionals: [guestArg, { name: "name", description: "The snapshot", required: true }],
				options: noWait,
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const g = await guestOf(c, positionals.guest as string);
					const upid = await api.rollback(c, g, positionals.name as string);
					return runTask(c, upid, `Rolled ${api.guestName(g)} back to ${positionals.name}`, !options["no-wait"], io);
				}),
			}),
			"delete-snapshot": cliCommand({
				summary: "Delete a guest's snapshot",
				positionals: [guestArg, { name: "name", description: "The snapshot", required: true }],
				options: noWait,
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const g = await guestOf(c, positionals.guest as string);
					const upid = await api.deleteSnapshot(c, g, positionals.name as string);
					return runTask(c, upid, `Deleted snapshot ${positionals.name} of ${api.guestName(g)}`, !options["no-wait"], io);
				}),
			}),
			backups: cliCommand({
				summary: "Backups, newest first: a guest's, or every guest's last one",
				positionals: [{ name: "guest", description: "A vmid or name; every guest's last backup when left out" }],
				options: json,
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const list = await api.resources(c);
					const online = list.filter((r) => r.type === "node" && r.status === "online").map((r) => r.node!);
					if (positionals.guest) {
						const g = api.findGuest(list, positionals.guest as string);
						const bs = await api.backups(c, [g.node], g.vmid);
						if (options.json) return io.print(JSON.stringify(bs.map((b) => ({ volid: b.volid, storage: b.storage, time: b.ctime ?? null, size: b.size ?? null, notes: b.notes ?? "", protected: !!b.protected, verified: b.verification?.state ?? null }))));
						if (!bs.length) return io.print(`No backups of ${api.guestName(g)} on ${g.node}'s storage.`);
						for (const b of bs) io.print(`${b.ctime ? new Date(b.ctime * 1000).toISOString().replace("T", " ").slice(0, 16) : "".padEnd(16)}  ${api.bytes(b.size).padEnd(9)} ${b.storage.padEnd(12)} ${b.volid}`);
						return;
					}
					const bs = await api.backups(c, online);
					const rows = list.filter(api.isGuest).filter((g) => !g.template).sort((a, b) => a.vmid - b.vmid).map((g) => {
						const mine = bs.filter((b) => b.vmid === g.vmid);
						return { vmid: g.vmid, name: g.name ?? null, backups: mine.length, last: mine[0]?.ctime ?? null, lastStorage: mine[0]?.storage ?? null };
					});
					if (options.json) return io.print(JSON.stringify(rows));
					for (const r of rows) io.print(`${String(r.vmid).padEnd(6)} ${(r.name ?? "").padEnd(22)} ${r.last ? `last ${api.ago(r.last)} on ${r.lastStorage}, ${r.backups} in all` : "never backed up"}`);
				}),
			}),
			backup: cliCommand({
				summary: "Back a guest up now",
				positionals: [guestArg],
				options: {
					...noWait,
					storage: { type: "string", description: "The storage to back up to; its node's Proxmox Backup Server, else its first that takes backups, when left out" },
					mode: { type: "enum", values: ["snapshot", "suspend", "stop"], default: "snapshot", description: "snapshot keeps it running; suspend pauses it; stop shuts it down and starts it again" },
				},
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const g = await guestOf(c, positionals.guest as string);
					const stores = await api.nodeStorages(c, g.node, "backup");
					const store = options.storage ? stores.find((s) => s.storage === options.storage) : (stores.find((s) => s.type === "pbs") ?? stores[0]);
					if (!store) throw new PluginCliError(options.storage ? `${g.node} has no storage ${options.storage} that takes backups: ${stores.map((s) => s.storage).join(", ") || "none"}.` : `No storage of ${g.node} takes backups.`, { code: "no_storage" });
					const upid = await api.backupNow(c, g, store.storage, (options.mode as api.BackupMode) ?? "snapshot", store.type === "pbs");
					return runTask(c, upid, `Backed up ${api.guestName(g)} to ${store.storage}`, !options["no-wait"], io);
				}),
			}),
			clone: cliCommand({
				summary: "Clone a guest, or make a new one from a template",
				positionals: [guestArg],
				options: {
					...noWait,
					name: { type: "string", description: "The new guest's name" },
					vmid: { type: "number", description: "Its vmid; the next free one when left out" },
					linked: { type: "boolean", description: "From a template: share its disks, not copy them" },
					node: { type: "string", description: "The node to make it on" },
				},
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const g = await guestOf(c, positionals.guest as string);
					if (options.linked && !g.template) throw new PluginCliError("Only a template's clone can be linked.", { code: "not_template" });
					const id = (options.vmid as number | undefined) ?? (await api.nextId(c));
					const upid = await api.clone(c, g, id, (options.name as string) ?? "", !options.linked, options.node as string | undefined);
					const code = await runTask(c, upid, `Made ${options.name ?? id} (${id}) from ${api.guestName(g)}`, !options["no-wait"], io);
					if (code === 0 && !options["no-wait"]) io.print(`It's stopped: swarm proxmox start ${id}`);
					return code;
				}),
			}),
			migrate: cliCommand({
				summary: "Move a guest to another node: a running VM live, a running container by restarting it there",
				positionals: [guestArg, { name: "node", description: "The node to move it to", required: true }],
				options: noWait,
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const g = await guestOf(c, positionals.guest as string);
					const target = positionals.node as string;
					if (target === g.node) return io.print(`${api.guestName(g)} is on ${target} already.`);
					const upid = await api.migrate(c, g, target, g.status === "running");
					return runTask(c, upid, `Moved ${api.guestName(g)} to ${target}`, !options["no-wait"], io);
				}),
			}),
			set: cliCommand({
				summary: "Change a guest's name, cores, memory, start at boot or tags",
				positionals: [guestArg],
				options: {
					name: { type: "string", description: "Its new name" },
					cores: { type: "number", description: "How many cores" },
					memory: { type: "number", description: "Its memory, in MiB" },
					onboot: { type: "enum", values: ["yes", "no"], description: "Whether it starts as its node does" },
					tags: { type: "string", description: "Its tags, separated by commas or spaces, in place of those it has; \"\" for none" },
				},
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const g = await guestOf(c, positionals.guest as string);
					const ch: api.Changes = {};
					if (options.name !== undefined) ch.name = options.name as string;
					if (options.cores !== undefined) ch.cores = options.cores as number;
					if (options.memory !== undefined) ch.memory = options.memory as number;
					if (options.onboot !== undefined) ch.onboot = options.onboot === "yes";
					if (options.tags !== undefined) ch.tags = String(options.tags).split(/[\s,;]+/).filter(Boolean);
					if (!Object.keys(ch).length) throw new PluginCliError("Say what to change: --name, --cores, --memory, --onboot or --tags.", { code: "nothing" });
					const bad = (ch.tags ?? []).find((t) => !api.tagOk(t));
					if (bad) throw new PluginCliError(`${bad} isn't a tag: letters, digits and - _ + .`, { code: "bad_tag" });
					await api.setConfig(c, g, ch);
					io.print(`Changed ${api.guestName(g)}.`);
					if (g.type === "qemu" && g.status === "running" && (ch.cores !== undefined || ch.memory !== undefined)) io.print("It's running: new cores and memory take hold at its next start, unless hotplug is on for them.");
				}),
			}),
			nodes: cliCommand({
				summary: "The cluster's nodes: state, uptime, CPU and memory",
				options: json,
				run: guard(async ({ options }, io) => {
					const c = need();
					const nodes = (await api.resources(c)).filter((r) => r.type === "node").sort((a, b) => (a.node ?? "").localeCompare(b.node ?? ""));
					if (options.json) return io.print(JSON.stringify(nodes.map((n) => ({ node: n.node, status: n.status, uptime: n.uptime ?? null, cpu: n.cpu ?? null, cpus: n.maxcpu ?? null, memory: n.mem ?? null, maxMemory: n.maxmem ?? null, disk: n.disk ?? null, maxDisk: n.maxdisk ?? null }))));
					for (const n of nodes) io.print(`${(n.node ?? "").padEnd(12)} ${api.nodeState(n).label.padEnd(8)} ${n.status === "online" ? `up ${api.uptime(n.uptime)}, CPU ${api.pct(n.cpu)} of ${n.maxcpu}, memory ${api.bytes(n.mem)} of ${api.bytes(n.maxmem)}` : ""}`.trimEnd());
				}),
			}),
			storage: cliCommand({
				summary: "Each storage of each node, and how full it is",
				options: json,
				run: guard(async ({ options }, io) => {
					const c = need();
					const ss = (await api.resources(c)).filter((r: Resource) => r.type === "storage");
					if (options.json) return io.print(JSON.stringify(ss.map((s) => ({ storage: s.storage, node: s.node, type: s.plugintype ?? null, content: (s.content ?? "").split(",").filter(Boolean), shared: !!s.shared, status: s.status, used: s.disk ?? null, total: s.maxdisk ?? null }))));
					for (const s of ss) io.print(`${(s.storage ?? "").padEnd(16)} ${(s.node ?? "").padEnd(10)} ${(s.plugintype ?? "").padEnd(9)} ${s.status === "available" ? `${api.pct(api.frac(s.disk, s.maxdisk))} of ${api.bytes(s.maxdisk)}` : (s.status ?? "")}`);
				}),
			}),
			tasks: cliCommand({
				summary: "The cluster's recent tasks, newest first",
				options: {
					...json,
					guest: { type: "string", description: "Only this guest's (a vmid or name)" },
					failed: { type: "boolean", description: "Only those that failed" },
					limit: { type: "number", description: "How many at most (20)", default: 20 },
				},
				run: guard(async ({ options }, io) => {
					const c = need();
					let ts = (await api.tasks(c)).sort((a, b) => b.starttime - a.starttime);
					if (options.guest) {
						const g = await guestOf(c, options.guest as string);
						ts = ts.filter((t) => t.id === String(g.vmid));
					}
					if (options.failed) ts = ts.filter((t) => api.taskOk(t) === false);
					ts = ts.slice(0, Number(options.limit ?? 20));
					if (options.json) return io.print(JSON.stringify(ts.map((t) => ({ upid: t.upid, node: t.node, type: t.type, what: api.taskLabel(t.type), id: t.id || null, user: t.user ?? null, start: t.starttime, end: t.endtime ?? null, status: t.status ?? "running" }))));
					if (!ts.length) return io.print("No tasks.");
					for (const t of ts) io.print(`${new Date(t.starttime * 1000).toISOString().replace("T", " ").slice(0, 19)}  ${(api.taskLabel(t.type) + (t.id ? ` ${t.id}` : "")).padEnd(24)} ${(t.status ?? "running").padEnd(8)} ${t.node}  ${t.upid}`);
				}),
			}),
			"task-log": cliCommand({
				summary: "A task's log",
				positionals: [{ name: "upid", description: "The task's UPID, as tasks and the actions print it", required: true }],
				run: guard(async ({ positionals }, io) => {
					const c = need();
					const upid = positionals.upid as string;
					if (!/^UPID:/.test(upid)) throw new PluginCliError(`${upid} isn't a task's UPID: they start UPID:.`, { code: "bad_upid", hint: "swarm proxmox tasks" });
					for (const l of await api.taskLog(c, upid)) io.print(l.t);
				}),
			}),
		},
	});
}
