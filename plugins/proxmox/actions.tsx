// What changes a guest beyond its power: its backups (back up now,
// restore, delete), a clone, a move to another node, and its settings
// (name, cores, memory, start at boot, tags). Each is a form over the
// guest's tabs, or a question before what can't be undone.
import { ui, type Child } from "swarm";
import * as api from "./pve";
import type { Backup, Guest } from "./pve";
import { act, conn, guests, nodes, openedGuest, readAllBackups, readBackupStores, readGuest, readGuestBackups, state, type GuestForm, type OpenedGuest } from "./store";
import { badge, confirmBox, faint, line, list, loading, phone, problem, refresh, rowOf, sectionHead } from "./view";

/** Nodes online, other than this one: where a guest can move or be cloned to. */
export const otherNodes = (node: string) => nodes().filter((n) => n.status === "online" && n.node !== node).map((n) => n.node!);

const hostOk = (s: string) => /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,61}[a-zA-Z0-9])?$/.test(s);
const vmidOk = (s: string) => /^\d+$/.test(s) && Number(s) >= 100 && Number(s) <= 999_999_999 && !guests().some((g) => g.vmid === Number(s));

/** Opens a form over a guest, with what it starts from. */
export function openForm(g: Guest, o: OpenedGuest, kind: GuestForm["kind"], volid = "") {
	o.actErr = "";
	o.confirm = "";
	const c = conn();
	if (kind === "backup") {
		void readBackupStores(g.node);
		o.form = { kind, storage: "", mode: "snapshot" };
	} else if (kind === "clone") {
		const f: GuestForm = { kind, newid: "", name: `${g.name ?? g.vmid}-clone`, full: !g.template, target: g.node };
		o.form = f;
		if (c) void api.nextId(c).then((id) => {
			if (o.form === f && !f.newid) f.newid = String(id);
			ui.update();
		}).catch(() => undefined);
	} else if (kind === "migrate") {
		o.form = { kind, target: otherNodes(g.node)[0] ?? "" };
	} else if (kind === "edit") {
		const cfg = o.config ?? {};
		o.form = { kind, name: g.name ?? "", cores: String(cfg.cores ?? g.maxcpu ?? 1), memory: String(cfg.memory ?? Math.round((g.maxmem ?? 0) / 1048576)), onboot: String(cfg.onboot ?? "0") === "1", tags: api.tagsOf(g).join(" ") };
	} else {
		const f: GuestForm = { kind, volid, asNew: true, newid: "" };
		o.form = f;
		if (c) void api.nextId(c).then((id) => {
			if (o.form === f && !f.newid) f.newid = String(id);
			ui.update();
		}).catch(() => undefined);
	}
}

/** Closes a guest's form, as its action ends well. */
const close = (o: OpenedGuest) => () => void (o.form = undefined);

function formCard(title: string, children: Child[], submit: { label: string; busy: string; disabled: boolean; run: () => void }, o: OpenedGuest): Child {
	const wide = phone.on ? { flex: 1 } : undefined;
	return (
		<ui.card padding="s5 s6" gap="s4">
			<ui.box style={{ flexDirection: "row", alignItems: "center" }}>
				<ui.text style={{ fontWeight: 500 }}>{title}</ui.text>
			</ui.box>
			{children}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				<ui.button kind={phone.on ? "secondary" : "ghost"} onClick={() => void (o.form = undefined)} style={wide}>Cancel</ui.button>
				<ui.button kind="primary" disabled={submit.disabled || !!o.busy} onClick={submit.run} style={wide}>{o.busy ? submit.busy : submit.label}</ui.button>
			</ui.box>
		</ui.card>
	);
}

const labelled = (label: string, child: Child, hint?: string): Child => (
	<ui.box key={label} style={{ gap: 6 }}>
		<ui.text style={{ fontSize: "small", fontWeight: 500, color: "text2" }}>{label}</ui.text>
		{child}
		{hint ? <ui.text style={{ fontSize: "small", color: "text3" }}>{hint}</ui.text> : null}
	</ui.box>
);

/** A select as wide as what it says, at the start of its line. */
const pick = { alignSelf: "flex-start" as const, minWidth: 200 };

const fieldError = (text: string): Child => <ui.text style={{ fontSize: "small", color: "red" }}>{text}</ui.text>;

