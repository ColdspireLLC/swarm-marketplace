// Due dates as Flux's (bb's pickers.tsx and view.ts): days are the local
// calendar's, never UTC's, so "Today" late at night is still today; the
// presets, the label a chip shows, and what typing a date understands.

export function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** A local day as Flux keeps it: 2026-10-29. */
export function isoDay(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Today, or n days on, as Flux keeps a day. */
export function localDay(n = 0): string {
	return isoDay(addDays(new Date(), n));
}

export function parseIsoDay(value: string | null | undefined): Date | null {
	const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
	if (!match) return null;
	const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
	const date = new Date(year, month, day);
	return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

/** Friday this week, or next Friday when today is Saturday. */
function endOfWorkWeek(now: Date): Date {
	const today = startOfDay(now);
	const day = today.getDay();
	return addDays(today, day <= 5 ? 5 - day : 6);
}

/** Days from today to date, by the local calendar. */
export function dayDelta(value: string, now = new Date()): number {
	const date = parseIsoDay(value);
	if (!date) return 0;
	return Math.round((date.getTime() - startOfDay(now).getTime()) / 86_400_000);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Flux's due label: Today, Tomorrow, Yesterday, a weekday this week, else Oct 6 (with the year when it isn't this one). */
export function dueLabel(value: string, now = new Date()): string {
	const date = parseIsoDay(value);
	if (!date) return value;
	const diff = dayDelta(value, now);
	if (diff === 0) return "Today";
	if (diff === 1) return "Tomorrow";
	if (diff === -1) return "Yesterday";
	if (diff > 1 && diff < 7) return SHORT_DAYS[date.getDay()]!;
	return `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}${date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`}`;
}

/** "Mon, 6 Oct", with the year when it isn't this one: a preset's hint. */
export function dueHint(date: Date, now = new Date()): string {
	return `${SHORT_DAYS[date.getDay()]}, ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}${date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`}`;
}

export interface DueChoice {
	label: string;
	value: string;
	hint: string;
}

/** Flux's presets: Today, Tomorrow, End of week, In one week, In two weeks; one per day. */
export function dueChoices(now = new Date()): DueChoice[] {
	const today = startOfDay(now);
	const seen = new Set<string>();
	return [
		["Today", today],
		["Tomorrow", addDays(today, 1)],
		["End of week", endOfWorkWeek(today)],
		["In one week", addDays(today, 7)],
		["In two weeks", addDays(today, 14)],
	]
		.map(([label, date]) => ({ label: label as string, value: isoDay(date as Date), hint: dueHint(date as Date, today) }))
		.filter((choice) => !seen.has(choice.value) && seen.add(choice.value));
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function upcomingMonthDay(now: Date, month: number, day: number, year?: number): Date | null {
	const today = startOfDay(now);
	let date = new Date(year ?? today.getFullYear(), month, day);
	if (date.getMonth() !== month || date.getDate() !== day) return null;
	if (year === undefined && date.getTime() < today.getTime()) date = new Date(today.getFullYear() + 1, month, day);
	return date;
}

/** What a typed date means, as Flux's search: 24h, 7 days, Feb 9, next friday, 2/9, 2026-11-05… */
export function parseDue(query: string, now = new Date()): Date | null {
	const raw = query.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
	if (!raw) return null;
	const today = startOfDay(now);
	if (raw === "today") return today;
	if (raw === "tomorrow") return addDays(today, 1);
	if (raw === "yesterday") return addDays(today, -1);
	if (["next week", "in one week", "in 1 week", "1 week"].includes(raw)) return addDays(today, 7);
	if (["in two weeks", "in 2 weeks", "2 weeks"].includes(raw)) return addDays(today, 14);
	if (raw === "end of week" || raw === "end of this week") return endOfWorkWeek(now);
	const duration = /^(?:in\s+)?(\d+)\s*(h|hrs?|hours?|d|days?|w|wks?|weeks?)$/.exec(raw);
	if (duration) {
		const count = Number(duration[1]);
		const unit = duration[2]!;
		if (unit.startsWith("h")) return startOfDay(new Date(now.getTime() + count * 3_600_000));
		return addDays(today, unit.startsWith("d") ? count : count * 7);
	}
	const weekday = /^(next\s+)?(sun(day)?|mon(day)?|tue(s|sday)?|wed(nesday)?|thu(r|rs|rsday)?|fri(day)?|sat(urday)?)$/.exec(raw);
	if (weekday) {
		const target = WEEKDAYS.indexOf(weekday[2]!.slice(0, 3));
		let delta = target - today.getDay();
		if (weekday[1] ? delta <= 0 : delta < 0) delta += 7;
		return addDays(today, delta);
	}
	const iso = parseIsoDay(raw);
	if (iso) return iso;
	const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(raw);
	if (numeric) {
		const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : undefined;
		return upcomingMonthDay(now, Number(numeric[1]) - 1, Number(numeric[2]), year);
	}
	const named = /^(?:(\d{1,2})\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(\d{1,2})?(?:\s+(\d{4}))?$/.exec(raw);
	if (named && (named[1] || named[3])) {
		return upcomingMonthDay(now, MONTHS[named[2]!.slice(0, 3)]!, Number(named[1] || named[3]), named[4] ? Number(named[4]) : undefined);
	}
	return null;
}
