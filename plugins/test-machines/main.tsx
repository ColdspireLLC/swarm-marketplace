// Test machines: the shared test machines for Swarm's agents, ported from
// bb's test-machines (SWARM-132, SWARM-330). Each machine has a line of
// Swarm's threads (turns.ts); the drivers reach the machines (drivers.ts);
// what agents stay out of is held here (rules.ts), not asked of them. The
// agents act through tools (tools.ts) and the command line (cli.ts), both
// the same actions (ops.ts). A thread's turns end with its turn of the
// conversation. The Machines panel (panel.tsx) shows who has what; the
// Settings page (settingsPage.tsx) sets them up.
import { hook, on, settings, ui } from "swarm";
import { registerCli } from "./cli";
import { discover } from "./discover";
import { turnEnded } from "./ops";
import { PAGE, registerPanel } from "./panel";
import { settingsPage } from "./settingsPage";
import { learnTitles, refresh } from "./state";
import { registerTools } from "./tools";

export function activate() {
	ui.tracked();
	registerTools();
	registerCli();
	registerPanel();
	ui.page({ id: PAGE, title: "Test machines", icon: "laptop-mobile", render: settingsPage });

	hook("turnEnd", ({ thread, turn }) => turnEnded(thread, turn));
	on("event", (e) => {
		// Titles, for who has what.
		if (e.type === "thread.renamed" || e.type === "thread.created") void learnTitles();
	});
	settings.onChange(() => void refresh());
	void refresh();
	void learnTitles();
	// The phones plugged in, for the panel to say when one's unused.
	void discover().catch(() => {});
}
