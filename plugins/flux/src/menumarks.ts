// The marks a property's menu items show, as Flux's menus do: a status's
// ring, a priority's bars, a member's picture or their initial on their
// color, a label's dot. A menu item takes a picture (an SVG here, in
// colors that read in either theme) or a tile, where the board draws them
// on a canvas.
import type { ColorValue } from "swarm";
import type { ColorName, Priority, Status } from "./flux";
import type { Member } from "./contract";
import { MARK_HEX, colorOf } from "./marks";
import { pictureBytes } from "./pictures";

// As bytes, made once each: a menu names them by their hash, where it
// would carry a data: URL whole in every card's every menu.
const made = new Map<string, Uint8Array>();
function svg(key: string, inner: () => string): Uint8Array {
	let bytes = made.get(key);
	if (!bytes) made.set(key, (bytes = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14">${inner()}</svg>`)));
	return bytes;
}

const GRAY = MARK_HEX.gray;

/** A status's color, as StatusIcon draws it: the theme's. */
export const STATUS_COLOR: Record<Status, ColorValue> = {
	backlog: "text2",
	todo: "text2",
	progress: "amber",
	review: "violet",
	complete: "green",
	canceled: "text3",
};

/** A point on a circle, clockwise from twelve o'clock, by degrees. */
function at(r: number, deg: number): string {
	const a = ((deg - 90) * Math.PI) / 180;
	return `${(7 + r * Math.cos(a)).toFixed(2)} ${(7 + r * Math.sin(a)).toFixed(2)}`;
}

/** A disc with a glyph cut out of it, where the menu shows through, as StatusIcon's in the background's color. */
function cutDisc(id: string, glyph: string): string {
	return `<mask id="${id}"><rect width="14" height="14" fill="#fff"/><path d="${glyph}" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></mask><circle cx="7" cy="7" r="6" fill="currentColor" mask="url(#${id})"/>`;
}

// The marks draw in currentColor, which Swarm draws in their tint as the
// user's theme has it.

/** A status's ring, as StatusIcon draws it, in the theme's color. */
export function statusMark(status: Status): { mark: Uint8Array; tint: ColorValue } {
	return {
		tint: STATUS_COLOR[status],
		mark: svg("status:" + status, () => {
			const ring = `<circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
			switch (status) {
				case "backlog":
					return `<circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1.6 1.54"/>`;
				case "todo":
					return ring;
				case "progress":
					return ring + `<path d="M7 7 L${at(4, 0)} A4 4 0 1 1 ${at(4, 270)} Z" fill="currentColor"/>`;
				case "review":
					return ring + `<path d="M7 7 L${at(4, 0)} A4 4 0 0 1 ${at(4, 180)} Z" fill="currentColor"/>`;
				case "complete":
					return cutDisc("c", "M4.2 7.15 L6.15 9.1 L9.8 5.25");
				case "canceled":
					return cutDisc("x", "M5 5 L9 9 M9 5 L5 9");
			}
		}),
	};
}

/** A priority's bars, or Urgent's red square, as PriorityIcon draws them, in the theme's colors. */
export function priorityMark(priority: Priority): { mark: Uint8Array; tint: ColorValue } {
	return {
		tint: priority === "urgent" ? "red" : priority === "none" ? "text2" : "text",
		mark: svg("priority:" + priority, () => {
			if (priority === "urgent") return `<rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="currentColor"/><rect x="6.2" y="3" width="1.6" height="5.5" rx="0.8" fill="#fff"/><rect x="6.2" y="9.6" width="1.6" height="1.6" rx="0.8" fill="#fff"/>`;
			if (priority === "none") return `<rect x="3" y="6.25" width="8" height="1.5" rx="0.75" fill="currentColor"/>`;
			const level = { high: 3, medium: 2, low: 1 }[priority];
			let out = "";
			for (let i = 0; i < 3; i++) out += `<rect x="${1.5 + i * 4}" y="${(10 - i * 3.2).toFixed(1)}" width="3" height="${(3 + i * 3.2).toFixed(1)}" rx="1" fill="currentColor" fill-opacity="${i < level ? 1 : 0.25}"/>`;
			return out;
		}),
	};
}

/** A member's picture, as their avatar; while it comes, or when there's none, their initial on their color. */
export function memberMark(member: Member): { mark?: Uint8Array; initial: string; tint: ColorValue } {
	const tile = { initial: (member.name || member.username).trim().slice(0, 1).toUpperCase() || "?", tint: colorOf[member.avatarColor] ?? GRAY };
	const picture = member.avatarUrl ? pictureBytes(member.avatarUrl) : null;
	return picture ? { mark: picture, ...tile } : tile;
}

/** A label's dot in its color. */
export function labelMark(color: ColorName): { mark: Uint8Array; tint: ColorValue } {
	return { tint: colorOf[color] ?? "text3", mark: svg("label", () => `<circle cx="7" cy="7" r="3.5" fill="currentColor"/>`) };
}
