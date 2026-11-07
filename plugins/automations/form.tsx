// The form that makes and changes an automation: its name and project, a
// schedule (presets, or a cron, or a day and time once), what it runs (an
// agent or a script, as two cards), and where an agent's runs go, with a
// sentence at its foot saying what it will do.
import { call, ui, type Child, type ThreadInfo } from "swarm";
import { describeCron, formatDuration, nextCron, parseCron, parseDuration, stamp } from "./cron";
import { apply, EditError, INTERPRETERS, type Spec } from "./edit";
import { askAgent, type Idea } from "./ideas";
import { column, faint, line, NAV, projectNames, soft, title, top } from "./parts";
import { automations, type Automation } from "./store";

const USER = { user: true } as const;

type Where = "thread" | "worktree" | "target";
interface Draft {
	id?: string;
	name: string;
	project: string;
	mode: "agent" | "script";
	repeat: "cron" | "once";
	cron: string;
	day: string;
	time: string;
	prompt: string;
	provider: string;
	model: string;
	effort: string;
	approval: string;
	where: Where;
	target: string;
	script: string;
	interpreter: string;
	timeout: string;
	error: string;
	saving: boolean;
}

/** Each project's threads, for the thread a run re-prompts. */
const threadsOf = ui.store(new Map<string, ThreadInfo[]>());

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function blank(): Draft {
	const soon = new Date(Date.now() + 3_600_000);
	soon.setMinutes(0, 0, 0);
	return { id: undefined, name: "", project: "", mode: "agent", repeat: "cron", cron: "0 9 * * 1-5", day: dayOf(soon), time: timeOf(soon), prompt: "", provider: "", model: "", effort: "", approval: "auto", where: "thread", target: "", script: "", interpreter: "sh", timeout: "2m", error: "", saving: false };
}

export const draft = ui.store<Draft>(blank());

/** Fills the form: with a to change it, an idea to start from, a thread to re-prompt; else anew. */
export function fill(o: { a?: Automation; copy?: boolean; idea?: Idea; target?: ThreadInfo } = {}) {
	Object.assign(draft, blank(), { project: [...projectNames.keys()][0] ?? "" });
	const { a, idea, target } = o;
	if (a) {
		const at = a.at ? new Date(a.at) : null;
		Object.assign(draft, {
			id: o.copy ? undefined : a.id,
			name: o.copy ? `${a.name} (copy)` : a.name,
			project: a.project,
			mode: a.mode,
			repeat: a.cron ? "cron" : "once",
			cron: a.cron ?? draft.cron,
			...(at && at.getTime() > Date.now() ? { day: dayOf(at), time: timeOf(at) } : {}),
			prompt: a.prompt ?? "",
			provider: a.provider ?? "",
			model: a.model ?? "",
			effort: a.effort ?? "",
			approval: a.approval ?? "",
			where: a.target ? "target" : a.worktree ? "worktree" : "thread",
			target: a.target ?? "",
			script: a.script ?? "",
			interpreter: a.interpreter ?? "sh",
			timeout: formatDuration(a.timeoutMs ?? 120_000).replace(" ", ""),
		});
	}
	if (idea) Object.assign(draft, { name: idea.name, mode: idea.mode, cron: idea.cron, prompt: idea.prompt, script: idea.script ?? "", where: idea.worktree ? "worktree" : "thread" });
	if (target) Object.assign(draft, { project: target.project, where: "target", target: target.id, name: `Check in on ${target.title}`.slice(0, 80) });
	if (draft.where === "target") void learnThreads(draft.project);
}

export function openForm(o: Parameters<typeof fill>[0] = {}) {
	fill(o);
	ui.navTo(NAV, o.a && !o.copy ? "edit/" + o.a.id : "new");
}

async function learnThreads(project: string) {
	if (!project) return;
	const list = await call("Threads", { project }).catch(() => [] as ThreadInfo[]);
	threadsOf.set(
		project,
		list.filter((t) => !t.archived && !t.hidden),
	);
}

function spec(): Spec {
	const d = draft;
	const agentish = d.mode === "agent" || !!d.prompt.trim();
	return {
		name: d.name,
		project: d.project || undefined,
		mode: d.mode,
		...(d.repeat === "cron" ? { cron: d.cron } : { at: `${d.day}T${d.time}` }),
		prompt: d.prompt,
		provider: d.provider,
		model: d.model,
		effort: d.effort,
		approval: d.approval,
		worktree: agentish && d.where === "worktree",
		target: agentish && d.where === "target" ? d.target : "",
		...(d.mode === "script" ? { script: d.script, interpreter: d.interpreter, timeout: d.timeout } : {}),
	};
}

