// The Automations page, as Swarm's Pull requests page is laid out: the
// list in one island, the automation opened beside it while there's room
// (alone in a narrow window), and its form in that place. The list groups
// them by how they stand, a strip of each one's latest runs on its row,
// and offers ideas to start from. Paths: "" the list, "a/ID" one,
// "new" and "edit/ID" the form.
import { ui, type Child, type Style } from "swarm";
import { describeCron, formatDuration, nextCron, parseCron, stamp } from "./cron";
import { EditError, setEnabled } from "./edit";
import { draft, fill, Form, openForm } from "./form";
import { askAgent, IDEAS, type Idea } from "./ideas";
import { card, column, doing, empty, fact, faint, heading, line, mark, NAV, project, projectNames, relative, RUN, upcoming, runMark, runTip, soft, state, STATE, strip, title, top, type State } from "./parts";
import { start } from "./runner";
import { activeRun, automations, remove, runs, type Automation, type Run } from "./store";

const USER = { user: true } as const;

const view = ui.store({ search: "", folded: {} as { [group: string]: boolean }, open: {} as { [run: number]: boolean }, deleting: "" });

const GROUPS: { name: string; states: State[] }[] = [
	{ name: "Needs a look", states: ["failing"] },
	{ name: "Active", states: ["running", "on"] },
	{ name: "Paused", states: ["paused"] },
	{ name: "Done", states: ["done"] },
];

const toggle = (a: Automation, on: boolean) => setEnabled(a, on, USER).catch((e) => ui.toast(e instanceof EditError ? e.message : String(e)));

function scheduleText(a: Automation): string {
	return a.cron ? describeCron(a.cron) : a.at ? `Once, ${stamp(a.at)}` : "Once";
}

function nextText(a: Automation): string {
	const s = state(a);
	if (s === "running") return "running now";
	if (s === "done") return a.at ? `ran ${relative(a.at)}` : "ran";
	if (!a.enabled) return "paused";
	return a.nextAt ? `next ${upcoming(a.nextAt)}` : "";
}

// The list.

/** Search shows once there are this many: over a few, it's only in the way. */
const SEARCH_FROM = 8;

function row(a: Automation, chosen: boolean, divided: boolean): Child {
	const s = state(a);
	const many = projectNames.size > 1;
	return (
		<ui.pressable
			key={a.id}
			label={a.name}
			checked={chosen}
			onClick={() => ui.navTo(NAV, chosen ? "" : "a/" + a.id)}
			style={{ minHeight: 60, width: "100%", flexDirection: "row", gap: 12, alignItems: "center", padding: "8 8 8 12", borderTop: divided ? "1px solid divider" : undefined, hover: { backgroundColor: "hover" }, checked: { backgroundColor: "selected" }, transition: { duration: 110, colors: true } }}>
			{mark(a, 16, 26)}
			<ui.box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 3 }}>
				<ui.text style={{ fontWeight: 500, ...line }}>{a.name}</ui.text>
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", overflow: "hidden" }}>
					{many ? project(a.project) : null}
					<ui.text style={{ ...faint, ...line, color: s === "failing" ? "red" : "text3" }}>{[scheduleText(a), s === "failing" ? a.lastError : nextText(a)].filter(Boolean).join(" · ")}</ui.text>
				</ui.box>
			</ui.box>
			{strip(runs.get(a.id) ?? [])}
			<ui.iconButton key="run" icon="play" label={`Run ${a.name} now`} disabled={s === "running"} onClick={() => void start(a, "manual")} style={{ opacity: 0, groupHover: { opacity: 1 }, focus: { opacity: 1 } }} />
			{s === "done" ? <ui.box style={{ width: 32 }} /> : <ui.toggle checked={a.enabled} tooltip={a.enabled ? `On: pause ${a.name}` : `Paused: resume ${a.name}`} onChange={(v) => toggle(a, v)} />}
		</ui.pressable>
	);
}

function matches(a: Automation): boolean {
	const q = view.search.trim().toLowerCase();
	if (!q) return true;
	return [a.name, a.prompt, a.script, projectNames.get(a.project)].some((x) => x?.toLowerCase().includes(q));
}

