// Project keys as Flux has them (its app's lib/identifiers.ts): two to
// five letters, upper-cased, none of the words its routes use, none
// another project has or had. A project whose key changes keeps the old
// one among its aliases, so ABC-12 still finds its issue.

/** The words Flux's routes use, which no project can be keyed. */
export const RESERVED_PROJECT_KEYS: ReadonlySet<string> = new Set([
	"AUTH", "ADMIN", "USER", "HOME", "INBOX", "TEAM", "API", "ISSUE", "ISSUES", "SETTINGS", "ASSETS", "HEALTH", "CONFIG",
	"PROJECT", "PROJECTS", "MINE", "DOCS", "DOCUMENT", "DOCUMENTS", "INVITES", "ONBOARDING", "SIGNIN", "SIGNUP",
]);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A project as its key's rules see it: its key, and the keys it had. */
export interface Keyed {
	id: string;
	name?: string;
	key: string;
	aliases: string[];
}

/** What's typed as a key, as Flux keeps it: its letters, upper-cased, five at most. */
export function normalizeProjectKey(value: string): string {
	return value.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
}

export function isValidProjectKey(key: string): boolean {
	return key.length >= 2 && key.length <= 5 && !RESERVED_PROJECT_KEYS.has(key);
}

/** Why a key can't be one, as Flux's dialog says it; null for a key it takes. */
export function keyProblem(key: string): string | null {
	if (!key) return null;
	if (RESERVED_PROJECT_KEYS.has(key)) return "That project key is reserved";
	if (!isValidProjectKey(key)) return "Project keys must be 2–5 letters";
	return null;
}

/** The project other than ignore that has key, or had it: what a new one can't be keyed. */
export function keyOwner<P extends Keyed>(projects: P[], key: string, ignore?: string): { project: P; old: boolean } | null {
	const k = key.toUpperCase();
	for (const p of projects) if (p.id !== ignore && p.key.toUpperCase() === k) return { project: p, old: false };
	for (const p of projects) if (p.id !== ignore && p.aliases.some((a) => a.toUpperCase() === k)) return { project: p, old: true };
	return null;
}

/**
 * The key a project gets for desired, as Flux's uniqueProjectKey: desired
 * itself where it's free, else its first four letters and another, else
 * its first three and two more; PRJ when nothing's free.
 */
export function uniqueProjectKey(projects: Keyed[], desired: string, ignore?: string): string {
	const fits = (key: string) => isValidProjectKey(key) && !keyOwner(projects, key, ignore);
	let base = normalizeProjectKey(desired);
	if (base.length < 2) base = "PRJ";
	if (fits(base)) return base;
	const root = base.slice(0, Math.min(4, base.length));
	for (const letter of LETTERS) {
		const next = (root + letter).slice(0, 5);
		if (fits(next)) return next;
	}
	const stem = base.slice(0, 3);
	for (const first of LETTERS) {
		for (const second of LETTERS) {
			const next = (stem + first + second).slice(0, 5);
			if (fits(next)) return next;
		}
	}
	return "PRJ";
}

/** A project's aliases once its key changes from was to key: was among them, key not. */
export function aliasesAfter(aliases: string[], was: string, key: string): string[] {
	const out = [...aliases];
	if (was && was !== key && !out.includes(was)) out.push(was);
	return out.filter((a) => a !== key);
}
