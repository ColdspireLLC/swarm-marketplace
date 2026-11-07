// Cron, five fields in this computer's local time, as Swarm's own
// schedules read them: minute hour day-of-month month day-of-week, with
// lists, ranges, steps, names (jan, mon) and the macros (@daily…). Day of
// month and day of week, both narrowed, match either (cron's rule).
// Durations (30s, 5m, 2h, 1d) and what a schedule is, in words.

export interface Cron {
	minute: Set<number>;
	hour: Set<number>;
	dom: Set<number>;
	month: Set<number>;
	dow: Set<number>;
	domAny: boolean;
	dowAny: boolean;
}

const MACROS: { [name: string]: string } = {
	"@yearly": "0 0 1 1 *",
	"@annually": "0 0 1 1 *",
	"@monthly": "0 0 1 * *",
	"@weekly": "0 0 * * 0",
	"@daily": "0 0 * * *",
	"@midnight": "0 0 * * *",
	"@hourly": "0 * * * *",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export class CronError extends Error {}

function field(text: string, lo: number, hi: number, names?: string[], nameBase = 0): Set<number> {
	const out = new Set<number>();
	const num = (s: string): number => {
		const i = names ? names.indexOf(s.toLowerCase()) : -1;
		if (i >= 0) return i + nameBase;
		if (!/^\d+$/.test(s)) throw new CronError(`"${s}" isn't a number`);
		return Number(s);
	};
	for (const part of text.split(",")) {
		const [range, stepText] = part.split("/") as [string, string | undefined];
		const step = stepText === undefined ? 1 : Number(stepText);
		if (!Number.isInteger(step) || step < 1) throw new CronError(`"${part}": the step must be a whole number from 1`);
		let a: number, b: number;
		if (range === "*") [a, b] = [lo, hi];
		else if (range.includes("-")) {
			const [x, y] = range.split("-");
			[a, b] = [num(x!), num(y!)];
		} else {
			a = num(range);
			b = stepText === undefined ? a : hi;
		}
		if (a < lo || b > hi || a > b) throw new CronError(`"${part}" is out of ${lo}-${hi}`);
		for (let v = a; v <= b; v += step) out.add(v);
	}
	return out;
}

/** Reads a cron expression, or throws CronError saying what's wrong. */
export function parseCron(expr: string): Cron {
	const text = MACROS[expr.trim().toLowerCase()] ?? expr.trim();
	const parts = text.split(/\s+/);
	if (parts.length !== 5) throw new CronError(`a cron has five fields (minute hour day month weekday), not ${parts.length}: "${expr}"`);
	const [mi, h, dom, mo, dow] = parts as [string, string, string, string, string];
	const days = field(dow, 0, 7, DAYS);
	if (days.has(7)) (days.delete(7), days.add(0));
	return {
		minute: field(mi, 0, 59),
		hour: field(h, 0, 23),
		dom: field(dom, 1, 31),
		month: field(mo, 1, 12, MONTHS, 1),
		dow: days,
		domAny: dom === "*" || dom === "?",
		dowAny: dow === "*" || dow === "?",
	};
}

function dayMatches(c: Cron, d: Date): boolean {
	const byDom = c.dom.has(d.getDate());
	const byDow = c.dow.has(d.getDay());
	if (c.domAny && c.dowAny) return true;
	if (c.domAny) return byDow;
	if (c.dowAny) return byDom;
	return byDom || byDow;
}

/** The first time after `after` (ms) the cron comes due, in ms; null if none within five years (Feb 30). */
export function nextCron(c: Cron, after: number): number | null {
	const d = new Date(after);
	d.setSeconds(0, 0);
	d.setMinutes(d.getMinutes() + 1);
	const limit = after + 5 * 366 * 86_400_000;
	while (d.getTime() <= limit) {
		if (!c.month.has(d.getMonth() + 1)) {
			d.setMonth(d.getMonth() + 1, 1);
			d.setHours(0, 0, 0, 0);
			continue;
		}
		if (!dayMatches(c, d)) {
			d.setDate(d.getDate() + 1);
			d.setHours(0, 0, 0, 0);
			continue;
		}
		if (!c.hour.has(d.getHours())) {
			d.setHours(d.getHours() + 1, 0, 0, 0);
			continue;
		}
		if (!c.minute.has(d.getMinutes())) {
			d.setMinutes(d.getMinutes() + 1, 0, 0);
			continue;
		}
		return d.getTime();
	}
	return null;
}

const UNITS: { [unit: string]: number } = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };

/** "90s", "5m", "2h30m", "1d": in ms, or null where it isn't one. A bare number is in `bare`'s unit. */
export function parseDuration(text: string, bare: keyof typeof UNITS = "ms"): number | null {
	const t = text.trim().toLowerCase();
	if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * UNITS[bare]!);
	const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)/gy;
	let total = 0;
	let at = 0;
	for (let m; (m = re.exec(t)); at = re.lastIndex) total += Number(m[1]) * UNITS[m[2]!]!;
	return at === t.length && at > 0 ? Math.round(total) : null;
}

/** ms as a short duration: 45s, 5m, 2h 30m, 3d. */
export function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
	return `${Math.round(h / 24)}d`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function sorted(s: Set<number>) {
	return [...s].sort((a, b) => a - b);
}

/** A cron in words where it's a common shape ("Every day at 09:30", "Weekdays at 08:00", "Every 15 minutes"), else the cron itself. */
export function describeCron(expr: string): string {
	let c: Cron;
	try {
		c = parseCron(expr);
	} catch {
		return expr;
	}
	const parts = (MACROS[expr.trim().toLowerCase()] ?? expr.trim()).split(/\s+/);
	const [mi, h, dom, mo] = parts as [string, string, string, string, string];
	const allDays = c.domAny && c.dowAny && mo === "*";
	const step = (f: string) => /^\*\/(\d+)$/.exec(f)?.[1];
	if (allDays && h === "*" && mi === "*") return "Every minute";
	if (allDays && h === "*" && step(mi)) return `Every ${step(mi)} minutes`;
	const weekdays = c.domAny && !c.dowAny && mo === "*" && sorted(c.dow).join(",") === "1,2,3,4,5";
	if ((allDays || weekdays) && h === "*" && c.minute.size === 1) return (mi === "0" ? "Every hour" : `Every hour at :${pad(sorted(c.minute)[0]!)}`) + (weekdays ? " on weekdays" : "");
	if (allDays && step(h) && c.minute.size === 1) return `Every ${step(h)} hours`;
	if (c.minute.size !== 1 || c.hour.size !== 1 || mo !== "*") return expr;
	const at = `${pad(sorted(c.hour)[0]!)}:${pad(sorted(c.minute)[0]!)}`;
	if (allDays) return `Every day at ${at}`;
	if (c.domAny) {
		const d = sorted(c.dow).join(",");
		if (d === "1,2,3,4,5") return `Weekdays at ${at}`;
		if (d === "0,6") return `Weekends at ${at}`;
		return `${sorted(c.dow).map((x) => DAY_NAMES[x] + "s").join(", ")} at ${at}`;
	}
	if (c.dowAny && c.dom.size === 1 && dom !== "*") return `Monthly on day ${dom} at ${at}`;
	return expr;
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon 9 Nov, 09:30", the year where it isn't this one's. */
export function stamp(t: number): string {
	const d = new Date(t);
	const p = (n: number) => String(n).padStart(2, "0");
	const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
	return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}${year}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