function ideaCard(i: Idea): Child {
	return (
		<ui.pressable
			key={i.id}
			label={`${i.title}: ${i.blurb}`}
			onClick={() => openForm({ idea: i })}
			style={{ ...card, flexDirection: "column", alignItems: "stretch", flexGrow: 1, flexBasis: 0, minWidth: 220, gap: 8, padding: 14, hover: { backgroundColor: "hover" }, transition: { duration: 110, colors: true } }}>
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
				<ui.icon icon={i.icon} style={{ width: 16, height: 16, color: "text2", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }} />
				<ui.text style={{ fontWeight: 500, ...line }}>{i.title}</ui.text>
				<ui.spacer />
				<ui.iconButton icon="sparkle" label={`Ask an agent to set up ${i.title}`} onClick={() => ui.prefill({ prompt: askAgent(i.blurb.charAt(0).toLowerCase() + i.blurb.slice(1)) })} style={{ opacity: 0, groupHover: { opacity: 1 }, focus: { opacity: 1 } }} />
			</ui.box>
			<ui.text style={soft}>{i.blurb}</ui.text>
			<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
				<ui.tag tone="muted" icon={i.mode === "script" ? "terminal" : "bot"}>
					{i.mode === "script" ? "Script" : "Agent"}
				</ui.tag>
				<ui.text style={faint}>{describeCron(i.cron)}</ui.text>
			</ui.box>
		</ui.pressable>
	);
}

function ideas(): Child {
	return (
		<ui.box key="ideas" style={{ gap: 8 }}>
			{heading("Ideas to start from")}
			<ui.box style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{IDEAS.map(ideaCard)}</ui.box>
		</ui.box>
	);
}

function newMenu(): Child {
	return (
		<ui.menu wide label="New" icon="plus" kind="primary" size="sm" tooltip="New automation">
			<ui.item icon="plus" label="Blank automation" detail="A schedule, and a prompt or a script" onClick={() => openForm()} />
			<ui.item icon="sparkle" label="Ask an agent to set one up" detail="Describe it in a new thread" onClick={() => ui.prefill({ prompt: askAgent("") })} />
			<ui.separator />
			<ui.heading>From an idea</ui.heading>
			{IDEAS.map((i) => (
				<ui.item key={i.id} icon={i.icon} label={i.title} detail={describeCron(i.cron)} onClick={() => openForm({ idea: i })} />
			))}
		</ui.menu>
	);
}

