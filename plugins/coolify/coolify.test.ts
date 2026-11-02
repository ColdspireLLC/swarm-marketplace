import { expect, test, type Request, type T } from "swarm/test";

const TOKEN = "1|secret-token";

const RESOURCES = [
	{ uuid: "app1", name: "web", type: "application", status: "running:healthy", fqdn: "https://web.example.com", git_repository: "acme/web", git_branch: "main", environment_id: 1 },
	{ uuid: "db1", name: "main-db", type: "standalone-postgresql", status: "exited:unhealthy", environment_id: 1 },
	{ uuid: "svc1", name: "plausible", type: "service", status: "running:healthy", environment_id: 2 },
	// Enough that the list has its search.
	...["api", "worker", "docs", "redis"].map((name) => ({ uuid: name, name, type: name === "redis" ? "standalone-redis" : "application", status: "running:healthy", environment_id: 2 })),
	// Shaped as a real Coolify's: names that repeat across projects, docker
	// image applications whose deployments have no commit, Coolify's names.
	{ uuid: "cs1", name: "server", type: "application", status: "running:unknown", fqdn: "https://api.conduish.com", build_pack: "dockerimage", git_repository: "coollabsio/coolify", docker_registry_image_name: "registry.example.com/acme/conduish", docker_registry_image_tag: "0.2.0", environment_id: 3 },
	{ uuid: "cw1", name: "website:main-cw1", type: "application", status: "running:healthy", fqdn: "https://conduish.com,https://www.conduish.com", build_pack: "railpack", git_repository: "acme/website", git_branch: "main", environment_id: 3 },
	{ uuid: "cp1", name: "postgres", type: "standalone-postgresql", status: "running:healthy", environment_id: 3 },
	{ uuid: "ss1", name: "server", type: "application", status: "running:healthy", fqdn: "https://api.sql.studio", build_pack: "dockerimage", docker_registry_image_name: "registry.example.com/acme/sql-studio", environment_id: 4 },
];

const LOG = JSON.stringify([
	{ output: "Starting deployment of acme/web:main.", type: "stdout", hidden: false },
	{ output: "docker build --no-cache", type: "stdout", hidden: true },
	{ output: "npm ERR! missing script: build", type: "stderr", hidden: false },
]);

