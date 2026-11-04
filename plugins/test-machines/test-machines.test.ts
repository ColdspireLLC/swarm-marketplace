import { expect, test, type T } from "swarm/test";

// The demo machine alone: bb's would reach the real ones.
async function demo(t: T) {
	await t.set("bb", false);
	await t.set("demo", true);
}

const call = (name: string, args: object) => `tool test-machines_${name} ${JSON.stringify(args)}`;

test("status lists the machines, and the steps each takes", async (t) => {
	await demo(t);
	const out = await t.run("status");
	expect(out.stdout).toContain("demo — Demo machine: free.");
	const th = await t.thread(call("machine_status", {}));
	await th.see("Input steps: click X Y, type TEXT, open APP, wait MS");
});

test("a command, and a screenshot the agent sees and shows", async (t) => {
	await demo(t);
	const run = await t.thread(call("machine_run", { machine: "demo", command: 'echo "hi from the demo"' }));
	await run.see("The tool said: Exit code 0.\nhi from the demo");
	const shot = await t.thread(call("machine_capture", { machine: "demo", show: true }));
	await shot.see("![Screenshot of Demo machine](");
	await shot.see("[image/png]");
	const line = (await shot.text()).match(/!\[Screenshot of Demo machine\]\(<[^>]+>\)/)![0];
	// The line in a reply shows the screen in the thread.
	await shot.send(`say Here it is:\n\n${line}`);
	await shot.see("Here it is:");
	await shot.idle();
	const w = await t.window();
	await w.show(shot);
	await w.see("Screenshot of Demo machine");
	await w.screenshot("test-machines-shot");
	// Swarm keeps it with the thread, as it is, not copied again as the
	// turn ends: the reply still shows it once the plugin restarted.
	const path = line.slice(line.indexOf("](<") + 3, -2);
	expect(path).toContain(`${shot.id}/shown-`);
	const kept = await t.until(async () => {
		const d = await t.call("Thread", { thread: shot.id });
		const paths = (d.thread?.items ?? []).flatMap((it: any) => it.media ?? []).map((f: any) => String(f.path).replace(/\\/g, "/"));
		
		return paths.length ? paths : null;
	}, { what: "the reply's picture kept" });
	expect([...new Set(kept)]).toEqual([path]);
	await t.reload();
	await w.show(shot);
	await w.see("Screenshot of Demo machine");
}, { timeout: 180000 });

test("one thread at a time on the screen; its turn ends with its turn", async (t) => {
	await demo(t);
	// A holds the machine while its command runs.
	const a = await t.thread(call("machine_run", { machine: "demo", command: "sleep 3; echo done", exclusive: true }));
	await t.until(async () => (await t.run("status")).stdout.includes("'s turn"), { what: "A's turn" });
	const b = await t.thread(call("machine_drive", { machine: "demo", steps: ["click 10 10"], wait: 0 }));
	await b.see("is thread");
	await b.see("'s turn");
	await a.see("Exit code 0.\ndone");
	await a.idle();
	// A's turn ended: the machine's free, and B gets it. The plugin hears
	// of it in its turnEnd hook, which nothing waits for: the thread is
	// idle first.
	await t.until(async () => (await t.run("status")).stdout.includes("demo — Demo machine: free."), { what: "A's turn to end" });
	await b.send(call("machine_drive", { machine: "demo", steps: ["click 40 60", "type hello"], capture: true }));
	await b.see("Done on Demo machine.\nclicked 40,60\ntyped hello");
});

test("the Machines panel shows a screen, and the user takes the machine", async (t) => {
	await demo(t);
	const th = await t.thread("say Hello.");
	await th.idle();
	const w = await t.window();
	await w.panel(th, "machines");
	await w.see("Demo machine");
	await w.see("Free: the next agent to use it gets it at once.");
	// Its screen shows without a click: a card with none looks by itself.
	await w.see("Screenshot of Demo machine");
	await w.see("just now · by you");
	// The picture, as the window has it once it comes.
	await w.screenshot("test-machines-panel", { delay: 500 });
	// The user takes it from the panel, and gives it back.
	await w.click("Use it myself");
	await w.see("You have it since just now. Agents wait until you give it back.");
	expect((await t.run("status")).stdout).toContain("the user's turn");
	await w.screenshot("test-machines-panel-yours");
	await w.click("Give it back");
	await w.see("Free: the next agent to use it gets it at once.");
});