function list(open: string): Child {
	const all = [...automations.values()];
	const shown = all.filter(matches);
	const groups = GROUPS.map((g) => ({ ...g, items: shown.filter((a) => g.states.includes(state(a))).sort((x, y) => (x.nextAt ?? Infinity) - (y.nextAt ?? Infinity) || x.name.localeCompare(y.name)) }));
	let body: Child;
	if (!all.length) {
		body = (
			<ui.box style={{ gap: 24 }}>
				{empty("clock", "No automations yet", "Have an agent work on a prompt, or a script check on something, every morning, every hour, or once at a time you pick.")}
				{ideas()}
			</ui.box>
		);
	} else if (!shown.length) {
		body = empty("search", "No automation matches");
	} else {
		const first = groups.findIndex((g) => g.items.length);
		body = (
			<ui.box style={{ gap: 4 }}>
				{groups.map((g, gi) => {
					if (!g.items.length) return null;
					const folded = !!view.folded[g.name];
					return [
						<ui.pressable
							key={"head-" + g.name}
							label={g.name}
							checked={!folded}
							onClick={() => void (view.folded[g.name] = !folded)}
							style={{ flexDirection: "row", height: 28, gap: 4, alignItems: "center", paddingLeft: 4, paddingRight: 4, borderRadius: "control", alignSelf: "flex-start", marginTop: gi > first ? 16 : 0, hover: { backgroundColor: "hover" } }}>
							<ui.icon icon={folded ? "chevron-right" : "chevron-down"} style={{ width: 12, height: 12, color: "text3" }} />
							<ui.text style={{ fontSize: "small", fontWeight: 600, color: g.name === "Needs a look" ? "red" : "text2", whiteSpace: "nowrap" }}>{g.name}</ui.text>
							<ui.text style={faint}>{String(g.items.length)}</ui.text>
						</ui.pressable>,
						folded ? null : (
							<ui.box key={"rows-" + g.name} style={card}>
								{g.items.map((a, i) => row(a, a.id === open, i > 0))}
							</ui.box>
						),
					];
				})}
			</ui.box>
		);
	}
	return (
		<ui.box style={{ flexGrow: 1, minHeight: 0 }}>
			<ui.box dragWindow style={top} />
			<ui.box style={{ ...column, flexShrink: 0, paddingBottom: 12, gap: 10 }}>
				<ui.box style={{ flexDirection: "row", minHeight: 28, gap: 8, alignItems: "center" }}>
					<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "baseline", flexShrink: 1, minWidth: 0 }}>
						<ui.text style={title}>Automations</ui.text>
						{all.length ? <ui.text style={{ fontSize: "body", color: "text3", whiteSpace: "nowrap" }}>{String(all.length)}</ui.text> : null}
					</ui.box>
					<ui.spacer />
					{newMenu()}
				</ui.box>
				{all.length >= SEARCH_FROM || view.search ? (
					<ui.search key="search" value={view.search} placeholder="Search automations" onChange={(v) => (view.search = v)} />
				) : null}
			</ui.box>
			<ui.scroll key="list" style={{ flexGrow: 1 }}>
				<ui.box style={{ ...column, paddingBottom: 24 }}>{body}</ui.box>
			</ui.scroll>
		</ui.box>
	);
}

// One automation.

const sameDay = (x: number, y: number) => new Date(x).toDateString() === new Date(y).toDateString();

/** The summary's first line: when it runs next (and the times after, faint), or how it stands. */
function nextRow(a: Automation): Child[] {
	const s = state(a);
	if (s === "running") {
		const r = activeRun(a.id)!;
		return [<ui.text key="t" style={{ color: "accent", fontWeight: 500 }}>Running now</ui.text>, <ui.text key="s" style={faint}>{`started ${relative(r.started)}`}</ui.text>];
	}
	if (s === "done") return [<ui.text key="t">{a.at ? `Ran once, ${stamp(a.at)}` : "Ran once"}</ui.text>];
	if (!a.enabled) return [<ui.text key="t" style={{ color: "text2" }}>Paused</ui.text>, <ui.text key="s" style={faint}>resume it to run on its schedule</ui.text>];
	if (!a.nextAt) return [<ui.text key="t">Not scheduled</ui.text>];
	const later: number[] = [];
	if (a.cron) {
		const c = parseCron(a.cron);
		for (let t = a.nextAt, i = 0; i < 2; i++) {
			const n = nextCron(c, t);
			if (n === null) break;
			later.push(n);
			t = n;
		}
	}
	return [
		<ui.text key="t" style={{ fontWeight: 500 }}>{stamp(a.nextAt)}</ui.text>,
		<ui.text key="r" style={{ color: "text2", whiteSpace: "nowrap" }}>{relative(a.nextAt)}</ui.text>,
		later.length ? <ui.text key="l" style={{ ...faint, ...line }}>{`then ${later.map((t) => (sameDay(t, a.nextAt!) ? stamp(t).slice(-5) : stamp(t))).join(", ")}`}</ui.text> : null,
	];
}