/** The form open over a guest, if one is. go opens a guest made by it (a clone, a restore as new). */
export function guestForm(g: Guest, o: OpenedGuest, go: (id: string) => void): Child {
	const f = o.form;
	if (!f) return null;
	const name = api.guestName(g);
	const running = g.status === "running";
	if (f.kind === "backup") {
		const stores = state.backupStores.get(g.node);
		if (stores && stores.length && !stores.some((s) => s.storage === f.storage)) f.storage = stores.find((s) => s.type === "pbs")?.storage ?? stores[0]!.storage;
		const store = stores?.find((s) => s.storage === f.storage);
		return formCard(
			`Back up ${name}`,
			stores === undefined || (!stores.length && !state.backupStores.has(g.node))
				? [loading("Reading its node's storage…")]
				: !stores.length
					? [problem(`No storage of ${g.node} takes backups: give one the Backup content in Proxmox, Datacenter, Storage.`)]
					: [
							labelled("To", <ui.select style={pick} label="Storage" value={f.storage} options={stores.map((s) => ({ value: s.storage, label: `${s.storage}${s.total ? ` (${api.bytes(s.avail)} free)` : ""}` }))} onChange={(v) => void (f.storage = v)} />),
							labelled(
								"Mode",
								<ui.select
									style={pick}
									label="Mode"
									value={f.mode}
									options={[
										{ value: "snapshot", label: "Snapshot: it keeps running" },
										{ value: "suspend", label: "Suspend: paused while it's copied" },
										{ value: "stop", label: "Stop: shut down, then started again" },
									]}
									onChange={(v) => void (f.mode = v as api.BackupMode)}
								/>,
								store?.type === "pbs" ? "To Proxmox Backup Server: only what changed since the last one is sent." : "Compressed with zstd.",
							),
						],
			{ label: "Back up now", busy: "Backing up…", disabled: !store, run: () => void act(g, o, "backup", (c) => api.backupNow(c, g, f.storage, f.mode, store?.type === "pbs"), `Backed up ${name} to ${f.storage}`, () => readGuestBackups(g, o), close(o)) },
			o,
		);
	}
	if (f.kind === "clone") {
		const targets = [g.node, ...otherNodes(g.node)];
		const idErr = f.newid && !vmidOk(f.newid) ? (guests().some((x) => x.vmid === Number(f.newid)) ? `${f.newid} is taken.` : "A vmid is a number from 100.") : "";
		const nameErr = f.name && !hostOk(f.name) ? "A name is letters, digits, - and ., as a host's." : "";
		return formCard(
			g.template ? `New guest from ${name}` : `Clone ${name}`,
			[
				<ui.box key="row" style={{ flexDirection: phone.on ? "column" : "row", gap: 12 }}>
					<ui.box style={{ width: phone.on ? undefined : 120 }}>{labelled("vmid", <ui.field key="newid" value={f.newid} placeholder="Next free" onChange={(v) => void (f.newid = v.trim())} />)}</ui.box>
					<ui.box style={{ flex: 1, minWidth: 0 }}>{labelled("Name", <ui.field key="clonename" value={f.name} placeholder={`${g.name ?? g.vmid}-clone`} onChange={(v) => void (f.name = v.trim())} />)}</ui.box>
				</ui.box>,
				idErr ? fieldError(idErr) : null,
				nameErr ? fieldError(nameErr) : null,
				targets.length > 1 ? labelled("On", <ui.select style={pick} label="Node" value={f.target} options={targets.map((n) => ({ value: n, label: n === g.node ? `${n} (where it is)` : n }))} onChange={(v) => void (f.target = v)} />) : null,
				g.template
					? <ui.checkbox key="full" label="A full copy, apart from the template's disks" checked={f.full} onChange={(v) => void (f.full = v)} />
					: <ui.text key="full" style={{ fontSize: "small", color: "text3" }}>A full copy of its disks{running ? ", taken as it runs" : ""}: it takes as long as copying them.</ui.text>,
			],
			{
				label: g.template ? "Create" : "Clone",
				busy: g.template ? "Creating…" : "Cloning…",
				disabled: !vmidOk(f.newid) || !!nameErr,
				run: () => {
					const id = Number(f.newid);
					void act(g, o, "clone", (c) => api.clone(c, g, id, f.name, f.full, f.target), `${g.template ? "Created" : "Cloned to"} ${f.name || id} (${id})`, undefined, () => {
						o.form = undefined;
						go(`${g.type}/${id}`);
					});
				},
			},
			o,
		);
	}
	if (f.kind === "migrate") {
		const targets = otherNodes(g.node);
		return formCard(
			`Move ${name} to another node`,
			[
				labelled("To", <ui.select style={pick} label="Node" value={f.target} options={targets.map((n) => ({ value: n, label: n }))} onChange={(v) => void (f.target = v)} />),
				<ui.text key="how" style={{ fontSize: "small", color: "text3" }}>
					{running ? (g.type === "qemu" ? "It moves as it runs: its memory, then its local disks, are copied over while it keeps serving." : "It stops, moves, and starts again there.") : "Its configuration and local disks are copied over."}
				</ui.text>,
			],
			{ label: "Move", busy: "Moving…", disabled: !f.target, run: () => void act(g, o, "migrate", (c) => api.migrate(c, g, f.target, running), `Moved ${name} to ${f.target}`, undefined, close(o)) },
			o,
		);
	}
	if (f.kind === "edit") {
		const cfg = o.config ?? {};
		const maxCores = nodes().find((n) => n.node === g.node)?.maxcpu ?? 512;
		const cores = Number(f.cores);
		const mem = Number(f.memory);
		const tags = f.tags.split(/[\s,;]+/).filter(Boolean);
		const errs = [
			f.name && !hostOk(f.name) ? "A name is letters, digits, - and ., as a host's." : "",
			!Number.isInteger(cores) || cores < 1 || cores > maxCores ? `Cores are 1 to ${maxCores}, as ${g.node} has.` : "",
			!Number.isInteger(mem) || mem < 16 ? "Memory is a whole number of MiB, 16 or more." : "",
			tags.some((t) => !api.tagOk(t)) ? "A tag is letters, digits and - _ + ." : "",
		].filter(Boolean);
		const ch: api.Changes = {};
		if (f.name && f.name !== (g.name ?? "")) ch.name = f.name;
		if (cores !== Number(cfg.cores ?? g.maxcpu)) ch.cores = cores;
		if (mem !== Number(cfg.memory ?? 0)) ch.memory = mem;
		if (f.onboot !== (String(cfg.onboot ?? "0") === "1")) ch.onboot = f.onboot;
		if (tags.join(";") !== api.tagsOf(g).join(";")) ch.tags = tags;
		const changed = Object.keys(ch).length > 0;
		return formCard(
			`Edit ${name}`,
			[
				labelled("Name", <ui.field key="editname" value={f.name} placeholder={String(g.vmid)} onChange={(v) => void (f.name = v.trim())} />),
				<ui.box key="res" style={{ flexDirection: phone.on ? "column" : "row", gap: 12 }}>
					<ui.box style={{ flex: 1 }}>{labelled("Cores", <ui.number label="Cores" value={Number.isFinite(cores) ? cores : null} min={1} max={maxCores} step={1} onChange={(v) => void (f.cores = String(v))} />)}</ui.box>
					<ui.box style={{ flex: 1 }}>{labelled("Memory", <ui.number label="Memory" value={Number.isFinite(mem) ? mem : null} min={16} step={512} unit="MiB" onChange={(v) => void (f.memory = String(v))} />)}</ui.box>
				</ui.box>,
				labelled("Tags", <ui.field key="tags" value={f.tags} placeholder="prod web" onChange={(v) => void (f.tags = v)} />, "Separated by spaces."),
				<ui.checkbox key="onboot" label="Start it when its node starts" checked={f.onboot} onChange={(v) => void (f.onboot = v)} />,
				...errs.map((e) => fieldError(e)),
				running && g.type === "qemu" && (ch.cores !== undefined || ch.memory !== undefined) ? <ui.text key="pending" style={{ fontSize: "small", color: "amber" }}>It's running: new cores and memory take hold at its next start, unless hotplug is on for them.</ui.text> : null,
			],
			{
				label: "Save",
				busy: "Saving…",
				disabled: !changed || errs.length > 0,
				run: () => void act(g, o, "edit", (c) => api.setConfig(c, g, ch).then(() => null), `Saved ${f.name || name}`, () => readGuest(g, o), close(o)),
			},
			o,
		);
	}
	// Restore.
	const b = o.backups?.find((x) => x.volid === f.volid);
	if (!b) return null;
	const storage = g.type === "lxc" ? api.rootStorage(o.config) : undefined;
	const idErr = f.asNew && f.newid && !vmidOk(f.newid) ? (guests().some((x) => x.vmid === Number(f.newid)) ? `${f.newid} is taken.` : "A vmid is a number from 100.") : "";
	return formCard(
		`Restore the backup of ${api.backupWhen(b)}`,
		[
			<ui.segmented key="how" label="Restore" value={f.asNew ? "new" : "over"} options={[{ value: "new", label: "As a new guest" }, { value: "over", label: `Over ${name}` }]} onChange={(v) => void (f.asNew = v === "new")} style={{ alignSelf: phone.on ? "stretch" : "flex-start" }} />,
			f.asNew
				? labelled("vmid", <ui.field key="restoreid" value={f.newid} placeholder="Next free" onChange={(v) => void (f.newid = v.trim())} />, `A copy of ${name} as it was then, beside it, with new MAC addresses.`)
				: <ui.text key="over" style={{ fontSize: "small", color: running ? "red" : "amber" }}>{running ? `${name} is running: shut it down first.` : `${name}'s disks and configuration are replaced by the backup's: what changed since is lost.`}</ui.text>,
			idErr ? fieldError(idErr) : null,
		],
		{
			label: f.asNew ? "Restore" : `Replace ${name}`,
			busy: "Restoring…",
			disabled: f.asNew ? !vmidOk(f.newid) : running,
			run: () => {
				const id = f.asNew ? Number(f.newid) : g.vmid;
				void act(g, o, "restore", (c) => api.restore(c, g.node, g.type, b.volid, id, { force: !f.asNew, unique: f.asNew, storage }), f.asNew ? `Restored ${name} as ${id}` : `Restored ${name}`, () => readGuest(g, o), () => {
					o.form = undefined;
					if (f.asNew) go(`${g.type}/${id}`);
				});
			},
		},
		o,
	);
}

