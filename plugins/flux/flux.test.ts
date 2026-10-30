import { expect, test, type Request, type T } from "swarm/test";
import manifest from "./plugin.json";

// A Flux of the test's: its sync API over items with versions, as Flux's
// backend has it (pull since a version, atomic pushes refused on a stale
// base version), its documents' seeds and an asset.
const ME = { id: "u1", username: "ada", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null, avatarColor: "blue" };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const ASSET = "0192f0e4-0000-7000-8000-0000000000aa";

interface Stored {
	id: string;
	version: number;
	deleted: boolean;
	createdAt: string;
	updatedAt: string;
	body: Record<string, unknown> | null;
}

async function flux(t: T, opts: { conflictOnce?: boolean; subIssue?: boolean; demo?: boolean; unset?: boolean; workspace?: string; many?: number; long?: boolean; marks?: boolean; rich?: boolean; hold?: boolean; talk?: boolean; crowd?: boolean; long_name?: boolean } = {}) {
	let version = 0;
	const items = new Map<string, Stored>();
	const put = (id: string, body: Record<string, unknown> | null) => {
		version++;
		const had = items.get(id);
		const at = new Date(Date.UTC(2026, 9, 24, 12, 0, version)).toISOString();
		items.set(id, { id, version, deleted: body === null, createdAt: had?.createdAt ?? at, updatedAt: at, body });
	};
	put("p1", { type: "project", key: "ABC", name: "Alpha", mark: { type: "emoji", value: "🚀", color: "blue" }, position: 0, nextNumber: opts.subIssue ? 4 : 3 });
	put("l1", { type: "label", name: "Bug", color: "red" });
	put("i1", { type: "issue", projectId: "p1", number: 1, title: "Fix the login redirect", description: `<p>It loops. <img src="/assets/${ASSET}" alt="loop"></p>`, status: "todo", priority: "high", assigneeIds: ["u1"], labelIds: ["l1"], subscriberIds: ["u1"], creatorId: "u1", dueDate: null, parentId: null, position: 0 });
	put("i2", { type: "issue", projectId: "p1", number: 2, title: "Write the docs", description: "", status: "backlog", priority: "none", assigneeIds: [], labelIds: [], subscriberIds: [], creatorId: "u1", dueDate: null, parentId: null, position: 1 });
	if (opts.subIssue) put("i3", { type: "issue", projectId: "p1", number: 3, title: "Keep the redirect's query", description: "", status: "progress", priority: "medium", assigneeIds: ["u2"], labelIds: [], subscriberIds: [], creatorId: "u1", dueDate: null, parentId: "i1", position: 2 });
	if (opts.demo) {
		put("p2", { type: "project", key: "SWARM", name: "Swarm", mark: { type: "emoji", value: "🐝", color: "amber" }, position: 1, nextNumber: 20 });
		put("l2", { type: "label", name: "Feature", color: "blue" });
		const issue = (id: string, projectId: string, number: number, title: string, status: string, priority: string, assignees: string[], labels: string[], parentId: string | null) =>
			put(id, { type: "issue", projectId, number, title, description: "", status, priority, assigneeIds: assignees, labelIds: labels, subscriberIds: assignees, creatorId: "u1", dueDate: null, parentId, position: number });
		issue("s12", "p2", 12, "Pages fill the content area", "todo", "high", ["u1"], ["l2"], null);
		issue("s18", "p2", 18, "Drag a card between columns", "progress", "urgent", ["u1"], ["l1"], null);
		issue("s7", "p2", 7, "Follow the event stream", "review", "medium", ["u2"], [], null);
		issue("s3", "p2", 3, "Start an agent from the issue", "backlog", "low", [], [], null);
		issue("s21", "p2", 21, "Sub-issues stay with their parent", "progress", "medium", ["u1"], [], "s18");
		issue("s30", "p2", 30, "Display options stick", "todo", "none", ["u2"], ["l2"], null);
	}
	const statuses = ["backlog", "todo", "progress", "review", "complete"];
	for (let n = 0; n < (opts.many ?? 0); n++) {
		put(`m${n}`, { type: "issue", projectId: "p1", number: 100 + n, title: `Issue number ${n}`, description: `<p>${"A long description. ".repeat(1000)}</p>`, status: statuses[n % 5], priority: "medium", assigneeIds: ["u1"], labelIds: ["l1"], subscriberIds: ["u1"], creatorId: "u1", dueDate: null, parentId: null, position: 10 + n });
	}
	if (opts.long) {
		const paragraphs = Array.from({ length: 30 }, (_, i) => `<p>Step ${i + 1} of the plan, written out at some length so the page scrolls.</p>`).join("");
		put("g1", { type: "issue", projectId: "p1", number: 7, title: "Write it all down", description: paragraphs, status: "todo", priority: "none", assigneeIds: [], labelIds: [], subscriberIds: [], creatorId: "u1", dueDate: null, parentId: null, position: 70 });
	}
	// crowd: a workspace of 30 labels and 10 members, and 300 issues in one
	// column, each with a few of each, whose every card has its menus.
	const crew = opts.crowd ? Array.from({ length: 8 }, (_, n) => ({ ...ME, id: `u${n + 3}`, username: `crew${n}`, name: `Crew ${n}`, email: `crew${n}@example.com`, avatarColor: "green" })) : [];
	if (opts.crowd) {
		for (let n = 0; n < 30; n++) put(`lc${n}`, { type: "label", name: `Label ${n}`, color: ["red", "blue", "green", "purple", "yellow"][n % 5] });
		for (let n = 0; n < 300; n++) {
			put(`k${n}`, { type: "issue", projectId: "p1", number: 200 + n, title: `Crowded issue ${n}`, description: "", status: "todo", priority: "low", assigneeIds: ["u1", "u2", `u${3 + (n % 8)}`], labelIds: [0, 7, 14, 21].map((k) => `lc${(n + k) % 30}`), subscriberIds: [], creatorId: "u1", dueDate: null, parentId: null, position: 100 + n });
		}
	}
	if (opts.long_name) {
		put("p6", { type: "project", key: "CON", name: "Conduish desktop", mark: { type: "icon", value: "console", color: "green" }, position: 5, nextNumber: 2 });
		put("cd1", { type: "issue", projectId: "p6", number: 1, title: "Its window remembers its size", description: "", status: "todo", priority: "medium", assigneeIds: ["u1"], labelIds: [], subscriberIds: [], creatorId: "u1", dueDate: null, parentId: null, position: 80 });
	}
	if (opts.marks) {
		// A project with no emoji or icon: its key's letter on its color.
		put("p3", { type: "project", key: "NUD", name: "Nudge", mark: { type: "color", color: "green" }, position: 2, nextNumber: 2 });
		// A project with one of Swarm's icons, in its color, and one with an emoji of Twemoji's.
		put("p4", { type: "project", key: "BOT", name: "Robots", mark: { type: "icon", value: "robot", color: "purple" }, position: 3, nextNumber: 2 });
		put("p5", { type: "project", key: "FOX", name: "Foxes", mark: { type: "emoji", value: "🦊", color: "amber" }, position: 4, nextNumber: 2 });
		put("b1", { type: "issue", projectId: "p4", number: 1, title: "Robots have their color", description: "", status: "progress", priority: "low", assigneeIds: ["u1", "u2"], labelIds: [], subscriberIds: [], creatorId: "u1", dueDate: null, parentId: null, position: 51 });
		put("f1", { type: "issue", projectId: "p5", number: 1, title: "A fox, as Twemoji draws it", description: "", status: "backlog", priority: "none", assigneeIds: [], labelIds: [], subscriberIds: [], creatorId: "u1", dueDate: null, parentId: null, position: 52 });
		put("n1", { type: "issue", projectId: "p3", number: 1, title: "Bob's picture shows", description: "", status: "todo", priority: "urgent", assigneeIds: ["u2"], labelIds: ["l1"], subscriberIds: [], creatorId: "u1", dueDate: null, parentId: null, position: 50 });
	}
	if (opts.rich) {
		put("r1", { type: "issue", projectId: "p1", number: 9, title: "Plan the release", description: '<p>Before we ship:</p><table><tbody><tr><th><p>Step</p></th><th><p>Owner</p></th></tr><tr><td><p>Notes</p></td><td><p>Ada</p></td></tr></tbody></table><div data-type="callout" data-mark=\'{"type":"emoji","value":"💡"}\'><p>Freeze on Friday.</p></div><hr><p>The end.</p>', status: "todo", priority: "none", assigneeIds: [], labelIds: [], subscriberIds: [], creatorId: "u1", dueDate: null, parentId: null, position: 60 });
	}
	put("c1", { type: "comment", issueId: "i1", authorId: "u1", body: "<p>Seen on Safari too: <code>?next=</code> is dropped.</p>" });
	if (opts.talk) {
		// A comment that mentions a member and a project, shows a picture, and was edited; and an agent's.
		const said = `<p><span data-type="mention" class="mention" data-id="u2" data-label="bob">@bob</span> can you check <span data-type="mention" class="mention" data-id="p1" data-label="ABC">@ABC</span>?</p><p><img src="/assets/${ASSET}" alt="the loop"></p>`;
		put("c2", { type: "comment", issueId: "i1", authorId: "u1", body: said.replace("check", "look at") });
		put("l9", { type: "label", name: "Later", color: "gray" });
		put("c2", { type: "comment", issueId: "i1", authorId: "u1", body: said });
		put("c3", { type: "comment", issueId: "i1", authorId: "u1", body: "<p>Plan settled.</p>", agent: { name: "Claude Code", provider: "claude-code", threadId: "th_gone" } });
	}
	let conflict = !!opts.conflictOnce;
	const docs = new Set<string>();
	// down: Flux's proxy answering 503, as when Flux is away.
	const away = { down: false };
	// hold: the first pull waits for release(), as a first sync of a big workspace does.
	const held = { release: () => {} };
	const pulled = opts.hold ? new Promise<void>((done) => { held.release = done; }) : Promise.resolve();
	const srv = await t.server((req: Request) => {
		if (away.down) return { status: 503, json: { message: "Service Unavailable" } };
		if (req.headers["authorization"] !== "Bearer tok") return { status: 401, json: { message: "no" } };
		const path = req.path;
		if (path === "/user") return { json: ME };
		if (path === "/workspace") return { json: { id: opts.workspace ? "w-" + opts.workspace.toLowerCase() : "w1", name: opts.workspace ?? "Coldspire", slug: (opts.workspace ?? "coldspire").toLowerCase(), color: "indigo", latestVersion: version } };
		if (path === "/workspace/members") return { json: { members: [ME, { ...ME, id: "u2", username: "bob", name: "Bob", email: "bob@example.com", avatarUrl: opts.marks ? `/assets/${ASSET}` : null }, ...crew] } };
		if (path.startsWith("/sync/pull/")) {
			// Pages of the limit asked, as Flux's (200 when none, 1000 at most).
			const since = Number(path.split("/").pop());
			const limit = Math.min(Number(new URLSearchParams(req.query).get("limit") ?? 200) || 200, 1000);
			const newer = [...items.values()].filter((i) => i.version > since).sort((a, b) => a.version - b.version);
			const out = newer.slice(0, limit);
			const reply = { json: { items: out, nextVersion: out.length ? out[out.length - 1]!.version : Math.max(since, 0), hasMore: newer.length > limit, latestVersion: version } };
			return opts.hold ? pulled.then(() => reply) : reply;
		}
		if (path === "/sync/push" && req.method === "POST") {
			const { ops } = req.json() as { ops: { id: string; type: string; itemId: string; baseVersion: number; body?: Record<string, unknown> }[] };
			if (conflict) {
				conflict = false;
				// Someone else changed the first item meanwhile.
				const first = items.get(ops[0]!.itemId);
				if (first) put(first.id, { ...first.body! });
				return { status: 409, json: { code: "sync_conflict", message: "stale" } };
			}
			for (const op of ops) {
				const had = items.get(op.itemId);
				if ((had ? had.version : -1) !== op.baseVersion) return { status: 409, json: { code: "sync_conflict", message: "stale" } };
			}
			const applied = ops.map((op) => {
				put(op.itemId, op.type === "delete" ? null : op.body!);
				return { opId: op.id, itemId: op.itemId, version: version };
			});
			return { json: { applied, latestVersion: version } };
		}
		if (path.startsWith("/sync/docs/") && req.method === "PUT") {
			const id = path.split("/").pop()!;
			const created = !docs.has(id);
			docs.add(id);
			return { json: { created, update: (req.json() as { update: string }).update } };
		}
		if (path === `/assets/${ASSET}`) return { headers: { "content-type": "image/png" }, base64: PNG };
		return { status: 404, json: { message: "Not found" } };
	});
	const pushes = () => srv.requests.filter((r) => r.path === "/sync/push").map((r) => r.json().ops);
	if (!opts.unset) {
		await t.set("url", srv.url);
		await t.set("token", "tok");
		if (!opts.hold) await t.until(async () => (await t.run("status")).stdout.includes("Flux: ready"), { what: "Flux ready" });
	}
	return { srv, items, pushes, away, put, held };
}

