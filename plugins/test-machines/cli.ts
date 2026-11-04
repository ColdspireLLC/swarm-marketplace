// The command line: swarm test-machines …, for the agents' shells (their
// builds and scripts, in their thread's turn) and the user's terminal
// (who comes first: their commands wait in no line). What only the user
// does, taking a machine for themselves and saying which phones they
// carry and which apps are off limits, is refused to an agent.
import { cliCommand, defineCli, PluginCliError, settings, type CliResult, type CommandIO } from "swarm";
import { discover, stopUsing, use, type Found } from "./discover";
import { DriverError } from "./drivers";
import * as ops from "./ops";
import { carried, testApps } from "./rules";
import { claim, machineNamed, pathOfLine, plainTitle, refresh, st, title, turnsOf, wda } from "./state";
import { cutOffNote } from "./tools";
import { TurnError, USER } from "./turns";

/** Whose turn a command takes: its thread's, or the user's. */
function who(io: CommandIO): string {
	if (io.thread) return io.thread;
	if (io.user) return USER;
	throw new PluginCliError("This command line isn't a thread's agent's, nor the user's.", { code: "unvouched", hint: "Run it from a thread, or from a terminal of Swarm's." });
}

function userOnly(io: CommandIO, what: string) {
	if (!io.user) throw new PluginCliError(`Only the user ${what}.`, { code: "user_only", hint: "Ask the user to run it in a terminal of Swarm's." });
}

const minutes = (ms: unknown) => (typeof ms === "number" ? ms / 60_000 : undefined);

/** An action's result as the command's: its words, its exit code, and the user's cutting it off on the error output. */
async function act(io: CommandIO, fn: (thread: string) => Promise<ops.Out>): Promise<CliResult> {
	const thread = who(io);
	const started = Date.now();
	try {
		const o = await fn(thread);
		const cut = cutOffNote(thread, started);
		return { stdout: o.text + "\n", stderr: cut ? cut + "\n" : undefined, exitCode: o.code ?? 0 };
	} catch (e) {
		if (e instanceof TurnError) throw new PluginCliError(e.message, { code: e.code === "busy" || e.code === "timeout" ? "busy" : e.code });
		if (e instanceof DriverError) throw new PluginCliError(e.message, { code: e.busy ? "busy" : "machine" });
		throw e;
	}
}

const wait = { wait: { type: "duration", defaultUnit: "m", description: "How long to wait in line if another thread has the machine (default 4m, at most 10m; 0 not to wait)." } } as const;
const machine = { name: "machine", required: true, description: "Its id, as status lists them" };

/** A phone discover finds, by its id, serial, UDID or model. */
async function foundPhone(name: string): Promise<Found> {
	const phones = await discover();
	const n = name.toLowerCase();
	const f = phones.find((f) => [f.id, f.serial].some((x) => x?.toLowerCase() === n)) ?? phones.find((f) => f.model.toLowerCase() === n);
	if (!f) throw new PluginCliError(`No phone ${JSON.stringify(name)} is plugged in: ${phones.map((f) => `${f.model} (${f.serial})`).join(", ") || "none found"}.`, { code: "not_found", hint: "swarm test-machines discover lists them." });
	return f;
}