async function submit() {
	if (draft.saving) return;
	const was = draft.id ? automations.get(draft.id) : undefined;
	draft.saving = true;
	try {
		const a = await apply(spec(), USER, was);
		draft.error = "";
		ui.navTo(NAV, "a/" + a.id);
		ui.toast(was ? `Saved ${a.name}` : `Made ${a.name}`);
	} catch (e) {
		draft.error = e instanceof EditError ? e.message : String(e);
	}
	draft.saving = false;
}

const PRESETS = [
	{ label: "Every 15 minutes", cron: "*/15 * * * *" },
	{ label: "Every hour", cron: "0 * * * *" },
	{ label: "Every morning at 9", cron: "0 9 * * *" },
	{ label: "Weekdays at 9", cron: "0 9 * * 1-5" },
	{ label: "Mondays at 9", cron: "0 9 * * 1" },
];

/** A segmented control at its own width, as Swarm's are. */
const fit = { alignSelf: "flex-start" } as const;

function labelled(label: string, children: Child, hint?: Child): Child {
	return (
		<ui.box style={{ gap: 6 }}>
			<ui.text style={{ fontSize: "small", fontWeight: 500, color: "text2" }}>{label}</ui.text>
			{children}
			{hint ? <ui.text style={{ fontSize: "small", color: "text3" }}>{hint}</ui.text> : null}
		</ui.box>
	);
}

/** A part of the form: its name, then its fields, a rule above it as Settings has between its groups. */
function section(name: string, ...children: Child[]): Child {
	return (
		<ui.box key={name || "first"} style={{ gap: 14, paddingTop: name ? 20 : 0, borderTop: name ? "1px solid divider" : undefined }}>
			{name ? <ui.text style={{ fontWeight: 600 }}>{name}</ui.text> : null}
			{children}
		</ui.box>
	);
}

/** The cron's next few times, or what's wrong with it. */
function upcoming(expr: string): { ok: boolean; text: string; times: number[] } {
	try {
		const c = parseCron(expr);
		const times: number[] = [];
		let t = Date.now();
		for (let i = 0; i < 3; i++) {
			const n = nextCron(c, t);
			if (n === null) break;
			times.push(n);
			t = n;
		}
		return { ok: true, text: describeCron(expr), times };
	} catch (e) {
		return { ok: false, text: (e as Error).message, times: [] };
	}
}

function scheduleSection(): Child {
	const d = draft;
	const up = upcoming(d.cron);
	const at = Date.parse(`${d.day}T${d.time}`);
	const soon = (ms: number) => {
		const t = new Date(Date.now() + ms);
		d.day = dayOf(t);
		d.time = timeOf(t);
	};
	const at9 = (days: number) => {
		const t = new Date();
		t.setDate(t.getDate() + days);
		t.setHours(9, 0, 0, 0);
		d.day = dayOf(t);
		d.time = "09:00";
	};
	return section(
		"When",
		<ui.segmented
			key="repeat"
			label="Repeat or once"
			value={d.repeat}
			options={[
				{ value: "cron", label: "On a repeat" },
				{ value: "once", label: "Once" },
			]}
			onChange={(v) => (d.repeat = v as Draft["repeat"])}
			style={fit}
		/>,
		d.repeat === "cron" ? (
			<ui.box key="cron" style={{ gap: 10 }}>
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<ui.select
						label="Repeat"
						style={{ backgroundColor: "field", borderRadius: "control", boxShadow: "inset 0 0 0 1px border", paddingLeft: 8, paddingRight: 4 }}
						value={PRESETS.find((p) => p.cron === d.cron.trim())?.cron ?? "custom"}
						options={[...PRESETS.map((p) => ({ value: p.cron, label: p.label })), { value: "custom", label: "Custom" }]}
						onChange={(v) => v !== "custom" && (d.cron = v)}
					/>
					<ui.field key="cron" value={d.cron} placeholder="0 9 * * 1-5" tooltip="Five fields in this computer's time: minute, hour, day of the month, month, day of the week" onChange={(v) => (d.cron = v)} style={{ width: 160, fontFamily: "mono" }} />
					<ui.text style={{ color: up.ok ? "text2" : "red", ...line }}>{up.text}</ui.text>
				</ui.box>
				{up.times.length ? (
					<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
						<ui.text style={faint}>Next</ui.text>
						<ui.text style={{ fontSize: "small", color: "text2", ...line }}>{up.times.map(stamp).join("  ·  ")}</ui.text>
					</ui.box>
				) : null}
			</ui.box>
		) : (
			<ui.box key="once" style={{ gap: 10 }}>
				<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<ui.menu label={Number.isNaN(at) ? "Pick a day" : stamp(at).replace(/, \d\d:\d\d$/, "")} icon="calendar" kind="secondary" size="sm">
						<ui.item icon="clock" label="In 1 hour" onClick={() => soon(3_600_000)} />
						<ui.item icon="clock" label="In 3 hours" onClick={() => soon(3 * 3_600_000)} />
						<ui.item icon="sun" label="Tomorrow at 9" onClick={() => at9(1)} />
						<ui.item icon="calendar" label="Monday at 9" onClick={() => at9(((8 - new Date().getDay()) % 7) || 7)} />
						<ui.separator />
						<ui.calendar label="Another day…" icon="calendar" value={d.day} onChange={(v) => (d.day = v)} />
					</ui.menu>
					<ui.text style={faint}>at</ui.text>
					<ui.field key="time" value={d.time} placeholder="09:00" onChange={(v) => (d.time = v)} style={{ width: 72, fontFamily: "mono" }} />
					<ui.text style={{ ...soft, ...line }}>{Number.isNaN(at) ? "A time as 09:30" : at < Date.now() ? "That has passed" : relative(at)}</ui.text>
				</ui.box>
			</ui.box>
		),
	);
}

