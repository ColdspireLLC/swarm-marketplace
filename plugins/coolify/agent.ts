// What the page hands an agent: a new thread, filled in, on what went
// wrong or what to set up, in the Swarm project it's about.
import { settings, ui } from "swarm";
import * as api from "./coolify";
import type { Deployment, Resource } from "./coolify";
import { conn, placeOf, projectsOf } from "./store";

const fence = (lines: string[]) => "```\n" + lines.join("\n") + "\n```";

/** The last lines of a log worth reading: from the first error near its end, else its tail. */
export function tail(lines: string[], n = 40): string[] {
	const last = lines.slice(-200);
	const first = last.findIndex((l) => /\b(error|err!|failed|fatal|exception)\b/i.test(l));
	const from = first >= 0 ? Math.max(0, Math.min(first - 5, last.length - n)) : last.length - n;
	return last.slice(Math.max(0, from), Math.max(0, from) + n);
}

function where(r: Resource): string {
	const p = placeOf(r);
	return p ? ` (Coolify project ${p.project}, ${p.environment})` : "";
}

/** A prompt to fix a failed deployment, with what its log says. */
export function fixPrompt(r: Resource, d: Deployment, log?: Deployment): string {
	const lines = api.logLines((log ?? d).logs).map((l) => l.output);
	const commit = d.commit && d.commit !== "HEAD" ? ` of commit ${d.commit.slice(0, 7)}${d.commit_message ? ` ("${d.commit_message.split("\n")[0]}")` : ""}` : "";
	return [
		`The Coolify deployment${commit} of ${api.displayName(r)}${where(r)} failed ${api.ago(d.created_at)}. Its uuid is ${r.uuid}; the deployment's is ${d.deployment_uuid}.`,
		lines.length ? `The end of its build log:\n\n${fence(tail(lines))}` : "",
		`Read the whole log with \`swarm coolify deployment-log ${d.deployment_uuid}\`, find the cause and fix it. If it's in the code, commit and push the fix; if it's Coolify's setup (env vars, build pack, ports), say what to change, and change it with Coolify's tools if you have them. Then deploy again with \`swarm coolify deploy ${r.uuid} --wait\` and tell me whether it worked.`,
	]
		.filter(Boolean)
		.join("\n\n");
}

/** A prompt to find out why a resource is unhealthy or down. */
export function lookPrompt(r: Resource): string {
	const s = api.statusOf(r.status);
	return [
		`${api.displayName(r)}${where(r)} on Coolify is ${s.label.toLowerCase()} (${r.status}). Its uuid is ${r.uuid}.`,
		r.type === "service" ? "" : `Read its containers' logs with \`swarm coolify logs ${r.uuid} --lines 300\`, and its last deployments with \`swarm coolify show ${r.uuid}\`.`,
		"Find out why, and tell me what you found before changing anything on the server. If it's the code, fix it, push, and deploy with `swarm coolify deploy " + r.uuid + " --wait`.",
	]
		.filter(Boolean)
		.join(" ");
}

/** A prompt to put a project on Coolify, with Coolify's own tools. */
export function setupPrompt(): string {
	const c = conn();
	const host = c ? api.baseOf(c.url).replace(/^https?:\/\//, "") : "my Coolify";
	return [
		`Put this project on my Coolify (${host}) as a new application, with the coolify MCP tools.`,
		"Start with its coolify_help tool (topic deploy_app_from_git), and look at how this repository builds and runs.",
		"Before creating anything, ask me which Coolify project and environment it goes in, its domain, and the secrets it needs; I'll give secrets through the Secrets plugin, never in the chat.",
		"Then create it, set its env vars, deploy with `swarm coolify deploy <uuid> --wait`, and check the site answers.",
	].join(" ");
}

/** Opens a new thread on a resource, in the Swarm project it's built from. */
export function ask(r: Resource | undefined, prompt: string) {
	const project = r ? projectsOf(r)[0]?.id : undefined;
	ui.prefill({ project, prompt });
}

/** Whether agents have Coolify's own tools. */
export const agentsCanSetUp = () => String(settings.get("mcpAgents") ?? "") !== "";
