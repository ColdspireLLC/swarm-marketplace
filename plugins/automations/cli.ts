// swarm automations …: the page's actions on the command line, for the
// agents and the user's terminal, every one with --json.
import { cliCommand, defineCli, PluginCliError, type CliOption, type CliResult, type CommandIO } from "swarm";
import { describeCron, stamp } from "./cron";
import { apply, EditError, INTERPRETERS, mayTouch, setEnabled, type Spec, type Who } from "./edit";
import { APPROVALS } from "./plan";
import { state } from "./parts";
import { scriptDir, start } from "./runner";
import { automations, find, remove, runs, type Automation, type Run } from "./store";

const who = (io: CommandIO): Who => (io.user ? { user: true } : { user: false, thread: io.thread });

function fail(e: unknown): never {
	if (e instanceof EditError) throw new PluginCliError(e.message, { code: e.code, hint: e.hint });
	throw e;
}

function lookup(ref: string): Automation {
	const a = find(ref);
	if (!a) throw new PluginCliError(`No automation ${ref}.`, { code: "not_found", hint: "swarm automations list shows them." });
	return a;
}

const when = (t: number | null | undefined) => (t ? stamp(t) : "—");

export function schedule(a: Automation): string {
	return a.cron ? `${describeCron(a.cron)}${describeCron(a.cron) !== a.cron ? ` (${a.cron})` : ""}` : `Once, ${when(a.at)}`;
}

/** An automation as --json prints it. */
function json(a: Automation) {
	return { ...a, state: state(a), nextAt: a.enabled && a.nextAt ? new Date(a.nextAt).toISOString() : null, retryAt: a.retryAt ? new Date(a.retryAt).toISOString() : null, at: a.at ? new Date(a.at).toISOString() : undefined, created: new Date(a.created).toISOString(), updated: new Date(a.updated).toISOString() };
}

function runJson(r: Run, output: boolean) {
	const { stdout, stderr, ...rest } = r;
	return { ...rest, started: new Date(r.started).toISOString(), ended: r.ended ? new Date(r.ended).toISOString() : undefined, ...(output ? { stdout, stderr } : {}) };
}

function runLine(r: Run): string {
	const took = r.ended ? ` (${Math.max(1, Math.round((r.ended - r.started) / 1000))}s)` : "";
	return `#${r.id}  ${when(r.started)}  ${r.status.padEnd(7)} ${r.trigger.padEnd(8)} ${r.summary ?? ""}${took}${r.thread ? `  thread ${r.thread}` : ""}`;
}

async function detail(a: Automation): Promise<string> {
	const lines = [`${a.name}  (${a.id})`, `State:    ${state(a)}${a.origin === "agent" ? ", made by an agent" : ""}`, `Schedule: ${schedule(a)}`];
	if (a.enabled && a.nextAt) lines.push(`Next:     ${when(a.nextAt)}`);
	if (a.retryAt) lines.push(`Retry:    ${when(a.retryAt)}`);
	lines.push(`Mode:     ${a.mode}`);
	if (a.mode === "script") {
		lines.push(`Script:   ${a.interpreter}, ${Math.round((a.timeoutMs ?? 120_000) / 1000)}s at most, in ${(await scriptDir(a)) ?? "Swarm's own folder"}`);
		for (const l of (a.script ?? "").split("\n")) lines.push(`  | ${l}`);
	}
	if (a.prompt) {
		lines.push(a.mode === "script" ? "Then:     an agent, told its output and:" : "Prompt:");
		for (const l of a.prompt.split("\n")) lines.push(`  > ${l}`);
	}
	if (a.mode === "agent" || a.prompt) {
		if (a.target) lines.push(`Tells:    thread ${a.target}`);
		else lines.push(`Starts:   a thread each run${a.worktree ? ", in a worktree" + (a.branch ? ` of ${a.branch}` : "") : ""}; ${[a.provider || "the default agent", a.model, a.effort, a.approval && `approval ${a.approval}`].filter(Boolean).join(", ")}`);
	}
	if (a.lastError) lines.push(`Error:    ${a.lastError}${a.failures ? ` (${a.failures} failed in a row)` : ""}`);
	const rs = (runs.get(a.id) ?? []).slice(0, 5);
	if (rs.length) lines.push("Runs:", ...rs.map((r) => "  " + runLine(r)));
	return lines.join("\n") + "\n";
}

const J: { [k: string]: CliOption } = { json: { type: "boolean", description: "Print JSON" } };