test("not set up, it says so", async (t) => {
	const out = await t.run("status");
	expect(out.stdout).toContain("Flux: unconfigured — Set Flux's URL");
	expect((await t.run("list")).stderr).toContain("Set Flux's URL and an API token in Settings, Plugins, Flux");
	// Its panel says what to set, once.
	const th = await t.thread("say Hello.");
	await th.idle();
	const w = await t.window();
	await w.panel(th, "flux");
	await w.see("Set Flux's URL and an API token (Flux: Settings, API tokens) in Settings, Plugins, Flux.");
	expect((await w.texts()).filter((s) => s.includes("Set Flux's URL")).length).toBe(1);
	// Its page asks for them in the fields there, not in Settings.
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.see("Connect Flux");
	await w.see("Make one in Flux, under");
	expect(await w.has("Set Flux's URL in Settings, Plugins, Flux.")).toBe(false);
	await w.screenshot("flux-setup");
	await w.dark(true);
	await w.screenshot("flux-setup-dark");
	await w.resize(760, 800);
	await w.screenshot("flux-setup-narrow-dark");
	await w.dark(false);
});

test("the page's Connect tries the token, then keeps it", async (t) => {
	const { srv } = await flux(t, { unset: true });
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.see("Connect Flux");
	await w.click("https://flux.example.com");
	await w.type(srv.url);
	await w.click("flux_…");
	await w.type("wrong");
	await w.click("Connect");
	// Flux refused it: it says so where it was typed, and keeps nothing.
	await w.see("Flux rejected the API token. Create a new one in Flux under Settings → API tokens.");
	expect((await t.run("status")).stdout).toContain("Flux: unconfigured");
	await w.screenshot("flux-setup-refused");
	await w.click("Flux rejected the API token. Create a new one in Flux under Settings → API tokens.");
	await w.click("flux_…");
	await w.key("Mod+A");
	await w.type("tok");
	await w.key("Enter");
	await t.until(async () => (await t.run("status")).stdout.includes("Flux: ready"), { what: "Flux ready" });
	await w.see("Fix the login redirect");
	expect((await t.run("status")).stdout).toContain(srv.url);
	// The token was typed as dots.
	expect(await w.has("tok")).toBe(false);
});

