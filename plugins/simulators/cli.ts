// The command line: swarm simulators …, the tools' actions for an agent's
// shell (its builds and scripts), on its thread's own simulator. From the
// user's terminal: the pool's status, what slimming turns off, and ending
// an agent's hold on one.
import { cliCommand, defineCli, PluginCliError, type CliResult, type CommandIO } from "swarm";
import { SimError } from "./ios";
import * as ops from "./ops";
import { PoolError } from "./pool";
import { ANDROID_CATEGORIES, ANDROID_SETTINGS } from "./slimandroid";
import { IOS_CATEGORIES } from "./slimios";
import * as mine from "./mine";
import { canTwin, isTwinName, shelves } from "./picker";
import { info, key, pool, quoted } from "./state";

/** Only the user, from their own terminal, acts on their own simulators: an agent has its own (take). */
function userOnly(io: CommandIO) {
	if (io.user && !io.thread) return;
	throw new PluginCliError("Your own simulators are yours alone: an agent uses one of its own (swarm simulators take).", { code: "user_only", hint: "Run it from your terminal." });
}

/** One of the user's devices, named; listed again first. */
async function device(q: unknown): Promise<mine.Device> {
	await mine.refresh();
	const d = mine.find(String(q ?? ""));
	if (!d) throw new PluginCliError(`No simulator ${String(q ?? "")}: swarm simulators devices lists them.`, { code: "not_found" });
	return d;
}

async function done(err: Promise<string | null>, said: string): Promise<CliResult> {
	const e = await err;
	if (e) throw new PluginCliError(e, { code: "simulator" });
	return { stdout: said + "\n" };
}

const which = { name: "device", required: true, description: "A name, a UDID, or an AVD's name" };

function threadOf(io: CommandIO): string {
	if (io.thread) return io.thread;
	throw new PluginCliError("Only a thread's agent has a simulator of its own.", { code: "no_thread", hint: "Run it from a thread; swarm simulators status shows them all." });
}

async function act(io: CommandIO, fn: (thread: string) => Promise<ops.Out> | ops.Out): Promise<CliResult> {
	const thread = threadOf(io);
	try {
		const o = await fn(thread);
		return { stdout: o.text + "\n", exitCode: o.code ?? 0 };
	} catch (e) {
		if (e instanceof PoolError) throw new PluginCliError(e.message, { code: "busy" });
		if (e instanceof SimError) throw new PluginCliError(e.message, { code: "simulator" });
		throw e;
	}
}

const platform = { name: "platform", description: "ios or android: the one you hold when left out, else ios" };
const wait = { wait: { type: "duration", defaultUnit: "m", description: "How long to wait in line when every simulator is another thread's (default 4m, at most 30m; 0 not to wait)." } } as const;
const minutes = (ms: unknown) => (typeof ms === "number" ? ms / 60_000 : undefined);

