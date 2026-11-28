import { expect, test, type Request, type T } from "swarm/test";

const TOKEN_ID = "root@pam!swarm";
const SECRET = "11111111-2222-3333-4444-555555555555";

const now = Math.floor(Date.now() / 1000);
const GiB = 1024 ** 3;

const RESOURCES = [
	{ id: "node/pve1", type: "node", node: "pve1", status: "online", cpu: 0.18, maxcpu: 16, mem: 22 * GiB, maxmem: 64 * GiB, disk: 40 * GiB, maxdisk: 100 * GiB, uptime: 864000 },
	{ id: "node/pve2", type: "node", node: "pve2", status: "offline" },
	{ id: "qemu/100", type: "qemu", node: "pve1", vmid: 100, name: "web", status: "running", cpu: 0.42, maxcpu: 4, mem: 3 * GiB, maxmem: 8 * GiB, disk: 0, maxdisk: 32 * GiB, uptime: 7200, tags: "prod;web", netin: 1e9, netout: 2e9 },
	{ id: "lxc/101", type: "lxc", node: "pve1", vmid: 101, name: "db", status: "running", cpu: 0.05, maxcpu: 2, mem: 1 * GiB, maxmem: 2 * GiB, disk: 3 * GiB, maxdisk: 8 * GiB, uptime: 3600 },
	{ id: "qemu/102", type: "qemu", node: "pve1", vmid: 102, name: "windows", status: "stopped", maxcpu: 4, maxmem: 8 * GiB, maxdisk: 64 * GiB },
	{ id: "qemu/103", type: "qemu", node: "pve1", vmid: 103, name: "web-staging", status: "stopped", maxcpu: 2, maxmem: 4 * GiB, maxdisk: 32 * GiB },
	{ id: "qemu/9000", type: "qemu", node: "pve1", vmid: 9000, name: "debian-template", status: "stopped", template: 1 },
	{ id: "storage/pve1/local", type: "storage", node: "pve1", storage: "local", status: "available", plugintype: "dir", content: "iso,vztmpl,backup", disk: 40 * GiB, maxdisk: 100 * GiB },
	{ id: "storage/pve1/local-lvm", type: "storage", node: "pve1", storage: "local-lvm", status: "available", plugintype: "lvmthin", content: "images,rootdir", disk: 95 * GiB, maxdisk: 100 * GiB },
];

const upid = (type: string, id: string, n: number) => `UPID:pve1:0000${n}:00ABCDEF:${(now - n * 60).toString(16).toUpperCase()}:${type}:${id}:root@pam:`;

const TASKS = [
	{ upid: upid("vzdump", "101", 3), node: "pve1", type: "vzdump", id: "101", user: "root@pam", starttime: now - 3 * 3600, endtime: now - 3 * 3600 + 95, status: "OK" },
	{ upid: upid("qmstart", "102", 2), node: "pve1", type: "qmstart", id: "102", user: "root@pam", starttime: now - 2 * 3600, endtime: now - 2 * 3600 + 3, status: "TASK ERROR: start failed: QEMU exited with code 1" },
];

const rrd = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ time: now - (n - i) * 60, cpu: 0.2 + 0.2 * Math.sin(i / 6), maxcpu: 4, mem: (2.5 + Math.sin(i / 9) * 0.5) * GiB, maxmem: 8 * GiB, memused: 22 * GiB, memtotal: 64 * GiB, netin: 2e5 + 1e5 * Math.cos(i / 5), netout: 1e5, diskread: 0, diskwrite: 4e4 }));

// proxmox stands in for a Proxmox VE: its token, its cluster, and the
// tasks its actions start, which end as soon as they're asked about.
// The password sign-in's: a user with a second factor, the code it takes, and the ticket it gives.
const USER = "admin@pve";
const PASSWORD = "hunter2";
const CODE = "123456";
const TICKET = "PVE:admin@pve:6747AB12::signed";

