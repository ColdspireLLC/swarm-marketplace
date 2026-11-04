// The Apple developer teams a Mac's signing certificates are of, for
// WebDriverAgent's build: read from openssl's subjects, kept apart from
// the drivers so it's tested without Swarm.

/** The teams of certificates' subjects, as openssl prints them: OU is the Team ID, O its name. */
export function parseTeams(text: string): { id: string; name: string }[] {
	const out = new Map<string, string>();
	for (const line of text.split("\n")) {
		const id = /(?:^|[,/\s])OU\s*=\s*([A-Z0-9]{10})\b/.exec(line)?.[1];
		if (id && !out.has(id)) out.set(id, /(?:^|[,/\s])O\s*=\s*([^,/]+)/.exec(line)?.[1]?.trim() ?? id);
	}
	return [...out].map(([id, name]) => ({ id, name }));
}