function summary(a: Automation): Child {
	const agentish = a.mode === "agent" || !!a.prompt;
	const rows: [string, Child[]][] = [
		["Next run", nextRow(a)],
		["Schedule", [<ui.text key="w">{scheduleText(a)}</ui.text>, a.cron && describeCron(a.cron) !== a.cron ? <ui.text key="c" style={{ ...faint, fontFamily: "mono" }}>{a.cron}</ui.text> : null]],
		["Does", [<ui.icon key="i" icon={a.mode === "script" ? "terminal" : "bot"} style={{ width: 14, height: 14, color: "text2" }} />, <ui.text key="t">{doing(a)}</ui.text>]],
	];
	if (agentish) {
		rows.push(["Agent", [a.provider ? <ui.icon key="i" icon={`agent:${a.provider}`} style={{ width: 14, height: 14 }} /> : null, <ui.text key="t" style={line}>{[a.provider ? a.provider.charAt(0).toUpperCase() + a.provider.slice(1) : "The default agent", a.model, a.effort].filter(Boolean).join(" · ")}</ui.text>]]);
		rows.push(["Permission", [<ui.text key="t">{({ ask: "Ask first", edits: "Accept edits", auto: "Auto", all: "Full access" } as { [k: string]: string })[a.approval ?? ""] ?? "The agent's default"}</ui.text>]]);
	}
	if (a.target) rows.push(["Thread", [<ui.link key="l" label="Open the thread it re-prompts" onClick={() => ui.openThread(a.target!)} />]]);
	if (a.mode === "script") rows.push(["Limit", [<ui.text key="t">{`Stops after ${formatDuration(a.timeoutMs ?? 120_000)}`}</ui.text>]]);
	if (a.origin === "agent") rows.push(["Made by", [<ui.text key="t">An agent</ui.text>, a.creator ? <ui.link key="l" label="Open its thread" onClick={() => ui.openThread(a.creator!)} /> : null]]);
	return <ui.box style={card}>{rows.map(([k, v], i) => fact(k, i > 0, ...v))}</ui.box>;
}

/** The runs as bars, oldest at the left: their height their time taken, their colour how they ended. */
function chart(list: Run[]): Child {
	const shown = list.slice(0, 40).reverse();
	const took = (r: Run) => Math.max(1000, (r.ended ?? Date.now()) - r.started);
	const most = Math.log(Math.max(...shown.map(took)) + 1);
	return (
		<ui.box label="Its runs over time" style={{ ...card, flexDirection: "row", gap: 3, alignItems: "flex-end", height: 72, padding: "12 12 10 12" }}>
			{shown.map((r) => {
				const tone = RUN[r.status].tone;
				const h = r.status === "skipped" ? 6 : 10 + 40 * (Math.log(took(r) + 1) / most);
				return <ui.box key={r.id} tooltip={runTip(r)} style={{ flexGrow: 1, maxWidth: 14, minWidth: 3, height: h, borderRadius: 3, backgroundColor: (r.status === "skipped" ? "divider" : tone === "muted" ? "text3" : tone) as Style["backgroundColor"] }} />;
			})}
		</ui.box>
	);
}

function runRow(r: Run, divided: boolean): Child {
	const out = [r.stdout, r.stderr].filter((x) => x?.trim()).join("\n").trim();
	const more = !!out && out !== (r.summary ?? "").trim();
	const opened = !!view.open[r.id];
	const took = r.ended ? formatDuration(Math.max(1000, r.ended - r.started)) : "";
	return (
		<ui.box key={r.id} style={{ borderTop: divided ? "1px solid divider" : undefined }}>
			<ui.pressable
				label={`${RUN[r.status].label}: ${r.summary ?? ""}`}
				disabled={!more}
				checked={opened}
				onClick={() => void (view.open[r.id] = !opened)}
				style={{ flexDirection: "row", minHeight: 40, gap: 10, alignItems: "center", padding: "6 8 6 12", hover: more ? { backgroundColor: "hover" } : undefined }}>
				{runMark(r)}
				<ui.text tooltip={relative(r.started)} style={{ fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0, width: 118 }}>{stamp(r.started)}</ui.text>
				<ui.text style={{ ...line, flexGrow: 1, fontSize: "small", color: r.status === "failed" ? "red" : "text2" }}>{r.summary ?? (r.status === "running" ? "Running…" : RUN[r.status].label)}</ui.text>
				{r.trigger !== "schedule" ? <ui.icon icon={r.trigger === "manual" ? "hand" : "refresh"} tooltip={r.trigger === "manual" ? "Run by hand" : "A retry"} style={{ width: 12, height: 12, color: "text3", flexShrink: 0 }} /> : null}
				{took ? <ui.text style={{ ...faint, width: 40, textAlign: "right" }}>{took}</ui.text> : null}
				{r.thread ? <ui.iconButton icon="message" label="Open its thread" onClick={() => ui.openThread(r.thread!)} /> : <ui.box style={{ width: 28 }} />}
				{more ? <ui.icon icon={opened ? "chevron-down" : "chevron-right"} style={{ width: 12, height: 12, color: "text3" }} /> : <ui.box style={{ width: 12 }} />}
			</ui.pressable>
			{opened && more ? (
				<ui.box style={{ padding: "0 12 12 36" }}>
					<ui.text selectable style={{ fontFamily: "mono", fontSize: "small", color: "text2", backgroundColor: "field", borderRadius: "control", padding: 10 }}>
						{out}
					</ui.text>
				</ui.box>
			) : null}
		</ui.box>
	);
}

