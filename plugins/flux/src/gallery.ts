// Flux's gallery of project icons (its app's lib/marks.ts), in its order
// and groups, with the words its search finds each by: what Swarm's icon
// picker offers for a project, and the colors it offers them in. Swarm
// draws the icons it has; the rest are Flux's glyphs, drawn here
// (marks.ts).
import type { UIColorOption, UIIconOption } from "swarm";
import { COLORS, type ColorName } from "./flux";
import { glyphSource, MARK_HEX } from "./marks";

const GALLERY: [group: string, marks: [id: string, keywords: string][]][] = [
	["Developer", [
		["rocket", "launch ship startup deploy"],
		["bolt", "zap lightning energy fast power"],
		["gear-3", "settings config cog"],
		["wrench-screwdriver", "tools build fix repair"],
		["terminal", "terminal shell cli command prompt console"],
		["code", "brackets source develop programming"],
		["bug", "debug issue error defect"],
		["console", "terminal shell cli command prompt"],
		["square-terminal", "terminal console cli prompt"],
		["code-2", "brackets source develop"],
		["code-3", "brackets source develop"],
		["code-editor", "ide vscode editor write"],
		["window-code", "app window ide editor"],
		["window-code-2", "app window ide editor"],
		["square-code", "source snippet block"],
		["brackets-curly", "code braces syntax"],
		["brackets-square", "array list syntax"],
		["markdown", "md docs write"],
		["code-branch", "git branch vcs"],
		["code-commit", "git commit version"],
		["code-merge", "git merge pr"],
		["code-fork", "git fork clone"],
		["code-pull-request", "git pr review"],
		["code-compare", "git diff compare"],
		["branch-merge", "git branch merge vcs"],
		["command", "cmd palette shortcut"],
		["keyboard", "type input keys"],
		["server", "host backend rack"],
		["binary", "ones zeros compiled"],
		["hashtag", "hash tag pound"],
		["circuits", "chip hardware pcb"],
		["microchip", "cpu processor hardware"],
		["webhook", "hook endpoint callback"],
		["embed", "iframe snippet include"],
		["workflow", "pipeline automation ci"],
		["framework", "stack library sdk"],
		["task-debug", "debug inspect breakpoint"],
		["user-developer", "engineer coder programmer"],
		["ai-developer", "llm agent engineer"],
		["robot", "bot automation ai"],
		["flask", "lab experiment science"],
		["monitor", "screen display desktop"],
		["laptop", "computer notebook device"],
		["nodes", "graph network cluster"],
		["hard-drive", "disk storage drive"],
		["file-tree", "directory structure files"],
		["cloude-code", "cloud code deploy"],
	]],
	["Objects", [
		["cubes-2", "cube box package blocks"],
		["gift", "present reward"],
		["globe-2", "world global web internet"],
		["house-6", "home building"],
		["bookmark", "save pin later"],
		["flag", "milestone goal mark"],
		["database", "data storage sql"],
		["cloud", "hosting weather sky"],
		["floppy-disk", "save storage disk"],
		["key", "access auth password"],
		["lock", "secure encryption private"],
		["window-key", "license access app"],
		["image-binary", "code file binary"],
		["gear-nodes", "automation workflow nodes"],
		["layers", "stack design overlay"],
		["squares-connected", "network graph nodes"],
		["blueprint", "plan architecture design"],
		["microscope", "lab science research"],
		["gauge-3", "dashboard meter speed"],
		["qrcode", "scan code barcode"],
		["magnifier", "search find lookup"],
		["folder", "directory files"],
		["file-content", "document page text"],
		["page", "document paper sheet"],
		["paperclip", "attach file"],
		["archive", "box storage vault"],
		["envelope", "mail email message"],
		["paper-plane-2", "send message launch"],
		["bell", "notification alert ring"],
		["alarm-clock", "time reminder"],
		["clock-2", "time schedule"],
		["stopwatch", "timer race speed"],
		["hourglass", "waiting pending time"],
		["calendar", "date schedule event"],
		["pin-tack", "pin location save"],
		["location-4", "map pin place"],
		["label", "tag category"],
		["saved-items", "collection bookmarks"],
		["compose-2", "write edit draft"],
		["pen-2", "write edit sign"],
		["book-open", "docs read guide"],
		["image", "photo picture media"],
		["headphones", "audio music listen"],
		["bullhorn", "announce megaphone"],
		["phone-rotary", "call contact"],
		["cart-shopping", "shop checkout store"],
		["bag-shopping", "shop store retail"],
		["shop", "store market retail"],
		["suitcase", "travel work bag"],
		["desk-lamp", "light idea desk"],
		["light-switch", "toggle power on"],
		["battery-charging", "power charge energy"],
		["life-ring", "help support rescue"],
		["tablet-mobile", "phone app device"],
	]],
	["Symbols", [
		["star-2", "favorite rating shine"],
		["check", "done success complete yes"],
		["circle-check", "done success approved"],
		["triangle-warning", "caution alert"],
		["circle-info", "information help"],
		["circle-question", "help faq ask"],
		["ban", "block stop forbidden"],
		["refresh", "sync retry reload"],
		["download-4", "save get import"],
		["upload-4", "send publish export"],
		["export", "share send out"],
		["filter", "funnel sort refine"],
		["shapes-2", "geometry design"],
		["grid", "layout dashboard apps"],
		["vector", "pen tool design path"],
		["chart-bar-axis-x", "analytics stats data"],
		["square-activity-chart", "metrics graph pulse"],
	]],
	["Nature", [
		["flower", "bloom plant spring"],
		["tree-palm", "tropical beach vacation"],
		["leaf", "plant eco green"],
		["tree", "forest nature plant"],
		["earth-leaf", "eco green sustainability"],
		["earth", "planet world globe"],
		["droplet", "water drop liquid"],
		["flame", "fire energy heat"],
		["clover", "luck plant leaf"],
	]],
	["People", [
		["heart", "love like favorite"],
		["user", "person profile account"],
		["user-focus", "target person focus"],
		["user-short-hair", "person profile"],
		["child-head", "kid child person"],
		["handshake", "deal partner agree"],
		["interview", "meeting talk hire"],
		["take-selfie", "photo camera person"],
		["thumbs-up", "like approve yes"],
		["bicep", "strong muscle fitness"],
	]],
	["Activity", [
		["gamepad", "game controller play"],
		["yoga", "wellness stretch fitness"],
		["skull", "danger dead halloween"],
		["theatre-mask", "drama play acting"],
		["message", "chat comment talk"],
		["eye-2", "view watch visible"],
		["at-sign", "email mention handle"],
		["language", "translate locale i18n"],
	]],
];