/** Settings of the user's, as lists: the phones they carry, their test builds, the apps off limits. */
function listSetting(key: string): string[] {
	return String(settings.get(key) ?? "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}
function setList(key: string, list: string[]) {
	settings.set({ [key]: [...new Set(list)].join(", ") });
}

export function registerCli() {
	defineCli({
		summary: "The shared test machines and phones, one thread at a time on each screen. From a thread, a command takes its turn (it ends with the thread's turn); from your terminal, it runs at once.",
		commands: {
			status: cliCommand({
				summary: "The machines: who has each, who's waiting, how to drive it",
				positionals: [{ name: "machine", description: "One machine; all when left out" }],
				options: { live: { type: "boolean", description: "Ask each machine how it is now" }, json: { type: "boolean", description: "Print JSON" } },
				run: async ({ positionals, options }) => {
					if (options.json) {
						await refresh();
						const list = positionals.machine ? [await machineNamed(String(positionals.machine))] : st.machines;
						const out = list.map((m) => {
							const t = turnsOf(m);
							return { id: m.id, name: m.name, kind: m.kind, driver: m.driver.name, about: m.about, holder: t.holder ? { thread: t.holder.thread, title: plainTitle(t.holder.thread), note: t.holder.note || undefined, since: new Date(t.holder.since).toISOString() } : null, waiting: t.waiting.filter((w) => !w.kept).length, carried: carried(m.id) };
						});
						return { stdout: JSON.stringify({ machines: out, problems: st.driverProblems }, null, 2) + "\n" };
					}
					return { stdout: (await ops.status(positionals.machine as string | undefined, !!options.live)).text + "\n" };
				},
			}),
			take: cliCommand({
				summary: "From a thread, wait for its turn and hold it; from your terminal, take the machine for yourself: the agent on it is cut off, the rest wait until you give it back",
				positionals: [machine],
				options: { note: { type: "string", description: "What it's for, shown to the others" }, ...wait },
				run: async ({ positionals, options }, io) => {
					const id = String(positionals.machine);
					if (!io.thread && io.user) {
						const m = await machineNamed(id);
						const from = claim(m, true) as string | null;
						return { stdout: `${m.name} is yours until you give it back (swarm test-machines give-back ${m.id}).${from ? ` ${title(from)} was cut off, and told why.` : ""}\n` };
					}
					return act(io, (thread) => ops.take(thread, id, options.note as string | undefined, minutes(options.wait)));
				},
			}),
			"give-back": cliCommand({
				summary: "Give a machine you took back to the agents (yours alone)",
				positionals: [machine],
				run: async ({ positionals }, io) => {
					userOnly(io, "gives back a machine they took");
					const m = await machineNamed(String(positionals.machine));
					return { stdout: claim(m, false) ? `Gave ${m.name} back to the agents.\n` : `You don't have ${m.name}.\n` };
				},
			}),
			release: cliCommand({
				summary: "From a thread, give its machines back (one, or all); from your terminal, end whichever turn holds the machine",
				positionals: [{ name: "machine", description: "One machine; all of the thread's when left out" }],
				run: async ({ positionals }, io) => {
					const id = positionals.machine as string | undefined;
					if (!io.thread && io.user) {
						if (!id) throw new PluginCliError("Name the machine.", { code: "usage" });
						const m = await machineNamed(id);
						const t = turnsOf(m);
						const h = t.holder;
						if (!h) return { stdout: `${m.name} is free.\n` };
						if (h.thread === USER) claim(m, false);
						else t.release(h.thread);
						return { stdout: `Took ${m.name} back from ${title(h.thread)}.\n` };
					}
					return act(io, (thread) => ops.release(thread, id));
				},
			}),
			run: cliCommand({
				summary: "Run a command on a machine (a phone: adb shell); its output and exit code are the command's",
				positionals: [machine, { name: "command", required: true, variadic: true, description: "The command, after --" }],
				options: {
					exclusive: { type: "boolean", description: "Take the turn: for the app under test, or anything on the screen" },
					timeout: { type: "duration", defaultUnit: "s", description: "Stop it after this (default 10m)" },
					background: { type: "boolean", description: "Answer at once with a job id: swarm test-machines job ID --wait" },
					...wait,
				},
				run: async ({ positionals, options }, io) =>
					act(io, (thread) =>
						ops.run(thread, String(positionals.machine), (positionals.command as string[]).join(" "), {
							exclusive: !!options.exclusive,
							background: !!options.background,
							timeout: typeof options.timeout === "number" ? Math.round(options.timeout / 1000) : undefined,
							wait: minutes(options.wait),
						}),
					),
			}),
			job: cliCommand({
				summary: "A job of yours (run --background's): where it stands, wait for it, or list them",
				positionals: [{ name: "id", description: "Its id; all of yours when left out" }],
				options: { wait: { type: "duration", defaultUnit: "m", description: "Wait this long for it to end (at most 10m)" } },
				run: async ({ positionals, options }, io) => act(io, (thread) => ops.job(thread, positionals.id as string | undefined, options.wait ? "wait" : "status", minutes(options.wait))),
			}),
			capture: cliCommand({
				summary: "Screenshot a machine: prints the file, kept with the thread, and the line that shows it in a reply",
				positionals: [machine],
				options: wait,
				run: async ({ positionals, options }, io) => {
					if (!io.thread) throw new PluginCliError("A screenshot is kept with a thread: run it from one.", { code: "no_thread", hint: "Look at a machine in the Machines panel beside a thread." });
					return act(io, async (thread) => {
						const o = await ops.capture(thread, String(positionals.machine), { show: true, wait: minutes(options.wait) });
						const path = pathOfLine(o.line!);
						return { text: `${path}\n${o.text}` };
					});
				},
			}),
			describe: cliCommand({
				summary: "What's on a machine's screen as named elements, and the point to click each",
				positionals: [machine],
				options: wait,
				run: async ({ positionals, options }, io) => act(io, (thread) => ops.describe(thread, String(positionals.machine), minutes(options.wait))),
			}),
			drive: cliCommand({
				summary: "Click, tap and type on a machine's screen, in its own steps (status says which), one an argument",
				positionals: [machine, { name: "steps", required: true, variadic: true, description: "Its steps, after --" }],
				options: wait,
				run: async ({ positionals, options }, io) => act(io, (thread) => ops.drive(thread, String(positionals.machine), positionals.steps as string[], { wait: minutes(options.wait) })),
			}),
			app: cliCommand({
				summary: "Launch, focus, kill (only what you launched), install or uninstall an app, or read a phone app's logs",
				positionals: [machine, { name: "action", required: true, description: "launch, focus, kill, install, uninstall or logs" }, { name: "target", required: true, description: "The app: a name, a package or bundle id, or a build's file" }, { name: "args", variadic: true, description: "Its arguments, after -- (launch)" }],
				options: { cwd: { type: "string", description: "Where it runs (launch)" }, ...wait },
				run: async ({ positionals, options }, io) =>
					act(io, (thread) => ops.app(thread, String(positionals.machine), String(positionals.action), String(positionals.target), { args: (positionals.args as string[] | undefined) ?? [], cwd: options.cwd as string | undefined, wait: minutes(options.wait) })),
			}),
			put: cliCommand({
				summary: "Copy files from the computer Swarm runs on to a machine",
				positionals: [machine, { name: "paths", required: true, variadic: true, description: "LOCAL… REMOTE" }],
				options: wait,
				run: async ({ positionals, options }, io) => {
					const paths = positionals.paths as string[];
					if (paths.length < 2) throw new PluginCliError("Give the files, then where they go.", { code: "usage" });
					return act(io, (thread) => ops.files(thread, String(positionals.machine), "put", paths.slice(0, -1), paths.at(-1)!, minutes(options.wait)));
				},
			}),
			get: cliCommand({
				summary: "Copy a file from a machine to the computer Swarm runs on",
				positionals: [machine, { name: "remote", required: true }, { name: "local", required: true }],
				options: wait,
				run: async ({ positionals, options }, io) => act(io, (thread) => ops.files(thread, String(positionals.machine), "get", [String(positionals.local)], String(positionals.remote), minutes(options.wait))),
			}),
			power: cliCommand({
				summary: "A machine's power, or a phone's screen: status, on, off",
				positionals: [machine, { name: "action", required: true, description: "status, on or off" }],
				options: wait,
				run: async ({ positionals, options }, io) => act(io, (thread) => ops.power(thread, String(positionals.machine), String(positionals.action), minutes(options.wait))),
			}),
			record: cliCommand({
				summary: "Record a machine's screen: start, do the flow, stop, which prints the line that shows it in a reply",
				positionals: [machine, { name: "action", required: true, description: "start or stop" }],
				options: { title: { type: "string", description: "What it shows (start)" }, seconds: { type: "number", description: "The most it records (start; default 120, at most 180)" }, ...wait },
				run: async ({ positionals, options }, io) => {
					if (!io.thread) throw new PluginCliError("A recording is kept with a thread: run it from one.", { code: "no_thread" });
					const action = String(positionals.action);
					if (action !== "start" && action !== "stop") throw new PluginCliError("record takes start or stop.", { code: "usage" });
					return act(io, (thread) => ops.record(thread, String(positionals.machine), action, { title: options.title as string | undefined, seconds: options.seconds as number | undefined, wait: minutes(options.wait) }));
				},
			}),
			adb: cliCommand({
				summary: "adb on an Android phone of the adb driver, in your turn on it: what it opens is held to the apps agents may use",
				positionals: [machine, { name: "args", required: true, variadic: true, description: "adb's arguments, after --, without -s" }],
				options: wait,
				run: async ({ positionals, options }, io) => act(io, (thread) => ops.adbRaw(thread, String(positionals.machine), positionals.args as string[], minutes(options.wait))),
			}),
			doctor: cliCommand({
				summary: "Check everything the turned-on machines need: Swarm's machines and their permissions, adb and its phones, WebDriverAgent, ssh, bb",
				options: { json: { type: "boolean", description: "Print JSON" } },
				run: async ({ options }) => {
					const checks = await ops.doctor();
					if (options.json) return { stdout: JSON.stringify(checks, null, 2) + "\n" };
					return { stdout: ops.doctorText(checks) + "\n", exitCode: checks.every((c) => c.ok) ? 0 : 1 };
				},
			}),
			connect: cliCommand({
				summary: "Reach an Android phone over wireless debugging (Developer options, Wireless debugging: its address and port, new each time it's turned on), pairing it first with its code",
				positionals: [{ name: "address", required: true, description: "HOST:PORT the phone shows" }],
				options: { pair: { type: "string", description: "HOST:PORT of Pair device with pairing code" }, code: { type: "string", description: "The pairing code" } },
				constraints: [{ requires: ["pair", "code"] }],
				run: async ({ positionals, options }, io) => act(io, () => ops.connect(String(positionals.address), options.pair ? { addr: String(options.pair), code: String(options.code) } : undefined)),
			}),
			discover: cliCommand({
				summary: "The phones plugged into this computer and the computers joined to Swarm, used or not: those the plugin doesn't use yet, the user turns on (Settings, Plugins, Test machines, or use)",
				options: { json: { type: "boolean", description: "Print JSON" } },
				run: async ({ options }) => {
					const phones = await discover();
					if (options.json) return { stdout: JSON.stringify({ phones: phones.map((f) => ({ kind: f.kind, serial: f.serial, model: f.model, pluggedInto: f.placeLabel, used: !!f.id, id: f.id ?? null, carried: f.id ? carried(f.id) : false, problem: f.problem ?? null })) }, null, 2) + "\n" };
					if (!phones.length) return { stdout: "No phones plugged into this computer or the computers joined to Swarm.\n" };
					const lines = phones.map((f) => `${f.model} — ${f.kind === "ios" ? "iPhone" : "Android"}, ${f.serial}, on ${f.placeLabel}: ${f.id ? `in use as ${f.id}${carried(f.id) ? " (the user carries it)" : ""}` : f.problem ? `can't be used yet: ${f.problem}` : "not turned on"}.`);
					if (phones.some((f) => !f.id && !f.problem)) lines.push("", "Only the user turns a phone on: Settings, Plugins, Test machines, or swarm test-machines use PHONE in their terminal.");
					return { stdout: lines.join("\n") + "\n" };
				},
			}),
			use: cliCommand({
				summary: "Turn on a phone discover found, for agents to test on; --carried for the phone you carry (yours alone)",
				positionals: [{ name: "phone", required: true, description: "Its serial or UDID, or its model, as discover lists it" }],
				options: { carried: { type: "boolean", description: "You carry it: agents only install and uninstall your test builds there" } },
				run: async ({ positionals, options }, io) => {
					userOnly(io, "turns on the phones agents test on");
					const f = await foundPhone(String(positionals.phone));
					if (f.problem) throw new PluginCliError(`${f.model} can't be used yet: ${f.problem}.`, { code: "machine" });
					const id = await use(f, !!options.carried);
					const next = f.kind === "ios" && !(await wda.built().catch(() => false)) ? "\nIt needs WebDriverAgent built on the Mac once: swarm test-machines setup-iphone." : "";
					return { stdout: `${f.model} is in use as ${id}${options.carried ? ", the phone you carry" : ""}.${next}\n` };
				},
			}),
			"stop-using": cliCommand({
				summary: "Stop testing on a phone (yours alone)",
				positionals: [{ name: "phone", required: true, description: "Its id, serial, UDID or model" }],
				run: async ({ positionals }, io) => {
					userOnly(io, "says which phones agents test on");
					const f = await foundPhone(String(positionals.phone));
					await stopUsing(f);
					return { stdout: `Agents no longer test on ${f.model}.\n` };
				},
			}),
			"setup-iphone": cliCommand({
				summary: "Build WebDriverAgent on the Mac the iPhones are plugged into, signed with your Apple developer team, for the plugin to run on them (yours alone)",
				options: { team: { type: "string", description: "Your Team ID; the settings' when left out" } },
				run: async ({ options }, io) => {
					userOnly(io, "builds WebDriverAgent with their Apple developer team");
					let team = String(options.team || settings.get("wdaTeam") || "").trim();
					// The team of the Mac's one Apple Development certificate, where none is given.
					if (!team) {
						const teams = await wda.teams().catch(() => []);
						if (teams.length > 1) throw new PluginCliError(`The Mac has certificates of several teams: ${teams.map((t) => `${t.id} (${t.name})`).join(", ")}.`, { code: "usage", hint: "Give one with --team." });
						team = teams[0]?.id ?? "";
					}
					if (team && !settings.get("wdaTeam")) settings.set({ wdaTeam: team });
					if (options.team) settings.set({ wdaTeam: team });
					return { stdout: (await wda.setup(team, (l) => io.print(l))) + "\n" };
				},
			}),
			carry: cliCommand({
				summary: "Say a phone is the one you carry (agents only install and uninstall your test builds there), or give it back to testing with --off (yours alone)",
				positionals: [{ name: "phone", required: true }],
				options: { off: { type: "boolean", description: "Give it back to testing" } },
				run: async ({ positionals, options }, io) => {
					userOnly(io, "says which phones they carry");
					const id = String(positionals.phone);
					const list = listSetting("carried").filter((c) => c.toLowerCase() !== id.toLowerCase());
					setList("carried", options.off ? list : [...list, id]);
					return { stdout: options.off ? `${id} is back to testing.\n` : `${id} is the phone you carry: agents only install and uninstall your test builds there, and read their logs.\n` };
				},
			}),
			"test-apps": cliCommand({
				summary: "Your test builds, which agents may install and uninstall on a phone you carry: lists them, or sets them (yours alone)",
				positionals: [{ name: "ids", variadic: true, description: "Package or bundle ids, * for any part: com.example.app.*" }],
				options: { clear: { type: "boolean", description: "None" } },
				run: async ({ positionals, options }, io) => {
					const ids = (positionals.ids as string[] | undefined) ?? [];
					if (ids.length || options.clear) {
						userOnly(io, "sets their test builds");
						setList("testApps", options.clear ? [] : ids);
					}
					const now = testApps();
					return { stdout: now.length ? now.join("\n") + "\n" : "No test builds yet.\n" };
				},
			}),
			offlimits: cliCommand({
				summary: "Apps agents stay out of besides the built-in kinds (passwords, banking, mail, messages, photos, health, the car, social posting, shopping): lists them, or sets them (yours alone)",
				positionals: [{ name: "apps", variadic: true, description: "Names or ids" }],
				options: { clear: { type: "boolean", description: "None of your own" } },
				run: async ({ positionals, options }, io) => {
					const apps = (positionals.apps as string[] | undefined) ?? [];
					if (apps.length || options.clear) {
						userOnly(io, "says which apps are off limits");
						setList("sensitive", options.clear ? [] : apps);
					}
					const now = listSetting("sensitive");
					return { stdout: `Always: passwords, banking and payments, mail, messages, photos, health, the car, social posting, shopping.\n${now.length ? "Yours: " + now.join(", ") : "None of your own."}\n` };
				},
			}),
		},
	});
}
