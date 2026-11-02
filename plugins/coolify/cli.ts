// The command line: swarm coolify …, for the agents and the user.
import { cliCommand, defineCli, PluginCliError, type CommandIO } from "swarm";
import * as api from "./coolify";
import type { Conn, Place, Resource } from "./coolify";
import { conn, POLL, projectAt, readProjects, run, state, threadProjectNow } from "./store";
import { sourceText } from "./view";

/** The project a command runs in: the folder's, else (a worktree's folder is elsewhere) its thread's. */
async function hereOf(io: CommandIO) {
	if (!state.projects.length) await readProjects();
	const here = projectAt(io.cwd);
	if (here || !io.thread) return here;
	const id = await threadProjectNow(io.thread);
	return state.projects.find((p) => p.id === id);
}

function need(): Conn {
	const c = conn();
	if (!c) throw new PluginCliError("Coolify isn't connected.", { code: "not_connected", hint: "Connect it in Swarm: Settings, Coolify." });
	return c;
}

// ---- The command line ----

const json = { json: { type: "boolean", description: "Print JSON, for a script or another command to read." } } as const;

/** The resource a command names, or else the application of the project it's run in. */
async function resolve(c: Conn, what: string | undefined, io: CommandIO): Promise<Resource> {
	const [list, places] = await Promise.all([api.resources(c), api.places(c).catch(() => new Map<number, Place>())]);
	if (what) return api.find(list, what, places);
	if (!state.projects.length) await readProjects();
	const project = await hereOf(io);
	if (!project) throw new PluginCliError("Name the resource: this folder isn't one of Swarm's projects.", { code: "no_resource", hint: "swarm coolify list" });
	state.list ??= list;
	state.places = places;
	const linked = list.filter((r) => r.type === "application" && project.repo && api.builtFrom(r, project.repo));
	if (linked.length === 1) return linked[0]!;
	if (!linked.length) throw new PluginCliError(`No Coolify application is built from ${project.name}'s repository${project.repo ? ` (${project.repo})` : ""}: name the resource.`, { code: "not_linked", hint: "swarm coolify list" });
	const label = (r: Resource) => { const p = r.environment_id !== undefined ? places.get(r.environment_id) : undefined; return `${p ? p.project + "/" + (p.environment === "production" ? "" : p.environment + "/") : ""}${api.displayName(r)} (${r.uuid})`; };
	throw new PluginCliError(`${project.name} deploys to ${linked.length} applications: name one of ${linked.map(label).join(", ")}.`, { code: "ambiguous", hint: "swarm coolify deploy UUID" });
}

const target = [{ name: "resource", description: "A name, Project/name or uuid; the application of the project you're in when left out" }];

/** Wraps a command's run: Coolify's refusals as the CLI's errors. */
function guard<A extends unknown[]>(fn: (...a: A) => Promise<void | number>) {
	return async (...a: A) => {
		try {
			return await fn(...a);
		} catch (e) {
			if (e instanceof api.CoolifyError) throw new PluginCliError(e.message, { code: e.status === 401 ? "unauthorized" : e.status === 404 ? "not_found" : "coolify_error" });
			throw e;
		}
	};
}

/** Waits for a deployment to end, printing its new log lines as they come. Its exit code: 0 when it finished. */
async function follow(c: Conn, uuid: string, io: CommandIO): Promise<number> {
	let printed = 0;
	for (;;) {
		if (io.signal.aborted) return 130;
		const d = await api.deployment(c, uuid);
		const lines = api.logLines(d.logs);
		for (const l of lines.slice(printed)) io.print(l.output);
		printed = lines.length;
		if (!api.deploying(d)) {
			io.print(`Deployment ${uuid}: ${api.deploymentStatus(d.status).label.toLowerCase()} (${api.took(d)}).`);
			return d.status === "finished" ? 0 : 1;
		}
		await new Promise((done) => setTimeout(done, POLL.busy));
	}
}

