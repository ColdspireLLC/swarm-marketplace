// Coolify in a thread: a segment of the row above the composer, in a
// project whose repository Coolify deploys, saying how its application is
// doing and when it last deployed, with Deploy at its end and each of its
// applications under it while it's open; and a note to the thread's agent
// naming them, so "deploy it" needs no lookup.
import { agents, ui, type Child } from "swarm";
import * as api from "./coolify";
import type { Resource } from "./coolify";
import { conn, deployingNow, lastDeployment, linkedTo, openedOf, PAGE, placeOf, press, threadProject } from "./store";
import { badge, faint, line } from "./view";

function stateOf(r: Resource): { tone: api.Tone | "accent"; label: string } {
	if (deployingNow(r.uuid)) return { tone: "accent", label: "Deploying" };
	const last = lastDeployment(r.uuid);
	if (last?.status === "failed") return { tone: "red", label: "Deploy failed" };
	const s = api.statusOf(r.status);
	return { tone: s.tone, label: s.label };
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
			if (!apps.length) return null;
			const r = apps[0]!;
			const s = stateOf(r);
			const last = lastDeployment(r.uuid);
			return (
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
					<ui.text style={{ ...line, fontWeight: 500 }}>{nameOf(r, apps)}</ui.text>
					{badge(s.tone, s.label)}
					{last && !deployingNow(r.uuid) ? <ui.text style={faint}>{last.status === "failed" ? api.ago(last.created_at) : `deployed ${api.ago(last.created_at)}`}</ui.text> : null}
					{apps.length > 1 ? <ui.text style={faint}>{`+${apps.length - 1}`}</ui.text> : null}
				</ui.box>
			);
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
								<ui.icon icon="cube" style={{ width: 13, height: 13, color: "text3", flexShrink: 0 }} />
								<ui.text style={{ fontWeight: 500, flexShrink: 0 }}>{nameOf(r, apps)}</ui.text>
								{badge(s.tone, s.label)}
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

	// The thread's agent is told which applications its project deploys to.
	agents.instructions(({ project }) => {
		if (!conn()) return null;
		const apps = linkedTo(project);
		if (!apps.length) return null;
		const list = apps.map((r) => `${api.displayName(r)} (${r.uuid}${placeOf(r) ? `, ${placeOf(r)!.project}/${placeOf(r)!.environment}` : ""})`).join(", ");
		return `This project deploys to Coolify as ${list}. ${apps.length === 1 ? "`swarm coolify deploy --wait` deploys it" : "`swarm coolify deploy UUID --wait` deploys one"} after you push; the coolify skill says more.`;
	});
}
