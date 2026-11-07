// Simulators: iOS simulators and Android emulators of the agents' own, a
// thread's each, slim (SWARM-…), after bb's Simulator plugin, simlock's
// leases, simslim and avdslim. The pool (pool.ts) says who has which; the
// drivers (ios.ts, android.ts) reach them on the Mac, or wherever the
// Android SDK is; slimming is slimios.ts and slimandroid.ts. The agents act
// through tools (tools.ts) and the command line (cli.ts), both the same
// actions (ops.ts). A thread's simulators go back as its turn ends. The
// panel and the row above the composer show them (panel.tsx); Swarm's
// window shows one live (swarm://screen).
import { hook, on, schedule, settings, ui } from "swarm";
import { registerCli } from "./cli";
import * as ops from "./ops";
import { registerPanel } from "./panel";
import { settingsPage } from "./settingsPage";
import { learnTitles, restore, view } from "./state";
import { registerTools } from "./tools";

export function activate() {
	restore();
	registerTools();
	registerCli();
	registerPanel();
	ui.page({ id: "simulators", title: "Simulators", icon: "mobile", render: settingsPage });
	hook("turnEnd", ({ thread, turn }) => ops.turnEnded(thread, turn));
	on("event", (e) => {
		if (e.type === "thread.renamed" || e.type === "thread.created") void learnTitles();
	});
	settings.onChange(() => view.v++);
	// Each minute: idle holders bumped for those waiting, idle simulators shut down.
	schedule("sweep", "* * * * *", () => ops.sweep());
	void learnTitles();
	void ops.look();
}