const DEPLOYMENTS = [
	{ deployment_uuid: "dep2", status: "failed", commit: "9f8e7d6c5b", commit_message: "Break the build", is_webhook: true, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:01:12Z" },
	{ deployment_uuid: "dep0", status: "finished", commit: "7cd4d0222b", commit_message: "Merge branch 'bb/im-deployed-on-coolify-and-when-trying-to-send-a-thread-it-fails' into 'main'", created_at: "2026-10-31T08:00:00Z", updated_at: "2026-10-31T23:14:53Z" },
	{ deployment_uuid: "dep1", status: "finished", commit: "1a2b3c4d5e", commit_message: "First page", created_at: "2026-10-31T09:00:00Z", updated_at: "2026-10-31T09:00:40Z", logs: LOG },
];

// coolify stands in for a Coolify of before v4's actions turned POST: a
// POST to an action is 405, as Laravel answers a route of GET only.
async function coolify(t: T) {
	// web's variables, kept as Coolify keeps them: by key, each with a uuid.
	const envs = [
		{ uuid: "e1", key: "DATABASE_URL", value: "postgres://web:pw@db/web", is_runtime: true, is_buildtime: false },
		{ uuid: "e2", key: "NODE_ENV", value: "production", is_runtime: true, is_buildtime: true },
		{ uuid: "e3", key: "PREVIEW_ONLY", value: "1", is_preview: true },
	] as { uuid: string; key: string; value: string; [flag: string]: unknown }[];
	let next = 10;
	const upsert = (v: { key: string; value: string }) => {
		const at = envs.find((e) => e.key === v.key && !!e.is_preview === !!(v as { is_preview?: boolean }).is_preview);
		if (at) Object.assign(at, v);
		else envs.push({ uuid: `e${next++}`, ...v });
	};
	const srv = await t.server((req: Request) => {
		if (req.headers["authorization"] !== `Bearer ${TOKEN}`) return { status: 401, json: { message: "Unauthenticated." } };
		if (req.path === "/mcp") return { headers: { "content-type": "application/json", "mcp-session-id": "s2" }, json: { jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "Coolify" } } } };
		const p = req.path.replace(/^\/api\/v1/, "");
		if (p === "/version") return { body: "v4.0.0-beta.400" };
		if (p === "/resources") return { json: RESOURCES };
		if (p === "/projects") return { json: [{ uuid: "p1", name: "Acme" }, { uuid: "p2", name: "Conduish" }, { uuid: "p3", name: "SQL Studio" }] };
		if (p === "/projects/p2") return { json: { uuid: "p2", name: "Conduish", environments: [{ id: 3, uuid: "e3", name: "production" }] } };
		if (p === "/projects/p3") return { json: { uuid: "p3", name: "SQL Studio", environments: [{ id: 4, uuid: "e4", name: "production" }] } };
		if (p === "/deployments/applications/cs1") return { json: { count: 1, deployments: [{ deployment_uuid: "dc1", status: "finished", commit: "HEAD", commit_message: null, created_at: "2026-10-30T19:21:04.000000Z", updated_at: "2026-10-30T19:21:47.000000Z" }] } };
		if (p === "/deployments/applications/cw1") return { json: { count: 1, deployments: [{ deployment_uuid: "dw1", status: "finished", commit: "9e0dfd906ff9c9645c2e5a67bf9819c2df06cb6e", commit_message: "Light mode, following the system", is_webhook: true, created_at: "2026-10-31T12:00:00.000000Z", updated_at: "2026-10-31T12:01:30.000000Z" }] } };
		if (p === "/projects/p1") return { json: { uuid: "p1", name: "Acme", environments: [{ id: 1, uuid: "e1", name: "production" }, { id: 2, uuid: "e2", name: "staging" }] } };
		if (p === "/deploy") return req.method === "POST" ? { status: 405, json: { message: "The POST method is not supported for route api/v1/deploy." } } : { json: { deployments: [{ message: "Application web deployment queued.", resource_uuid: "app1", deployment_uuid: "dep3" }] } };
		if (p === "/deployments/dep3") return { json: { deployment_uuid: "dep3", status: "failed", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:05Z", logs: LOG } };
		if (p === "/deployments/applications/app1") return { json: { count: 2, deployments: DEPLOYMENTS } };
		const dep = DEPLOYMENTS.find((d) => p === `/deployments/${d.deployment_uuid}`);
		if (dep) return { json: { ...dep, logs: LOG } };
		if (p === "/databases/db1/logs") return { json: { logs: "" } };
		if (p === "/deployments") return { json: [] };
		if (p === "/applications/app1/logs") return { json: { logs: "\u001b[32mlistening on :3000\u001b[0m\nERROR database is down\nGET / 200\n" } };
		if (p === "/applications/app1/stop" && req.method === "POST") return { json: { message: "Application stopping request queued." } };
		if (p === "/applications/app1/envs") {
			if (req.method === "GET") return { json: envs };
			const v = req.json();
			if (req.method === "POST") {
				if (envs.some((e) => e.key === v.key && !!e.is_preview === !!v.is_preview)) return { status: 409, json: { message: "Environment variable already exists. Use PATCH request to update it." } };
				upsert(v);
				return { status: 201, json: { uuid: envs[envs.length - 1]!.uuid } };
			}
			if (req.method === "PATCH") {
				if (!envs.some((e) => e.key === v.key)) return { status: 404, json: { message: "Environment variable not found." } };
				upsert(v);
				return { json: envs.find((e) => e.key === v.key) };
			}
		}
		if (p === "/applications/app1/envs/bulk" && req.method === "PATCH") {
			for (const v of req.json().data) upsert(v);
			return { json: envs };
		}
		const del = /^\/applications\/app1\/envs\/(.+)$/.exec(p);
		if (del && req.method === "DELETE") {
			const at = envs.findIndex((e) => e.uuid === del[1]);
			if (at < 0) return { status: 404, json: { message: "Not found." } };
			envs.splice(at, 1);
			return { json: { message: "Environment variable deleted." } };
		}
		if (p === "/applications/app1/rollback-images") return { json: { current: "9f8e7d6", images: [{ tag: "1a2b3c4d5e", created_at: "2026-10-31T09:00:40.000000Z", is_current: false }] } };
		if (p === "/servers") return { json: [{ uuid: "srv1", name: "localhost", ip: "host.docker.internal", proxy_type: "TRAEFIK", settings: { is_reachable: true, is_usable: true, concurrent_builds: 2 } }] };
		if (p === "/servers/srv1/resources") return { json: RESOURCES.map(({ uuid, name, type, status }) => ({ uuid, name, type, status })) };
		return { status: 404, json: { message: "Not found." } };
	});
	return srv;
}

test("deploy finds the resource by name, falls back to GET on an older Coolify, and --wait fails with the build", async (t) => {
	const none = await t.run("list");
	expect(none.code).not.toBe(0);
	expect(none.stderr).toContain("Coolify isn't connected");

	const srv = await coolify(t);
	await t.set("url", srv.url + "/");
	await t.set("token", "wrong");
	const refused = await t.run("list");
	expect(refused.stderr).toContain("Coolify refused the token");

	await t.set("token", TOKEN);
	const list = await t.run("list");
	expect(list.code).toBe(0);
	expect(list.stdout).toContain("web  Application  Running  app1 [Acme/production]  https://web.example.com");
	expect(list.stdout).toContain("main-db  PostgreSQL  Stopped  db1");

	const run = await t.run("deploy", "web", "--force", "--wait");
	const deploys = srv.requests.filter((r) => r.path === "/api/v1/deploy");
	expect(deploys.map((r) => r.method)).toEqual(["POST", "GET"]);
	expect(deploys[1]!.query).toContain("uuid=app1");
	expect(deploys[1]!.query).toContain("force=true");
	expect(run.stdout).toContain("web: Application web deployment queued. (deployment dep3)");
	// The lines Coolify hides stay out.
	expect(run.stdout).toContain("npm ERR! missing script: build");
	expect(run.stdout).not.toContain("docker build --no-cache");
	expect(run.stdout).toContain("Deployment dep3: failed");
	expect(run.code).toBe(1);

	const vague = await t.run("show", "a");
	expect(vague.stderr).toContain("give Project/name or the uuid");
});

// The flow a user goes through, in one window: connect in Settings, the
// overview, a project from the sidebar, a resource's tabs, the servers. A
// window takes some seconds.
test("the page: overview, a project, a resource's tabs and the servers", async (t) => {
	const srv = await coolify(t);
	const w = await t.window();
	await w.resize(1440, 900);
	await w.click("Coolify");
	await w.see("Connect Coolify");
	await w.settings("Coolify");
	await w.click("https://coolify.example.com");
	await w.type(srv.url);
	await w.click("1|abc…");
	await w.type(TOKEN);
	await w.click("Connect");
	await w.see("Connected");
	await w.see("Let agents set things up");
	await w.see("What the token may do");
	await w.see("Not known");
	await w.see("Agents get Coolify's own tools: apps from a repository, databases, services from templates, env vars, domains, backups. They go through Swarm, so the token stays in your keychain.");
	await w.screenshot("coolify-settings");

	// The overview: the failed deploy needs attention, and leads the recent ones.
	await t.set("mcpAgents", "claude");
	await w.click("Coolify");
	await w.see("New app");
	await w.see("Needs attention");
	await w.see("Recent deployments");
	await w.see("Break the build");
	await w.screenshot("coolify-overview");

	// A project, from the sidebar: its environments.
	await w.click("Acme");
	await w.see("Production");
	await w.see("Staging");
	await w.screenshot("coolify-project");
	await w.click("web, Running");
	await w.see("Ask an agent to fix it");
	await w.see("Health check");
	await w.screenshot("coolify-app");

	await w.click("See the log");
	await w.see("Starting deployment of acme/web:main.");
	await w.click("Finished deployment 1a2b3c4");
	await w.see("Starting deployment of acme/web:main.");
	await w.see("Roll back to this");
	await w.screenshot("coolify-app-deployments");

	// Its containers' logs, in the code viewer: colour codes out, errors counted.
	await w.click("Logs");
	await w.see("Errors only (1)");
	await w.see("listening on :3000");
	await w.screenshot("coolify-app-logs");

	// Stop asks first.
	await w.click("More actions");
	await w.click("Stop…");
	await w.see("Keep it running");
	await w.screenshot("coolify-stop");
	expect(srv.requests.some((q) => q.path.endsWith("/stop"))).toBe(false);
	await w.click("Stop web");
	await t.until(() => srv.requests.some((q) => q.method === "POST" && q.path === "/api/v1/applications/app1/stop"), { what: "the stop" });

	await w.click("Environment");
	await w.see("DATABASE_URL");
	expect(await w.has("postgres://web:pw@db/web")).toBe(false);
	await w.click("Show DATABASE_URL");
	await w.see("postgres://web:pw@db/web");
	expect(await w.has("PREVIEW_ONLY")).toBe(false);
	await w.dark(true);
	await w.screenshot("coolify-app-env-dark");
	await w.dark(false);

	// Managing them: add one, delete one after confirming, paste a .env.
	await w.click("Add variable");
	await w.click("MY_VARIABLE");
	await w.type("API_KEY");
	await w.click("Its value");
	await w.type("s3cret");
	await w.screenshot("coolify-env-add");
	await w.click("Add");
	await w.see("Added API_KEY.");
	await w.see("Redeploy now");
	await w.click("Delete NODE_ENV");
	await w.see("Keep");
	await w.screenshot("coolify-env-delete");
	await w.click("Delete NODE_ENV");
	await w.see("Deleted NODE_ENV.");
	await w.see("2 variables");
	await w.click("Paste .env…");
	await w.click("KEY=value, a line each");
	await w.type("LOG_LEVEL=debug");
	await w.key("Enter");
	await w.type('API_KEY="rotated"');
	await w.see("2 variables: 1 new, 1 changed. Those not in it stay as they are.");
	await w.screenshot("coolify-env-paste");
	await w.click("Import 2");
	await w.see("Imported 2 variables.");
	await w.see("LOG_LEVEL");
	const sent = srv.requests.filter((q) => q.path.startsWith("/api/v1/applications/app1/envs") && q.method !== "GET").map((q) => `${q.method} ${q.path.replace("/api/v1/applications/app1/envs", "")}`);
	expect(sent).toEqual(["POST ", "DELETE /e2", "PATCH /bulk"]);
	expect(srv.requests.find((q) => q.method === "POST" && q.path.endsWith("/envs"))!.json()).toEqual({ key: "API_KEY", value: "s3cret", is_literal: false, is_multiline: false, is_shown_once: false, is_buildtime: true, is_runtime: true, is_preview: false });
	await w.screenshot("coolify-env-done");

	await w.click("Servers");
	await w.see("Reachable");
	await w.click("localhost, Reachable");
	await w.see("plausible");
	await w.screenshot("coolify-servers");
	const log = (await t.log()).join("\n");
	expect(log).not.toMatch(/error|threw/i);
});

test("the agents' MCP requests need the plugin's key, and reach Coolify with its token", async (t) => {
	const srv = await coolify(t);
	await t.set("url", srv.url);
	await t.set("token", TOKEN);
	await t.set("mcpKey", "k1");
	const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
	const stranger = await t.http("POST", "/mcp", { headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body });
	expect(stranger.status).toBe(401);
	expect(srv.requests.some((r) => r.path === "/mcp")).toBe(false);

	const res = await t.http("POST", "/mcp", { headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer k1", "mcp-session-id": "s1" }, body });
	expect(res.status).toBe(200);
	expect(res.json().result.serverInfo.name).toBe("Coolify");
	expect(res.headers["mcp-session-id"] ?? res.headers["Mcp-Session-Id"]).toBe("s2");
	const sent = srv.requests.find((r) => r.path === "/mcp")!;
	expect(sent.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
	expect(sent.headers["mcp-session-id"]).toBe("s1");
	expect(sent.json().method).toBe("initialize");
});

test("env lists names, never values; env-set adds and changes; env-unset removes", async (t) => {
	const srv = await coolify(t);
	await t.set("url", srv.url);
	await t.set("token", TOKEN);
	const list = await t.run("env", "--app", "app1");
	expect(list.stdout).toContain("DATABASE_URL  (runtime only)");
	expect(list.stdout).not.toContain("postgres://");
	expect(list.stdout).not.toContain("PREVIEW_ONLY");
	const set = await t.run("env-set", "--app", "app1", "NODE_ENV=staging", "FEATURE=on", "--runtime-only");
	expect(set.code).toBe(0);
	const bulk = srv.requests.find((q) => q.path.endsWith("/envs/bulk"))!.json();
	expect(bulk.data).toEqual([
		{ key: "NODE_ENV", value: "staging", is_literal: false, is_multiline: false, is_buildtime: false, is_runtime: true, is_preview: false },
		{ key: "FEATURE", value: "on", is_literal: false, is_multiline: false, is_buildtime: false, is_runtime: true, is_preview: false },
	]);
	const bad = await t.run("env-set", "--app", "app1", "1BAD=x");
	expect(bad.stderr).toContain("doesn't start with a digit");
	const unset = await t.run("env-unset", "--app", "app1", "FEATURE", "MISSING");
	expect(unset.stderr).toContain("has no MISSING");
	expect((await t.run("env-unset", "--app", "app1", "FEATURE")).code).toBe(0);
	expect((await t.run("env", "--app", "app1")).stdout).not.toContain("FEATURE");
});
