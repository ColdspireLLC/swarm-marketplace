// Picking a due date, as Flux's: the presets in a menu, each with its day,
// and Custom…, Swarm's calendar in the menu's place. A date typed as Flux
// understands it (24h, 7 days, Feb 9, next friday) is the palette's
// (palette.tsx).
import { ui, type Child } from "swarm";
import { dueChoices } from "./dates";

/** A due date's menu items: the presets, Custom…, and No due date while one is set. */
export function dueItems(current: string | null | undefined, set: (value: string | null) => unknown): Child[] {
	return [
		...dueChoices().map((choice) => (
			<ui.item key={"due-" + choice.label} icon="calendar" detail={choice.hint} checked={current === choice.value} onClick={() => set(choice.value)}>{choice.label}</ui.item>
		)),
		<ui.calendar key="due-custom" label="Custom…" value={current ?? null} onChange={(day) => set(day)} />,
		current ? <ui.separator key="due-sep" /> : null,
		current ? <ui.item key="due-clear" icon="x" onClick={() => set(null)}>No due date</ui.item> : null,
	];
}