test("Flux's page of Settings connects, adds another, switches and disconnects", async (t) => {
	const first = await flux(t, { unset: true });
	const second = await flux(t, { unset: true, workspace: "Syntad" });
	const w = await t.window();
	await w.resize(1280, 900);
	// Swarm's own form draws none of the settings the page keeps.
	await w.settings("Plugins");
	// Its row, by its version, as the plugin is named in the sidebar too.
	await w.click(manifest.version);
	await w.see("Its page of Settings");
	expect(await w.has("Flux URL for Flux")).toBe(false);
	expect(await w.has("More Fluxes for Flux")).toBe(false);
	await w.click("Open Flux");
	await w.see("Connect Flux");
	await w.screenshot("flux-settings-empty");
	await w.click("https://flux.example.com");
	await w.type(first.srv.url);
	await w.click("flux_…");
	await w.type("tok");
	await w.click("Connect");
	await w.see("Connected to Coldspire");
	const host = first.srv.url.replace(/^https?:\/\//, "");
	await w.see(`Ada Lovelace · ${host} · 2 issues synced`);
	await w.see("Where agents work");
	await w.see("Alpha");
	await w.screenshot("flux-settings");
	await w.dark(true);
	await w.screenshot("flux-settings-dark");
	await w.dark(false);

	// Another Flux, which is then the active one.
	await w.click("Add another Flux");
	await w.click("https://flux.example.com");
	await w.type(second.srv.url);
	await w.click("flux_…");
	await w.type("tok");
	await w.click("Connect");
	await w.see("Connected to Syntad");
	await w.see("Active");
	await t.until(async () => (await t.run("status")).stdout.includes("Workspace: Syntad"), { what: "Syntad active" });
	await w.screenshot("flux-settings-two");
	// The same Flux twice is refused.
	await w.click("Add another Flux");
	await w.click("https://flux.example.com");
	await w.type(first.srv.url);
	await w.click("flux_…");
	await w.type("tok");
	await w.click("Connect");
	await w.see(`Coldspire at ${first.srv.url} is connected already: change its token there.`);
	await w.click("Cancel");
	// Use switches back.
	await w.click("Use");
	await t.until(async () => (await t.run("status")).stdout.includes("Workspace: Coldspire"), { what: "Coldspire active" });
	// The cards redrawn: Active on Coldspire's, Use on Syntad's, so Resync is where it's shown.
	await t.until(async () => {
		const texts = await w.texts();
		return texts.indexOf("Active") > texts.indexOf("Connected to Coldspire") && texts.indexOf("Active") < texts.indexOf("Connected to Syntad");
	}, { what: "Coldspire's card active" });

	// Resync pulls everything again.
	const pulls = () => first.srv.requests.filter((r) => r.path === "/sync/pull/-1").length;
	const before = pulls();
	await w.click("Resync");
	await t.until(() => pulls() > before, { what: "a pull from the start" });
	await w.see("Connected to Coldspire");

	// Disconnecting the first leaves Syntad, the first now, and forgets the token.
	await w.click(`Disconnect ${host}`);
	await w.gone(`Disconnect ${host}`);
	await t.until(async () => (await t.run("status")).stdout.includes("Workspace: Syntad"), { what: "Syntad, the first now" });
	await w.see("Connected to Syntad");
	expect((await t.run("status")).stdout).toContain(second.srv.url);
	await w.click(`Disconnect ${second.srv.url.replace(/^https?:\/\//, "")}`);
	await w.see("Connect Flux");
	expect((await t.run("status")).stdout).toContain("Flux: unconfigured");
});

test("Where agents work links a Flux project to a Swarm project", async (t) => {
	await flux(t);
	const [project] = await t.call("Projects", {});
	const w = await t.window();
	await w.resize(1280, 900);
	// The board's Flux menu opens its page of Settings.
	await w.click("Flux");
	await w.see("Fix the login redirect");
	// Which Flux is beside its name in the sidebar.
	await w.click("Workspace: Coldspire");
	await w.click("Flux settings…");
	await w.see("Where agents work");
	await w.click("Swarm project for Alpha: Not linked");
	await w.click(project!.name);
	await w.see(`Swarm project for Alpha: ${project!.name}`);
	expect((await t.run("projects")).stdout).toContain(`→ ${project!.id}`);
	await w.screenshot("flux-settings-linked");
	await w.click(`Swarm project for Alpha: ${project!.name}`);
	await w.click("Not linked");
	await w.see("Swarm project for Alpha: Not linked");
});

test("a refused token is fixed on the page", async (t) => {
	const { srv } = await flux(t, { unset: true });
	await t.set("url", srv.url);
	await t.set("token", "old");
	const w = await t.window();
	await w.resize(1280, 900);
	await w.settings("Flux");
	await w.see(`${srv.url.replace(/^https?:\/\//, "")} needs a new API token`);
	await w.screenshot("flux-settings-refused");
	await w.click("flux_…");
	await w.type("tok");
	await w.key("Enter");
	await w.see("Connected to Coldspire");
	// Swarm told it the URL and the token together: it never tried the old token with the new URL again.
	expect(srv.requests.filter((r) => r.path === "/user" && r.headers["authorization"] === "Bearer old").length).toBe(1);
	// Following Flux's events, as a Flux set up from the start does.
	await t.until(() => srv.requests.some((r) => r.path === "/sync/events"), { what: "the event stream" });
});

test("what Flux answers that it can't read is said in a line, and logged", async (t) => {
	let user: "ok" | "visitor" = "ok";
	const srv = await t.server((req: Request) => {
		if (req.path === "/user") return user === "ok" ? { json: ME } : { status: 204 };
		if (req.path === "/workspace") return { headers: { "content-type": "text/html" }, body: "<!doctype html><html><body>Flux</body></html>" };
		return { status: 404, json: { message: "Not found" } };
	});
	await t.set("url", srv.url);
	await t.set("token", "tok");
	const said = `${srv.url} answered GET /workspace with a web page, not Flux's API. Check the Flux URL: the address you open Flux at.`;
	await t.until(async () => (await t.run("status")).stdout.includes(said), { what: "the web page said" });
	expect((await t.log(20)).some((line) => line.includes(said))).toBe(true);
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.see("Can't load Flux");
	await w.see(said);
	expect(await w.has("No issues assigned to you")).toBe(false);
	await w.screenshot("flux-unreadable");
	await w.click("Flux settings");
	await w.see(`Can't connect to ${srv.url.replace(/^https?:\/\//, "")}`);
	// A token Flux doesn't know as one gets a 204 from GET /user: refused.
	user = "visitor";
	await t.set("token", "flux_unknown");
	await t.until(async () => (await t.run("status")).stdout.includes("Flux: unauthorized"), { what: "refused" });
});

test("an empty board shows Flux's art", async (t) => {
	await flux(t);
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("Active");
	await w.see("Nothing in progress");
	await w.screenshot("flux-empty");
	// The project menu's trigger keeps the ghost's background while it's open.
	await w.click("Project: All projects");
	await w.see("Alpha");
	await w.screenshot("flux-project-menu-open");
	await w.dark(true);
	await w.screenshot("flux-project-menu-open-dark");
	await w.dark(false);
	await w.key("Escape");
	await w.dark(true);
	await w.screenshot("flux-empty-dark");
	await w.dark(false);
});

test("the first sync shows the board's shape, shimmering, then the board", async (t) => {
	const { held } = await flux(t, { demo: true, hold: true });
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.see("Loading Flux…");
	await w.screenshot("flux-loading");
	await w.dark(true);
	await w.screenshot("flux-loading-dark");
	await w.dark(false);
	// The list's shape, chosen while it comes.
	await w.click("Display");
	await w.see("Show completed issues");
	await w.click("List");
	await w.click("Display");
	await w.gone("Show completed issues");
	await w.screenshot("flux-loading-list");
	held.release();
	await w.see("Fix the login redirect");
	await w.gone("Loading Flux…");
});

test("sub-issues are filed in place, one per Enter, as Flux's", async (t) => {
	const { items } = await flux(t);
	const w = await t.window();
	await w.resize(1280, 1000);
	await w.click("Flux");
	await w.click("All issues");
	await w.click("Fix the login redirect");
	await w.click("Add sub-issues");
	await w.see("Sub-issue title");
	// Flux's defaults: Todo, the parent's priority, its assignees when you're one.
	await w.see("Status: Todo");
	await w.see("Priority: High");
	await w.see("Assignees: Ada Lovelace");
	await w.type("Reproduce on Safari");
	await w.key("Enter");
	await w.see("Reproduce on Safari");
	await w.type("Write the fix");
	await w.screenshot("flux-sub-composer");
	await w.dark(true);
	await w.screenshot("flux-sub-composer-dark");
	await w.dark(false);
	await w.key("Mod+Shift+Enter");
	await w.gone("Sub-issue title");
	await w.see("Write the fix");
	const subs = () => [...items.values()].filter((i) => i.body?.parentId === "i1");
	await t.until(() => subs().length === 2, { what: "two sub-issues pushed" });
	expect(subs().map((i) => i.body!.title).sort()).toEqual(["Reproduce on Safari", "Write the fix"]);
	expect(subs().every((i) => i.body!.priority === "high" && (i.body!.assigneeIds as string[]).includes("u1"))).toBe(true);
	await w.see("0/2");
	// ⌘⇧O opens it again; Escape closes it.
	await w.click("Activity");
	await w.key("Mod+Shift+O");
	await w.see("Sub-issue title");
	await w.key("Escape");
	await w.gone("Sub-issue title");
	// Its display: ordering, and what each row shows.
	await w.click("Sub-issue display options");
	await w.see("Display properties");
	await w.screenshot("flux-subs-display");
	await w.click("ID");
	await w.gone("Display properties");
	await t.sleep(300);
	await w.screenshot("flux-subs");
});

test("comments as Flux's: mentions, pictures, agents, Edited, times", async (t) => {
	await flux(t, { talk: true });
	const w = await t.window();
	await w.resize(1280, 1400);
	await w.click("Flux");
	await w.click("All issues");
	await w.click("Fix the login redirect");
	await w.see("Plan settled.");
	await w.see(" · Edited");
	await w.see("Claude Code");
	await w.see(" for Ada Lovelace");
	await w.see("@bob");
	// The picture is Flux's, read with the token, not a broken link.
	await w.see("the loop");
	await t.sleep(400);
	await w.screenshot("flux-comments");
	await w.dark(true);
	await w.screenshot("flux-comments-dark");
	await w.dark(false);
	// A project's chip opens it.
	await w.click("@ABC");
	await w.see("Write the docs");
});

test("a big workspace syncs, is kept on disk, and draws", async (t) => {
	await flux(t, { many: 500 });
	expect((await t.run("status")).stdout).toContain("Issues synced: 502");
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.see("Issue number 0");
	await w.screenshot("flux-big");
	const texts = (await w.texts()).join("\n");
	expect(texts).not.toContain("its recording is");
	expect(texts).not.toContain("out of memory");
	// Ordered by hand, a card dragged to a column's foot scrolls it.
	await w.click("Display");
	await w.see("Show completed issues");
	await w.click("Ordering: Priority");
	await w.see("Last created");
	await w.click("Manual");
	await w.see("Ordering: Manual");
	await w.click("Display");
	await w.gone("Show completed issues");
	await w.drag("Issue number 0", "Issue number 20", { place: "below", shot: "flux-drag-scroll" });
	await w.see("Issue number 60");
	// Started again, it has its copy before Flux answers.
	await t.reload();
	await t.until(async () => (await t.run("status")).stdout.includes("Issues synced: 502"), { what: "the copy kept" });
}, { timeout: 120_000 });

test("a column of 300 cards, of 30 labels and 10 members, draws: their menus' items come as one opens", async (t) => {
	const { items } = await flux(t, { crowd: true });
	expect((await t.run("status")).stdout).toContain("Issues synced: 302");
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	// Every issue, the unassigned too: the board laid out as it stays.
	await w.see("Write the docs");
	await w.see("Crowded issue 0");
	const texts = (await w.texts()).join("\n");
	expect(texts).not.toContain("couldn't draw");
	expect(texts).not.toContain("Its rows are");
	expect(texts).not.toContain("its recording is");
	expect((await t.log(200)).join("\n")).not.toContain("Its list's rows");
	await w.screenshot("flux-crowd");
	// The issues' labels: a card's chips name them too, so what's chosen
	// is told by what's pushed.
	const labels = () => JSON.stringify([...items.values()].filter((i) => i.body?.type === "issue").map((i) => i.body!.labelIds));
	let was = labels();
	// A card's label chip: its menu, every label, as it opens.
	await w.click("Labels: Label 7");
	await w.see("New label…");
	await w.screenshot("flux-crowd-labels");
	await w.key("Down");
	await w.key("Enter");
	await t.until(() => labels() !== was, { what: "a label pushed" });
	// Its assignees, each with their mark, and their handle under their name.
	await w.click("Assignees: Ada Lovelace, Bob, Crew 0");
	await w.see("@crew7");
	await w.screenshot("flux-crowd-assignees");
	await w.key("Escape");
	await w.gone("@crew7");
	// Its right-click menu, and a submenu in it.
	was = labels();
	// On its key: the card's middle is its chips', each a menu of its own.
	await w.rightClick("ABC-201");
	await w.see("Set parent");
	await w.click("Labels");
	await w.see("Back");
	// No card in view has it: the menu's item, not a chip.
	await w.see("Label 29");
	await w.screenshot("flux-crowd-context-labels");
	await w.click("Label 29");
	await t.until(() => labels() !== was, { what: "a label pushed from the right-click menu" });
	expect((await w.texts()).join("\n")).not.toContain("couldn't draw");
}, { timeout: 120_000 });

test("marks, avatars and menus' icons, as Flux draws them", async (t) => {
	const { srv } = await flux(t, { marks: true });
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.see("Bob's picture shows");
	await w.see("Nudge");
	// Bob's picture is Flux's, read with the token.
	await t.until(() => srv.requests.some((r) => r.path === `/assets/${ASSET}` && r.headers["authorization"] === "Bearer tok"), { what: "Bob's avatar read" });
	await w.screenshot("flux-marks");
	await w.dark(true);
	await w.screenshot("flux-marks-dark");
	await w.dark(false);
	// The sidebar and the project picker show each project's mark: Robots' icon in purple, the fox as Twemoji's.
	await w.click("Project: All projects");
	await w.see("Foxes");
	await t.sleep(300);
	await w.screenshot("flux-project-menu");
	await w.key("Escape");
	await w.click("Bob's picture shows");
	await w.see("Properties");
	await w.click("Status: Todo");
	await w.see("In Review");
	await t.sleep(300);
	await w.resize(1280, 800);
	await w.screenshot("flux-status-menu");
	await w.key("Escape");
	await w.click("Priority: Urgent");
	await w.see("Medium");
	await w.screenshot("flux-priority-menu");
	await w.key("Escape");
	// Members show their pictures, where they have one.
	await w.click("Assignees: Bob");
	await w.see("@bob");
	await t.sleep(300);
	await w.screenshot("flux-assignee-menu");
	await w.key("Escape");
});

test("the description's / menu is Flux's, a popover at the caret", async (t) => {
	const { srv } = await flux(t);
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.click("Write the docs");
	await w.click("Description");
	await w.type("/");
	await w.see("Insert a block");
	await w.see("Track tasks with checkboxes");
	// A popover: the page under it stays where it was.
	await w.see("Add sub-issues");
	await w.screenshot("flux-slash");
	await w.dark(true);
	await w.screenshot("flux-slash-dark");
	await w.dark(false);
	await w.type("hea");
	await w.gone("Bullet list");
	await w.see("Heading 2");
	await w.type("zzz");
	await w.see("No matching commands");
	for (let i = 0; i < 6; i++) await w.key("Backspace");
	// The keys choose, as Flux's: Down twice, Enter.
	await w.key("Down");
	await w.key("Down");
	await w.screenshot("flux-slash-keys");
	await w.key("Enter");
	await w.gone("Insert a block");
	await w.type("Steps");
	// Escape closes it, leaving what was typed.
	await w.key("Enter");
	await w.type("/");
	await w.see("Insert a block");
	await w.key("Escape");
	await w.gone("Insert a block");
	await w.key("Backspace");
	// A divider, from its keyword.
	await w.type("/hr");
	await w.see("Separate sections");
	await w.key("Enter");
	await w.gone("Insert a block");
	await w.type("After the rule");
	await w.screenshot("flux-divider");
	await t.until(() => srv.requests.some((r) => r.path.startsWith("/sync/docs/")), { what: "the description written", timeout: 15000 }).catch(() => {});
});

test("dragging a card opens a gap where it lands, as Flux's board", async (t) => {
	const { items } = await flux(t, { demo: true });
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.see("Pages fill the content area");
	// Ordered by priority, a column says so, and a card lands in its place.
	await w.drag("Write the docs", "Pages fill the content area", { shot: "flux-drag-sorted" });
	await t.until(() => items.get("i2")!.body!.status === "todo", { what: "the status pushed" });
	// By hand, a gap opens at the pointer, and the card takes its place.
	await w.click("Display");
	await w.see("Show completed issues");
	await w.click("Ordering: Priority");
	await w.see("Last created");
	await w.click("Manual");
	await w.see("Ordering: Manual");
	await w.click("Display");
	await w.gone("Show completed issues");
	await w.drag("Display options stick", "Pages fill the content area", { place: "above", shot: "flux-drag-gap" });
	await t.until(() => {
		const moved = items.get("s30")!.body!;
		const top = items.get("s12")!.body!;
		return (moved.position as number) < (top.position as number);
	}, { what: "the card placed above" });
	await w.dark(true);
	await w.drag("Write the docs", "Fix the login redirect", { place: "below", shot: "flux-drag-gap-dark" });
	await w.dark(false);
	// The list, too: one gap through every group; a row dropped in another
	// group takes its status.
	await w.click("Display");
	await w.click("List");
	await w.click("Display");
	await w.gone("Show completed issues");
	await w.drag("Start an agent from the issue", "Fix the login redirect", { place: "above", shot: "flux-drag-list" });
	await t.until(() => {
		const moved = items.get("s3")!.body!;
		return moved.status === "todo" && (moved.position as number) < (items.get("i1")!.body!.position as number);
	}, { what: "the row moved into Todo, first" });
});

test("the title edits in place: nothing under it moves", async (t) => {
	await flux(t);
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.click("Fix the login redirect");
	await w.see("Description");
	await w.screenshot("flux-title");
	await w.click("Title");
	await w.see("Issue title");
	await w.screenshot("flux-title-editing");
	await w.key("End");
	await w.type(" when the session has expired in another tab");
	await w.screenshot("flux-title-wrapped");
	await w.key("Escape");
	await w.see("Fix the login redirect");
});

test("typing at the end of a description leaves the page where it was", async (t) => {
	await flux(t, { long: true });
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.click("Write it all down");
	await w.see("Description");
	await w.click("Description");
	await w.key("Mod+End");
	await w.scroll("Title", 0, 250);
	await w.screenshot("flux-desc-end");
	await w.type("x");
	await t.sleep(1500);
	await w.screenshot("flux-desc-x");
	await w.type(" ");
	await t.sleep(1500);
	await w.screenshot("flux-desc-space");
	await w.type("y");
	await t.sleep(1500);
	await w.screenshot("flux-desc-y");
	await w.type("z");
	await w.screenshot("flux-desc-z");
});

test("a description Swarm can't keep shows as it is, to edit in Flux", async (t) => {
	await flux(t, { rich: true });
	// Agents read its table as Markdown's.
	const show = (await t.run("show", "ABC-9")).stdout;
	expect(show).toContain("| Step | Owner |");
	expect(show).toContain("| Notes | Ada |");
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.click("Plan the release");
	await w.see("This description has a table and a callout, which Swarm can't edit without changing. Edit it in Flux.");
	await w.see("Owner");
	await w.see("The end.");
	expect(await w.has("Description")).toBe(false);
	expect(show).toContain("\n---\n");
	await w.screenshot("flux-unkept");
});

test("keys, the palette, delete and move, as Flux's", async (t) => {
	const { items } = await flux(t, { demo: true });
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.see("Write the docs");
	// j moves a cursor that shows; S opens the palette for it; Enter takes the first.
	await w.click("Find a view");
	await w.click("All issues");
	await w.key("j");
	await w.key("s");
	await w.click("Change status…");
	await w.screenshot("flux-palette");
	await w.dark(true);
	await w.screenshot("flux-palette-dark");
	await w.dark(false);
	await w.type("rev");
	await w.key("Enter");
	await w.gone("Change status…");
	await t.until(() => [...items.values()].some((it) => it.body?.status === "review" && it.body?.title !== "Follow the event stream"), { what: "a status set from the keys" });
	// A card's chips pick in place, as Flux's.
	await w.click("Labels: Feature");
	await w.see("New label…");
	await w.screenshot("flux-chip-menu");
	await w.key("Escape");
	await w.click("Priority: Medium");
	await w.see("No priority");
	await w.click("No priority");
	await t.until(() => ["s7", "s21"].some((id) => items.get(id)!.body!.priority === "none"), { what: "the priority set in place" });
	// Delete asks first; Escape keeps it, though the board takes Escape itself, and so does Cancel.
	for (const leave of ["Escape", "Cancel"]) {
		await w.rightClick("Write the docs");
		// The menu open, its items built as it opens, before one's clicked.
		await w.see("Move to project");
		await w.click("Delete");
		await w.see("Delete this issue?");
		if (leave === "Escape") {
			await w.key("Escape");
			await w.gone("Delete this issue?");
			expect(items.get("i2")!.deleted).toBe(false);
			continue;
		}
		await w.screenshot("flux-confirm");
		await w.click("Cancel");
	}
	await w.gone("Delete this issue?");
	expect(items.get("i2")!.deleted).toBe(false);
	// Moved to another project, it takes a number free there, and its page follows it.
	await w.click("Write the docs");
	await w.see("Add sub-issues");
	// The page takes the keys as it appears.
	await w.key("Shift+P");
	await w.click("Move to project…");
	await w.type("swa");
	await w.key("Enter");
	await t.until(() => items.get("i2")!.body!.projectId === "p2", { what: "the move pushed" });
	await w.gone("Move to project…");
	const number = items.get("i2")!.body!.number as number;
	const taken = [...items.values()].filter((it) => it.id !== "i2" && it.body?.type === "issue" && it.body?.projectId === "p2").map((it) => it.body!.number);
	expect(taken.includes(number)).toBe(false);
	await w.see(`SWARM-${number}`);
	// A due date typed, as Flux reads it, in the palette, where it comes first.
	await w.key("Shift+D");
	await w.see("Set due date…");
	await w.type("2 weeks");
	const due = new Date();
	due.setDate(due.getDate() + 14);
	const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][due.getMonth()];
	await w.see(`Due ${month} ${due.getDate()}${due.getFullYear() === new Date().getFullYear() ? "" : `, ${due.getFullYear()}`}`);
	await w.screenshot("flux-due-typed");
	await w.key("Enter");
	const local = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
	await t.until(() => items.get("i2")!.body!.dueDate === local, { what: "two weeks from today pushed" });
	// The palette gone, as the user sees it go, before the page's keys.
	await w.gone("Set due date…");
	// Deleted, its comments go with it.
	await w.key("Mod+Backspace");
	await w.see("Delete this issue?");
	await w.click("Delete");
	await t.until(() => items.get("i2")!.deleted, { what: "the issue deleted" });
});