const SCHEDULE: { [k: string]: CliOption } = {
	cron: { type: "string", description: "A repeat: five-field cron in this computer's time (30 9 * * 1-5 is 9:30 on weekdays; @daily, @hourly)" },
	at: { type: "string", description: "Once, at this time: 2026-11-08T09:00 (ISO 8601, local time unless it says)" },
	in: { type: "string", description: "Once, this long from now: 30s, 5m, 2h, 1d" },
};

const EXEC: { [k: string]: CliOption } = {
	mode: { type: "enum", values: ["agent", "script"], description: "agent (the default; script where --script is given)" },
	prompt: { type: "string", description: "What the agent is told each run; with a script, what it's told along with the script's output, when the script prints something" },
	provider: { type: "string", description: "The agent: claude, codex… (the default agent when left out)" },
	model: { type: "string", description: "Its model" },
	effort: { type: "string", description: "Its reasoning effort, as the model lists them" },
	approval: { type: "enum", values: APPROVALS, description: "What its agent may do without asking (auto when the user makes it; an agent's at most its own)" },
	worktree: { type: "boolean", description: "A worktree of its own for each run's thread" },
	branch: { type: "string", description: "With --worktree, the branch it checks out" },
	"target-thread": { type: "string", description: "Tell this thread each run, rather than start one" },
	script: { type: "string", description: 'The script: --script "$(cat check.sh)". Printing nothing (or a last line {"wakeAgent": false}) is a silent run' },
	interpreter: { type: "enum", values: INTERPRETERS, description: "What runs the script (sh)" },
	timeout: { type: "string", description: "How long the script may run: 90s, 5m (2m; 10m at most)" },
	cwd: { type: "string", description: "The folder the script runs in (its project's, where that is on this computer)" },
};

function spec(o: { [k: string]: unknown }): Spec {
	const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
	return {
		name: s("name"),
		project: s("project"),
		mode: s("mode") as Spec["mode"],
		cron: s("cron"),
		at: s("at"),
		in: s("in"),
		prompt: s("prompt"),
		provider: s("provider"),
		model: s("model"),
		effort: s("effort"),
		approval: s("approval"),
		worktree: o["no-worktree"] ? false : o.worktree ? true : undefined,
		branch: s("branch"),
		target: o["no-target-thread"] ? "" : s("target-thread"),
		script: s("script"),
		interpreter: s("interpreter"),
		timeout: s("timeout"),
		cwd: s("cwd"),
	};
}

const id = { name: "automation", required: true, description: "Its id or name" };

