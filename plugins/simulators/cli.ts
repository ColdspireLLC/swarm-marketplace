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
import { info, key, pool, quoted } from "./state";

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