test("changes made offline wait, and go when Flux is back", async (t) => {
	const { items, away, put } = await flux(t, { demo: true });
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.see("Write the docs");
	away.down = true;
	// Changed while Flux is away: shown at once, and waiting.
	await w.click("Write the docs");
	await w.see("Add sub-issues");
	// The page takes the keys as it appears: a frame after it shows.
	await t.sleep(250);
	await w.key("Shift+1");
	await w.see("1 waiting to send", { timeout: 15000 });
	await w.see("Urgent");
	expect(items.get("i2")!.body!.priority).toBe("none");
	// An issue deleted in Flux meanwhile: a change to it can't be sent.
	await w.key("Escape");
	await w.click("Fix the login redirect");
	await w.see("Add sub-issues");
	// The page takes the keys as it appears: a frame after it shows.
	await t.sleep(250);
	await w.key("Shift+2");
	await w.see("2 waiting to send");
	await w.screenshot("flux-offline");
	put("i1", null);
	away.down = false;
	await w.click("Retry now");
	await t.until(() => items.get("i2")!.body!.priority === "urgent", { what: "the change sent" });
	await w.see("A change made offline wasn't sent");
	await w.screenshot("flux-dropped");
	await w.click("Dismiss");
	await w.gone("A change made offline wasn't sent");
	expect(await w.has("waiting to send")).toBe(false);
});