/** Names Nucleo's ids don't spell as people do. */
const NAMES: Record<string, string> = { "ai-developer": "AI developer", "cloude-code": "Cloud code", qrcode: "QR code", "eye-2": "Eye" };

const IDS = new Set(GALLERY.flatMap(([, marks]) => marks.map(([id]) => id)));

/** What the gallery calls an icon: its id's words, without Nucleo's number where there's no other of its name. */
function nameOf(id: string): string {
	if (NAMES[id]) return NAMES[id]!;
	const base = id.replace(/-\d+$/, "");
	const words = (base !== id && !IDS.has(base) ? base : id).replaceAll("-", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The gallery's icons as Swarm's icon picker takes them: Swarm's by their ids, Flux's own glyphs by their SVGs. */
export const GALLERY_ICONS: (Omit<UIIconOption, "src"> & { src?: Uint8Array })[] = GALLERY.flatMap(([group, marks]) =>
	marks.map(([id, keywords]) => {
		const src = glyphSource(id);
		return { id, label: nameOf(id), group, keywords, ...(src ? { src } : {}) };
	}),
);

const COLOR_NAMES: Record<ColorName, string> = {
	gray: "Gray",
	red: "Red",
	orange: "Orange",
	yellow: "Yellow",
	green: "Green",
	cyan: "Cyan",
	blue: "Blue",
	indigo: "Indigo",
	purple: "Purple",
	pink: "Pink",
};

/** Flux's colors, in its pickers' order, as the picker's swatches. */
export const GALLERY_COLORS: UIColorOption[] = COLORS.map((id) => ({ id, name: COLOR_NAMES[id], color: MARK_HEX[id] }));
