import { expect, test, type Request, type T } from "swarm/test";

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

async function flux(t: T, opts: { conflictOnce?: boolean; subIssue?: boolean; demo?: boolean } = {}) {
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
	put("c1", { type: "comment", issueId: "i1", authorId: "u1", body: "<p>Seen on Safari too: <code>?next=</code> is dropped.</p>" });
	let conflict = !!opts.conflictOnce;
	const docs = new Set<string>();
	const srv = await t.server((req: Request) => {
		if (req.headers["authorization"] !== "Bearer tok") return { status: 401, json: { message: "no" } };
		const path = req.path;
		if (path === "/user") return { json: ME };
		if (path === "/workspace") return { json: { id: "w1", name: "Coldspire", slug: "coldspire", latestVersion: version } };
		if (path === "/workspace/members") return { json: { members: [ME, { ...ME, id: "u2", username: "bob", name: "Bob", email: "bob@example.com" }] } };
		if (path.startsWith("/sync/pull/")) {
			const since = Number(path.split("/").pop());
			const out = [...items.values()].filter((i) => i.version > since).sort((a, b) => a.version - b.version);
			return { json: { items: out, nextVersion: out.length ? out[out.length - 1]!.version : Math.max(since, 0), hasMore: false, latestVersion: version } };
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
	await t.set("url", srv.url);
	await t.set("token", "tok");
	await t.until(async () => (await t.run("status")).stdout.includes("Flux: ready"), { what: "Flux ready" });
	const pushes = () => srv.requests.filter((r) => r.path === "/sync/push").map((r) => r.json().ops);
	return { srv, items, pushes };
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
	await w.see("Make one in Flux, under Settings, API tokens.");
	expect(await w.has("Set Flux's URL in Settings, Plugins, Flux.")).toBe(false);
	await w.screenshot("flux-setup");
	await w.dark(true);
	await w.screenshot("flux-setup-dark");
	await w.resize(760, 800);
	await w.screenshot("flux-setup-narrow-dark");
	await w.dark(false);
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
	expect(await w.has("My issues")).toBe(true);
	await w.see("Coldspire");
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
	await w.click("In a week");
	await t.until(() => !!items.get("i2")!.body!.dueDate, { what: "the due date pushed" });
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
	await w.key("Escape");
	await w.gone("Create more");
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
	await w.see("Coldspire");
	await w.screenshot("flux-board-narrow");
	await w.dark(true);
	await w.screenshot("flux-board-narrow-dark");
});