test("status, list and show, as bb flux has them", async (t) => {
	await flux(t);
	const status = (await t.run("status")).stdout;
	expect(status).toContain("Workspace: Coldspire");
	expect(status).toContain("Signed in as: Ada Lovelace (@ada)");
	expect(status).toContain("Issues synced: 2");
	expect((await t.run("list", "--project", "ABC")).stdout).toBe(
		"Alpha (ABC)\n\nABC-1      ○ Todo         ▲   Fix the login redirect  @ada  [Bug]\nABC-2      ◌ Backlog      ·   Write the docs\n",
	);
	const show = (await t.run("show", "ABC-1")).stdout;
	expect(show).toContain("# ABC-1 · Fix the login redirect");
	expect(show).toContain("- Status: Todo");
	expect(show).toContain("It loops. [Image 1]");
	expect(show).toContain("Seen on Safari too");
	expect((await t.run("projects")).stdout).toContain("ABC    Alpha                        2 open");
	expect((await t.run("members")).stdout).toContain("@ada                 Ada Lovelace (you)");
});

test("create, update and comment push what Flux takes", async (t) => {
	const { items, pushes } = await flux(t);
	const created = await t.run("create", "--project", "ABC", "--title", "Retry pushes", "--description", "Steps:\n\n- one\n- two", "--assign", "bob", "--label", "Bug");
	expect(created.stdout).toMatch(/^Created ABC-3 · Retry pushes\nhttp:\/\/127\.0\.0\.1:\d+\/issue\/ABC-3\n$/);
	const [project, issue] = pushes()[0]!;
	expect(project).toMatchObject({ itemId: "p1", body: { nextNumber: 4 } });
	expect(issue).toMatchObject({ baseVersion: -1, body: { type: "issue", number: 3, title: "Retry pushes", description: "<p>Steps:</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>", assigneeIds: ["u2"], labelIds: ["l1"], subscriberIds: ["u1", "u2"] } });
	const updated = await t.run("update", "ABC-1", "--status", "review", "--priority", "urgent");
	expect(updated.stdout).toBe("Updated ABC-1: status → In Review; priority → Urgent\n");
	expect(items.get("i1")!.body).toMatchObject({ status: "review", priority: "urgent", position: 0 });
	// A description goes into the issue's document, then its HTML.
	const described = await t.run("update", "ABC-2", "--description", "## Plan\n\n- [x] Read it\n- [ ] Write it");
	expect(described.stdout).toBe("Updated ABC-2: description\n");
	expect(String(items.get("i2")!.body!.description)).toContain('data-type="taskList"');
	const commented = await t.run("comment", "ABC-2", "--body", "Started on it, @bob.");
	expect(commented.stdout).toMatch(/^Commented on ABC-2 \(\d+ characters\)\. http/);
	const comment = [...items.values()].find((i) => i.body?.type === "comment" && i.body.issueId === "i2")!;
	expect(String(comment.body!.body)).toContain('data-type="mention"');
	// Commenters follow the issue.
	expect(items.get("i2")!.body!.subscriberIds).toEqual(["u1"]);
	expect((await t.run("update", "ABC-1")).stderr).toContain("nothing to change");
	expect((await t.run("update", "ABC-1", "--status", "nope")).stderr).toContain('unknown status "nope"');
});

