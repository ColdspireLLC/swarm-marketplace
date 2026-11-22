// What the Simulator page's parts share: how a device is named and
// shown, times said short, and the line that says what an action came of.
import { ui, type IconName } from "swarm";
import { isTwinName, TWIN_SUFFIX, type Device } from "./picker";
import { info, pool } from "./state";

export const line = { flexShrink: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** A device's name as a row says it: a twin's without its "(120 Hz)", which its badge says. */
export function shortName(d: Device): string {
	const agent = /^(Swarm|bb) agent (\d+) · (.*)$/.exec(d.name);
	if (agent) return `${agent[1] === "bb" ? "bb agent" : "Agent"} ${agent[2]} · ${agent[3]!.replace(TWIN_SUFFIX, "")}`;
	return isTwinName(d.name) ? d.name.slice(0, -TWIN_SUFFIX.length) : d.name;
}

export function ago(at: number, now: number) {
	const s = Math.max(0, (now - at) / 1000);
	return s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}

export const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;

/** The agent's thread that holds an agent simulator, by its UDID or serial, if one does. */
export function holderOf(d: Device): string | undefined {
	const s = pool.slots.find((x) => x.holder && (info(x).udid === d.id || (d.serial && info(x).serial === d.serial)));
	return s?.holder?.thread;
}

export const iconOf = (d: Device): IconName => (d.platform === "android" ? "mobile-signal" : /iPad/.test(d.name) ? "tablet" : /Watch/.test(d.name) ? "watch" : /TV/.test(d.name) ? "tv" : "mobile");

/** Said once and gone: what the user just did came of. */
export const note = ui.store({ text: "", at: 0 });
export function say(text: string) {
	note.text = text;
	note.at = Date.now();
}