function relative(t: number) {
	const ms = t - Date.now();
	return ms < 60_000 ? "In under a minute" : `In ${formatDuration(ms)}`;
}

function taskSection(): Child {
	const d = draft;
	const script = d.mode === "script";
	return section(
		"What it does",
		labelled(
			"Runs",
			<ui.segmented
				label="What it runs"
				value={d.mode}
				options={[
					{ value: "agent", label: "An agent" },
					{ value: "script", label: "A script" },
				]}
				onChange={(v) => (d.mode = v as Draft["mode"])}
				style={fit}
			/>,
			script ? "A script runs on this computer, and wakes an agent only when it prints something." : "An agent works on the prompt, in a thread of its own or one you have.",
		),
		script ? (
			<ui.box key="script" style={{ gap: 16 }}>
				{labelled(
					"Script",
					<ui.field key="script" multiline value={d.script} placeholder={'curl -fsS https://example.com/health > /dev/null || echo "down"'} onChange={(v) => (d.script = v)} style={{ fontFamily: "mono", minHeight: 96 }} />,
					'Runs in its project\'s folder. Printing nothing, or a last line {"wakeAgent": false}, is a quiet run; a non-zero exit is a failure.',
				)}
				<ui.box style={{ flexDirection: "row", gap: 16 }}>
					{labelled("Runs with", <ui.select value={d.interpreter} options={INTERPRETERS.map((v) => ({ value: v, label: v }))} onChange={(v) => (d.interpreter = v)} />)}
					{labelled("Stops after", <ui.field key="timeout" value={d.timeout} placeholder="2m" onChange={(v) => (d.timeout = v)} style={{ width: 96 }} />, parseDuration(d.timeout, "ms") === null ? "A duration: 90s, 5m" : undefined)}
				</ui.box>
			</ui.box>
		) : null,
		labelled(
			script ? "Then, when it prints something, tell an agent" : "Prompt",
			<ui.field key="prompt" multiline value={d.prompt} placeholder={script ? "Optional: look into what the check found and tell me." : "Triage yesterday's new issues and summarise what needs me."} onChange={(v) => (d.prompt = v)} style={{ minHeight: 96 }} />,
			script ? "Leave it empty to only keep the script's output." : undefined,
		),
	);
}