export function registerCli() {
	defineCli({
		summary: "Scheduled work: an agent given a prompt, or a script, on a cron or once. From a thread, a new automation is that thread's project's and runs with no more access than its agent has.",
		commands: {
			list: cliCommand({
				summary: "The automations: each one's state, schedule and next run",
				options: { project: { type: "string", description: "Only this project's" }, "target-thread": { type: "string", description: "Only those that tell this thread" }, ...J },
				run: ({ options }) => {
					let list = [...automations.values()].sort((a, b) => a.name.localeCompare(b.name));
					if (options.project) list = list.filter((a) => a.project === options.project || a.project.toLowerCase() === String(options.project).toLowerCase());
					if (options["target-thread"]) list = list.filter((a) => a.target === options["target-thread"]);
					if (options.json) return { stdout: JSON.stringify(list.map(json), null, 2) + "\n" };
					if (!list.length) return { stdout: "No automations.\n" };
					return { stdout: list.map((a) => `${a.id}  ${a.name}  [${state(a)}]  ${schedule(a)}${a.enabled && a.nextAt ? `, next ${when(a.nextAt)}` : ""}`).join("\n") + "\n" };
				},
			}),
			show: cliCommand({
				summary: "One automation: its schedule, what it runs and its last runs",
				positionals: [id],
				options: J,
				run: async ({ positionals, options }) => {
					const a = lookup(String(positionals.automation));
					if (options.json) return { stdout: JSON.stringify({ ...json(a), runs: (runs.get(a.id) ?? []).slice(0, 10).map((r) => runJson(r, false)) }, null, 2) + "\n" };
					return { stdout: await detail(a) };
				},
			}),
			create: cliCommand({
				summary: "Make one: a name, a schedule (--cron, or --at/--in for once) and an agent's prompt or a script",
				options: { name: { type: "string", required: true, description: "What it's called" }, project: { type: "string", description: "Its project, by id or name (this thread's, else the only one)" }, ...SCHEDULE, ...EXEC, paused: { type: "boolean", description: "Make it paused" }, ...J },
				run: async ({ options }, io): Promise<CliResult> => {
					const a = await apply({ ...spec(options), enabled: options.paused ? false : undefined }, who(io)).catch(fail);
					if (options.json) return { stdout: JSON.stringify(json(a), null, 2) + "\n" };
					return { stdout: `Made ${a.name} (${a.id}): ${schedule(a)}${a.enabled && a.nextAt ? `, first ${when(a.nextAt)}` : ""}.\n` };
				},
			}),
			update: cliCommand({
				summary: "Change one: only what's given changes ('' clears a text field)",
				positionals: [id],
				options: { name: { type: "string", description: "A new name" }, ...SCHEDULE, ...EXEC, "no-worktree": { type: "boolean", description: "No worktree" }, "no-target-thread": { type: "boolean", description: "Start a thread each run again" }, ...J },
				run: async ({ positionals, options }, io): Promise<CliResult> => {
					const was = lookup(String(positionals.automation));
					const a = await apply(spec(options), who(io), was).catch(fail);
					if (options.json) return { stdout: JSON.stringify(json(a), null, 2) + "\n" };
					return { stdout: `Changed ${a.name}: ${schedule(a)}${a.enabled && a.nextAt ? `, next ${when(a.nextAt)}` : ""}.\n` };
				},
			}),
			pause: cliCommand({
				summary: "Stop it running on its schedule, until resumed",
				positionals: [id],
				options: J,
				run: async ({ positionals, options }, io) => {
					const a = await setEnabled(lookup(String(positionals.automation)), false, who(io)).catch(fail);
					return { stdout: options.json ? JSON.stringify(json(a)) + "\n" : `Paused ${a.name}.\n` };
				},
			}),
			resume: cliCommand({
				summary: "Run it on its schedule again, from now, its failures forgotten",
				positionals: [id],
				options: J,
				run: async ({ positionals, options }, io) => {
					const a = await setEnabled(lookup(String(positionals.automation)), true, who(io)).catch(fail);
					return { stdout: options.json ? JSON.stringify(json(a)) + "\n" : `Resumed ${a.name}${a.nextAt ? `: next ${when(a.nextAt)}` : ""}.\n` };
				},
			}),
			run: cliCommand({
				summary: "Run it now, its schedule as it was; one already running is that run",
				positionals: [id],
				options: J,
				run: async ({ positionals, options }, io) => {
					const a = lookup(String(positionals.automation));
					await mayTouch(a, who(io)).catch(fail);
					const r = await start(a, "manual");
					const now = runs.get(a.id)?.find((x) => x.id === r.id) ?? r;
					if (options.json) return { stdout: JSON.stringify(runJson(now, true), null, 2) + "\n" };
					return { stdout: `${a.name}: run #${now.id} ${now.status === "running" ? `running${now.thread ? ` in thread ${now.thread}` : ""}` : `${now.status}: ${now.summary ?? ""}`}.\n`, exitCode: now.status === "failed" ? 1 : 0 };
				},
			}),
			runs: cliCommand({
				summary: "Its last runs; --output RUN prints what a script run printed",
				positionals: [id],
				options: { limit: { type: "number", description: "How many (10)" }, output: { type: "number", description: "This run's whole output" }, ...J },
				run: ({ positionals, options }) => {
					const a = lookup(String(positionals.automation));
					const list = runs.get(a.id) ?? [];
					if (options.output !== undefined) {
						const r = list.find((x) => x.id === options.output);
						if (!r) throw new PluginCliError(`No run #${options.output} of ${a.name}.`, { code: "not_found" });
						if (options.json) return { stdout: JSON.stringify(runJson(r, true), null, 2) + "\n" };
						return { stdout: `${runLine(r)}\n${r.code !== undefined ? `exit ${r.code}\n` : ""}--- stdout\n${r.stdout ?? ""}\n--- stderr\n${r.stderr ?? ""}\n` };
					}
					const shown = list.slice(0, typeof options.limit === "number" ? options.limit : 10);
					if (options.json) return { stdout: JSON.stringify(shown.map((r) => runJson(r, false)), null, 2) + "\n" };
					return { stdout: shown.length ? shown.map(runLine).join("\n") + "\n" : `${a.name} hasn't run yet.\n` };
				},
			}),
			delete: cliCommand({
				summary: "Delete it and its runs",
				positionals: [id],
				options: { yes: { type: "boolean", required: true, description: "Yes, delete it" }, ...J },
				run: async ({ positionals, options }, io) => {
					const a = lookup(String(positionals.automation));
					await mayTouch(a, who(io)).catch(fail);
					await remove(a.id);
					return { stdout: options.json ? JSON.stringify({ ok: true, id: a.id }) + "\n" : `Deleted ${a.name}.\n` };
				},
			}),
		},
	});
}