async function proxmox(t: T, cluster = "homelab") {
	// Its own copy of the tasks: a test adds to them.
	const clusterTasks = TASKS.map((x) => ({ ...x }));
	const snaps: { name: string; description?: string; snaptime?: number; vmstate?: number; parent?: string; running?: number }[] = [
		{ name: "before-upgrade", description: "Before apt full-upgrade", snaptime: now - 86400 * 3 },
		{ name: "current", description: "You are here!", running: 1 },
	];
	const tasks = new Map<string, string>();
	// Its own copy: a clone adds a guest.
	const resources = RESOURCES.map((r) => ({ ...r }));
	const BACKUPS: Record<string, { volid: string; vmid: number; ctime: number; size: number; notes?: string; protected?: number; verification?: { state: string } }[]> = {
		local: [
			{ volid: "local:backup/vzdump-qemu-100-2026_11_24-03_00_02.vma.zst", vmid: 100, ctime: now - 86400, size: 3.1 * GiB, notes: "web" },
			{ volid: "local:backup/vzdump-lxc-101-2026_11_01-03_00_02.tar.zst", vmid: 101, ctime: now - 24 * 86400, size: 0.6 * GiB, protected: 1 },
		],
		pbs: [{ volid: "pbs:backup/vm/100/2026-11-25T03:00:00Z", vmid: 100, ctime: now - 3600, size: 3.2 * GiB, verification: { state: "ok" } }],
	};
	let n = 10;
	const started = (type: string, id: string, exit = "OK") => {
		const u = upid(type, id, n++);
		tasks.set(u, exit);
		return { json: { data: u } };
	};
	const srv = await t.server((req: Request) => {
		const p = req.path.replace(/^\/api2\/json/, "");
		const form = new URLSearchParams(req.body);
		if (p === "/access/ticket" && req.method === "POST") {
			if (form.get("username") !== USER) return { status: 401, body: "" };
			if (form.get("tfa-challenge") === "PVE:partial") return form.get("password") === `totp:${CODE}` ? { json: { data: { ticket: TICKET, CSRFPreventionToken: "csrf1", username: USER } } } : { status: 401, body: "" };
			if (form.get("password") === TICKET) return { json: { data: { ticket: TICKET, CSRFPreventionToken: "csrf1", username: USER } } };
			if (form.get("password") === PASSWORD) return { json: { data: { ticket: "PVE:partial", CSRFPreventionToken: "", username: USER, NeedTFA: 1 } } };
			return { status: 401, body: "" };
		}
		const byToken = req.headers["authorization"] === `PVEAPIToken=${TOKEN_ID}=${SECRET}`;
		const byTicket = (req.headers["cookie"] ?? "").includes(`PVEAuthCookie=${encodeURIComponent(TICKET)}`) && (req.method === "GET" || req.headers["csrfpreventiontoken"] === "csrf1");
		if (!byToken && !byTicket) return { status: 401, body: "" };
		if (p === "/nodes/pve1/disks/list") return { json: { data: [{ devpath: "/dev/nvme0n1", model: "Samsung SSD 980 PRO 1TB", serial: "S5GXNX0R123", size: 1000 * GiB, type: "nvme", health: "PASSED", wearout: 97, used: "LVM" }, { devpath: "/dev/sda", model: "WDC WD40EFRX", serial: "WD-WCC7K1", size: 4000 * GiB, type: "hdd", health: "FAILED", wearout: "N/A", used: "ZFS" }] } };
		if (p === "/nodes/pve1/disks/smart") return { json: { data: { health: "FAILED", type: "ata", attributes: [{ id: 5, name: "Reallocated_Sector_Ct", value: 1, worst: 1, threshold: 140, raw: "2016", fail: "FAILING_NOW" }, { id: 9, name: "Power_On_Hours", value: 40, worst: 40, threshold: 0, raw: "44123", fail: "-" }] } } };
		const term = /^\/nodes\/pve1(?:\/(?:lxc|qemu)\/\d+)?\/termproxy$/.exec(p);
		if (term && req.method === "POST") return { json: { data: { port: 5900, ticket: "PVEVNC:x", user: TOKEN_ID } } };
		if (p === "/version") return { json: { data: { version: "8.2.4", release: "8.2" } } };
		if (p === "/cluster/resources") return { json: { data: resources } };
		if (p === "/cluster/nextid") return { json: { data: "104" } };
		if (p === "/nodes/pve1/storage") return { json: { data: [{ storage: "local", type: "dir", content: "iso,backup,vztmpl", active: 1, total: 100 * GiB, avail: 60 * GiB }, { storage: "pbs", type: "pbs", content: "backup", active: 1, shared: 1, total: 2000 * GiB, avail: 1500 * GiB }] } };
		const content = /^\/nodes\/pve1\/storage\/([^/]+)\/content(?:\/(.+))?$/.exec(p);
		if (content) {
			const list = BACKUPS[content[1]!] ?? [];
			if (req.method === "DELETE") {
				const at = list.findIndex((b) => b.volid === decodeURIComponent(content[2]!));
				list.splice(at, 1);
				return started("imgdel", "");
			}
			const vmid = new URLSearchParams(req.query).get("vmid");
			return { json: { data: list.filter((b) => !vmid || String(b.vmid) === vmid).map((b) => ({ ...b, content: "backup", format: "vma.zst" })) } };
		}
		if (p === "/nodes/pve1/vzdump" && req.method === "POST") {
			BACKUPS[form.get("storage")!]!.unshift({ volid: `${form.get("storage")}:backup/vm/${form.get("vmid")}/now`, vmid: Number(form.get("vmid")), ctime: now, size: GiB });
			return started("vzdump", form.get("vmid")!);
		}
		if ((p === "/nodes/pve1/qemu" || p === "/nodes/pve1/lxc") && req.method === "POST") return started(p.endsWith("qemu") ? "qmrestore" : "vzrestore", form.get("vmid")!);
		const cl = /^\/nodes\/pve1\/(qemu|lxc)\/(\d+)\/clone$/.exec(p);
		if (cl && req.method === "POST") {
			const from = resources.find((r) => r.vmid === Number(cl[2]))!;
			resources.push({ ...from, id: `${cl[1]}/${form.get("newid")}`, vmid: Number(form.get("newid")), name: form.get("name") ?? form.get("hostname") ?? "", template: 0, status: "stopped" } as (typeof resources)[number]);
			return started(cl[1] === "qemu" ? "qmclone" : "vzclone", cl[2]!);
		}
		const mig = /^\/nodes\/pve1\/(qemu|lxc)\/(\d+)\/migrate$/.exec(p);
		if (mig && req.method === "POST") return started(mig[1] === "qemu" ? "qmigrate" : "vzmigrate", mig[2]!);
		if (p === "/nodes/pve1/qemu/100/config" && req.method === "PUT") return { json: { data: null } };
		if (p === "/cluster/status") return { json: { data: [{ type: "cluster", name: cluster, quorate: 1, nodes: 2 }, { type: "node", name: "pve1", online: 1 }, { type: "node", name: "pve2", online: 0 }] } };
		if (p === "/cluster/tasks") return { json: { data: clusterTasks } };
		if (p === "/nodes/pve1/status") return { json: { data: { cpu: 0.18, wait: 0.01, cpuinfo: { model: "AMD Ryzen 9 5950X 16-Core Processor", cpus: 32, sockets: 1 }, loadavg: ["1.20", "0.98", "0.80"], memory: { total: 64 * GiB, used: 22 * GiB }, swap: { total: 8 * GiB, used: 0 }, rootfs: { total: 100 * GiB, used: 40 * GiB }, uptime: 864000, pveversion: "pve-manager/8.2.4/faa83925c9641325", kversion: "Linux 6.8.8-2-pve #1 SMP PREEMPT_DYNAMIC" } } };
		if (p === "/nodes/pve1/rrddata" || /^\/nodes\/pve1\/(qemu|lxc)\/\d+\/rrddata$/.test(p)) return { json: { data: rrd(70) } };
		if (p === "/nodes/pve1/syslog") return { json: { data: [{ n: 1, t: "Nov 25 04:00:01 pve1 systemd[1]: Started pvesr.service." }] } };
		if (p === "/nodes/pve1/qemu/100/status/current") return { json: { data: { status: "running", qmpstatus: "running", cpus: 4, cpu: 0.42, mem: 3 * GiB, maxmem: 8 * GiB, uptime: 7200, agent: 1 } } };
		if (p === "/nodes/pve1/qemu/100/config") return { json: { data: { name: "web", cores: 4, sockets: 1, memory: "8192", ostype: "l26", scsi0: "local-lvm:vm-100-disk-0,iothread=1,size=32G", ide2: "none,media=cdrom", net0: "virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,firewall=1", agent: "1", onboot: 1, bios: "ovmf", description: "Serves **example.com**." } } };
		if (p === "/nodes/pve1/qemu/100/agent/network-get-interfaces") return { json: { data: { result: [{ name: "lo", "ip-addresses": [{ "ip-address": "127.0.0.1", "ip-address-type": "ipv4" }] }, { name: "eth0", "ip-addresses": [{ "ip-address": "192.168.1.50", "ip-address-type": "ipv4" }, { "ip-address": "fe80::1", "ip-address-type": "ipv6" }] }] } } };
		if (p === "/nodes/pve1/qemu/100/snapshot") {
			if (req.method === "POST") {
				snaps.unshift({ name: form.get("snapname")!, description: form.get("description") ?? "", snaptime: now, vmstate: form.get("vmstate") === "1" ? 1 : 0 });
				return started("qmsnapshot", "100");
			}
			return { json: { data: snaps } };
		}
		const rb = /^\/nodes\/pve1\/qemu\/100\/snapshot\/([^/]+)\/rollback$/.exec(p);
		if (rb && req.method === "POST") return started("qmrollback", "100");
		const power = /^\/nodes\/pve1\/(qemu|lxc)\/(\d+)\/status\/(start|stop|shutdown|reboot|suspend|resume)$/.exec(p);
		if (power && req.method === "POST") return started(`${power[1] === "qemu" ? "qm" : "vz"}${power[3]}`, power[2]!, power[2] === "102" ? "TASK ERROR: start failed: QEMU exited with code 1" : "OK");
		const ts = /^\/nodes\/pve1\/tasks\/([^/]+)\/(status|log)$/.exec(p);
		if (ts) {
			const u = decodeURIComponent(ts[1]!);
			const exit = tasks.get(u) ?? clusterTasks.find((x) => x.upid === u)?.status;
			if (exit === undefined) return { status: 500, body: "" };
			if (ts[2] === "status") return { json: { data: { status: "stopped", exitstatus: exit } } };
			return { json: { data: [{ n: 1, t: "task started by HA resource agent" }, { n: 2, t: exit }] } };
		}
		return { status: 501, body: "" };
	});
	return Object.assign(srv, { tasks: clusterTasks });
}

