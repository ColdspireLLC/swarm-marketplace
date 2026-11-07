// Automations in a thread: the row above the composer of a thread an
// automation started or re-prompts, saying which (and, for one it
// re-prompts, when it comes back), a clock on its row in the sidebar,
// and "Automate this thread…" in each thread's menu. The schedule itself
// is the automation's page's to say.
import { call, ui, type Child } from "swarm";
import { fill, openForm } from "./form";
import { line, NAV, relative, state } from "./parts";
import { automations, runs, type Automation } from "./store";

/** The automation a thread belongs to: one that re-prompts it, else the one whose run started it. */
function of(thread: string): Automation | undefined {
	for (const a of automations.values()) if (a.target === thread) return a;
	for (const [id, list] of runs) if (list.some((r) => r.thread === thread)) return automations.get(id);
	return undefined;
}

/** The threads given a badge, so one no longer an automation's loses it. */
const marked = new Set<string>();

/** Each automation's threads' clocks in the sidebar: red while one it re-prompts is failing. */
export function syncBadges() {
	const ids = new Set(marked);
	for (const a of automations.values()) if (a.target) ids.add(a.target);
	for (const list of runs.values()) for (const r of list) if (r.thread) ids.add(r.thread);
	for (const thread of ids) {
		const a = of(thread);
		if (!a) {
			ui.badge(thread, null);
			marked.delete(thread);
			continue;
		}
		const again = a.target === thread;
		ui.badge(thread, { icon: "clock", tone: again && state(a) === "failing" ? "red" : "muted", tooltip: `${again ? "Re-prompted by" : "Started by"} ${a.name}` });
		marked.add(thread);
	}
}

export function registerThread() {
	ui.context({
		id: "automation",
		title: "Automation",
		icon: "clock",
		group: "automations",
		summary: ({ thread }): Child => {
			const a = of(thread);
			if (!a) return null;
			const s = state(a);
			const again = a.target === thread;
			// When it comes back, only to a thread it re-prompts: one it started gets no more runs.
			const when = !again ? "" : s === "running" ? "running now" : !a.enabled ? "paused" : a.nextAt ? `next ${relative(a.nextAt)}` : "";
			return (
				<ui.box label={`Automation ${a.name}`} style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
					<ui.text style={{ fontWeight: 500, color: s === "failing" ? "red" : s === "running" ? "accent" : "text2", flexShrink: 0 }}>{again ? "Re-prompted by" : "Started by"}</ui.text>
					<ui.text style={{ fontWeight: 500, ...line }}>{a.name}</ui.text>
					{when ? <ui.text style={{ color: "text3", ...line }}>{when}</ui.text> : null}
				</ui.box>
			);
		},
		badge: ({ thread }) => {
			const a = of(thread);
			return a && state(a) === "running" ? <ui.box label="Running" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "accent", animation: { name: "pulse" } }} /> : null;
		},
		action: ({ thread }) => {
			const a = of(thread);
			return a ? <ui.iconButton icon="arrow-right" label={`Open ${a.name}`} href={`swarm://plugin/${NAV}/a/${a.id}`} /> : null;
		},
	});

	ui.threadMenu({
		id: "automate",
		title: "Automate this thread…",
		icon: "clock",
		group: "automations",
		run: async ({ thread }) => {
			if (!thread) return;
			// To the page at once, while the click is the user's; the thread's name follows.
			openForm();
			const info = (await call("Thread", { thread })).info;
			fill({ target: info });
		},
	});
}
