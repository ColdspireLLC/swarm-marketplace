// Automations: scheduled work, after bb's Automations plugin. An
// automation runs on a cron or once, either an agent given a prompt (a
// thread of its own each run, or a thread it re-prompts) or a script run
// here, whose output can wake an agent. What's due starts on the minute's
// tick, or a timer between ticks (runner.ts); what's kept is store.ts;
// making and changing them, and what an agent may make, edit.ts; the
// command line cli.ts, the page page.tsx.
import { hook, schedule, ui } from "swarm";
import { registerCli } from "./cli";
import { registerPage, syncNav } from "./page";
import { learnProjects } from "./parts";
import { registerThread } from "./thread";
import { arm, settle, tick, turnEnded } from "./runner";
import { listeners, load } from "./store";

export async function activate() {
	ui.tracked();
	registerCli();
	registerPage();
	registerThread();
	hook("turnEnd", (p) => turnEnded(p.thread, p.reason, p.error));
	schedule("tick", "* * * * *", async () => {
		tick();
		await learnProjects();
	});
	await load();
	listeners.push(syncNav, arm);
	syncNav();
	await learnProjects();
	await settle();
	tick();
}
