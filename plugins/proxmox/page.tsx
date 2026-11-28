// Proxmox's page of the rail. Its sidebar has the views: the overview
// (the cluster's nodes, what needs you, the busiest guests, the last
// tasks), every VM and container, the tasks, the storage, and each node.
// A guest opens beside the view, with its actions and its tabs: its
// summary and graphs, its hardware, its snapshots and its tasks.
//
// The path is the view ("", guests, tasks, storage, n/<node>), then
// g/<type>-<vmid> for the guest opened: "guests/g/qemu-100", or
// "g/lxc-101" beside the overview.
import { ui, type Child, type IconName, type RenderContext } from "swarm";
import * as api from "./pve";
import type { Guest, Resource, Task } from "./pve";
import {
	clusterName,
	conn,
	fresh,
	guestById,
	guests,
	navItems,
	nodeByName,
	nodePower,
	nodes,
	openedGuest,
	openedNode,
	PAGE,
	press,
	readGuest,
	consoles,
	opening,
	readAllBackups,
	readBadDisks,
	readDisks,
	readSmart,
	startConsole,
	readList,
	readNode,
	readSnapshots,
	readSyslog,
	readTaskLog,
	readTasks,
	shown,
	snapAction,
	state,
	storages,
	type OpenedGuest,
	type OpenedNode,
	type Timeframe,
} from "./store";
import { hasSerial, type OpenConsole } from "./console";
import { current, servers, setCurrent } from "./servers";
import { codeCard } from "./settings";
import { backupsTab, backupsView, guestForm, openForm, otherNodes } from "./actions";
import { badge, columnStyle, empty, fact, faint, graph, line, list, loading, logBox, phone, problem, refresh, rowOf, searchField, sectionHead, setPhone, stats, top, usage, meter, confirmBox, type Series } from "./view";

type View = { kind: "overview" } | { kind: "guests" } | { kind: "tasks" } | { kind: "storage" } | { kind: "backups" } | { kind: "node"; node: string };

export function parsePath(path: string): { view: View; base: string; open: string } {
	const m = /^(.*?)(?:^|\/)g\/(qemu|lxc)-(\d+)$/.exec(path);
	const base = m ? m[1]! : path;
	const open = m ? `${m[2]}/${m[3]}` : "";
	const parts = base.split("/").filter(Boolean);
	let view: View = { kind: "overview" };
	if (parts[0] === "guests") view = { kind: "guests" };
	else if (parts[0] === "tasks") view = { kind: "tasks" };
	else if (parts[0] === "storage") view = { kind: "storage" };
	else if (parts[0] === "backups") view = { kind: "backups" };
	else if (parts[0] === "n" && parts[1]) view = { kind: "node", node: decodeURIComponent(parts[1]) };
	return { view, base: parts.join("/"), open };
}

const join = (base: string, open: string) => {
	const seg = open ? `g/${open.replace("/", "-")}` : "";
	return seg ? (base ? `${base}/${seg}` : seg) : base;
};
const openIn = (base: string, id: string) => ui.navTo(PAGE, join(base, id));

const guestIcon = (g: { type: string }): IconName => (g.type === "qemu" ? "monitor" : "box");
const settingsHref = `swarm://settings/${PAGE}/${PAGE}`;

// ---- Rows ----

function guestRow(g: Guest, base: string, open: string, why?: string): Child {
	const s = api.guestState(g);
	const sub = why ?? [String(g.vmid), api.kindOf(g.type), g.node, ...api.tagsOf(g)].join(" · ");
	return (
		<ui.pressable key={g.id} label={`${api.guestName(g)}, ${s.label}`} checked={open === g.id} onClick={() => openIn(base, open === g.id ? "" : g.id)} style={rowOf()}>
			<ui.icon icon={guestIcon(g)} style={{ width: 15, height: 15, color: s.running ? "text2" : "text3", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<ui.text style={{ fontWeight: 500, ...line }}>{api.guestName(g)}</ui.text>
				<ui.text style={{ ...faint, ...line, color: why ? "amber" : "text3" }}>{sub}</ui.text>
			</ui.box>
			{s.running && !phone.on ? useMeters(g.cpu, api.frac(g.mem, g.maxmem), 70) : null}
			{badge(s.tone, s.label)}
		</ui.pressable>
	);
}

/** CPU and memory, each a small meter, as a row's end shows them. */
function useMeters(cpu: number | undefined, mem: number | undefined, width: number): Child {
	return (
		<ui.box style={{ flexDirection: "row", gap: 12, flexShrink: 0 }}>
			<ui.box style={{ width, gap: 4 }}>
				<ui.text style={faint}>{`CPU ${api.pct(cpu)}`}</ui.text>
				{meter(cpu)}
			</ui.box>
			<ui.box style={{ width, gap: 4 }}>
				<ui.text style={faint}>{`RAM ${api.pct(mem)}`}</ui.text>
				{meter(mem)}
			</ui.box>
		</ui.box>
	);
}

function nodeRow(n: Resource): Child {
	const s = api.nodeState(n);
	const name = n.node ?? "";
	return (
		<ui.pressable key={n.id} label={`${name}, ${s.label}`} onClick={() => ui.navTo(PAGE, `n/${encodeURIComponent(name)}`, { title: name })} style={rowOf()}>
			<ui.icon icon="server" style={{ width: 15, height: 15, color: "text2", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<ui.text style={{ fontWeight: 500, ...line }}>{name}</ui.text>
				<ui.text style={{ ...faint, ...line }}>{s.online ? [`Up ${api.uptime(n.uptime)}`, n.maxcpu ? `${n.maxcpu} CPUs` : "", `${guests().filter((g) => g.node === name && g.status === "running").length} running`].filter(Boolean).join(" · ") : "Not reachable"}</ui.text>
			</ui.box>
			{s.online && !phone.on ? useMeters(n.cpu, api.frac(n.mem, n.maxmem), 90) : null}
			{badge(s.tone, s.label)}
		</ui.pressable>
	);
}

function taskTitle(t: Task): string {
	const g = t.id && /^\d+$/.test(t.id) ? guests().find((x) => x.vmid === Number(t.id)) : undefined;
	const what = api.taskLabel(t.type);
	return g ? `${what} ${api.guestName(g)}` : t.id ? `${what} ${t.id}` : what;
}

function taskRow(t: Task, expanded: boolean, onToggle: () => void): Child {
	const ok = api.taskOk(t);
	const label = ok === undefined ? "Running" : ok ? (t.status === "OK" ? "OK" : "Warnings") : "Failed";
	return (
		<ui.box key={t.upid} style={{ minWidth: 0 }}>
			<ui.pressable label={`${taskTitle(t)}, ${label}`} checked={expanded} onClick={onToggle} style={{ ...rowOf(), checked: {} }}>
				<ui.icon icon={ok === undefined ? "hourglass" : ok ? "check-circle" : "alert-circle"} style={{ width: 15, height: 15, color: ok === undefined ? "accent" : ok ? "text3" : "red", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
				<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
					<ui.text style={{ fontWeight: 500, ...line }}>{taskTitle(t)}</ui.text>
					<ui.text style={{ ...faint, ...line }}>{[t.node, t.user, api.ago(t.starttime), api.took(t), ok === false ? t.status : ""].filter(Boolean).join(" · ")}</ui.text>
				</ui.box>
				{badge(ok === undefined ? "accent" : ok ? (t.status === "OK" ? "green" : "amber") : "red", label)}
				<ui.icon icon={expanded ? "chevron-down" : "chevron-right"} style={{ width: 12, height: 12, color: "text3" }} />
			</ui.pressable>
			{expanded ? (
				<ui.box style={{ padding: phone.on ? "4 12 14" : "s2 s5 s4", minWidth: 0 }}>
					{state.taskLog.upid !== t.upid || (!state.taskLog.text && !state.taskLog.err) ? loading("Reading the log…") : state.taskLog.err ? problem(state.taskLog.err) : logBox(`task-${t.upid}`, state.taskLog.text, 320, { title: taskTitle(t) })}
				</ui.box>
			) : null}
		</ui.box>
	);
}

let openTask = "";
const toggleTask = (t: Task) => () => {
	openTask = openTask === t.upid ? "" : t.upid;
	if (openTask) void readTaskLog(t.upid);
};

// ---- The views ----

function titleBar(title: string, count: string, ...end: Child[]): Child {
	const c = conn();
	return (
		<ui.box style={{ flex: 1, minWidth: 0, height: "100%", flexDirection: "row", gap: 6, alignItems: "center", paddingLeft: 16, paddingRight: 16 }}>
			<ui.text style={{ fontSize: 14, fontWeight: 600, ...line }}>{title}</ui.text>
			{count ? <ui.text style={{ fontSize: 14, color: "text3", flexShrink: 0 }}>{count}</ui.text> : null}
			<ui.spacer />
			{end}
			{c ? <ui.iconButton icon="external" label="Open Proxmox" href={api.baseOf(c.url)} /> : null}
			<ui.iconButton icon="settings" label="Proxmox settings" href={settingsHref} />
		</ui.box>
	);
}

function phoneHead(end: Child[]): Child {
	const c = conn();
	return (
		<ui.box style={{ flexDirection: "row", gap: 2, alignItems: "center", flexShrink: 0 }}>
			{c ? end : null}
			<ui.menu label="" icon="more" kind="ghost" tooltip="More">
				{c ? <ui.item icon="external" label="Open Proxmox" href={api.baseOf(c.url)} /> : null}
				<ui.item icon="settings" label="Proxmox settings" href={settingsHref} />
			</ui.menu>
		</ui.box>
	);
}

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
						{it.badge ? <ui.text style={faint}>{it.badge}</ui.text> : null}
						<ui.icon icon="chevron-right" style={{ width: 14, height: 14, color: "text3", flexShrink: 0 }} />
					</ui.pressable>
				)),
			)}
		</ui.box>
	);
}