test("a push someone else's change beat is built again and sent", async (t) => {
	const { items } = await flux(t, { conflictOnce: true });
	expect((await t.run("update", "ABC-2", "--status", "todo")).stdout).toBe("Updated ABC-2: status → Todo\n");
	expect(items.get("i2")!.body!.status).toBe("todo");
});

test("a thread's agent starts on an issue, is told of it, and comments as itself", async (t) => {
	const { items } = await flux(t);
	const th = await t.thread("say Hello.");
	await th.idle();
	expect((await t.runIn(th, "start", "ABC-2")).stdout).toBe("Attached this thread to ABC-2 (In Progress). Run `swarm flux show` to read it.\n");
	expect(items.get("i2")!.body!.status).toBe("progress");
	// Its next message tells the agent, once.
	await th.send("say Noted.");
	await th.see("This thread is attached to Flux issue ABC-2. Keep that issue current as you work:");
	await th.idle();
	// The key defaults to the thread's issue; the comment is its agent's.
	expect((await t.runIn(th, "show")).stdout).toContain("# ABC-2 · Write the docs");
	await t.runIn(th, "comment", "--body", "Plan settled.");
	const comment = [...items.values()].find((i) => i.body?.type === "comment" && i.body.issueId === "i2")!;
	expect(comment.body!.agent).toEqual({ name: "Demo agent", provider: "fake", threadId: th.id });
	expect((await t.runIn(th, "detach")).stdout).toBe(`Detached ${th.id} from ABC-2.\n`);
	expect((await t.run("start", "ABC-1")).stderr).toContain("not running in a Swarm thread");
});

test("Start agent seeds bb's prompt, sends the issue's images, and remembers the project", async (t) => {
	const { items } = await flux(t);
	const th = await t.thread("say Hello.");
	await th.idle();
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.click("All issues");
	await w.click("Fix the login redirect");
	await w.click("Start agent");
	await w.see("Its image goes along as an attachment.");
	await w.see("Starting moves it to In Progress.");
	// The only Swarm project, Alpha linked to none.
	await w.see("Swarm project: project");
	await w.screenshot("flux-start-agent");
	await w.dark(true);
	await w.screenshot("flux-start-agent-dark");
	await w.dark(false);
	// A dialog, as bb's: Escape leaves it, and the board's card opens it in place.
	await w.key("Escape");
	await w.gone("Its image goes along as an attachment.");
	await w.click("Start agent");
	await w.see("Its image goes along as an attachment.");
	await w.click("Start");
	await w.see("Agent started on ABC-1.");
	await t.until(() => items.get("i1")!.body!.status === "progress", { what: "the issue in progress" });
	// No comment of its own: the agent's own say what it does.
	expect([...items.values()].some((i) => i.body?.type === "comment" && i.body.issueId === "i1" && String(i.body.body ?? "").includes("Started an agent"))).toBe(false);
	// Its thread got bb's prompt, its picture where the prompt numbers it.
	await w.see("ABC-1 · Fix the login redirect");
	await w.see("Work on Flux issue ABC-1: Fix the login redirect");
	await w.screenshot("flux-started-thread");
	// Alpha now starts its agents in that Swarm project.
	expect((await t.run("status")).code).toBe(0);
	await w.click("Flux");
	await w.settings("flux");
	await w.see("Where agents work");
	expect(await w.has("Swarm project for Alpha: Not linked")).toBe(false);
});

test("the agent looks at an issue's images", async (t) => {
	await flux(t);
	const th = await t.thread('tool flux_issue_images {"issue": "ABC-1"}');
	await th.see("[Image 1] in the description");
	await th.see("[image/png]");
});

test("each thread's Flux panel attaches an issue, and shows it", async (t) => {
	const { items } = await flux(t, { subIssue: true });
	const th = await t.thread("say Hello.");
	await th.idle();
	const w = await t.window();
	await w.panel(th, "flux");
	await w.see("Attach a Flux issue");
	await w.see("Write the docs");
	await w.screenshot("flux-panel-attach");
	await w.click("Search issues");
	await w.type("login");
	await w.gone("Write the docs");
	await w.click("Fix the login redirect");
	// bb's panel, in Swarm's look: its properties, its sub-issues, its
	// activity. Attaching leaves the status as it was, as bb's does.
	await w.see("Sub-issues");
	await w.see("Keep the redirect's query");
	expect(items.get("i1")!.body!.status).toBe("todo");
	await w.see("Description");
	await w.see("Seen on Safari too: ");
	await w.see("Comment");
	await w.see("Activity");
	await w.screenshot("flux-panel");
	await w.dark(true);
	await w.screenshot("flux-panel-dark");
	await w.dark(false);
	// Its priority, from Swarm's menu.
	await w.click("Priority: High");
	await w.click("Urgent");
	await t.until(() => items.get("i1")!.body!.priority === "urgent", { what: "the priority pushed" });
	const cards = async () => (await w.texts()).filter((s) => s === "ABC-1").length;
	const before = await cards();
	// A reply's ::flux{key} is the issue's card.
	await th.send('say Working on it:\n\n::flux{key="ABC-1"}');
	await th.see("Working on it:");
	await th.idle();
	await t.until(async () => (await cards()) > before, { what: "the reply's card" });
	await w.screenshot("flux-directive");
	await w.dark(true);
	await w.screenshot("flux-directive-dark");
	await w.dark(false);
	// The new-thread screen's section: open issues nobody's agent has.
	await w.click("New thread");
	await w.see("Write the docs");
	await w.see("Unassigned");
	await w.screenshot("flux-home");
	await w.dark(true);
	await w.screenshot("flux-home-dark");
	await w.dark(false);
	await w.type("@");
	await w.see("Flux issues");
	await w.screenshot("flux-mention");
	await w.key("Escape");
	// Picked, it goes after what's typed, as a mention the agent is told of.
	await w.key("Backspace");
	await w.type("First, read the logs.");
	await w.click("ABC-2 Write the docs");
	// One draft still, the issue after its text, not a draft of its own.
	await t.sleep(500);
	const texts = await w.texts();
	expect(texts.filter((x) => x.startsWith("Draft: ")).length).toBe(1);
	expect(texts.includes("Draft: First, read the logs.")).toBe(true);
	await w.screenshot("flux-home-picked");
});

