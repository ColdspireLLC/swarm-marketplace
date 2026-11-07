// Ideas: automations people make first, each filling the form (or told
// to an agent to set up), as bb's templates do.
import type { IconName } from "swarm";

export interface Idea {
	id: string;
	title: string;
	icon: IconName;
	/** What it does, a line. */
	blurb: string;
	name: string;
	mode: "agent" | "script";
	cron: string;
	prompt: string;
	script?: string;
	worktree?: boolean;
}

export const IDEAS: Idea[] = [
	{
		id: "triage",
		title: "Morning triage",
		icon: "sun",
		blurb: "Each weekday at 9, sums up what changed overnight and what needs you.",
		name: "Morning triage",
		mode: "agent",
		cron: "0 9 * * 1-5",
		prompt: "Look at what changed in this project since yesterday morning: new commits on the main branch, merge requests opened or updated, and failing pipelines. Summarise what needs me today, most urgent first, in a short list. Don't change anything.",
	},
	{
		id: "ci",
		title: "CI failure watch",
		icon: "alert-circle",
		blurb: "Checks the main branch's pipeline each hour and fixes only new failures.",
		name: "CI failure watch",
		mode: "agent",
		cron: "0 * * * 1-5",
		worktree: true,
		prompt: "Check the main branch's latest pipeline. If it passed, or failed the same way as the last time you looked, stop and say so in a line. If it's a new failure, find the cause, fix it on a branch of your own and open a merge request.",
	},
	{
		id: "deps",
		title: "Dependency drift",
		icon: "layers",
		blurb: "Each Monday, updates dependencies whose new versions look safe.",
		name: "Dependency drift",
		mode: "agent",
		cron: "0 10 * * 1",
		worktree: true,
		prompt: "List this project's outdated dependencies. Update the ones whose changes look low-risk (patch and minor releases with nothing breaking in their notes), run the tests, and open a merge request. List the rest, with why they need a closer look.",
	},
	{
		id: "health",
		title: "Health check",
		icon: "heart-pulse",
		blurb: "A script pings the site every 10 minutes; an agent wakes only if it's down.",
		name: "Health check",
		mode: "script",
		cron: "*/10 * * * *",
		script: 'url="https://example.com/health"\ncurl -fsS --max-time 10 "$url" > /dev/null || echo "$url didn\'t answer"',
		prompt: "The health check failed. Find out why the site isn't answering (recent deploys, logs, the service's status) and tell me what you found. Don't restart or change anything.",
	},
	{
		id: "worktrees",
		title: "Stale branches",
		icon: "branch",
		blurb: "Each Friday, lists branches and worktrees nobody touched in two weeks.",
		name: "Stale branches",
		mode: "agent",
		cron: "0 16 * * 5",
		prompt: "List this repository's branches and worktrees with no commits in the last 14 days, with each one's last commit, author and whether it was merged. Suggest which are safe to delete. Don't delete anything.",
	},
	{
		id: "changelog",
		title: "Weekly changelog",
		icon: "file-text",
		blurb: "Each Friday afternoon, drafts the week's changes for the team.",
		name: "Weekly changelog",
		mode: "agent",
		cron: "0 15 * * 5",
		prompt: "Draft a changelog of what merged into the main branch this week, grouped as features, fixes and chores, in plain words for the team. Leave out merges and version bumps.",
	},
];

/** The new thread's prompt that asks an agent to set an automation up. */
export function askAgent(what: string): string {
	return `Set up a Swarm automation (with \`swarm automations\`, as its skill says) that ${what.trim() || "…"}\n\nPick a clear name and a schedule that fits, show me what you made with \`swarm automations show\`, and run it once so we can see it work.`;
}