const matches = (g: Guest, q: string) => [g.name ?? "", String(g.vmid), g.node, g.tags ?? "", api.kindOf(g.type)].some((s) => s.toLowerCase().includes(q));

function overview(base: string, open: string): Child {
	const all = guests();
	const q = state.search.trim().toLowerCase();
	if (q) {
		const hits = all.filter((g) => matches(g, q));
		return (
			<ui.box style={{ gap: 6 }}>
				{sectionHead(`${hits.length} found`)}
				{hits.length ? list(hits.map((g) => guestRow(g, base, open))) : <ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>{`Nothing matches ${state.search.trim()}.`}</ui.text>}
			</ui.box>
		);
	}
	const ns = nodes();
	const online = ns.filter((n) => n.status === "online");
	const real = all.filter((g) => !g.template);
	const running = real.filter((g) => g.status === "running");
	const cpu = online.reduce((a, n) => a + (n.cpu ?? 0) * (n.maxcpu ?? 0), 0) / Math.max(1, online.reduce((a, n) => a + (n.maxcpu ?? 0), 0));
	const mem = api.frac(online.reduce((a, n) => a + (n.mem ?? 0), 0), online.reduce((a, n) => a + (n.maxmem ?? 0), 0));
	if (Date.now() - state.disksAt > 10 * 60_000) void readBadDisks();
	const attention: { g?: Guest; text: string; r?: Resource; node?: string }[] = [
		...ns.filter((n) => n.status !== "online").map((n) => ({ r: n, text: `${n.node} is offline` })),
		...all.filter((g) => g.lock).map((g) => ({ g, text: api.guestState(g).label })),
		...storages().filter((s) => s.status === "available" && (api.frac(s.disk, s.maxdisk) ?? 0) >= 0.9).map((s) => ({ r: s, text: `${s.storage} on ${s.node} is ${api.pct(api.frac(s.disk, s.maxdisk))} full` })),
		...state.badDisks.map((d) => ({ node: d.node, text: `${d.devpath} on ${d.node}: ${d.label === "Failing" ? "SMART says it's failing" : d.label}` })),
	];
	const busiest = running.slice().sort((a, b) => (b.cpu ?? 0) * (b.maxcpu ?? 1) - (a.cpu ?? 0) * (a.maxcpu ?? 1)).slice(0, 5);
	if (state.tasks === undefined && !state.tasksAt) void readTasks();
	const recent = (state.tasks ?? []).slice(0, 6);
	return (
		<ui.box style={{ gap: 18 }}>
			{stats([
				{ value: `${online.length}/${ns.length}`, label: ns.length === 1 ? "Node online" : "Nodes online", tone: online.length === ns.length ? "green" : "red" },
				{ value: `${running.length}/${real.length}`, label: "Guests running" },
				{ value: api.pct(cpu), label: "CPU", tone: cpu >= 0.9 ? "red" : cpu >= 0.8 ? "amber" : undefined },
				{ value: api.pct(mem), label: "Memory", tone: (mem ?? 0) >= 0.9 ? "red" : (mem ?? 0) >= 0.8 ? "amber" : undefined },
			])}
			{attention.length ? (
				<ui.box style={{ gap: 6 }}>
					{sectionHead("Needs attention")}
					{list(
						attention.map((a, i) =>
							a.g ? (
								guestRow(a.g, base, open, a.text)
							) : (
								<ui.box key={`a${i}`} style={{ ...rowOf(), hover: {} }}>
									<ui.icon icon="alert-circle" style={{ width: 15, height: 15, color: "amber", flexShrink: 0 }} />
									<ui.text style={{ flex: 1, ...line }}>{a.text}</ui.text>
								</ui.box>
							),
						),
					)}
				</ui.box>
			) : null}
			<ui.box style={{ gap: 6 }}>
				{sectionHead(clusterName() ? `Nodes of ${clusterName()}` : ns.length === 1 ? "Node" : "Nodes")}
				{list(ns.map(nodeRow))}
			</ui.box>
			{busiest.length ? (
				<ui.box style={{ gap: 6 }}>
					{sectionHead("Busiest now", <ui.link key="all" label="All guests" onClick={() => ui.navTo(PAGE, "guests")} style={{ fontSize: "small" }} />)}
					{list(busiest.map((g) => guestRow(g, base, open)))}
				</ui.box>
			) : null}
			<ui.box style={{ gap: 6 }}>
				{sectionHead("Recent tasks", <ui.link key="all" label="All tasks" onClick={() => ui.navTo(PAGE, "tasks")} style={{ fontSize: "small" }} />)}
				{recent.length ? list(recent.map((t) => taskRow(t, openTask === t.upid, toggleTask(t)))) : state.tasks === undefined ? loading("Reading tasks…") : <ui.text style={{ color: "text3", padding: 12 }}>No tasks yet.</ui.text>}
			</ui.box>
			{phone.on ? browse() : null}
		</ui.box>
	);
}