export function registerCli() {
	defineCli({
		summary: "The agents' own iOS simulators and Android emulators, slim, one thread's each. From a thread, each command acts on that thread's simulator, taken from the pool as it needs.",
		commands: {
			status: cliCommand({
				summary: "Each agent simulator: who has it, how it is, who waits",
				options: { json: { type: "boolean", description: "Print JSON" } },
				run: async ({ options }) => {
					if (options.json) {
						const slots = pool.slots.map((s) => ({ id: key(s), ...info(s), holder: s.holder ? { thread: s.holder.thread, note: s.holder.note || undefined, since: new Date(s.holder.since).toISOString() } : null }));
						return { stdout: JSON.stringify({ slots, waiting: pool.waiting.map((w) => ({ thread: w.thread, platform: w.platform })) }, null, 2) + "\n" };
					}
					return { stdout: (await ops.status()).text + "\n" };
				},
			}),
			take: cliCommand({
				summary: "Take a simulator of your own (made, slimmed and booted as needed): its name and UDID or serial, to build for",
				positionals: [platform],
				options: { note: { type: "string", description: "What it's for, shown to the user" }, ...wait },
				run: ({ positionals, options }, io) => act(io, (t) => ops.take(t, positionals.platform as string | undefined, { note: options.note as string | undefined, wait: minutes(options.wait) })),
			}),
			release: cliCommand({
				summary: "Give your simulators back now (your turn ending does too); from your terminal, end an agent's hold on one: ios:1, android:2",
				positionals: [{ name: "which", description: "ios or android from a thread; ios:N or android:N from your terminal" }],
				run: async ({ positionals }, io) => {
					const which = positionals.which as string | undefined;
					if (!io.thread && io.user) {
						const s = pool.slots.find((x) => key(x) === which);
						if (!s) throw new PluginCliError(`No simulator ${which ?? ""}: ${pool.slots.map(key).join(", ") || "none yet"}.`, { code: "not_found" });
						const h = s.holder;
						ops.endTurn(s);
						return { stdout: h ? `Took ${info(s).name} back from ${quoted(h.thread)}.\n` : `${info(s).name} is free.\n` };
					}
					return act(io, (t) => ops.release(t, which));
				},
			}),
			describe: cliCommand({
				summary: "Your simulator's screen as named elements and where to tap them",
				positionals: [platform],
				options: wait,
				run: ({ positionals, options }, io) => act(io, (t) => ops.describe(t, positionals.platform as string | undefined, { wait: minutes(options.wait) })),
			}),
			drive: cliCommand({
				summary: "Taps, swipes, keys and text on your simulator, in screenshot pixels: tap X Y, long X Y [MS], swipe X1 Y1 X2 Y2 [MS], type TEXT, key NAME, wait MS",
				positionals: [{ name: "steps", required: true, variadic: true, description: "Each step one argument: 'tap 300 600' 'type hello'" }],
				options: { platform: { type: "enum", values: ["ios", "android"], description: "Which of yours" }, ...wait },
				run: ({ positionals, options }, io) => act(io, (t) => ops.drive(t, options.platform as string | undefined, positionals.steps as string[], { wait: minutes(options.wait) })),
			}),
			app: cliCommand({
				summary: "An app on your simulator: list, launch, terminate, install (a path on the simulators' machine), uninstall, openurl, logs",
				positionals: [{ name: "action", required: true }, { name: "target", description: "Bundle id or package, path, or URL" }],
				options: { platform: { type: "enum", values: ["ios", "android"], description: "Which of yours" }, ...wait },
				run: ({ positionals, options }, io) => act(io, (t) => ops.app(t, options.platform as string | undefined, String(positionals.action), positionals.target as string | undefined, { wait: minutes(options.wait) })),
			}),
			device: cliCommand({
				summary: "Your simulator itself: appearance dark|light, text-size, location LAT,LON|clear, permission, push, status-bar clean|clear; shutdown, reboot, erase, measure",
				positionals: [{ name: "action", required: true }, { name: "value", variadic: true }],
				options: { app: { type: "string", description: "The app a permission or push is for" }, platform: { type: "enum", values: ["ios", "android"], description: "Which of yours" }, ...wait },
				run: ({ positionals, options }, io) =>
					act(io, (t) => ops.device(t, options.platform as string | undefined, String(positionals.action), ((positionals.value as string[] | undefined) ?? []).join(" ") || undefined, { app: options.app as string | undefined, wait: minutes(options.wait) })),
			}),
			shell: cliCommand({
				summary: "A command on your simulator: Android's shell (--root through su), or an iOS simulator's Mac, in its data folder, with $UDID and $DATA set",
				positionals: [{ name: "command", required: true, variadic: true, description: "The command, after --" }],
				options: { root: { type: "boolean", description: "Android: as root" }, timeout: { type: "duration", defaultUnit: "s", description: "Stop it after this (default 2m)" }, platform: { type: "enum", values: ["ios", "android"], description: "Which of yours" }, ...wait },
				run: async ({ positionals, options }, io) => {
					const r = await act(io, (t) => ops.shell(t, options.platform as string | undefined, (positionals.command as string[]).join(" "), { root: !!options.root, timeout: typeof options.timeout === "number" ? options.timeout / 1000 : undefined, wait: minutes(options.wait) }));
					return r;
				},
			}),
			files: cliCommand({
				summary: "Copy a file between your computer and your simulator: put LOCAL REMOTE, get REMOTE LOCAL (iOS: app:BUNDLE/path, or a path in its data folder)",
				positionals: [{ name: "action", required: true, description: "put or get" }, { name: "from", required: true }, { name: "to", required: true }],
				options: { platform: { type: "enum", values: ["ios", "android"], description: "Which of yours" }, ...wait },
				run: ({ positionals, options }, io) => {
					const a = String(positionals.action);
					if (a !== "put" && a !== "get") throw new PluginCliError("put or get.", { code: "usage" });
					const [local, remote] = a === "put" ? [String(positionals.from), String(positionals.to)] : [String(positionals.to), String(positionals.from)];
					return act(io, (t) => ops.files(t, options.platform as string | undefined, a, local, remote, { wait: minutes(options.wait) }));
				},
			}),
			forward: cliCommand({
				summary: "Make your simulator's localhost:PORT reach your dev server (--to host:port or a port on your computer; PORT itself when not given); no PORT lists them",
				positionals: [{ name: "port", description: "The simulator's port" }],
				options: { to: { type: "string", description: "host:port, or a port on your computer" }, remove: { type: "boolean", description: "Undo it (all, with no port)" }, platform: { type: "enum", values: ["ios", "android"], description: "Which of yours" }, ...wait },
				run: ({ positionals, options }, io) =>
					act(io, (t) => ops.forward(t, options.platform as string | undefined, positionals.port === undefined ? undefined : Number(positionals.port), { to: options.to as string | undefined, remove: !!options.remove, wait: minutes(options.wait) })),
			}),
			devices: cliCommand({
				summary: "Your own simulators and emulators, as the Simulator page lists them: running, recent, then by OS; the agents' last",
				options: { json: { type: "boolean", description: "Print JSON" } },
				run: async ({ options }) => {
					await mine.refresh();
					if (options.json) return { stdout: JSON.stringify({ place: mine.page.place, problem: mine.page.problem || undefined, shown: mine.current()?.id, devices: mine.page.devices }, null, 2) + "\n" };
					const lines: string[] = [];
					if (mine.page.problem) lines.push(mine.page.problem);
					const cur = mine.current();
					for (const sh of shelves(mine.page.devices, mine.saved().used, "", Date.now())) {
						lines.push(`${sh.title}:`);
						for (const d of sh.devices) lines.push(`  ${d.id === cur?.id ? "*" : " "} ${d.name}  ${[sh.title === d.os ? "" : d.os, d.state, canTwin(d, mine.page.devices) ? "can have a 120 Hz copy" : ""].filter(Boolean).join(" · ")}  ${d.platform === "ios" ? d.id : d.id.slice(4)}`);
					}
					if (!lines.length) lines.push("No simulators.");
					return { stdout: lines.join("\n") + "\n" };
				},
			}),
			open: cliCommand({
				summary: "Show one of your simulators on the Simulator page, booting it if it's shut down",
				positionals: [which],
				run: async ({ positionals }, io) => {
					userOnly(io);
					const d = await device(positionals.device);
					return done(mine.pick(d), `${d.name} is on the Simulator page${d.state === "Shutdown" ? ", booted" : ""}.`);
				},
			}),
			boot: cliCommand({
				summary: "Boot one of your simulators and wait until it's up",
				positionals: [which],
				run: async ({ positionals }, io) => {
					userOnly(io);
					const d = await device(positionals.device);
					return done(mine.boot(d), `${d.name} is running.`);
				},
			}),
			shutdown: cliCommand({
				summary: "Shut one of your simulators down",
				positionals: [which],
				run: async ({ positionals }, io) => {
					userOnly(io);
					const d = await device(positionals.device);
					return done(mine.shutdown(d), `${d.name} is shut down.`);
				},
			}),
			erase: cliCommand({
				summary: "Erase one of your simulators: its apps, data and settings gone, as new",
				positionals: [which],
				options: { yes: { type: "boolean", description: "It can't be undone: say yes" } },
				run: async ({ positionals, options }, io) => {
					userOnly(io);
					const d = await device(positionals.device);
					if (!options.yes) throw new PluginCliError(`Erasing ${d.name} can't be undone: add --yes.`, { code: "confirm" });
					return done(mine.erase(d), `${d.name} is erased.`);
				},
			}),
			delete: cliCommand({
				summary: "Delete one of your simulators for good",
				positionals: [which],
				options: { yes: { type: "boolean", description: "It can't be undone: say yes" } },
				run: async ({ positionals, options }, io) => {
					userOnly(io);
					const d = await device(positionals.device);
					if (d.agent) throw new PluginCliError(`${d.name} is an agent's: the pool makes and keeps those.`, { code: "agent" });
					if (!options.yes) throw new PluginCliError(`Deleting ${d.name} can't be undone: add --yes.`, { code: "confirm" });
					return done(mine.remove(d), `${d.name} is deleted.`);
				},
			}),
			create: cliCommand({
				summary: "Make an iOS simulator of a model on a runtime, and show it on the Simulator page",
				positionals: [{ name: "model", required: true, description: "The model: iPhone 17 Pro" }],
				options: { os: { type: "string", description: "The runtime: iOS 26.5 (the newest iOS when left out)" }, name: { type: "string", description: "Its name (the model's when left out)" } },
				run: async ({ positionals, options }, io) => {
					userOnly(io);
					mine.catalog.at = 0;
					await mine.loadCatalog();
					const c = mine.catalog.value;
					if (!c) throw new PluginCliError(mine.catalog.problem || "No runtimes.", { code: "simulator" });
					const os = String(options.os ?? "").toLowerCase();
					const rt = os ? c.runtimes.find((r) => r.name.toLowerCase() === os || r.name.toLowerCase().startsWith(os)) : c.runtimes[0];
					if (!rt) throw new PluginCliError(`No runtime ${os}: ${c.runtimes.map((r) => r.name).join(", ")}.`, { code: "not_found" });
					const m = String(positionals.model).toLowerCase();
					const t = rt.types.find((x) => x.name.toLowerCase() === m) ?? rt.types.find((x) => x.name.toLowerCase().startsWith(m));
					if (!t) throw new PluginCliError(`${rt.name} has no ${positionals.model}: ${rt.types.map((x) => x.name).join(", ")}.`, { code: "not_found" });
					const name = String(options.name ?? t.name);
					const err = await mine.create(name, t.id, rt.id);
					if (err) throw new PluginCliError(err, { code: "simulator" });
					return { stdout: `Made ${name} (${t.name}, ${rt.name}), booting on the Simulator page.\n` };
				},
			}),
			twin: cliCommand({
				summary: "Make a 120 Hz copy of one of your ProMotion simulators (a twin whose display runs at 120 Hz), and boot it",
				positionals: [which],
				run: async ({ positionals }, io) => {
					userOnly(io);
					const d = await device(positionals.device);
					if (isTwinName(d.name)) throw new PluginCliError(`${d.name} runs at 120 Hz already.`, { code: "twin" });
					if (!canTwin(d, mine.page.devices)) throw new PluginCliError(`${d.name} can't have one: only ProMotion models (iPhone 13 Pro and later Pros, iPhone 17 and later, iPhone Air, iPad Pro) on iOS, and one copy a model and runtime.`, { code: "twin" });
					return done(mine.makeTwin(d), `Made a 120 Hz copy of ${d.name}, running.`);
				},
			}),
			appearance: cliCommand({
				summary: "Switch one of your simulators between light and dark",
				positionals: [which, { name: "look", description: "dark or light (the other one when left out)" }],
				run: async ({ positionals }, io) => {
					userOnly(io);
					const d = await device(positionals.device);
					await mine.readLook(d);
					const want = positionals.look as string | undefined;
					if (want && want !== "dark" && want !== "light") throw new PluginCliError("dark or light.", { code: "usage" });
					if (want && mine.looks.get(d.id) === want) return { stdout: `${d.name} is ${want} already.\n` };
					const err = await mine.toggleLook(d);
					if (err) throw new PluginCliError(err, { code: "simulator" });
					return { stdout: `${d.name} is ${mine.looks.get(d.id)} now.\n` };
				},
			}),
			slimming: cliCommand({
				summary: "What slimming turns off, by category: the ids the Keep settings take",
				run: () => {
					const lines = ["iOS simulators (Keep in iOS simulators: these ids, or single launchd labels):"];
					for (const [id, c] of Object.entries(IOS_CATEGORIES)) lines.push(`  ${id.padEnd(13)} ${c.what} (${c.labels.length})`);
					lines.push("Android emulators (Keep in Android emulators: these ids, or single packages):");
					for (const [id, c] of Object.entries(ANDROID_CATEGORIES)) lines.push(`  ${id.padEnd(13)} ${c.what} (${c.packages.length} packages)`);
					for (const [id, c] of Object.entries(ANDROID_SETTINGS)) lines.push(`  ${id.padEnd(13)} ${c.what}`);
					return { stdout: lines.join("\n") + "\n" };
				},
			}),
		},
	});
}