test("the board opens an issue, and a status change is pushed", async (t) => {
	const { items } = await flux(t, { subIssue: true, demo: true });
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.see("In Progress");
	await w.see("Fix the login redirect");
	// The sidebar lists the projects with their open issues; the scope
	// is the toolbar's alone.
	await w.see("Find a view");
	await w.see("All projects");
	// The scopes are the title bar's, which can draw a moment after the board.
	await w.see("My issues");
	await w.see("New issue");
	await w.screenshot("flux-board");
	await w.dark(true);
	await w.screenshot("flux-board-dark");
	await w.dark(false);
	// A project in the sidebar filters the board, as the toolbar's
	// dropdown does, and the scope stays.
	await w.click("Swarm");
	await w.gone("Fix the login redirect");
	await w.see("Drag a card between columns");
	await w.gone("Follow the event stream");
	await w.screenshot("flux-project");
	await w.click("All issues");
	await w.see("Follow the event stream");
	await w.click("All projects");
	await w.see("Fix the login redirect");
	// Display options, a popover as Flux's.
	await w.click("Display");
	await w.see("Show completed issues");
	await w.screenshot("flux-display");
	await w.dark(true);
	await w.screenshot("flux-display-dark");
	await w.dark(false);
	await w.click("List");
	await w.gone("Created Oct 24");
	await w.click("Close display options");
	await w.gone("Show completed issues");
	await w.screenshot("flux-list");
	await w.dark(true);
	await w.screenshot("flux-list-dark");
	await w.dark(false);
	await w.click("Display");
	await w.click("Board");
	await w.see("Created Oct 24");
	await w.click("Close display options");
	await w.gone("Show completed issues");
	// The right-click menu, Flux's, with its submenus.
	await w.rightClick("Fix the login redirect");
	await w.see("Move to project");
	await w.screenshot("flux-context");
	await w.dark(true);
	await w.screenshot("flux-context-dark");
	await w.dark(false);
	await w.click("Copy");
	await w.see("Copy title");
	await w.click("Copy ID");
	await w.gone("Move to project");
	// The selection bar.
	await w.rightClick("Write the docs");
	await w.click("Due date");
	await w.click("In one week");
	// The local calendar's day, not UTC's.
	const week = new Date();
	week.setDate(week.getDate() + 7);
	const local = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, "0")}-${String(week.getDate()).padStart(2, "0")}`;
	await t.until(() => items.get("i2")!.body!.dueDate === local, { what: "a week from today pushed" });
	// Custom…, Swarm's calendar in the menu's place, on the day set, once the card has it: a day on, and Enter.
	await w.see(`${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][week.getMonth()]} ${week.getDate()}`);
	await w.rightClick("Write the docs");
	await w.click("Due date");
	await w.click("Custom…");
	await w.see("Previous month");
	await w.screenshot("flux-due-calendar");
	await w.dark(true);
	await w.screenshot("flux-due-calendar-dark");
	await w.dark(false);
	await w.key("Right");
	await w.key("Enter");
	await w.gone("Previous month");
	week.setDate(week.getDate() + 1);
	const next = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, "0")}-${String(week.getDate()).padStart(2, "0")}`;
	await t.until(() => items.get("i2")!.body!.dueDate === next, { what: "the day after pushed" });
	await w.click("Fix the login redirect", { mod: true });
	await w.see("1 selected");
	await w.click("Write the docs");
	await w.see("2 selected");
	await w.screenshot("flux-selection");
	await w.dark(true);
	await w.screenshot("flux-selection-dark");
	await w.dark(false);
	await w.click("Clear selection");
	await w.gone("2 selected");
	// The create dialog.
	await w.click("New issue");
	await w.see("Issue title");
	await w.see("Create more");
	await w.screenshot("flux-new-issue");
	await w.dark(true);
	await w.screenshot("flux-new-issue-dark");
	await w.dark(false);
	// Its chips say what's picked, as Flux's: everyone assigned, how many labels.
	await w.click("Assignee");
	await w.click("Ada Lovelace (you)");
	await w.click("Assignee: Ada Lovelace");
	await w.see("Ada Lovelace (you)");
	// Bob by the keys: his name is a card's avatar's too, behind the dialog.
	await w.key("Down");
	await w.key("Down");
	await w.key("Enter");
	await w.see("Assignee: Ada Lovelace, Bob");
	await w.click("Labels");
	await w.key("Down");
	await w.key("Enter");
	await w.see("1 label");
	await w.screenshot("flux-new-issue-picked");
	// Made, it stays on the board, and says so, with Open, as Flux's.
	await w.click("Issue title");
	await w.type("Ship the toast");
	await w.key("Mod+Enter");
	await w.gone("Create more");
	await w.see("Open");
	const made = [...items.values()].find((it) => it.body?.title === "Ship the toast");
	expect(!!made).toBe(true);
	expect(made!.body!.assigneeIds).toEqual(["u1", "u2"]);
	expect(made!.body!.labelIds).toEqual(["l1"]);
	await w.see("Fix the login redirect");
	await w.click("Open");
	await w.see("Add sub-issues");
	await w.key("Escape");
	await w.click("Fix the login redirect");
	await w.see("Description");
	await w.see("Sub-issues");
	await w.screenshot("flux-issue");
	await w.click("Status: Todo");
	await w.click("In Review");
	await t.until(() => items.get("i1")!.body!.status === "review", { what: "the board's status pushed" });
	await w.see("In Review");
	await w.screenshot("flux-issue");
	await w.dark(true);
	await w.screenshot("flux-issue-dark");
	await w.dark(false);
	// The title is edited where it is.
	await w.click("Title");
	await w.click("Issue title");
	await w.key("End");
	await w.type(" on Safari");
	await w.key("Enter");
	await t.until(() => items.get("i1")!.body!.title === "Fix the login redirect on Safari", { what: "the title pushed", timeout: 10000 });
	await w.gone("Issue title");
	// Escape leaves it as it was, what was typed saved or not.
	await w.click("Title");
	await w.click("Issue title");
	await w.key("End");
	await w.type(" and Firefox");
	// The draft saved as it's typed, then Escape.
	await t.until(() => items.get("i1")!.body!.title === "Fix the login redirect on Safari and Firefox", { what: "the draft pushed" });
	await w.key("Escape");
	await w.gone("Issue title");
	await t.until(() => items.get("i1")!.body!.title === "Fix the login redirect on Safari", { what: "the title put back", timeout: 10000 });
	await w.see("Fix the login redirect on Safari");
	// Left mid-edit, its title isn't another issue's to go back to.
	await w.click("Title");
	await w.see("Issue title");
	await w.click("Keep the redirect's query");
	await w.see("Sub-issue of");
	await w.click("Title");
	await w.see("Issue title");
	await w.key("Escape");
	await w.gone("Issue title");
	await t.sleep(300);
	expect(items.get("i3")!.body!.title).toBe("Keep the redirect's query");
	// That Escape was the field's: the page stays; the next goes back.
	expect((await w.texts()).some((x) => x.includes("Sub-issue of"))).toBe(true);
	await w.key("Escape");
	await w.gone("Sub-issue of");
	await w.see("Activity");
	// Escape, from the page rather than a field, goes back to the board.
	await w.click("Activity");
	await w.key("Escape");
	await w.see("Backlog");
	// Its card moved to In Review, which can be past the window's edge:
	// back to it from its sub-issue's "Sub-issue of".
	await w.click("Keep the redirect's query");
	await w.see("Sub-issue of");
	await w.click("ABC-1 Fix the login redirect on Safari");
	await w.gone("Sub-issue of");
	await w.see("Sub-issues");
	// Narrow, with Swarm's sidebar hidden: the properties are chips under
	// the title, as bb's are, and the board scrolls sideways.
	await w.key("Mod+B");
	await w.resize(390, 800);
	await w.see("Start agent");
	await w.screenshot("flux-issue-narrow");
	await w.dark(true);
	await w.screenshot("flux-issue-narrow-dark");
	await w.dark(false);
	// Back through the sub-issue to the board.
	await w.key("Escape");
	await w.see("Sub-issue of");
	await w.key("Escape");
	await w.see("Backlog");
	await w.see("Project: All projects");
	await w.screenshot("flux-board-narrow");
	// Narrow, the board settles column by column, as Flux's: a little way
	// goes back, past halfway on to the next.
	await w.scroll("Backlog", 120);
	await w.screenshot("flux-board-snap-back");
	await w.scroll("Backlog", 260);
	await w.screenshot("flux-board-snap-next");
	await w.dark(true);
	await w.screenshot("flux-board-narrow-dark");
});

test("a new project, as Flux makes it: its name's key, its mark from Swarm's gallery, then its board", async (t) => {
	const { pushes } = await flux(t);
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.see("Fix the login redirect");
	await w.click("Project: All projects");
	await w.see("New project…");
	await t.sleep(300);
	await w.click("New project…");
	await w.see("Project name");
	await w.type("Plugins");
	// The key is the name's, as Flux derives it, until one's typed.
	await w.see("Issues numbered PLUGI-1, PLUGI-2, …");
	await w.screenshot("flux-new-project");
	await w.dark(true);
	await w.screenshot("flux-new-project-dark");
	await w.dark(false);
	// Its mark: Swarm's gallery of Flux's icons, in Flux's colors.
	await w.click("Project icon: Folder, gray");
	await w.see("Developer");
	await w.see("Search icons");
	await t.sleep(300);
	await w.screenshot("flux-mark-picker");
	await w.dark(true);
	await w.screenshot("flux-mark-picker-dark");
	await w.dark(false);
	// As it opens it's at the icon chosen; its search finds the others by their words.
	await w.type("launch");
	await w.click("Rocket");
	await w.click("Blue");
	await w.see("Project icon: Rocket, blue");
	// And Swarm's emoji, found by name.
	await w.click("Emoji");
	await w.type("bee");
	await w.see("Honeybee");
	await t.sleep(300);
	await w.screenshot("flux-mark-picker-emoji");
	await w.click("Icons");
	await w.click("Rocket");
	await w.key("Escape");
	await w.gone("Matches");
	// A key another project has, or a word Flux's routes use, isn't one.
	await w.click("KEY");
	await w.key("Mod+A");
	await w.type("abc");
	await w.see("Alpha has the key ABC");
	await w.screenshot("flux-new-project-taken");
	await w.key("Mod+A");
	await w.type("inbox");
	await w.see("That project key is reserved");
	await w.key("Mod+A");
	await w.type("plg");
	await w.see("Issues numbered PLG-1, PLG-2, …");
	expect(pushes().length).toBe(0);
	await w.key("Mod+Enter");
	await t.until(() => pushes().length === 1, { what: "the project pushed" });
	const [created] = pushes()[0]!;
	expect(created).toMatchObject({ type: "upsert", baseVersion: -1, body: { type: "project", key: "PLG", aliases: [], name: "Plugins", mark: { type: "icon", value: "rocket", color: "blue" }, nextNumber: 1, position: 1 } });
	// Its board opens, and the sidebar lists it.
	await w.gone("Project name");
	await w.see("Project: Plugins");
	await w.see("Created Plugins.");
	expect((await t.run("projects")).stdout).toContain("PLG");
	// New issues number from 1 in it.
	expect((await t.run("create", "--project", "PLG", "--title", "First")).stdout).toContain("Created PLG-1 · First");
});