export function registerCli() {
	defineCli({
		summary: "Your Coolify's applications, services and databases: list them, deploy, start, stop, restart and roll them back, and read their deployments and logs. RESOURCE is a name, Project/name or uuid; left out, it's the application built from the project you're in.",
		commands: {
			status: cliCommand({
				summary: "Whether Coolify is connected, and its version",
				options: json,
				run: guard(async ({ options }, io) => {
					const c = conn();
					const v = c ? await api.version(c) : "";
					let here: Resource[] = [];
					if (c) {
						if (!state.projects.length) await readProjects();
						const project = await hereOf(io);
						if (project?.repo) here = (await api.resources(c)).filter((r) => r.type === "application" && api.builtFrom(r, project.repo));
					}
					if (options.json) return io.print(JSON.stringify({ connected: !!c, url: c ? api.baseOf(c.url) : null, version: v || null, thisProject: here.map((r) => ({ uuid: r.uuid, name: api.displayName(r), status: r.status })) }));
					io.print(c ? `Connected to ${api.baseOf(c.url)}, Coolify ${v}.` : "Not connected: connect it in Swarm, Settings, Coolify.");
					if (here.length) io.print(`This project deploys to ${here.map((r) => `${api.displayName(r)} (${r.uuid}, ${api.statusOf(r.status).label})`).join(", ")}: ${here.length === 1 ? "swarm coolify deploy --wait deploys it" : "swarm coolify deploy UUID --wait deploys one"}.`);
				}),
			}),
			list: cliCommand({
				summary: "Every application, service and database, with its status and uuid",
				options: json,
				run: guard(async ({ options }, io) => {
					const c = need();
					const [list, places] = await Promise.all([api.resources(c), api.places(c).catch(() => new Map<number, Place>())]);
					const rows = list.map((r) => {
						const p = r.environment_id !== undefined ? places.get(r.environment_id) : undefined;
						return { uuid: r.uuid, name: api.displayName(r), type: r.type, status: r.status, project: p?.project ?? null, environment: p?.environment ?? null, domains: api.domains(r.fqdn) };
					});
					if (options.json) return io.print(JSON.stringify(rows));
					if (rows.length === 0) return io.print("Coolify has nothing this token may see.");
					for (const r of rows) {
						const where = r.project ? ` [${r.project}/${r.environment}]` : "";
						io.print(`${api.displayName(r)}  ${api.typeLabel(r.type)}  ${api.statusOf(r.status).label}  ${r.uuid}${where}${r.domains.length ? "  " + r.domains.join(", ") : ""}`);
					}
				}),
			}),
			show: cliCommand({
				summary: "A resource's status, domains, repository and last deployments",
				positionals: target,
				options: json,
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const r = await resolve(c, positionals.resource as string | undefined, io);
					const deps = r.type === "application" ? await api.deployments(c, r.uuid, 5) : [];
					if (options.json) return io.print(JSON.stringify({ ...api.withoutSecrets(r), deployments: deps.map(({ logs: _, ...d }) => d) }));
					io.print(`${api.displayName(r)} (${api.typeLabel(r.type)}, ${r.uuid}): ${api.statusOf(r.status).label} [${r.status}]`);
					for (const d of api.domains(r.fqdn)) io.print(`  ${d}`);
					if (r.type === "application") io.print(`  ${sourceText(r)}`);
					if (deps.length) io.print("Last deployments:");
					for (const d of deps) io.print(`  ${d.deployment_uuid}  ${api.deploymentStatus(d.status).label}  ${d.commit?.slice(0, 7) ?? ""}  ${api.ago(d.created_at)}  ${d.commit_message?.split("\n")[0] ?? ""}`);
				}),
			}),
			deploy: cliCommand({
				summary: "Deploy an application or service; --wait follows the deployment to its end and fails when it fails",
				positionals: target,
				options: {
					force: { type: "boolean", description: "Rebuild without the build cache." },
					wait: { type: "boolean", description: "Print the deployment's log as it comes, until it ends; exits 1 when it failed." },
					...json,
				},
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const r = await resolve(c, positionals.resource as string | undefined, io);
					const res = await run(c, r, options.force ? "force" : "deploy");
					if (options.json && !options.wait) return io.print(JSON.stringify({ resource: r.uuid, deployment: res.deployment ?? null, message: res.message }));
					io.print(`${api.displayName(r)}: ${res.message}${res.deployment ? ` (deployment ${res.deployment})` : ""}`);
					if (options.wait && res.deployment) return follow(c, res.deployment, io);
				}),
			}),
			...Object.fromEntries(
				(["start", "stop", "restart"] as const).map((what) => [
					what,
					cliCommand({
						summary: `${what.charAt(0).toUpperCase() + what.slice(1)} a resource`,
						positionals: target,
						options: json,
						run: guard(async ({ positionals, options }, io) => {
							const c = need();
							const r = await resolve(c, positionals.resource as string | undefined, io);
							const res = await run(c, r, what);
							if (options.json) io.print(JSON.stringify({ resource: r.uuid, deployment: res.deployment ?? null, message: res.message }));
							else io.print(`${api.displayName(r)}: ${res.message}`);
						}),
					}),
				]),
			),
			deployments: cliCommand({
				summary: "An application's last deployments, newest first",
				positionals: target,
				options: { limit: { type: "number", default: 10, description: "How many, 100 at most." }, ...json },
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const r = await resolve(c, positionals.resource as string | undefined, io);
					if (r.type !== "application") throw new PluginCliError(`${api.displayName(r)} is a ${api.typeLabel(r.type).toLowerCase()}: only applications have deployments.`, { code: "not_application" });
					const deps = await api.deployments(c, r.uuid, Math.min(100, Math.max(1, Number(options.limit) || 10)));
					if (options.json) return io.print(JSON.stringify(deps.map(({ logs: _, ...d }) => d)));
					if (deps.length === 0) return io.print(`${api.displayName(r)} was never deployed.`);
					for (const d of deps) io.print(`${d.deployment_uuid}  ${api.deploymentStatus(d.status).label}  ${d.commit?.slice(0, 7) ?? ""}  ${api.ago(d.created_at)}  ${api.took(d)}  ${d.commit_message?.split("\n")[0] ?? ""}`);
				}),
			}),
			"deployment-log": cliCommand({
				summary: "A deployment's build log; --follow prints it as it comes until the deployment ends",
				positionals: [{ name: "deployment", description: "Its uuid, from deploy or deployments", required: true }],
				options: { follow: { type: "boolean", short: "f", description: "Wait for the deployment to end, printing its lines as they come." } },
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const uuid = positionals.deployment as string;
					if (options.follow) return follow(c, uuid, io);
					const d = await api.deployment(c, uuid);
					if (d.logs == null) throw new PluginCliError("Coolify didn't send the log.", { code: "no_logs", hint: "Give the API token read:sensitive in Coolify's Keys & Tokens." });
					for (const l of api.logLines(d.logs)) io.print(l.output);
					io.print(`Deployment ${uuid}: ${api.deploymentStatus(d.status).label.toLowerCase()}.`);
				}),
			}),
			rollback: cliCommand({
				summary: "Roll an application back to an image of before; without --to, lists them",
				positionals: target,
				options: { to: { type: "string", placeholder: "TAG", description: "The image tag (a commit) to roll back to, as the list shows." }, wait: { type: "boolean", description: "Follow the rollback to its end; exits 1 when it failed." }, ...json },
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const r = await resolve(c, positionals.resource as string | undefined, io);
					if (r.type !== "application") throw new PluginCliError(`${api.displayName(r)} is a ${api.typeLabel(r.type).toLowerCase()}: only applications roll back.`, { code: "not_application" });
					if (!options.to) {
						const images = await api.rollbackImages(c, r.uuid);
						if (options.json) return io.print(JSON.stringify(images));
						if (!images.length) return io.print(`${api.displayName(r)} has no image to roll back to.`);
						for (const i of images) io.print(`${i.tag}  ${api.ago(i.created_at)}${i.is_current ? "  (running now)" : ""}`);
						return;
					}
					const res = await api.rollback(c, r.uuid, String(options.to));
					if (res.deployment) state.started.set(res.deployment, r.uuid);
					if (options.json && !options.wait) return io.print(JSON.stringify({ resource: r.uuid, deployment: res.deployment ?? null, message: res.message }));
					io.print(`${api.displayName(r)}: ${res.message}${res.deployment ? ` (deployment ${res.deployment})` : ""}`);
					if (options.wait && res.deployment) return follow(c, res.deployment, io);
				}),
			}),
			env: cliCommand({
				summary: "A resource's environment variables: names and how they're used, never their values",
				options: { app: { type: "string", placeholder: "RESOURCE", description: "Name, Project/name or uuid; this project's application when left out." }, preview: { type: "boolean", description: "Preview deployments' variables instead." }, ...json },
				run: guard(async ({ options }, io) => {
					const c = need();
					const r = await resolve(c, options.app as string | undefined, io);
					const vars = (await api.envs(c, api.kindOf(r.type), r.uuid)).filter((v) => !!v.is_preview === !!options.preview).sort((a, b) => a.key.localeCompare(b.key));
					const rows = vars.map((v) => ({ key: v.key, buildtime: v.is_buildtime ?? null, runtime: v.is_runtime ?? null, literal: !!v.is_literal, multiline: !!v.is_multiline, hiddenOnceSaved: !!v.is_shown_once }));
					if (options.json) return io.print(JSON.stringify(rows));
					if (!rows.length) return io.print(`${api.displayName(r)} has no variables${options.preview ? " for previews" : ""}.`);
					for (const v of rows) {
						const how = [v.buildtime && !v.runtime ? "build only" : "", v.runtime && !v.buildtime ? "runtime only" : "", v.literal ? "literal" : "", v.multiline ? "multiline" : "", v.hiddenOnceSaved ? "hidden" : ""].filter(Boolean).join(", ");
						io.print(how ? `${v.key}  (${how})` : v.key);
					}
				}),
			}),
			"env-set": cliCommand({
				summary: "Add or change environment variables, KEY=VALUE each; Coolify uses them from the next deploy",
				positionals: [{ name: "assignment", description: "KEY=VALUE", required: true, variadic: true }],
				options: {
					app: { type: "string", placeholder: "RESOURCE", description: "Name, Project/name or uuid; this project's application when left out." },
					"build-only": { type: "boolean", description: "Only while building (an application's)." },
					"runtime-only": { type: "boolean", description: "Only while running (an application's)." },
					literal: { type: "boolean", description: "No $VAR expansion in the value." },
					preview: { type: "boolean", description: "For preview deployments (an application's)." },
					...json,
				},
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const pairs = (positionals.assignment as string[]).map((a) => {
						const eq = a.indexOf("=");
						if (eq <= 0) throw new PluginCliError(`${a} isn't KEY=VALUE.`, { code: "bad_assignment" });
						const key = a.slice(0, eq).trim();
						const problem = api.envKeyProblem(key);
						if (problem) throw new PluginCliError(`${key}: ${problem}`, { code: "bad_key" });
						return { key, value: a.slice(eq + 1) };
					});
					if (options["build-only"] && options["runtime-only"]) throw new PluginCliError("Give --build-only or --runtime-only, not both.", { code: "both" });
					const r = await resolve(c, options.app as string | undefined, io);
					const app = r.type === "application";
					await api.bulkEnvs(c, api.kindOf(r.type), r.uuid, pairs.map((p) => ({ ...p, is_literal: !!options.literal, is_multiline: p.value.includes("\n"), ...(app ? { is_buildtime: !options["runtime-only"], is_runtime: !options["build-only"], is_preview: !!options.preview } : {}) })));
					if (options.json) return io.print(JSON.stringify({ resource: r.uuid, set: pairs.map((p) => p.key) }));
					io.print(`${api.displayName(r)}: set ${pairs.map((p) => p.key).join(", ")}. Coolify uses ${pairs.length === 1 ? "it" : "them"} from the next deploy: swarm coolify deploy ${r.uuid} --wait`);
				}),
			}),
			"env-unset": cliCommand({
				summary: "Remove environment variables by name",
				positionals: [{ name: "key", required: true, variadic: true }],
				options: { app: { type: "string", placeholder: "RESOURCE", description: "Name, Project/name or uuid; this project's application when left out." }, preview: { type: "boolean", description: "Preview deployments' variables." }, ...json },
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const r = await resolve(c, options.app as string | undefined, io);
					const kind = api.kindOf(r.type);
					const vars = (await api.envs(c, kind, r.uuid)).filter((v) => !!v.is_preview === !!options.preview);
					const keys = positionals.key as string[];
					const missing = keys.filter((k) => !vars.some((v) => v.key === k));
					if (missing.length) throw new PluginCliError(`${api.displayName(r)} has no ${missing.join(", ")}.`, { code: "not_found", hint: `swarm coolify env --app ${r.uuid}` });
					for (const k of keys) await api.deleteEnv(c, kind, r.uuid, vars.find((v) => v.key === k)!.uuid!);
					if (options.json) return io.print(JSON.stringify({ resource: r.uuid, removed: keys }));
					io.print(`${api.displayName(r)}: removed ${keys.join(", ")}. Coolify drops ${keys.length === 1 ? "it" : "them"} at the next deploy.`);
				}),
			}),
			logs: cliCommand({
				summary: "An application's or database's containers' last lines",
				positionals: target,
				options: { lines: { type: "number", default: 100, description: "How many lines, 2000 at most." } },
				run: guard(async ({ positionals, options }, io) => {
					const c = need();
					const r = await resolve(c, positionals.resource as string | undefined, io);
					if (r.type === "service") throw new PluginCliError("A service's logs are its containers': read them in Coolify.", { code: "service_logs", hint: api.baseOf(c.url) });
					io.write(await api.logs(c, api.kindOf(r.type), r.uuid, Math.min(2000, Math.max(1, Number(options.lines) || 100))));
				}),
			}),
		},
	});
}