const filter = { show: "all" as "all" | "running" | "stopped" | "templates" };

function guestsView(base: string, open: string, only?: string): Child {
	const q = state.search.trim().toLowerCase();
	const all = guests().filter((g) => !only || g.node === only);
	const shownGuests = all
		.filter((g) => (filter.show === "templates" ? !!g.template : filter.show === "running" ? g.status === "running" && !g.template : filter.show === "stopped" ? g.status !== "running" && !g.template : true))
		.filter((g) => !q || matches(g, q))
		.sort((a, b) => a.vmid - b.vmid);
	const templates = all.some((g) => g.template);
	const byNode = new Map<string, Guest[]>();
	for (const g of shownGuests) byNode.set(g.node, [...(byNode.get(g.node) ?? []), g]);
	return (
		<ui.box style={{ gap: 14 }}>
			<ui.segmented
				label="Show"
				style={{ alignSelf: phone.on ? "stretch" : "flex-start" }}
				value={filter.show}
				options={[{ value: "all", label: "All" }, { value: "running", label: "Running" }, { value: "stopped", label: "Stopped" }, ...(templates ? [{ value: "templates", label: "Templates" }] : [])]}
				onChange={(v) => void (filter.show = v as typeof filter.show)}
			/>
			{!shownGuests.length ? (
				<ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>{q ? `Nothing matches ${state.search.trim()}.` : all.length ? "None of them." : "No VMs or containers yet."}</ui.text>
			) : only || byNode.size === 1 ? (
				list(shownGuests.map((g) => guestRow(g, base, open)))
			) : (
				[...byNode].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([node, gs]) => (
					<ui.box key={node} style={{ gap: 6 }}>
						{sectionHead(node)}
						{list(gs.map((g) => guestRow(g, base, open)))}
					</ui.box>
				))
			)}
		</ui.box>
	);
}

function tasksView(): Child {
	shown.tasks = true;
	if (Date.now() - state.tasksAt > 10_000) void readTasks();
	if (state.tasksErr && !state.tasks) return problem(state.tasksErr);
	if (!state.tasks) return loading("Reading tasks…");
	const q = state.search.trim().toLowerCase();
	const ts = state.tasks.filter((t) => !q || [taskTitle(t), t.node, t.user ?? "", t.status ?? ""].some((s) => s.toLowerCase().includes(q)));
	const live = ts.filter((t) => api.taskOk(t) === undefined);
	const done = ts.filter((t) => api.taskOk(t) !== undefined);
	if (!ts.length) return <ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>{q ? `Nothing matches ${state.search.trim()}.` : "No tasks yet."}</ui.text>;
	return (
		<ui.box style={{ gap: 18 }}>
			{state.tasksErr ? problem(state.tasksErr) : null}
			{live.length ? (
				<ui.box style={{ gap: 6 }}>
					{sectionHead("Running")}
					{list(live.map((t) => taskRow(t, openTask === t.upid, toggleTask(t))))}
				</ui.box>
			) : null}
			<ui.box style={{ gap: 6 }}>
				{sectionHead("Done")}
				{list(done.map((t) => taskRow(t, openTask === t.upid, toggleTask(t))))}
			</ui.box>
		</ui.box>
	);
}