function moreMenu(a: Automation): Child {
	return (
		<ui.menu label="More" icon="more" kind="ghost" size="sm" tooltip="More">
			<ui.item icon="pencil" label="Edit" onClick={() => openForm({ a })} />
			<ui.item icon="copy" label="Duplicate" onClick={() => openForm({ a, copy: true })} />
			<ui.item icon="copy" label="Copy its id" detail={a.id} onClick={() => (ui.copy(a.id), ui.toast("Copied its id"))} />
			<ui.separator />
			<ui.item icon="trash" label="Delete…" danger onClick={() => void (view.deleting = a.id)} />
		</ui.menu>
	);
}

function detail(a: Automation | undefined): Child {
	const close = () => ui.navTo(NAV, "");
	if (!a)
		return (
			<ui.box style={{ flexGrow: 1 }}>
				<ui.box dragWindow style={{ ...top, justifyContent: "flex-end" }}>
					<ui.iconButton icon="x" label="Close" onClick={close} />
				</ui.box>
				{empty("clock", "That automation was deleted")}
			</ui.box>
		);
	const s = state(a);
	const rs = runs.get(a.id) ?? [];
	const count = (st: Run["status"]) => rs.filter((r) => r.status === st).length;
	return (
		<ui.box style={{ flexGrow: 1, minHeight: 0 }}>
			<ui.box dragWindow style={{ ...top, justifyContent: "flex-end" }}>
				<ui.iconButton icon="x" label="Close" onClick={close} />
			</ui.box>
			<ui.scroll key={"a-" + a.id} style={{ flexGrow: 1 }}>
				<ui.box style={{ ...column, gap: 16, paddingBottom: 24 }}>
					<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
						{mark(a, 20, 28)}
						<ui.box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }}>
							<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
								<ui.text style={{ ...title, ...line }}>{a.name}</ui.text>
								{s === "on" ? null : <ui.tag tone={STATE[s].tone}>{STATE[s].label}</ui.tag>}
							</ui.box>
							{project(a.project)}
						</ui.box>
					</ui.box>
					<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
						<ui.button kind="primary" size="sm" icon="play" disabled={s === "running"} onClick={() => void start(a, "manual")}>
							{s === "running" ? "Running…" : "Run now"}
						</ui.button>
						<ui.button kind="secondary" size="sm" icon="pencil" onClick={() => openForm({ a })}>
							Edit
						</ui.button>
						{s === "done" ? null : (
							<ui.button kind="secondary" size="sm" icon={a.enabled ? "pause" : "play"} onClick={() => toggle(a, !a.enabled)}>
								{a.enabled ? "Pause" : "Resume"}
							</ui.button>
						)}
						<ui.spacer />
						{moreMenu(a)}
					</ui.box>
					{view.deleting === a.id ? (
						<ui.card tone="red" icon="trash" title={`Delete ${a.name}?`}>
							<ui.text style={soft}>{`It and its ${rs.length === 1 ? "run" : `${rs.length} runs`} go; the threads it started stay.`}</ui.text>
							<ui.box style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
								<ui.button kind="danger" size="sm" onClick={async () => (await remove(a.id), (view.deleting = ""), close(), ui.toast(`Deleted ${a.name}`))}>
									Delete
								</ui.button>
								<ui.button kind="ghost" size="sm" onClick={() => void (view.deleting = "")}>
									Keep it
								</ui.button>
							</ui.box>
						</ui.card>
					) : null}
					{a.lastError ? (
						<ui.card tone="red" icon="alert" title={a.failures > 1 ? `Failed ${a.failures} times in a row` : "Its last run failed"}>
							<ui.text selectable>{a.lastError}</ui.text>
							{a.retryAt ? <ui.text style={soft}>{`Trying again ${relative(a.retryAt)}.`}</ui.text> : null}
						</ui.card>
					) : null}
					{summary(a)}
					{a.mode === "script" ? (
						<ui.box style={{ gap: 8 }}>
							{heading("Script", <ui.tag tone="muted">{a.interpreter ?? "sh"}</ui.tag>)}
							<ui.box>
								<ui.source text={a.script ?? ""} language={a.interpreter === "node" ? "javascript" : a.interpreter === "python3" ? "python" : "bash"} />
							</ui.box>
						</ui.box>
					) : null}
					{a.prompt ? (
						<ui.box style={{ gap: 8 }}>
							{heading(a.mode === "script" ? "Then an agent is told" : "Prompt")}
							<ui.box style={{ ...card, padding: "10 14" }}>
								<ui.markdown>{a.prompt}</ui.markdown>
							</ui.box>
						</ui.box>
					) : null}
					<ui.box style={{ gap: 8 }}>
						{heading("Runs", rs.length ? <ui.text style={faint}>{[`${rs.length}`, count("ok") && `${count("ok")} done`, count("failed") && `${count("failed")} failed`, count("skipped") && `${count("skipped")} skipped`].filter(Boolean).join(" · ")}</ui.text> : null)}
						{rs.length ? (
							<ui.box style={{ gap: 8 }}>
								{rs.length >= 5 ? chart(rs) : null}
								<ui.box style={card}>{rs.slice(0, 25).map((r, i) => runRow(r, i > 0))}</ui.box>
							</ui.box>
						) : (
							<ui.box style={card}>{empty("history", "No runs yet", a.enabled && a.nextAt ? `Its first runs ${upcoming(a.nextAt)}.` : "Run it now to try it.")}</ui.box>
						)}
					</ui.box>
				</ui.box>
			</ui.scroll>
		</ui.box>
	);
}

