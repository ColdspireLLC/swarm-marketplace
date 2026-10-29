// Picking a due date, as Flux's: the presets in a menu, each with its day,
// and Custom… for a calendar, or a date typed as Flux understands it
// (24h, 7 days, Feb 9, next friday).
import { ui, type Child } from "swarm";
import { MONTH_NAMES, dueChoices, dueHint, dueLabel, isoDay, monthGrid, parseDue, parseIsoDay, startOfDay } from "./dates";

/** A due date's menu items: the presets, Custom…, and No due date while one is set. */
export function dueItems(current: string | null | undefined, set: (value: string | null) => unknown): Child[] {
	return [
		...dueChoices().map((choice) => (
			<ui.item key={"due-" + choice.label} icon="calendar" detail={choice.hint} checked={current === choice.value} onClick={() => set(choice.value)}>{choice.label}</ui.item>
		)),
		<ui.item key="due-custom" icon="calendar" onClick={() => openDuePicker(current ?? null, set)}>Custom…</ui.item>,
		current ? <ui.separator key="due-sep" /> : null,
		current ? <ui.item key="due-clear" icon="x" onClick={() => set(null)}>No due date</ui.item> : null,
	];
}

let target: { current: string | null; set: (value: string | null) => unknown } | null = null;
let month = startOfDay(new Date());
let typed = "";

/** Opens the calendar for a due date. */
export function openDuePicker(current: string | null, set: (value: string | null) => unknown) {
	target = { current, set };
	month = parseIsoDay(current) ?? startOfDay(new Date());
	typed = "";
	ui.showOverlay("flux-due");
}

function choose(value: string | null) {
	const t = target;
	target = null;
	ui.hideOverlay("flux-due");
	void t?.set(value);
}

/** The calendar: a field for a typed date, the month's days, and the presets. */
export function DuePicker() {
	if (!target) return null;
	const current = target.current;
	const parsed = parseDue(typed);
	const today = isoDay(new Date());
	const cell = { width: 36, height: 32, alignItems: "center", justifyContent: "center", borderRadius: "control" } as const;
	return (
		<ui.box style={{ width: 300, gap: 12, padding: 16 }}>
			<ui.text style={{ fontWeight: 600 }}>Due date</ui.text>
			<ui.field key="due-typed" autoFocus value={typed} placeholder="Try: 24h, 7 days, Feb 9" onChange={(value) => { typed = value; }} onSubmit={() => { if (parsed) choose(isoDay(parsed)); }} />
			{typed.trim() ? (
				parsed ? (
					<ui.pressable label={`Due ${dueLabel(isoDay(parsed))}`} onClick={() => choose(isoDay(parsed))} style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 32, paddingLeft: 8, paddingRight: 8, borderRadius: "control", backgroundColor: "hover" }}>
						<ui.icon icon="calendar" style={{ width: 13, height: 13, color: "text2" }} />
						<ui.text style={{ flex: 1 }}>{dueLabel(isoDay(parsed))}</ui.text>
						<ui.text style={{ fontSize: "small", color: "text3" }}>{dueHint(parsed)}</ui.text>
					</ui.pressable>
				) : (
					<ui.text style={{ fontSize: "small", color: "text3" }}>No date matches “{typed.trim()}”.</ui.text>
				)
			) : null}
			<ui.box style={{ flexDirection: "row", alignItems: "center" }}>
				<ui.text style={{ flex: 1, fontWeight: 500 }}>{`${MONTH_NAMES[month.getMonth()]} ${month.getFullYear()}`}</ui.text>
				<ui.iconButton icon="chevron-right" label="Previous month" style={{ transform: "rotate(180deg)" }} onClick={() => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); }} />
				<ui.iconButton icon="chevron-right" label="Next month" onClick={() => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); }} />
			</ui.box>
			<ui.box style={{ gap: 2 }}>
				<ui.box style={{ flexDirection: "row" }}>
					{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <ui.box key={d} style={cell}><ui.text style={{ fontSize: "small", color: "text3" }}>{d}</ui.text></ui.box>)}
				</ui.box>
				{monthGrid(month).map((week, w) => (
					<ui.box key={"w" + w} style={{ flexDirection: "row" }}>
						{week.map((day) => {
							const value = isoDay(day);
							const on = value === current;
							const inMonth = day.getMonth() === month.getMonth();
							return (
								<ui.pressable key={value} label={dueHint(day)} checked={on} onClick={() => choose(value)} style={{ ...cell, backgroundColor: on ? "accent" : "transparent", border: value === today && !on ? "1px solid border" : "none", hover: { backgroundColor: on ? "accent" : "hover" } }}>
									<ui.text style={{ fontSize: 13, color: on ? "white" : inMonth ? "text" : "text3", fontWeight: value === today ? 600 : 400 }}>{String(day.getDate())}</ui.text>
								</ui.pressable>
							);
						})}
					</ui.box>
				))}
			</ui.box>
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				{current ? <ui.button kind="ghost" size="sm" onClick={() => choose(null)}>No due date</ui.button> : null}
				<ui.button kind="secondary" size="sm" onClick={() => { target = null; ui.hideOverlay("flux-due"); }}>Cancel</ui.button>
			</ui.box>
		</ui.box>
	);
}
