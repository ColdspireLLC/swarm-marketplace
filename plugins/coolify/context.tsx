// Coolify in a thread, of a project whose repository Coolify deploys: a
// segment of the row above the composer while there's news (one of its
// applications deploying, failing or not Running), and none while they
// run. It has a dot on its icon saying how they're doing (pulsing while
// one deploys), the name of the one that's news, its state, when a
// failed deploy failed, Deploy at its end, and each of its applications under it
// while it's open. Deploy to Coolify, in the palette and the composer's /,
// deploys from any of the project's threads. And a note to the thread's
// agent naming them, so "deploy it" needs no lookup.
import { agents, ui, type Child } from "swarm";
import * as api from "./coolify";
import type { Resource } from "./coolify";
import { conn, deployingNow, lastDeployment, linkedTo, openedOf, PAGE, placeOf, press, threadProject, threadProjectNow } from "./store";
import { dot, faint, line } from "./view";

type State = { tone: api.Tone | "accent"; label: string };

function stateOf(r: Resource): State {
	if (deployingNow(r.uuid)) return { tone: "accent", label: "Deploying" };
	const last = lastDeployment(r.uuid);
	if (last?.status === "failed") return { tone: "red", label: "Deploy failed" };
	const s = api.statusOf(r.status);
	return { tone: s.tone, label: s.label };
}

// The dot's order: one deploying first, then a failure, a warning, running, and what's stopped.
const rank: Record<State["tone"], number> = { accent: 4, red: 3, amber: 2, green: 1, muted: 0 };

/** The worst of the applications' states, the one the dot shows. */
function worst(apps: Resource[]): State {
	let w = stateOf(apps[0]!);
	for (const r of apps.slice(1)) {
		const s = stateOf(r);
		if (rank[s.tone] > rank[w.tone]) w = s;
	}
	return w;
}

const isNews = (r: Resource) => api.news(r.status, lastDeployment(r.uuid), deployingNow(r.uuid));

/** The application the row names: the worst of those that are news, the first of them on a tie. */
function headline(apps: Resource[]): Resource | undefined {
	let best: Resource | undefined;
	for (const r of apps.filter(isNews)) if (!best || rank[stateOf(r).tone] > rank[stateOf(best).tone]) best = r;
	return best;
}

/** How long a failed deploy's time shows beside it. */
const RECENT = 60 * 60 * 1000;

/**
 * What the row says after the name: a state that isn't Running in its
 * tone, a failed deploy's time beside it while that's recent.
 */
function said(r: Resource): Child[] {
	const s = stateOf(r);
	if (s.tone === "accent") return [<ui.text key="s" style={{ color: "accent", flexShrink: 0 }}>Deploying…</ui.text>];
	const last = lastDeployment(r.uuid);
	const recent = !!last && Date.now() - api.parseTime(last.created_at) < RECENT;
	const out: Child[] = [];
	if (s.tone !== "green") out.push(<ui.text key="s" style={{ color: s.tone === "muted" ? "text2" : s.tone, flexShrink: 0, whiteSpace: "nowrap" }}>{s.label}</ui.text>);
	const failed = last?.status === "failed";
	if (recent && failed) out.push(<ui.text key="w" style={{ ...faint, ...line }}>{api.ago(last.created_at)}</ui.text>);
	return out;
}

const nameOf = (r: Resource, all: Resource[]) => {
	const env = placeOf(r)?.environment;
	const twins = all.filter((x) => api.displayName(x) === api.displayName(r)).length > 1;
	return twins && env ? `${api.displayName(r)} (${env})` : api.displayName(r);
};

function deploy(r: Resource) {
	const c = conn();
	if (!c) return;
	void press(r, openedOf(r), "deploy");
}

/** Deploy to Coolify, from a thread: its project's application, or of several the one named. */
async function deployFrom(thread: string, named: string) {
	if (!conn()) return ui.toast("Coolify isn't connected: Settings, Coolify.");
	const project = await threadProjectNow(thread);
	const apps = linkedTo(project);
	if (!apps.length) return ui.toast("Coolify doesn't deploy this thread's project.");
	const want = named.trim().toLowerCase();
	const r = apps.length === 1 && !want ? apps[0] : apps.find((x) => [x.uuid, x.name, api.displayName(x), nameOf(x, apps)].some((n) => n.toLowerCase() === want));
	if (!r) return ui.toast(`Name one: ${apps.map((x) => nameOf(x, apps)).join(", ")}.`);
	if (deployingNow(r.uuid)) return ui.toast(`${nameOf(r, apps)} is deploying already.`);
	deploy(r);
}