/** A server's entry, as Settings keeps it, for a test that starts connected. */
const tokenServer = (id: string, name: string, url: string) => ({ id, name, url, certificate: "", auth: "token", who: TOKEN_ID });

test("the command line: lists, shows, and runs actions to their task's end", async (t) => {
	const none = await t.run("list");
	expect(none.code).not.toBe(0);
	expect(none.stderr).toContain("Proxmox isn't connected");

	const srv = await proxmox(t);
	await t.set("servers", JSON.stringify([{ id: "s1", name: "homelab", url: srv.url, certificate: "", auth: "token", who: TOKEN_ID }]));
	await t.set("secrets", JSON.stringify({ s1: { secret: "wrong" } }));
	expect((await t.run("list")).stderr).toContain("Proxmox refused the token");
	await t.set("secrets", JSON.stringify({ s1: { secret: SECRET } }));

	const status = await t.run("status");
	expect(status.stdout).toContain("Proxmox VE 8.2.4, cluster homelab.");
	expect(status.stdout).toContain("1 of 2 nodes online; 2 of 4 VMs and containers running.");

	const list = await t.run("list", "--running");
	expect(list.stdout).toContain("100    web                    VM  Running   pve1       CPU 42%, 3.0 GiB of 8.0 GiB [prod, web]");
	expect(list.stdout).toContain("101    db");
	expect(list.stdout).not.toContain("windows");

	const show = await t.run("show", "web");
	expect(show.stdout).toContain("web (100), VM on pve1: Running, up 2h 0m");
	expect(show.stdout).toContain("Addresses: 192.168.1.50");
	expect(show.stdout).toContain("Disk (scsi0): local-lvm:vm-100-disk-0, 32G");
	expect(show.stdout).toContain("Network (net0): virtio, on vmbr0, firewall");
	expect(show.stdout).toContain("Snapshots: before-upgrade");

	// A name that's part of two asks which; a whole one doesn't.
	expect((await t.run("show", "we")).stderr).toContain("could be web (100), web-staging (103)");

	const start = await t.run("start", "103");
	expect(start.code).toBe(0);
	expect(start.stdout).toContain("web-staging (103) started.");
	expect(srv.requests.some((r) => r.method === "POST" && r.path === "/api2/json/nodes/pve1/qemu/103/status/start")).toBe(true);

	const failed = await t.run("start", "windows");
	expect(failed.code).toBe(1);
	expect(failed.stdout).toContain("Failed: TASK ERROR: start failed: QEMU exited with code 1");
	expect(failed.stdout).toContain("swarm proxmox task-log UPID:pve1:");

	const snap = await t.run("snapshot", "web", "pre-deploy", "--description", "Before the deploy");
	expect(snap.stdout).toContain("Took snapshot pre-deploy of web.");
	const sent = new URLSearchParams(srv.requests.find((r) => r.method === "POST" && r.path.endsWith("/snapshot"))!.body);
	expect(sent.get("snapname")).toBe("pre-deploy");
	expect(sent.get("description")).toBe("Before the deploy");
	expect(sent.get("vmstate")).toBeNull();
	expect((await t.run("snapshot", "web", "1bad")).stderr).toContain("isn't a snapshot's name");

	// Backups: every guest's last one, then one guest's; and one now, to Proxmox Backup Server.
	const all = await t.run("backups");
	expect(all.stdout).toContain("100    web                    last 1h ago on pbs, 2 in all");
	expect(all.stdout).toContain("102    windows                never backed up");
	const backup = await t.run("backup", "db");
	expect(backup.stdout).toContain("Backed up db to pbs.");
	const dump = new URLSearchParams(srv.requests.find((r) => r.path.endsWith("/vzdump"))!.body);
	expect([dump.get("vmid"), dump.get("storage"), dump.get("mode"), dump.get("compress")]).toEqual(["101", "pbs", "snapshot", null]);

	const clone = await t.run("clone", "debian-template", "--name", "app", "--linked");
	expect(clone.stdout).toContain("Made app (104) from debian-template.");
	const cl = new URLSearchParams(srv.requests.find((r) => r.path.endsWith("/clone"))!.body);
	expect([cl.get("newid"), cl.get("name"), cl.get("full")]).toEqual(["104", "app", "0"]);
	expect((await t.run("clone", "web", "--linked")).stderr).toContain("Only a template's clone can be linked.");

	const set = await t.run("set", "web", "--cores", "2", "--tags", "prod, api");
	expect(set.stdout).toContain("new cores and memory take hold at its next start");
	const put = new URLSearchParams(srv.requests.find((r) => r.method === "PUT")!.body);
	expect([put.get("cores"), put.get("tags"), put.get("memory")]).toEqual(["2", "prod;api", null]);

	expect((await t.run("migrate", "web", "pve2")).stdout).toContain("Moved web to pve2.");
	expect(new URLSearchParams(srv.requests.find((r) => r.path.endsWith("/migrate"))!.body).get("online")).toBe("1");

	const tasks = await t.run("tasks", "--failed");
	expect(tasks.stdout).toContain("Start 102");
	expect(tasks.stdout).not.toContain("Backup 101");
});