// ---- The Backups tab ----

function backupRow(g: Guest, o: OpenedGuest, b: Backup): Child {
	const busy = o.busy === `delete-backup:${b.volid}`;
	const verified = b.verification?.state;
	return (
		<ui.box key={b.volid} style={{ minWidth: 0 }}>
			<ui.box style={{ ...rowOf(), hover: {} }}>
				<ui.icon icon="archive" style={{ width: 15, height: 15, color: "text2", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
				<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
					<ui.text style={{ fontWeight: 500, ...line }}>{api.backupWhen(b)}</ui.text>
					<ui.text style={{ ...faint, ...line }}>{[b.storage, api.bytes(b.size), api.ago(b.ctime), b.notes?.trim() ?? ""].filter(Boolean).join(" · ")}</ui.text>
				</ui.box>
				{b.protected ? badge("muted", "Protected") : null}
				{verified === "failed" ? badge("red", "Verify failed") : verified === "ok" ? badge("green", "Verified") : null}
				{busy ? (
					<ui.spinner />
				) : (
					<ui.menu label="" icon="more" kind="ghost" tooltip={`Act on the backup of ${api.backupWhen(b)}`}>
						<ui.item icon="undo" label="Restore…" onClick={() => openForm(g, o, "restore", b.volid)} />
						<ui.item icon="copy" label="Copy its volume ID" onClick={() => ui.copy(b.volid)} />
						<ui.separator />
						<ui.item icon="trash" label="Delete…" danger disabled={!!b.protected} onClick={() => void (o.confirm = `delete-backup:${b.volid}`)} />
					</ui.menu>
				)}
			</ui.box>
			{o.confirm === `delete-backup:${b.volid}` ? (
				<ui.box style={{ padding: "0 s4 s4" }}>
					{confirmBox(
						`Delete the backup of ${api.backupWhen(b)}?`,
						`It's gone from ${b.storage}, and can't be restored after.`,
						"Delete backup",
						() => void act(g, o, `delete-backup:${b.volid}`, (c) => api.deleteBackup(c, b), "Deleted the backup", () => readGuestBackups(g, o)),
						() => void (o.confirm = ""),
						"Keep it",
					)}
				</ui.box>
			) : null}
		</ui.box>
	);
}

export function backupsTab(g: Guest, o: OpenedGuest): Child {
	if (o.backups === undefined && !o.backupsErr) void readGuestBackups(g, o);
	return (
		<ui.box style={{ gap: 12 }}>
			{sectionHead(
				"Backups",
				refresh(false, () => void readGuestBackups(g, o)),
				o.form?.kind === "backup" || g.template ? null : <ui.button key="now" size="sm" icon="archive" onClick={() => openForm(g, o, "backup")}>Back up now</ui.button>,
			)}
			{o.backupsErr ? problem(o.backupsErr) : o.backups === undefined ? loading("Reading backups…") : !o.backups.length ? <ui.text style={{ color: "text3", padding: 12 }}>{`No backups of ${api.guestName(g)} on ${g.node}'s storage.`}</ui.text> : list(o.backups.map((b) => backupRow(g, o, b)))}
		</ui.box>
	);
}

// ---- The Backups view: each guest's last backup ----

const DAY = 86400;

export function backupsView(open: string, openIn: (id: string) => void): Child {
	if (!state.backups && !state.backupsErr) {
		if (!state.backupsReading) void readAllBackups();
		return loading("Reading every storage's backups…");
	}
	if (state.backupsErr && !state.backups) return problem(state.backupsErr);
	const all = state.backups ?? [];
	const now = Date.now() / 1000;
	const q = state.search.trim().toLowerCase();
	const rows = guests()
		.filter((g) => !g.template && (!q || [g.name ?? "", String(g.vmid), g.node, g.tags ?? ""].some((s) => s.toLowerCase().includes(q))))
		.map((g) => {
			const mine = all.filter((b) => b.vmid === g.vmid);
			return { g, mine, last: mine[0], size: mine.reduce((a, b) => a + (b.size ?? 0), 0) };
		})
		.sort((a, b) => (a.last?.ctime ?? 0) - (b.last?.ctime ?? 0) || a.g.vmid - b.g.vmid);
	const none = rows.filter((r) => !r.last).length;
	const old = rows.filter((r) => r.last && now - (r.last.ctime ?? 0) > 7 * DAY).length;
	const row = ({ g, mine, last, size }: (typeof rows)[number]) => {
		const age = last ? now - (last.ctime ?? 0) : Infinity;
		return (
			<ui.pressable
				key={g.id}
				label={`${api.guestName(g)}, ${last ? `last backed up ${api.ago(last.ctime)}` : "never backed up"}`}
				checked={open === g.id}
				onClick={() => {
					openedGuest(g).tab = "backups";
					openIn(g.id);
				}}
				style={rowOf()}
			>
				<ui.icon icon={g.type === "qemu" ? "monitor" : "box"} style={{ width: 15, height: 15, color: "text2", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
				<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
					<ui.text style={{ fontWeight: 500, ...line }}>{api.guestName(g)}</ui.text>
					<ui.text style={{ ...faint, ...line }}>{last ? [`${mine.length} ${mine.length === 1 ? "backup" : "backups"}`, api.bytes(size), [...new Set(mine.map((b) => b.storage))].join(", ")].join(" · ") : `${g.vmid} · ${g.node}`}</ui.text>
				</ui.box>
				{badge(!last ? "amber" : age > 7 * DAY ? "amber" : "green", !last ? "Never" : api.ago(last.ctime))}
			</ui.pressable>
		);
	};
	return (
		<ui.box style={{ gap: 16 }}>
			{state.backupsErr ? problem(state.backupsErr) : null}
			<ui.text style={{ fontSize: "small", color: "text2" }}>
				{none || old ? [none ? `${none} never backed up` : "", old ? `${old} not in the last week` : ""].filter(Boolean).join(", ") + "." : "Every guest was backed up in the last week."}
			</ui.text>
			{rows.length ? list(rows.map(row)) : <ui.text style={{ color: "text3", textAlign: "center", padding: 24 }}>{q ? `Nothing matches ${state.search.trim()}.` : "No VMs or containers yet."}</ui.text>}
		</ui.box>
	);
}
