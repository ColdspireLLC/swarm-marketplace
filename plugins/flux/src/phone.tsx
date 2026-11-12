// A phone's window (args.compact "1"): its page's bar has the title, Back
// and the page's actions, so Flux draws no title of its own there, lays
// out for a narrow screen, and keeps what a finger taps 36 DIPs or more.
// Desktop is as it was: each of these is read only where phone is set.
import { ui, type Child, type Style } from "swarm";

/**
 * Whether the surface rendering now is a phone's: set as each render
 * starts, from its args, which is all at once, so the parts it draws read
 * it as they're built.
 */
export let phone = false;

export function renderingFor(args: { compact?: string } | undefined) {
	phone = args?.compact === "1";
}

/** The phone's side margins. */
export const SIDE = 16;

/** What a finger taps, at the least. */
export const TAP = 36;

/** A card on a phone: the background 5% toward the text, no border. */
export const CARD_FILL = "color-mix(in srgb, text 5%, bg)";
export const CARD: Style = { borderRadius: 10, backgroundColor: CARD_FILL };

/** A section's heading on a phone: uppercase, small, semibold, quiet. */
export const HEADING: Style = { fontSize: "caption", fontWeight: 600, color: "text3", textTransform: "uppercase" };

/**
 * A section's heading, what it's for and its button: on a desktop, its
 * title and words, the button beside them; on a phone, the heading small
 * and uppercase with its button at its end, the words under them.
 */
export function SectionHead({ title, note, action }: { title: string; note: string; action: Child }) {
	if (phone) {
		return (
			<ui.box style={{ gap: 4 }}>
				<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: TAP, paddingLeft: 4 }}>
					<ui.text style={{ ...HEADING, flex: 1, minWidth: 0 }}>{title}</ui.text>
					{action}
				</ui.box>
				<ui.text style={{ fontSize: "small", color: "text2", paddingLeft: 4, paddingRight: 4 }}>{note}</ui.text>
			</ui.box>
		);
	}
	return (
		<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
			<ui.box style={{ flex: 1, minWidth: 0, gap: 4 }}>
				<ui.text style={{ fontWeight: 600 }}>{title}</ui.text>
				<ui.text style={{ fontSize: "small", color: "text2" }}>{note}</ui.text>
			</ui.box>
			{action}
		</ui.box>
	);
}