function storageView(): Child {
	const ss = storages().sort((a, b) => (a.storage ?? "").localeCompare(b.storage ?? "") || (a.node ?? "").localeCompare(b.node ?? ""));
	if (!ss.length) return <ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>No storage this token may see.</ui.text>;
	return list(
		ss.map((s) => {
			const f = api.frac(s.disk, s.maxdisk);
			const up = s.status === "available";
			return (
				<ui.box key={s.id} style={{ ...rowOf(), hover: {} }}>
					<ui.icon icon="hard-drive" style={{ width: 15, height: 15, color: "text2", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
					<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
						<ui.text style={{ fontWeight: 500, ...line }}>{s.storage ?? s.id}</ui.text>
						<ui.text style={{ ...faint, ...line }}>{[s.node, s.plugintype, (s.content ?? "").split(",").filter(Boolean).join(", "), s.shared ? "shared" : ""].filter(Boolean).join(" · ")}</ui.text>
					</ui.box>
					{up ? (
						<ui.box style={{ width: phone.on ? 90 : 160, gap: 4, flexShrink: 0 }}>
							<ui.box style={{ flexDirection: "row" }}>
								<ui.text style={faint}>{api.pct(f)}</ui.text>
								<ui.spacer />
								{phone.on ? null : <ui.text style={faint}>{`${api.bytes(s.disk)} of ${api.bytes(s.maxdisk)}`}</ui.text>}
							</ui.box>
							{meter(f)}
						</ui.box>
					) : (
						badge("red", s.status ? s.status.charAt(0).toUpperCase() + s.status.slice(1) : "Unknown")
					)}
				</ui.box>
			);
		}),
	);
}

// ---- A node ----

const timeframes = [{ value: "hour", label: "Hour" }, { value: "day", label: "Day" }, { value: "week", label: "Week" }];

function graphsOf(key: string, rrd: api.Point[] | undefined, node: boolean): Child[] {
	if (!rrd) return [loading("Reading graphs…")];
	const pts = rrd.filter((p) => p.time);
	const times = pts.map((p) => p.time);
	const cpu: Series = { name: "CPU", values: pts.map((p) => p.cpu), color: "accent", format: api.pct };
	const memUsed = pts.map((p) => (node ? p.memused : p.mem));
	const memMax = Math.max(0, ...pts.map((p) => (node ? p.memtotal : p.maxmem) ?? 0));
	const mem: Series = { name: "Memory", values: memUsed, color: "violet", format: api.bytes };
	const net: Series[] = [
		{ name: "In", values: pts.map((p) => p.netin), color: "green", format: api.rate },
		{ name: "Out", values: pts.map((p) => p.netout), color: "amber", format: api.rate },
	];
	const out = [graph(`${key}-cpu`, "CPU", times, [cpu], 1), graph(`${key}-mem`, "Memory", times, [mem], memMax || undefined), graph(`${key}-net`, "Network", times, net)];
	if (!node && pts.some((p) => p.diskread || p.diskwrite))
		out.push(
			graph(`${key}-disk`, "Disk I/O", times, [
				{ name: "Read", values: pts.map((p) => p.diskread), color: "accent", format: api.rate },
				{ name: "Write", values: pts.map((p) => p.diskwrite), color: "red", format: api.rate },
			]),
		);
	return out;
}

/** An open console, in Swarm's terminal, where its guest or node is; Disconnect ends it. */
function consoleTab(con: OpenConsole): Child {
	return (
		<ui.box style={{ gap: 8 }}>
			<ui.terminal key={`term-${con.id}`} terminal={con.id} label={con.title} style={{ height: phone.on ? 360 : 460 }} />
			<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<ui.text style={{ ...faint, ...line, flex: 1 }}>{`${con.title}. Click it to type; Proxmox ends it as you log out.`}</ui.text>
				<ui.button size="sm" kind="ghost" icon="x" onClick={() => con.close()}>Disconnect</ui.button>
			</ui.box>
		</ui.box>
	);
}

/** A disk's SMART, opened under its row: its attributes, or what smartctl printed. */
function smartOf(o: OpenedNode, d: api.Disk): Child {
	const s = o.smart.get(d.devpath);
	if (s === undefined) return loading("Reading its SMART…");
	if (typeof s === "string") return problem(s);
	if (s.attributes?.length)
		return (
			<ui.box style={{ gap: 2 }}>
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", minHeight: 22 }}>
					<ui.text style={{ ...faint, width: 28, textAlign: "right" }}>ID</ui.text>
					<ui.text style={{ ...faint, flex: 1 }}>Attribute</ui.text>
					<ui.text style={{ ...faint, width: 90, textAlign: "right" }}>Value / limit</ui.text>
					<ui.text style={{ ...faint, width: 120, textAlign: "right" }}>Raw</ui.text>
				</ui.box>
				{s.attributes.map((a) => (
					<ui.box key={`${a.id}-${a.name}`} style={{ flexDirection: "row", gap: 8, alignItems: "center", minHeight: 22 }}>
						<ui.text style={{ ...faint, width: 28, textAlign: "right" }}>{String(a.id ?? "")}</ui.text>
						<ui.text style={{ ...line, flex: 1, color: a.fail && a.fail !== "-" ? "red" : "text2" }}>{a.name.replace(/_/g, " ")}</ui.text>
						<ui.text style={{ ...faint, width: 90, textAlign: "right" }}>{`${a.value ?? "—"} / ${a.threshold ?? "—"}`}</ui.text>
						<ui.text style={{ fontFamily: "mono", fontSize: 11, color: "text3", width: 120, textAlign: "right", ...line }}>{a.raw ?? ""}</ui.text>
					</ui.box>
				))}
			</ui.box>
		);
	return s.text ? logBox(`smart-${d.devpath}`, s.text, 320, { title: `${d.devpath}: SMART` }) : <ui.text style={faint}>Its SMART says nothing more.</ui.text>;
}

function disksTab(node: string, o: OpenedNode): Child {
	if (o.disks === undefined && !o.disksErr) void readDisks(node, o);
	if (o.disksErr && !o.disks) return problem(/permission|may not/i.test(o.disksErr) ? `${o.disksErr} Disks need Sys.Audit on the node.` : o.disksErr);
	if (!o.disks) return loading("Reading its disks…");
	if (!o.disks.length) return <ui.text style={{ color: "text3", padding: 12 }}>No disks.</ui.text>;
	return (
		<ui.box style={{ gap: 6 }}>
			{sectionHead("Disks", refresh(false, () => { o.smart.clear(); void readDisks(node, o); }))}
			{list(
				o.disks.map((d) => {
					const st = api.diskState(d);
					const open = o.openDisk === d.devpath;
					return (
						<ui.box key={d.devpath} style={{ minWidth: 0 }}>
							<ui.pressable
								label={`${d.devpath}, ${st.label}`}
								checked={open}
								onClick={() => {
									o.openDisk = open ? "" : d.devpath;
									if (!open && !o.smart.has(d.devpath)) void readSmart(node, o, d.devpath);
								}}
								style={{ ...rowOf(), checked: {} }}
							>
								<ui.icon icon="hard-drive" style={{ width: 15, height: 15, color: "text2", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
								<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
									<ui.text style={{ fontWeight: 500, ...line }}>{`${d.devpath}${d.model ? ` · ${d.model}` : ""}`}</ui.text>
									<ui.text style={{ ...faint, ...line }}>{[api.bytes(d.size), (d.type ?? "").toUpperCase(), typeof d.wearout === "number" ? `${100 - d.wearout}% worn` : "", d.used ?? "unused", d.serial ?? ""].filter(Boolean).join(" · ")}</ui.text>
								</ui.box>
								{badge(st.tone, st.label)}
								<ui.icon icon={open ? "chevron-down" : "chevron-right"} style={{ width: 12, height: 12, color: "text3" }} />
							</ui.pressable>
							{open ? <ui.box style={{ padding: phone.on ? "4 12 14" : "s2 s5 s4", minWidth: 0 }}>{smartOf(o, d)}</ui.box> : null}
						</ui.box>
					);
				}),
			)}
		</ui.box>
	);
}

function nodeView(name: string, base: string, open: string): Child {
	const n = nodeByName(name);
	if (!n) return empty("server", "Not in the cluster", `Proxmox has no node ${name}, or this token can't see it.`);
	const o = openedNode(name);
	shown.node = name;
	if (!o.at || (o.rrdFor && o.rrdFor !== o.timeframe)) void readNode(name, o);
	const st = o.status;
	const online = n.status === "online";
	const c = conn()!;
	const wide = phone.on ? { flex: 1 } : undefined;
	const shell = consoles.get(`node/${name}`);
	if (o.tab === "shell" && !shell) o.tab = "summary";
	const tabs = [{ value: "summary", label: "Summary" }, ...(shell ? [{ value: "shell", label: "Shell" }] : []), { value: "guests", label: "Guests" }, { value: "disks", label: "Disks" }, { value: "syslog", label: "Syslog" }];
	let body: Child;
	if (o.tab === "shell" && shell) body = consoleTab(shell);
	else if (o.tab === "guests") body = guestsView(base, open, name);
	else if (o.tab === "disks") body = disksTab(name, o);
	else if (o.tab === "syslog") {
		if (o.syslog === undefined && !o.syslogErr) void readSyslog(name, o);
		body = o.syslogErr ? problem(o.syslogErr) : o.syslog === undefined ? loading("Reading the syslog…") : (
			<ui.box style={{ gap: 6 }}>
				{sectionHead("Its last 500 lines", refresh(false, () => void readSyslog(name, o)))}
				{logBox(`syslog-${name}`, o.syslog, 560, { title: `${name}: syslog` })}
			</ui.box>
		);
	} else {
		const facts: Child[] = [];
		if (st?.cpuinfo?.model) facts.push(fact("CPU", <ui.text style={{ ...line, color: "text2" }}>{`${st.cpuinfo.model}${st.cpuinfo.cpus ? `, ${st.cpuinfo.cpus} threads` : ""}${st.cpuinfo.sockets && st.cpuinfo.sockets > 1 ? ` on ${st.cpuinfo.sockets} sockets` : ""}`}</ui.text>));
		if (st?.loadavg) facts.push(fact("Load average", <ui.text style={{ color: "text2" }}>{st.loadavg.join(", ")}</ui.text>));
		if (st?.wait !== undefined) facts.push(fact("I/O wait", <ui.text style={{ color: "text2" }}>{api.pct(st.wait)}</ui.text>));
		facts.push(fact("Uptime", <ui.text style={{ color: "text2" }}>{api.uptime(st?.uptime ?? n.uptime)}</ui.text>));
		if (st?.pveversion) facts.push(fact("Proxmox VE", <ui.text style={{ color: "text2", ...line }}>{st.pveversion.replace(/^pve-manager\//, "")}</ui.text>));
		if (st?.kversion) facts.push(fact("Kernel", <ui.text style={{ color: "text2", ...line }} selectable>{st.kversion}</ui.text>));
		body = (
			<ui.box style={{ gap: 14 }}>
				{o.statusErr ? problem(o.statusErr) : null}
				{online ? (
					<ui.card padding={phone.on ? "s4 s5" : "s5 s6"} gap="s5" style={{ flexDirection: phone.on ? "column" : "row" }}>
						{usage("CPU", st?.cpu ?? n.cpu, `${st?.cpuinfo?.cpus ?? n.maxcpu ?? "?"} CPUs`)}
						{usage("Memory", api.frac(st?.memory?.used ?? n.mem, st?.memory?.total ?? n.maxmem), `${api.bytes(st?.memory?.used ?? n.mem)} of ${api.bytes(st?.memory?.total ?? n.maxmem)}`)}
						{st?.swap?.total ? usage("Swap", api.frac(st.swap.used, st.swap.total), `${api.bytes(st.swap.used)} of ${api.bytes(st.swap.total)}`) : null}
						{usage("Root disk", api.frac(st?.rootfs?.used ?? n.disk, st?.rootfs?.total ?? n.maxdisk), `${api.bytes(st?.rootfs?.used ?? n.disk)} of ${api.bytes(st?.rootfs?.total ?? n.maxdisk)}`)}
					</ui.card>
				) : null}
				{list(facts)}
				{online ? (
					<ui.box style={{ gap: 10 }}>
						<ui.box style={{ flexDirection: "row", alignItems: "center" }}>
							<ui.text style={{ fontSize: "small", fontWeight: 600, color: "text2" }}>Graphs</ui.text>
							<ui.spacer />
							<ui.segmented label="Graphs over" value={o.timeframe} options={timeframes} onChange={(v) => void (o.timeframe = v as Timeframe)} />
						</ui.box>
						{graphsOf(`node-${name}`, o.rrdFor === o.timeframe ? o.rrd : undefined, true)}
					</ui.box>
				) : null}
			</ui.box>
		);
	}
	return (
		<ui.box style={{ gap: 16 }}>
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
				{badge(api.nodeState(n).tone, api.nodeState(n).label)}
				<ui.text style={faint}>{[`${guests().filter((g) => g.node === name).length} guests`, n.maxcpu ? `${n.maxcpu} CPUs` : "", api.bytes(n.maxmem)].filter(Boolean).join(" · ")}</ui.text>
				<ui.spacer />
				{online ? <ui.button size="sm" icon="terminal" onClick={() => void startConsole({ kind: "node", node: name, name }, (e) => void (o.actErr = e), () => void (o.tab = "shell"))} disabled={opening.has(`node/${name}`)} style={wide}>{opening.has(`node/${name}`) ? "Connecting…" : "Shell"}</ui.button> : null}
				{online ? (
					<ui.menu label={phone.on ? "" : "Power"} icon="more" size="sm" kind={phone.on ? "secondary" : "ghost"} tooltip="Reboot or shut down">
						<ui.item icon="external" label="Shell in Proxmox" href={api.nodeShellUrl(c, name)} />
						<ui.separator />
						<ui.item icon="refresh" label="Reboot…" onClick={() => void (o.confirm = "reboot")} />
						<ui.item icon="stop" label="Shut down…" danger onClick={() => void (o.confirm = "shutdown")} />
					</ui.menu>
				) : null}
			</ui.box>
			{o.confirm === "reboot" || o.confirm === "shutdown"
				? confirmBox(
						o.confirm === "reboot" ? `Reboot ${name}?` : `Shut ${name} down?`,
						`${guests().filter((g) => g.node === name && g.status === "running").length} guests running on it ${o.confirm === "reboot" ? "stop while it restarts, and start again only if they start at boot" : "stop, and it stays off until it's turned on at the machine"}.`,
						o.confirm === "reboot" ? `Reboot ${name}` : `Shut down ${name}`,
						() => void nodePower(name, o, o.confirm as "reboot" | "shutdown"),
						() => void (o.confirm = ""),
					)
				: null}
			{o.actErr ? problem(o.actErr) : null}
			<ui.segmented label="Tabs" style={{ alignSelf: phone.on ? "stretch" : "flex-start" }} value={o.tab} options={tabs} onChange={(v) => void (o.tab = v as OpenedNode["tab"])} />
			{body}
		</ui.box>
	);
}

// ---- The board: a view, its search and title ----

function board(view: View, base: string, open: string, head = false): Child {
	const c = conn();
	let title = (servers().length > 1 ? current()?.name : "") || clusterName() || "Overview";
	let count = "";
	let search = true;
	let body: Child;
	const end: Child[] = [refresh(state.reading, () => void readList().then(() => readTasks()))];
	if (view.kind === "guests") {
		title = "VMs & containers";
		count = state.list ? String(guests().length) : "";
	} else if (view.kind === "tasks") title = "Tasks";
	else if (view.kind === "backups") {
		title = "Backups";
		end[0] = refresh(state.backupsReading, () => void readAllBackups());
	} else if (view.kind === "storage") {
		title = "Storage";
		search = false;
	} else if (view.kind === "node") {
		title = view.node;
		search = (state.nodes.get(view.node)?.tab ?? "summary") === "guests";
	}
	if (head) return phone.on ? phoneHead(end) : titleBar(title, count, ...(c ? end : []));
	if (!c) {
		body = empty("server", "Connect Proxmox", "Give its address and an API token, and its nodes, VMs and containers show here.", <ui.link label="Connect in Settings…" href={settingsHref} />);
		search = false;
	} else if (state.needsCode && !state.list) {
		body = <ui.box style={{ ...columnStyle(), marginTop: "auto", marginBottom: "auto" }}>{codeCard()}</ui.box>;
		search = false;
	} else if (state.err && !state.list) {
		body = empty("alert-circle", "Proxmox didn't answer", state.err, state.certificate ? <ui.link label="Trust its certificate in Settings…" href={settingsHref} /> : <ui.button onClick={() => void readList()}>Try again</ui.button>);
		search = false;
	} else if (!state.list) {
		body = loading("Reading Proxmox…", true);
	} else {
		const inner = view.kind === "overview" ? overview(base, open) : view.kind === "guests" ? guestsView(base, open) : view.kind === "tasks" ? tasksView() : view.kind === "storage" ? storageView() : view.kind === "backups" ? backupsView(open, (id) => openIn(base, id)) : nodeView(view.node, base, open);
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
					{searchField("search", state.search, view.kind === "tasks" ? "Search tasks" : "Search VMs, containers, tags, nodes", (v) => void (state.search = v))}
				</ui.box>
			) : (
				<ui.box style={{ height: phone.on ? 8 : 20, flexShrink: 0 }} />
			)}
			{body}
		</ui.box>
	);
}

// ---- A guest opened ----

function summaryTab(g: Guest, o: OpenedGuest): Child {
	const s = o.status;
	const running = (s?.status ?? g.status) === "running";
	const facts: Child[] = [];
	facts.push(fact("Node", <ui.link label={g.node} onClick={() => ui.navTo(PAGE, `n/${encodeURIComponent(g.node)}`)} />));
	if (running && o.addrs !== undefined)
		facts.push(
			fact(
				"Addresses",
				o.addrs.length ? (
					o.addrs.filter((a) => !a.v6).concat(o.addrs.filter((a) => a.v6)).slice(0, 6).map((a) => (
						<ui.box key={a.iface + a.ip} style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
							<ui.text style={{ fontFamily: "mono", fontSize: 12 }} selectable>{a.ip}</ui.text>
							<ui.iconButton icon="copy" label={`Copy ${a.ip}`} onClick={() => ui.copy(a.ip)} style={{ width: 20, height: 20 }} />
						</ui.box>
					))
				) : (
					<ui.text style={faint}>{g.type === "qemu" ? "None known: install the QEMU guest agent in it" : "None"}</ui.text>
				),
			),
		);
	if (running) facts.push(fact("Network", <ui.text style={{ color: "text2" }}>{`${api.bytes(s?.netin ?? g.netin)} in, ${api.bytes(s?.netout ?? g.netout)} out since it started`}</ui.text>));
	if (s?.ha?.managed) facts.push(fact("High availability", <ui.text style={{ color: "text2" }}>{s.ha.state ?? "Managed"}</ui.text>));
	if (g.pool) facts.push(fact("Pool", <ui.text style={{ color: "text2" }}>{g.pool}</ui.text>));
	// A VM's disk use is known only through its agent; a container's, as Proxmox reads it.
	const diskKnown = (s?.maxdisk ?? g.maxdisk ?? 0) > 0 && (g.type === "lxc" || (s?.disk ?? g.disk ?? 0) > 0);
	return (
		<ui.box style={{ gap: 14 }}>
			{running ? (
				<ui.card padding={phone.on ? "s4 s5" : "s5 s6"} gap="s5" style={{ flexDirection: phone.on ? "column" : "row" }}>
					{usage("CPU", s?.cpu ?? g.cpu, `${s?.cpus ?? g.maxcpu ?? "?"} ${(s?.cpus ?? g.maxcpu) === 1 ? "core" : "cores"}`)}
					{usage("Memory", api.frac(s?.mem ?? g.mem, s?.maxmem ?? g.maxmem), `${api.bytes(s?.mem ?? g.mem)} of ${api.bytes(s?.maxmem ?? g.maxmem)}`)}
					{diskKnown ? usage("Disk", api.frac(s?.disk ?? g.disk, s?.maxdisk ?? g.maxdisk), `${api.bytes(s?.disk ?? g.disk)} of ${api.bytes(s?.maxdisk ?? g.maxdisk)}`) : null}
				</ui.card>
			) : null}
			{list(facts)}
			{g.template ? null : (
				<ui.box style={{ gap: 10 }}>
					<ui.box style={{ flexDirection: "row", alignItems: "center" }}>
						<ui.text style={{ fontSize: "small", fontWeight: 600, color: "text2" }}>Graphs</ui.text>
						<ui.spacer />
						<ui.segmented label="Graphs over" value={o.timeframe} options={timeframes} onChange={(v) => { o.timeframe = v as Timeframe; void readGuest(g, o, false); }} />
					</ui.box>
					{graphsOf(`g-${g.id}`, o.rrdFor === o.timeframe ? o.rrd : undefined, false)}
				</ui.box>
			)}
		</ui.box>
	);
}

function hardwareTab(g: Guest, o: OpenedGuest): Child {
	if (o.configErr && !o.config) return problem(o.configErr);
	if (!o.config) return loading("Reading its configuration…");
	const rows = api.configRows(g.type, o.config);
	const desc = String(o.config.description ?? "").trim();
	return (
		<ui.box style={{ gap: 14 }}>
			{list(rows.map((r) => fact(r.label, <ui.text style={{ color: "text2", ...line }} selectable>{r.value}</ui.text>)))}
			{desc ? (
				<ui.box style={{ gap: 6 }}>
					{sectionHead("Notes")}
					<ui.card padding="s4 s5">
						<ui.markdown text={desc} />
					</ui.card>
				</ui.box>
			) : null}
			{g.template ? null : (
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<ui.button size="sm" icon="pencil" onClick={() => openForm(g, o, "edit")}>Edit name, cores, memory and tags</ui.button>
					<ui.spacer />
					<ui.text style={faint}>Disks and networks change in Proxmox.</ui.text>
				</ui.box>
			)}
		</ui.box>
	);
}

function snapshotsTab(g: Guest, o: OpenedGuest): Child {
	if (o.snaps === undefined && !o.snapsErr) void readSnapshots(g, o);
	const running = g.status === "running";
	const f = o.snapForm;
	const nameOk = !f || /^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(f.name);
	return (
		<ui.box style={{ gap: 12 }}>
			{f ? (
				<ui.card padding="s5 s6" gap="s4">
					<ui.text style={{ fontWeight: 500 }}>Take a snapshot</ui.text>
					<ui.field key="snapname" autoFocus value={f.name} placeholder="Its name: pre-upgrade" onChange={(v) => void (f.name = v)} onSubmit={() => nameOk && f.name && void snapAction(g, o, "take", f.name, f.description, f.vmstate)} />
					{!nameOk && f.name ? <ui.text style={{ fontSize: "small", color: "red" }}>A letter first, then letters, digits, - or _; 2 to 40 of them.</ui.text> : null}
					<ui.field key="snapdesc" value={f.description} placeholder="What it's before (optional)" onChange={(v) => void (f.description = v)} />
					{g.type === "qemu" && running ? <ui.checkbox label="Include its memory, so it resumes running" checked={f.vmstate} onChange={(v) => void (f.vmstate = v)} /> : null}
					<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
						<ui.button kind="ghost" onClick={() => void (o.snapForm = undefined)}>Cancel</ui.button>
						<ui.button kind="primary" disabled={!f.name || !nameOk || !!o.busy} onClick={() => void snapAction(g, o, "take", f.name, f.description, f.vmstate)}>{o.busy.startsWith("take:") ? "Taking…" : "Take snapshot"}</ui.button>
					</ui.box>
				</ui.card>
			) : null}
			{sectionHead(
				"Snapshots",
				refresh(false, () => void readSnapshots(g, o)),
				f ? null : <ui.button key="take" size="sm" icon="camera" onClick={() => void (o.snapForm = { name: "", description: "", vmstate: false })}>Take snapshot</ui.button>,
			)}
			{o.snapsErr ? problem(o.snapsErr) : o.snaps === undefined ? loading("Reading snapshots…") : !o.snaps.length ? <ui.text style={{ color: "text3", padding: 12 }}>No snapshots.</ui.text> : list(
				o.snaps.map((s) => {
					const busy = o.busy.endsWith(`:${s.name}`);
					return (
						<ui.box key={s.name} style={{ minWidth: 0 }}>
							<ui.box style={{ ...rowOf(), hover: {} }}>
								<ui.icon icon="camera" style={{ width: 15, height: 15, color: "text2", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
								<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
									<ui.text style={{ fontWeight: 500, ...line }}>{s.name}</ui.text>
									<ui.text style={{ ...faint, ...line }}>{[s.snaptime ? new Date(s.snaptime * 1000).toLocaleString() : "", s.description?.trim() ?? ""].filter(Boolean).join(" · ")}</ui.text>
								</ui.box>
								{s.vmstate ? badge("muted", "With memory") : null}
								{busy ? <ui.spinner /> : (
									<ui.menu label="" icon="more" kind="ghost" tooltip={`Act on ${s.name}`}>
										<ui.item icon="undo" label="Roll back to it…" onClick={() => void (o.confirm = `rollback:${s.name}`)} />
										<ui.item icon="trash" label="Delete…" danger onClick={() => void (o.confirm = `delete:${s.name}`)} />
									</ui.menu>
								)}
							</ui.box>
							{o.confirm === `rollback:${s.name}`
								? <ui.box style={{ padding: "0 s4 s4" }}>{confirmBox(`Roll ${api.guestName(g)} back to ${s.name}?`, `Its disks${s.vmstate ? " and memory" : ""} go back to how they were ${s.snaptime ? api.ago(s.snaptime) : "then"}: what changed since is lost${running ? ", and it stops first" : ""}.`, "Roll back", () => void snapAction(g, o, "rollback", s.name), () => void (o.confirm = ""))}</ui.box>
								: null}
							{o.confirm === `delete:${s.name}`
								? <ui.box style={{ padding: "0 s4 s4" }}>{confirmBox(`Delete ${s.name}?`, "It can't be rolled back to after.", "Delete snapshot", () => void snapAction(g, o, "delete", s.name), () => void (o.confirm = ""), "Keep it")}</ui.box>
								: null}
						</ui.box>
					);
				}),
			)}
		</ui.box>
	);
}

function guestTasksTab(g: Guest): Child {
	if (state.tasks === undefined || Date.now() - state.tasksAt > 10_000) void readTasks();
	if (!state.tasks) return loading("Reading tasks…");
	const ts = state.tasks.filter((t) => t.id === String(g.vmid));
	if (!ts.length) return <ui.text style={{ color: "text3", padding: 12 }}>No recent tasks.</ui.text>;
	return list(ts.map((t) => taskRow(t, openTask === t.upid, toggleTask(t))));
}

function guestPane(g: Guest | undefined, id: string, base: string): Child {
	const c = conn();
	if (!g || !c) {
		return (
			<ui.box style={{ flexGrow: 1, minHeight: 0 }}>
				<ui.box dragWindow style={top}>
					<ui.iconButton icon="x" label="Close" onClick={() => ui.navTo(PAGE, base)} />
				</ui.box>
				{state.list ? empty("cube", "Not in the cluster", `Proxmox has no guest ${id}, or this token can't see it.`) : loading("Reading Proxmox…", true)}
			</ui.box>
		);
	}
	const o = openedGuest(g);
	shown.guest = g.id;
	if (!o.at) void readGuest(g, o);
	const st = api.guestState(g, o.status?.qmpstatus);
	const paused = st.label === "Paused";
	const running = g.status === "running" && !paused;
	const doing = (w: string) => o.busy === w;
	const wide = phone.on ? { flex: 1 } : undefined;
	const con = consoles.get(`${g.type}/${g.vmid}`);
	const tabs = [{ value: "summary", label: "Summary" }, ...(con ? [{ value: "console", label: "Console" }] : []), { value: "hardware", label: "Hardware" }, ...(g.template ? [] : [{ value: "snapshots", label: phone.on ? "Snaps" : "Snapshots" }]), { value: "backups", label: "Backups" }, { value: "tasks", label: "Tasks" }];
	if (!tabs.some((t) => t.value === o.tab)) o.tab = "summary";
	const askFirst: Record<string, [string, string, string]> = {
		shutdown: [`Shut ${api.guestName(g)} down?`, "It's asked to shut down as its own power button would, and stays off until it's started again.", "Shut down"],
		reboot: [`Reboot ${api.guestName(g)}?`, "It's asked to restart: what it serves is down until it's back.", "Reboot"],
		stop: [`Stop ${api.guestName(g)} at once?`, "As pulling its plug: it doesn't shut down, and what wasn't written to its disks is lost. Shut down asks it first.", "Stop now"],
	};
	const ask = askFirst[o.confirm];
	return (
		<ui.box style={{ flexGrow: 1, minHeight: 0 }}>
			<ui.scroll style={{ flexGrow: 1, minHeight: 0, minWidth: 0 }}>
				<ui.box style={{ padding: phone.on ? "8 16 32" : "s6 s7 s7", gap: phone.on ? 16 : 14, width: "100%", minWidth: 0 }}>
					<ui.box style={{ gap: 4 }}>
						<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
							<ui.icon icon={guestIcon(g)} style={{ width: 18, height: 18, color: "text2" }} />
							<ui.text style={{ fontSize: 20, fontWeight: 500, ...line }} selectable>{api.guestName(g)}</ui.text>
							<ui.text style={{ fontSize: 20, color: "text3", flexShrink: 0 }}>{String(g.vmid)}</ui.text>
							<ui.spacer />
							<ui.iconButton icon="external" label="Open in Proxmox" href={api.guestUrl(c, g)} />
							{phone.on ? null : <ui.iconButton icon="x" label="Close" onClick={() => ui.navTo(PAGE, base)} />}
						</ui.box>
						<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
							{badge(st.tone, st.label)}
							<ui.text style={faint}>{[api.kindOf(g.type), `on ${g.node}`, running ? `up ${api.uptime(o.status?.uptime ?? g.uptime)}` : ""].filter(Boolean).join(" · ")}</ui.text>
							{api.tagsOf(g).map((t) => <ui.tag key={t} tone="muted">{t}</ui.tag>)}
						</ui.box>
					</ui.box>

					{g.template ? (
						<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
							<ui.button kind="primary" icon="plus" disabled={!!o.busy} onClick={() => openForm(g, o, "clone")} style={wide}>New guest from it</ui.button>
						</ui.box>
					) : (
						<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
							{!running && !paused ? <ui.button kind="primary" icon="play" disabled={!!o.busy} onClick={() => void press(g, o, "start")} style={wide}>{doing("start") ? "Starting…" : "Start"}</ui.button> : null}
							{paused ? <ui.button kind="primary" icon="play" disabled={!!o.busy} onClick={() => void press(g, o, "resume")} style={wide}>{doing("resume") ? "Resuming…" : "Resume"}</ui.button> : null}
							{running && g.type === "lxc" ? <ui.button icon="terminal" onClick={() => void startConsole({ kind: "lxc", node: g.node, vmid: g.vmid, name: api.guestName(g) }, (e) => void (o.actErr = e), () => void (o.tab = "console"))} disabled={opening.has(`lxc/${g.vmid}`)} style={wide}>{opening.has(`lxc/${g.vmid}`) ? "Connecting…" : "Console"}</ui.button> : null}
							{running && g.type === "qemu" ? (
								hasSerial(o.config) ? (
									<ui.menu label="Console" icon="terminal" kind="secondary" tooltip="Open its console" style={wide}>
										<ui.item icon="terminal" label="Serial console, in Swarm" onClick={() => void startConsole({ kind: "qemu", node: g.node, vmid: g.vmid, name: api.guestName(g) }, (e) => void (o.actErr = e), () => void (o.tab = "console"))} />
										<ui.item icon="external" label="Its screen, in Proxmox" href={api.consoleUrl(c, g)} />
									</ui.menu>
								) : (
									<ui.button icon="external" href={api.consoleUrl(c, g)} tooltip="Its screen, in Proxmox's page: give it a serial port for a console in Swarm" style={wide}>Console</ui.button>
								)
							) : null}
							{running ? <ui.button icon="stop" disabled={!!o.busy} onClick={() => void (o.confirm = "shutdown")} style={wide}>{doing("shutdown") ? "Shutting down…" : "Shut down"}</ui.button> : null}
							{running ? <ui.button icon="refresh" disabled={!!o.busy} onClick={() => void (o.confirm = "reboot")} style={wide}>{doing("reboot") ? "Rebooting…" : "Reboot"}</ui.button> : null}
							<ui.menu label={phone.on ? "" : "More actions"} tooltip="More actions" icon="more" kind={phone.on ? "secondary" : "ghost"}>
								{running && g.type === "qemu" ? <ui.item icon="pause" label="Pause" onClick={() => void press(g, o, "suspend")} /> : null}
								<ui.item icon="camera" label="Take snapshot…" onClick={() => { o.tab = "snapshots"; o.snapForm = { name: "", description: "", vmstate: false }; }} />
								<ui.item icon="archive" label="Back up now…" onClick={() => { o.tab = "backups"; openForm(g, o, "backup"); }} />
								<ui.item icon="copy" label="Clone…" onClick={() => openForm(g, o, "clone")} />
								{otherNodes(g.node).length ? <ui.item icon="arrow-right" label="Move to another node…" onClick={() => openForm(g, o, "migrate")} /> : null}
								<ui.item icon="pencil" label="Edit…" onClick={() => openForm(g, o, "edit")} />
								<ui.item icon="tag" label="Copy vmid" onClick={() => ui.copy(String(g.vmid))} />
								{running || paused ? <ui.separator /> : null}
								{running || paused ? <ui.item icon="stop" label="Stop at once…" danger onClick={() => void (o.confirm = "stop")} /> : null}
							</ui.menu>
						</ui.box>
					)}
					{guestForm(g, o, (id) => openIn(base, id))}
					{ask ? confirmBox(ask[0], ask[1], ask[2], () => void press(g, o, o.confirm as api.Power), () => void (o.confirm = ""), "Keep it running") : null}
					{o.actErr ? problem(o.actErr) : null}

					<ui.segmented style={{ alignSelf: phone.on ? "stretch" : "flex-start" }} label="Tabs" value={o.tab} options={tabs} onChange={(v) => void (o.tab = v as OpenedGuest["tab"])} />
					{o.tab === "summary" ? summaryTab(g, o) : null}
					{o.tab === "console" && con ? consoleTab(con) : null}
					{o.tab === "hardware" ? hardwareTab(g, o) : null}
					{o.tab === "snapshots" ? snapshotsTab(g, o) : null}
					{o.tab === "backups" ? backupsTab(g, o) : null}
					{o.tab === "tasks" ? guestTasksTab(g) : null}
				</ui.box>
			</ui.scroll>
		</ui.box>
	);
}

export function renderPage({ args }: RenderContext): Child {
	setPhone(args);
	let { view, base, open } = parsePath(args.path ?? "");
	// A node the cluster no longer has, as the window reopens the page where it was.
	if (view.kind === "node" && state.list && !nodeByName(view.node)) {
		view = { kind: "overview" };
		base = "";
	}
	// A server chosen in the sidebar: shown, from its overview, its row
	// staying chosen. Not a navTo in a render, which the window doesn't take.
	const chosen = /^server\/([^/]+)$/.exec(args.path ?? "");
	if (chosen) {
		if (chosen[1] !== current()?.id && servers().some((s) => s.id === chosen[1])) setCurrent(chosen[1]!);
		view = { kind: "overview" };
		base = "";
		open = "";
	}
	if (args.slot === "head") return board(view, base, open, true);
	if (args.slot) return null;
	shown.guest = "";
	shown.node = "";
	shown.tasks = false;
	fresh();
	const g = open ? guestById(open) : undefined;
	return (
		<ui.box style={{ flexDirection: "row", flexGrow: 1, minHeight: 0, alignItems: "stretch" }}>
			<ui.box key="list" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, display: open ? "none" : "flex", media: [{ minWidth: 900, style: { display: "flex" } }] }}>
				{board(view, base, open)}
			</ui.box>
			{open ? <ui.box key="split" style={{ width: 1, flexShrink: 0, backgroundColor: "divider", display: "none", media: [{ minWidth: 900, style: { display: "flex" } }] }} /> : null}
			{open ? (
				<ui.box key="guest" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, media: [{ minWidth: 900, style: { flexGrow: 0, flexBasis: "56%" } }] }}>
					{guestPane(g, open, base)}
				</ui.box>
			) : null}
		</ui.box>
	);
}