/** The count of failing ones, on the page's row. */
export function syncNav() {
	const failing = [...automations.values()].filter((a) => state(a) === "failing").length;
	ui.navBadge(NAV, failing ? { text: String(failing) } : null);
}

export function registerPage() {
	ui.nav({
		id: NAV,
		title: "Automations",
		icon: "clock",
		islands: true,
		render: ({ args }) => {
			const path = String(args.path || "");
			let side: Child = null;
			let open = "";
			if (path === "new") side = Form();
			else if (path.startsWith("edit/")) {
				const a = automations.get(path.slice(5));
				if (a && ui.untracked(() => draft.id) !== a.id) ui.untracked(() => fill({ a }));
				side = a ? Form() : detail(undefined);
				open = a?.id ?? "";
			} else if (path.startsWith("a/")) {
				open = path.slice(2);
				side = detail(automations.get(open));
			}
			return (
				<ui.box style={{ flexDirection: "row", flexGrow: 1, minHeight: 0, gap: 6, alignItems: "stretch" }}>
					<ui.island key="list" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, display: side ? "none" : "flex", media: [{ minWidth: 900, style: { display: "flex" } }] }}>
						{list(open)}
					</ui.island>
					{side ? (
						<ui.island key="side" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, media: [{ minWidth: 900, style: { flexGrow: 0, flexBasis: "56%" } }] }}>
							{side}
						</ui.island>
					) : null}
				</ui.box>
			);
		},
	});
	ui.command({ id: "new-automation", title: "New automation", icon: "clock", palette: true, run: () => openForm() });
}