test("a project's settings rename it, rekey it keeping the old key, and change its mark; Delete says what happens to its issues", async (t) => {
	const { items, pushes } = await flux(t, { demo: true });
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.see("Fix the login redirect");
	await w.click("Alpha");
	await w.see("Project: Alpha");
	await w.click("Project: Alpha");
	await w.see("Project settings…");
	await t.sleep(300);
	await w.click("Project settings…");
	await w.see("Project settings");
	await w.see("Issues numbered ABC-1, ABC-2, …");
	await w.screenshot("flux-project-settings");
	await w.dark(true);
	await w.screenshot("flux-project-settings-dark");
	await w.dark(false);
	await w.click("Project name");
	await w.key("Mod+A");
	await w.type("Alphabet");
	await w.click("KEY");
	await w.key("Mod+A");
	await w.type("swarm");
	await w.see("Swarm has the key SWARM");
	await w.key("Mod+A");
	await w.type("alp");
	await w.see("Issues become ALP-1, ALP-2, …; ABC-1 still finds its issue");
	await w.click("Project icon: Rocket, an emoji");
	await w.see("Suggested");
	await w.type("fox");
	await w.click("Fox");
	await w.key("Escape");
	await w.gone("Suggested");
	const before = pushes().length;
	await w.click("Save  ⌘↵");
	await t.until(() => items.get("p1")!.body!.key === "ALP", { what: "the key pushed" });
	const [edit] = pushes()[before]!;
	// The old key stays an alias; the counter is the copy's, untouched.
	expect(edit).toMatchObject({ itemId: "p1", body: { type: "project", key: "ALP", aliases: ["ABC"], name: "Alphabet", mark: { type: "emoji", value: "🦊" }, nextNumber: 3, position: 0 } });
	// Its board follows it to its new key, and its issues' old keys still find them.
	await w.gone("Save  ⌘↵");
	await w.see("Project: Alphabet");
	await w.see("ALP-1");
	expect((await t.run("show", "ABC-1")).stdout).toContain("# ALP-1 · Fix the login redirect");
	// Delete asks, saying Flux keeps the issues without their project.
	// The menu open, done opening, before its item's clicked: once more if
	// the first click came as the bar settled on the new key.
	await w.click("Project: Alphabet");
	await t.sleep(300);
	if (!(await w.has("Project settings…"))) await w.click("Project: Alphabet");
	await w.see("Project settings…");
	await t.sleep(300);
	await w.click("Project settings…");
	await w.see("Delete…");
	await w.click("Delete…");
	await w.see("Delete Alphabet?");
	await w.see("Flux keeps its 2 issues, without a project: they lose their ALP keys, and only All projects lists them. This can't be undone.");
	await w.screenshot("flux-project-delete");
	await w.click("Cancel");
	await w.gone("Delete Alphabet?");
	expect(items.get("p1")!.deleted).toBe(false);
});

test("Flux's Settings list the projects to make, mark, reorder and delete", async (t) => {
	const { items, pushes } = await flux(t, { demo: true });
	const w = await t.window();
	await w.resize(1280, 900);
	await w.click("Flux");
	await w.see("Fix the login redirect");
	// Which Flux is beside its name in the sidebar.
	await w.click("Workspace: Coldspire");
	await w.click("Flux settings…");
	await w.see("Where agents work");
	await w.see("New project");
	await w.screenshot("flux-settings-projects");
	await w.dark(true);
	await w.screenshot("flux-settings-projects-dark");
	await w.dark(false);
	// The mark changes at once, from the gallery in its row.
	await w.click("Icon of Swarm: Honeybee, an emoji");
	await w.click("Icons");
	await w.click("Robot");
	await t.until(() => (items.get("p2")!.body!.mark as { value?: string }).value === "robot", { what: "the mark pushed" });
	await w.key("Escape");
	// Moved up, each project's place is its position, as Flux's sidebar's drag writes them.
	await w.click("Actions for Swarm");
	await w.see("Move up");
	await t.sleep(300);
	await w.click("Move up");
	await t.until(() => items.get("p2")!.body!.position === 0 && items.get("p1")!.body!.position === 1, { what: "the order pushed" });
	expect(pushes()[pushes().length - 1]!.map((op: { itemId: string }) => op.itemId).sort()).toEqual(["p1", "p2"]);
	// Delete, from its menu, asks first, then deletes the project alone, as Flux.
	await w.click("Actions for Alpha");
	await w.see("Delete project…");
	await t.sleep(300);
	await w.click("Delete project…");
	await w.see("Delete Alpha?");
	await w.click("Delete");
	await w.gone("Delete Alpha?");
	await t.until(() => !!items.get("p1")!.deleted, { what: "the project deleted" });
	expect(items.get("i1")!.deleted).toBe(false);
	await w.gone("Actions for Alpha");
	// New project, from here too.
	await w.click("New project");
	await w.see("Project name");
	// Docs, a word Flux's routes use, isn't a key: the next free is.
	await w.type("Docs");
	await w.see("Issues numbered DOCSA-1, DOCSA-2, …");
	await w.key("Enter");
	await t.until(() => [...items.values()].some((it) => it.body?.type === "project" && it.body.name === "Docs" && it.body.key === "DOCSA"), { what: "the project made" });
});

test("a project made offline waits, and goes when Flux is back", async (t) => {
	const { items, away } = await flux(t);
	const w = await t.window();
	await w.resize(1280, 800);
	await w.click("Flux");
	await w.see("Fix the login redirect");
	away.down = true;
	// From the palette, as Flux's command menu has it.
	await w.palette("New Flux project");
	await w.see("Project name");
	await w.type("Offline");
	await w.key("Enter");
	// Shown at once, its board open, and waiting.
	await w.see("Project: Offline");
	await w.see("1 waiting to send", { timeout: 15000 });
	expect([...items.values()].some((it) => it.body?.name === "Offline")).toBe(false);
	away.down = false;
	await w.click("Retry now");
	await t.until(() => [...items.values()].some((it) => it.body?.type === "project" && it.body.name === "Offline" && it.body.key === "OFFLI"), { what: "the project sent" });
	await w.gone("waiting to send");
});

test("the title bar gives way as it narrows: the filter, New issue's name, the scopes, the project's name last; nothing cut short or under another", async (t) => {
	await flux(t, { long_name: true });
	const w = await t.window();
	await w.resize(1440, 600);
	await w.click("Flux");
	await w.click("Conduish desktop");
	await w.see("Its window remembers its size");
	for (const width of [1440, 1180, 1100, 1000, 940, 900, 780, 640]) {
		await w.resize(width, 600);
		await t.sleep(150);
		await w.screenshot(`flux-bar-${width}`);
		// Always there whole: New issue, Display, the project menu, which has the workspace.
		await w.see("New issue");
		await w.see("Display");
		await w.see("Project: Conduish desktop");
	}
	// Which Flux is beside its name in the sidebar.
	await w.resize(1440, 600);
	await w.click("Workspace: Coldspire");
	await w.see("Flux settings…");
	await t.sleep(200);
	await w.screenshot("flux-bar-workspace");
	await w.key("Escape");
	await w.gone("Flux settings…");
	await w.screenshot("flux-side-workspace");
	await w.dark(true);
	await w.screenshot("flux-side-workspace-dark");
	await w.dark(false);
});