function agentSection(): Child {
	const d = draft;
	if (d.mode === "script" && !d.prompt.trim()) return null;
	const threads = threadsOf.get(d.project) ?? [];
	return section(
		"Agent",
		<ui.box key="pickers" style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
			<ui.agentPicker provider={d.provider} value={d.model} effort={d.effort} onChange={(v) => ((d.provider = v.provider), (d.model = v.model), (d.effort = v.effort ?? ""))} />
			<ui.modePicker provider={d.provider} value={d.approval} onChange={(v) => (d.approval = v)} />
		</ui.box>,
		labelled(
			"Each run",
			<ui.segmented
				label="Where each run goes"
				style={fit}
				value={d.where}
				options={[
					{ value: "thread", label: "New thread" },
					{ value: "worktree", label: "New worktree" },
					{ value: "target", label: "A thread I have" },
				]}
				onChange={(v) => {
					d.where = v as Where;
					if (v === "target") void learnThreads(d.project);
				}}
			/>,
			d.where === "worktree" ? "Each run's thread gets a worktree and branch of its own." : d.where === "target" ? "The thread gets the prompt as a message; the run ends with its turn." : "Each run starts a thread in the project's folder.",
		),
		d.where === "target" ? (
			<ui.select key="target" label="Thread" value={d.target} options={[{ value: "", label: threads.length ? "Choose a thread" : "No threads in this project" }, ...threads.map((t) => ({ value: t.id, label: t.title || t.id }))]} onChange={(v) => (d.target = v)} />
		) : null,
	);
}

/** What it will do, as a sentence. */
function sentence(): string {
	const d = draft;
	const when = d.repeat === "cron" ? (upcoming(d.cron).ok ? describeCron(d.cron) : "On a schedule") : Number.isNaN(Date.parse(`${d.day}T${d.time}`)) ? "Once" : `Once, ${stamp(Date.parse(`${d.day}T${d.time}`))}`;
	const where = d.where === "target" ? "re-prompts a thread" : d.where === "worktree" ? "starts a thread in a new worktree" : "starts a thread";
	const what = d.mode === "script" ? (d.prompt.trim() ? `runs its ${d.interpreter} script, and ${where} when it prints something` : `runs its ${d.interpreter} script`) : where;
	const place = projectNames.size > 1 && projectNames.get(d.project) ? ` in ${projectNames.get(d.project)}` : "";
	return `${when}, it ${what}${place}.`;
}

export function Form(): Child {
	const d = draft;
	const was = d.id ? automations.get(d.id) : undefined;
	const close = () => ui.navTo(NAV, was ? "a/" + was.id : "");
	const projectOptions = [...projectNames].map(([value, label]) => ({ value, label }));
	return (
		<ui.box style={{ flexGrow: 1, minHeight: 0 }}>
			<ui.box dragWindow style={{ ...top, justifyContent: "flex-end" }}>
				<ui.iconButton icon="x" label="Close" onClick={close} />
			</ui.box>
			<ui.scroll style={{ flexGrow: 1 }}>
				<ui.box style={{ ...column, gap: 20, paddingBottom: 32 }}>
					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
						<ui.text style={title}>{was ? `Edit ${was.name}` : "New automation"}</ui.text>
						<ui.spacer />
						{was ? null : (
							<ui.button kind="ghost" size="sm" icon="sparkle" onClick={() => ui.prefill({ project: d.project || undefined, prompt: askAgent(d.prompt || "") })}>
								Ask an agent to set it up
							</ui.button>
						)}
					</ui.box>
					{section(
						"",
						<ui.box key="name" style={{ flexDirection: "row", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
							<ui.box style={{ flexGrow: 1, minWidth: 220 }}>{labelled("Name", <ui.field key="name" value={d.name} placeholder="What it's called" autoFocus={!was} onChange={(v) => (d.name = v)} />)}</ui.box>
							{projectOptions.length > 1 ? (
								<ui.box style={{ minWidth: 180 }}>
									{labelled(
										"Project",
										<ui.select
											value={d.project}
											options={projectOptions}
											onChange={(v) => {
												d.project = v;
												d.target = "";
												if (d.where === "target") void learnThreads(v);
											}}
										/>,
									)}
								</ui.box>
							) : null}
						</ui.box>,
					)}
					{scheduleSection()}
					{taskSection()}
					{agentSection()}
				</ui.box>
			</ui.scroll>
			<ui.box style={{ borderTop: "1px solid divider", flexShrink: 0 }}>
				<ui.box style={{ ...column, flexDirection: "row", gap: 8, alignItems: "center", paddingTop: 12, paddingBottom: 12 }}>
					<ui.box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }}>
						{d.error ? <ui.text style={{ fontSize: "small", color: "red" }}>{d.error}</ui.text> : <ui.text style={{ ...soft }}>{sentence()}</ui.text>}
					</ui.box>
					<ui.button kind="ghost" size="sm" onClick={close}>
						Cancel
					</ui.button>
					<ui.button kind="primary" size="sm" disabled={d.saving} onClick={() => submit()}>
						{was ? "Save" : "Make it"}
					</ui.button>
				</ui.box>
			</ui.box>
		</ui.box>
	);
}