// The flow a user goes through, in one window: connect, the overview, a
// guest's tabs and actions, a node. A window takes some seconds.
test("the page: connect, the overview, a VM's tabs and actions, a node", async (t) => {
	const srv = await proxmox(t);
	const w = await t.window();
	await w.resize(1440, 900);
	await w.click("Proxmox");
	await w.see("Connect Proxmox");
	await w.settings("Proxmox");
	await w.click("https://pve.local:8006");
	await w.type(srv.url);
	await w.click("root@pam!swarm");
	await w.type(TOKEN_ID);
	await w.click("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
	await w.type(SECRET);
	await w.click("Connect");
	await w.see("Connected");
	await w.see(`As ${TOKEN_ID}`);
	await w.screenshot("proxmox-settings");

	await w.click("Proxmox");
	await w.see("Nodes of homelab");
	await w.see("pve2 is offline");
	await w.see("local-lvm on pve1 is 95% full");
	await w.see("/dev/sda on pve1: SMART says it's failing");
	await w.see("Busiest now");
	await w.see("Start windows");
	await w.screenshot("proxmox-overview");

	await w.click("web, Running");
	await w.see("192.168.1.50");
	await w.see("Disk I/O");
	await w.screenshot("proxmox-vm");
	await w.dark(true);
	await w.screenshot("proxmox-vm-dark");
	await w.dark(false);

	await w.click("Hardware");
	await w.see("UEFI (OVMF)");
	await w.see("local-lvm:vm-100-disk-0, 32G");
	await w.screenshot("proxmox-vm-hardware");

	// Shutting down asks first.
	await w.click("Shut down");
	await w.see("Keep it running");
	expect(srv.requests.some((r) => r.path.endsWith("/status/shutdown"))).toBe(false);
	await w.screenshot("proxmox-shutdown");
	await w.click("Keep it running");

	await w.click("Snapshots");
	await w.see("before-upgrade");
	await w.click("Take snapshot");
	await w.click("Its name: pre-upgrade");
	await w.type("pre-deploy");
	await w.screenshot("proxmox-snapshot");
	await w.click("Take snapshot");
	await w.see("Took snapshot pre-deploy of web.");
	await w.see("pre-deploy");

	// The Backups view: who's never been backed up; a guest from it opens on its backups.
	await w.click("Backups");
	await w.see("2 never backed up, 1 not in the last week.");
	await w.screenshot("proxmox-backups");
	await w.click("web, last backed up 1h ago");
	await w.see("Verified");

	// Back up now to the storage it picks, then restore one as a new guest.
	await w.click("Back up now");
	await w.see("Snapshot: it keeps running");
	await w.screenshot("proxmox-backup");
	await w.click("Back up now");
	await w.see("Backed up web to pbs.");
	await w.click(`Act on the backup of ${new Date((now - 86400) * 1000).toLocaleString()}`);
	await w.click("Restore…");
	await w.see("A copy of web as it was then, beside it, with new MAC addresses.");
	await w.screenshot("proxmox-restore");
	await w.click("Over web");
	await w.see("web is running: shut it down first.");
	await w.click("Cancel");

	// Its settings, from Hardware.
	await w.click("Hardware");
	await w.click("Edit name, cores, memory and tags");
	await w.click("Start it when its node starts");
	await w.screenshot("proxmox-edit");
	await w.click("Save");
	await w.see("Saved web.");
	expect(new URLSearchParams(srv.requests.find((r) => r.method === "PUT")!.body).get("onboot")).toBe("0");

	// Templates apart from the guests that run; a new guest from one.
	await w.click("VMs & containers");
	await w.click("Templates");
	await t.until(async () => !(await w.has("windows")), { what: "the templates alone" });
	await w.click("debian-template, Template");
	await w.click("New guest from it");
	await w.see("New guest from debian-template");
	await w.screenshot("proxmox-clone");
	await w.click("Create");
	await w.see("Created debian-template-clone (104).");
	// The new guest opens, stopped: the template's pane has no Start.
	await w.see("Start");
	await w.see("debian-template-clone");

	await w.click("Storage");
	await w.see("lvmthin");
	await w.screenshot("proxmox-storage");

	await w.click("pve1");
	await w.see("AMD Ryzen 9 5950X 16-Core Processor, 32 threads");
	await w.see("8.2.4/faa83925c9641325");
	await w.screenshot("proxmox-node");

	await w.click("Tasks");
	await w.see("Backup db");
	await w.click("Start windows, Failed");
	await w.see("task started by HA resource agent");
	await w.screenshot("proxmox-tasks");

	const log = (await t.log()).join("\n");
	expect(log).not.toMatch(/error|threw/i);
});

// A second server signed in with a password and a TOTP code, the sidebar
// switching between them, a node's disks and their SMART, and a
// container's console opened in Swarm's terminal.
test("several servers, a password with a second factor, disks and a console", async (t) => {
	const home = await proxmox(t);
	const lab = await proxmox(t, "lab");
	await t.set("servers", JSON.stringify([tokenServer("s1", "homelab", home.url)]));
	await t.set("secrets", JSON.stringify({ s1: { secret: SECRET } }));
	const w = await t.window();
	await w.resize(1440, 900);
	await w.settings("Proxmox");
	await w.click("Add server");
	await w.click("https://pve.local:8006");
	await w.type(lab.url);
	await w.click("Name");
	await w.click(new URL(lab.url).hostname);
	await w.type("lab");
	await w.click("Password");
	await w.click("root@pam");
	await w.type(USER);
	await w.click("Its password");
	await w.type(PASSWORD);
	await w.click("Connect");
	await w.see("From your authenticator app: Proxmox asks for a second factor.");
	await w.click("123456");
	await w.type(CODE);
	await w.screenshot("proxmox-totp");
	await w.click("Connect");
	await w.see("Connected to lab, Proxmox VE 8.2.4.");
	await w.see("As admin@pve, with its password");
	await w.screenshot("proxmox-servers");
	// What it asked after signing in went with the ticket, and a change with its CSRF token too.
	expect(lab.requests.some((r) => r.path === "/api2/json/cluster/resources" && (r.headers["cookie"] ?? "").includes("PVEAuthCookie="))).toBe(true);

	// The new one shows; the sidebar switches back.
	await w.click("Proxmox");
	await w.see("Nodes of lab");
	await w.click("homelab");
	await w.see("Nodes of homelab");
	await w.screenshot("proxmox-switch");

	// A node's disks: a failing one, and its SMART.
	await w.click("pve1");
	await w.see("Load average");
	await w.click("Disks");
	await w.see("Failing");
	await w.see("3% worn");
	await w.click("/dev/sda, Failing");
	await w.see("Reallocated Sector Ct");
	await w.screenshot("proxmox-disks");

	// A container's console: Proxmox's proxy, then Swarm's terminal.
	await w.click("VMs & containers");
	await w.click("db, Running");
	await w.click("Console");
	await t.until(() => home.requests.some((r) => r.method === "POST" && r.path === "/api2/json/nodes/pve1/lxc/101/termproxy"), { what: "the console's proxy" });
	// Here no WebSocket answers (console.test.ts has the protocol): why shows, and its terminal goes.
	await w.see("The console didn't connect");
	await w.screenshot("proxmox-console");

	// The command line takes either server.
	expect((await t.run("status", "--server", "lab")).stdout).toContain("cluster lab.");
	expect((await t.run("servers")).stdout).toMatch(/\* homelab .*\n {2}lab /);
});

// Every server's backups are watched, the page open or not: a failure
// since the last look is a toast, once; none from before is.
test("a failed backup on any server is a toast", async (t) => {
	const clock = await t.clock();
	const home = await proxmox(t);
	home.tasks.push({ upid: upid("vzdump", "102", 40), node: "pve1", type: "vzdump", id: "102", user: "root@pam", starttime: now - 7200, endtime: now - 7000, status: "TASK ERROR: an old failure" });
	await t.set("servers", JSON.stringify([tokenServer("s1", "homelab", home.url)]));
	await t.set("secrets", JSON.stringify({ s1: { secret: SECRET } }));
	const w = await t.window();
	await clock.advance(3 * 60_000);
	await t.idle();
	home.tasks.push({ upid: upid("vzdump", "101", 41), node: "pve1", type: "vzdump", id: "101", user: "root@pam", starttime: now + 60, endtime: now + 120, status: "TASK ERROR: job failed with err -5 - Input/output error" });
	await clock.advance(3 * 60_000);
	await w.see("A backup of 101 on homelab failed: job failed with err -5 - Input/output error.");
	expect(await w.has("an old failure")).toBe(false);
});

// Back after its ticket lapsed (Swarm closed past two hours), a server
// with a second factor asks for a code where the page is, and carries on.
test("a lapsed sign-in asks for a code on the page", async (t) => {
	const lab = await proxmox(t, "lab");
	await t.set("servers", JSON.stringify([{ id: "s2", name: "lab", url: lab.url, certificate: "", auth: "password", who: USER }]));
	await t.set("secrets", JSON.stringify({ s2: { secret: PASSWORD, ticket: "PVE:lapsed", csrf: "old", at: Date.now() - 3 * 3600_000 } }));
	const w = await t.window();
	await w.click("Proxmox");
	await w.see("Sign in to lab again");
	await w.click("123456");
	await w.type(CODE);
	await w.screenshot("proxmox-signin-again");
	await w.click("Sign in");
	await w.see("Nodes of lab");
	// Its new ticket is kept, not asked for again.
	expect((await t.run("status")).stdout).toContain("cluster lab.");
});