test("the user takes a machine: the agent on it is cut off, the rest wait until they give it back", async (t) => {
	await demo(t);
	// A holds the machine with a command that runs until the test opens its gate.
	const gate = `${t.project}/gate`;
	const a = await t.thread(call("machine_run", { machine: "demo", command: `while [ ! -e '${gate}' ]; do sleep 0.05; done; echo done`, exclusive: true }));
	await t.until(async () => (await t.run("status")).stdout.includes("'s turn"), { what: "A's turn" });
	// The row above A's composer says what it does there, and the rail's page that an agent has it.
	const w = await t.window();
	await w.show(a);
	await w.see("Using");
	await w.see(`running while [ ! -e`);
	await w.screenshot("test-machines-composer");
	await w.click("Test machines");
	await w.see("1 in use");
	await w.screenshot("test-machines-page");
	// An agent's shell can't take it for the user, nor end A's turn.
	const b = await t.thread("say Hello.");
	await b.idle();
	expect((await t.runIn(b, "give-back", "demo")).code).not.toBe(0);
	expect((await t.runIn(b, "release", "demo")).stdout).toContain("You don't hold Demo machine.");
	expect((await t.run("status")).stdout).toMatch(/demo — Demo machine: thread \w+'s turn|demo — Demo machine: “/);
	const took = await t.run("take", "demo");
	expect(took.stdout).toContain("Demo machine is yours");
	expect(took.stdout).toContain("was cut off");
	// B waits behind the user, and is told why.
	await b.send(call("machine_drive", { machine: "demo", steps: ["click 10 10"], wait: 0 }));
	await b.see("is the user's turn");
	await b.see("The user took it: stop, and tell them what you were doing there.");
	// Not even a look or a command beside the user, for an agent.
	await b.send(call("machine_run", { machine: "demo", command: `touch '${gate}'` }));
	await b.see("The user took Demo machine: it's theirs until they give it back.");
	// A's command goes on to its end, and its call says the user took the machine.
	await t.run("run", "demo", "--", `touch '${gate}'`);
	await a.see("The user took Demo machine while this ran");
	await a.see("done");
	await a.idle();
	expect((await t.run("status")).stdout).toContain("the user's turn");
	// Still theirs after the plugin restarts.
	await t.reload();
	expect((await t.run("status")).stdout).toContain("the user's turn");
	expect((await t.run("give-back", "demo")).stdout).toContain("Gave Demo machine back");
	await b.send(call("machine_drive", { machine: "demo", steps: ["click 40 60"] }));
	await b.see("Done on Demo machine.\nclicked 40,60");
});

test("agents stay out of sensitive apps, and off the phone the user carries", async (t) => {
	await demo(t);
	const th = await t.thread(call("machine_app", { machine: "demo", action: "launch", target: "Mail" }));
	await th.see("Mail is an app agents stay out of (mail)");
	// A step that lands in one is undone, and no screenshot is taken of one.
	await th.send(call("machine_drive", { machine: "demo", steps: ["open com.apple.MobileSMS"] }));
	await th.see("That opened com.apple.MobileSMS (messages), an app agents stay out of, so it was put away at once.");
	await th.send(call("machine_capture", { machine: "demo" }));
	await th.see("Demo machine's screen.");
	// One the user added; Photoshop isn't photos.
	await t.set("sensitive", "Notes");
	await th.send(call("machine_app", { machine: "demo", action: "launch", target: "Notes" }));
	await th.see("Notes is an app agents stay out of (one you listed)");
	await th.send(call("machine_app", { machine: "demo", action: "launch", target: "Photoshop" }));
	await th.see("Launched Photoshop.");
	// The phone the user carries: their test builds' uninstalls and logs, nothing else.
	await t.set("carried", "demo");
	await t.set("testApps", "com.example.app.*");
	await th.send(call("machine_capture", { machine: "demo" }));
	await th.see("Demo machine is the phone the user carries");
	await th.send(call("machine_app", { machine: "demo", action: "uninstall", target: "com.whatsapp" }));
	await th.see("may only install and uninstall test builds (com.example.app.*)");
	await th.send(call("machine_app", { machine: "demo", action: "install", target: "/builds/app.apk" }));
	await th.see("can't tell whose build /builds/app.apk is");
	// A test build's goes through to the driver (which has no uninstall).
	await th.send(call("machine_app", { machine: "demo", action: "uninstall", target: "com.example.app.dev" }));
	await th.see("The demo machine can launch and kill, not uninstall.");
});

test("a recording, started and stopped by its thread, is saved for its reply to show", async (t) => {
	await demo(t);
	// Start, a step, stop: in one turn, as an agent does.
	const th = await t.thread([call("machine_record", { machine: "demo", action: "start", title: "The demo flow" }), call("machine_drive", { machine: "demo", steps: ["click 20 30"] }), call("machine_record", { machine: "demo", action: "stop" })].join("\n"));
	await th.see("Recording Demo machine, 120 s at most");
	await th.see("Saved. Put this line in your reply");
	await th.idle();
	const line = (await th.text()).match(/!\[The demo flow\]\(<([^>]+)>\)/)!;
	expect(line[1]).toContain(`${th.id}/shown-`);
	// It's there, where the plugin wrote it: a run of what the path names.
	const there = await t.thread(call("machine_run", { machine: "demo", command: `test -s '${line[1]}' && echo there` }));
	await there.see("Exit code 0.\nthere");
	// The reply shows it, as Swarm keeps it.
	await th.send(`say Here:\n\n${line[0]}`);
	await th.idle();
	const w = await t.window();
	await w.show(th);
	await w.see("The demo flow");
	// The user taking the machine drops a recording, in the same turn: it would hold what they did.
	const gate = `${t.project}/rec-gate`;
	const r2 = await t.thread(
		[
			call("machine_record", { machine: "demo", action: "start" }),
			call("machine_run", { machine: "demo", command: `while [ ! -e '${gate}' ]; do sleep 0.05; done`, exclusive: true }),
			call("machine_record", { machine: "demo", action: "stop" }),
		].join("\n"),
	);
	await r2.see("Recording Demo machine");
	await t.until(async () => JSON.parse((await t.run("status", "--json")).stdout).machines[0].holder?.thread === r2.id, { what: "the recording thread's command" });
	await t.run("take", "demo");
	await t.run("run", "demo", "--", `touch '${gate}'`);
	await r2.see("You aren't recording Demo machine.");
	await r2.idle();
	await t.run("give-back", "demo");
	// One that its turn ended on is gone: another thread may record.
	await th.send(call("machine_record", { machine: "demo", action: "start" }));
	await th.idle();
	const other = await t.thread([call("machine_record", { machine: "demo", action: "start", title: "Another" }), call("machine_record", { machine: "demo", action: "stop" })].join("\n"));
	await other.see("![Another](");
});

test("an agent's shell takes its thread's turn, and the user's settings are theirs alone", async (t) => {
	await demo(t);
	const th = await t.thread("say Hello.");
	await th.idle();
	// A command's output and exit code are its own; --exclusive holds the thread's turn.
	const ok = await t.runIn(th, "run", "demo", "--exclusive", "--", "echo", "from the shell");
	expect(ok.stdout).toContain("Exit code 0.\nfrom the shell");
	expect(ok.code).toBe(0);
	expect((await t.runIn(th, "run", "demo", "--", "exit 3")).code).toBe(3);
	const held = JSON.parse((await t.run("status", "demo", "--json")).stdout).machines[0];
	expect(held.holder.thread).toBe(th.id);
	// Its turn ends with its thread's.
	await th.send("say Done.");
	await th.idle();
	await t.until(async () => JSON.parse((await t.run("status", "--json")).stdout).machines[0].holder === null, { what: "the turn to end" });
	// Off limits, carried phones and test builds: the user sets them, an agent only reads them.
	expect((await t.runIn(th, "offlimits", "Notes")).code).not.toBe(0);
	expect((await t.runIn(th, "carry", "demo")).code).not.toBe(0);
	await t.run("test-apps", "com.example.*");
	expect((await t.runIn(th, "test-apps")).stdout).toContain("com.example.*");
	await t.run("carry", "demo");
	const refused = await t.runIn(th, "drive", "demo", "--", "click 1 1");
	expect(refused.stderr).toContain("Demo machine is the phone the user carries");
	await t.run("carry", "demo", "--off");
	expect((await t.runIn(th, "drive", "demo", "--", "click 1 1")).stdout).toContain("Done on Demo machine.");
	// Files here are the thread's own: none from elsewhere on this computer.
	const away = await t.runIn(th, "put", "demo", "--", "../../outside.txt", "/x");
	expect(away.stderr).toContain("isn't in your thread's folder");
	// doctor checks what's turned on: the demo machine, and no computer joined to this Swarm.
	const doc = await t.run("doctor");
	expect(doc.stdout).toContain("✓ demo: Demo machine");
	expect(doc.stdout).toContain("✗ Swarm's machines: none connected");
	expect(doc.code).toBe(1);
});