// single is the details of a project's one application: its last
// deployment, its commit's message and how it went, and where it's served.
function single(r: Resource): Child {
	const last = lastDeployment(r.uuid);
	const doms = api.domains(r.fqdn);
	const commit = last?.commit && last.commit !== "HEAD" ? last.commit.slice(0, 7) : "";
	const how = last ? api.deploymentStatus(last.status) : null;
	return (
		<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
			<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
				{last ? (
					<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
						{commit ? <ui.text style={{ fontFamily: "mono", fontSize: 12, color: "text2", flexShrink: 0 }}>{commit}</ui.text> : null}
						<ui.text style={{ ...line, fontWeight: 500 }}>{last.commit_message?.split("\n")[0] || "Deployed"}</ui.text>
					</ui.box>
				) : (
					<ui.text style={{ ...line, color: "text2" }}>Not deployed yet</ui.text>
				)}
				<ui.text style={{ ...faint, ...line }}>{[last && how ? `${how.label} ${api.ago(last.updated_at ?? last.created_at)}` : "", doms[0]?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ")}</ui.text>
			</ui.box>
			{doms[0] ? <ui.iconButton icon="globe" label={`Open ${doms[0]}`} href={/^https?:\/\//.test(doms[0]) ? doms[0] : `https://${doms[0]}`} /> : null}
			<ui.iconButton icon="external" label={`${api.displayName(r)} in Coolify's page`} href={`swarm://plugin/${PAGE}/r/${r.uuid}`} />
		</ui.box>
	);
}

export function registerContext() {
	ui.context({
		id: "coolify",
		title: "Coolify",
		icon: "coolify:logo",
		group: "coolify",
		summary: ({ thread }) => {
			if (!conn()) return null;
			const apps = linkedTo(threadProject(thread));
			const r = headline(apps);
			if (!r) return null;
			return (
				<ui.box label={`${nameOf(r, apps)}, ${stateOf(r).label}`} style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
					<ui.text style={{ ...line, fontWeight: 500 }}>{nameOf(r, apps)}</ui.text>
					{said(r)}
					{apps.length > 1 ? <ui.text style={{ ...faint, flexShrink: 0 }}>{`+${apps.length - 1}`}</ui.text> : null}
				</ui.box>
			);
		},
		badge: ({ thread }) => {
			if (!conn()) return null;
			const apps = linkedTo(threadProject(thread));
			if (!apps.length) return null;
			const w = worst(apps);
			if (w.label === "Unknown") return null;
			return dot(w.tone, apps.length > 1 ? `${w.label}: ${apps.filter((r) => stateOf(r).label === w.label).map((r) => nameOf(r, apps)).join(", ")}` : w.label, w.tone === "accent");
		},
		action: ({ thread }) => {
			const apps = linkedTo(threadProject(thread));
			if (!apps.length) return null;
			if (apps.length === 1) return <ui.iconButton icon="rocket" label={`Deploy ${api.displayName(apps[0]!)}`} disabled={deployingNow(apps[0]!.uuid)} onClick={() => deploy(apps[0]!)} />;
			return (
				<ui.menu label="Deploy" icon="rocket" kind="ghost" size="sm">
					{apps.map((r) => (
						<ui.item key={r.uuid} icon="rocket" label={`Deploy ${nameOf(r, apps)}`} disabled={deployingNow(r.uuid)} onClick={() => deploy(r)} />
					))}
				</ui.menu>
			);
		},
		details: ({ thread }) => {
			const apps = linkedTo(threadProject(thread));
			// One application: the line above names it, says how it is
			// and deploys it, so this says what it doesn't.
			if (apps.length === 1) return single(apps[0]!);
			return (
				<ui.box style={{ gap: 2 }}>
					{apps.map((r): Child => {
						const s = stateOf(r);
						const last = lastDeployment(r.uuid);
						const doms = api.domains(r.fqdn);
						return (
							<ui.box key={r.uuid} style={{ flexDirection: "row", gap: 8, alignItems: "center", minHeight: 30 }}>
								{dot(s.tone, s.label, s.tone === "accent")}
								<ui.text style={{ fontWeight: 500, flexShrink: 0 }}>{nameOf(r, apps)}</ui.text>
								{s.tone !== "green" ? <ui.text style={{ fontSize: "small", color: s.tone === "muted" ? "text2" : s.tone, flexShrink: 0 }}>{s.label}</ui.text> : null}
								<ui.text style={{ ...faint, ...line, flex: 1 }}>{[doms[0]?.replace(/^https?:\/\//, ""), last ? `${last.commit && last.commit !== "HEAD" ? last.commit.slice(0, 7) + " " : ""}${api.ago(last.created_at)}` : ""].filter(Boolean).join(" · ")}</ui.text>
								{doms[0] ? <ui.iconButton icon="globe" label={`Open ${doms[0]}`} href={/^https?:\/\//.test(doms[0]) ? doms[0] : `https://${doms[0]}`} /> : null}
								<ui.iconButton icon="external" label={`${api.displayName(r)} in Coolify's page`} href={`swarm://plugin/${PAGE}/r/${r.uuid}`} />
								<ui.button size="sm" icon="rocket" disabled={deployingNow(r.uuid)} onClick={() => deploy(r)}>{deployingNow(r.uuid) ? "Deploying…" : "Deploy"}</ui.button>
							</ui.box>
						);
					})}
				</ui.box>
			);
		},
	});

	// The row's Deploy, while the row says nothing: from the palette, or
	// the composer's / with the application's name when there are several.
	ui.command({ id: "deploy", title: "Deploy to Coolify", detail: "This thread's project's application", icon: "rocket", hint: "[app]", palette: true, slash: true, thread: true, run: ({ thread, text }) => deployFrom(thread, text) });

	// The thread's agent is told which applications its project deploys to.
	agents.instructions(({ project }) => {
		if (!conn()) return null;
		const apps = linkedTo(project);
		if (!apps.length) return null;
		const list = apps.map((r) => `${api.displayName(r)} (${r.uuid}${placeOf(r) ? `, ${placeOf(r)!.project}/${placeOf(r)!.environment}` : ""})`).join(", ");
		return `This project deploys to Coolify as ${list}. ${apps.length === 1 ? "`swarm coolify deploy --wait` deploys it" : "`swarm coolify deploy UUID --wait` deploys one"} after you push; the coolify skill says more.`;
	});
}
