// What agents stay out of on the user's own machines, held here rather
// than asked in their instructions: apps that hold the user's private
// life or money, and the phones the user carries, where agents only
// install, uninstall and read the logs of test builds.
import { settings } from "swarm";

/**
 * Sensitive apps, by kind: what an app's name or id (a bundle id, a
 * package name) matches. Each word is whole: "pay" isn't "display",
 * "shopping" isn't "Photoshop".
 */
const SENSITIVE: [kind: string, words: string[]][] = [
	["passwords", ["passwords", "password", "1password", "bitwarden", "lastpass", "dashlane", "keeper", "keepass\\w*", "keychain access", "authenticator", "authy"]],
	["banking and payments", ["bank\\w*", "wallet\\w*", "passbook", "pay", "paypal", "venmo", "cash app", "squarecash", "zelle", "revolut", "monzo", "wise", "chase", "coinbase", "robinhood", "stripe"]],
	["mail", ["mail", "mobilemail", "gmail", "android\\.gm", "outlook", "proton\\w*", "spark", "thunderbird", "hey"]],
	["messages", ["messages", "mobilesms", "messaging", "imessage", "whatsapp", "signal", "telegram", "messenger", "wechat", "line", "slack", "discord", "facetime"]],
	["photos", ["photos", "mobileslideshow", "gallery", "gallery3d", "google photos"]],
	["health", ["health", "fitness", "healthkit", "myfitnesspal"]],
	["the car", ["tesla", "rivian", "polestar", "fordpass", "mercedes me", "mybmw", "carplay"]],
	["social posting", ["twitter", "instagram", "facebook", "katana", "tiktok", "musically", "threads", "barcelona", "linkedin", "reddit", "mastodon", "bluesky", "snapchat"]],
	["shopping", ["shopping", "amazon", "ebay", "etsy", "shopify", "temu", "aliexpress", "walmart", "target"]],
];

const words = (list: string[]) => new RegExp(`(?:^|[^a-z0-9])(?:${list.join("|")})(?:$|[^a-z0-9])`, "i");
const BUILT_IN = SENSITIVE.map(([kind, list]) => [kind, words(list)] as const);

/** The words the user added in the settings, comma-separated. */
function extra(): RegExp | null {
	const list = String(settings.get("sensitive") ?? "")
		.split(/[,;\n]/)
		.map((s) => s.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.filter(Boolean);
	return list.length ? words(list) : null;
}

/** What kind of sensitive app this is (by any of its names), or "" when it isn't. */
export function sensitive(...names: (string | undefined)[]): string {
	const user = extra();
	for (const n of names) {
		if (!n) continue;
		for (const [kind, re] of BUILT_IN) if (re.test(n)) return kind;
		if (user?.test(n)) return "one you listed";
	}
	return "";
}

export const refusedApp = (app: string, kind: string) =>
	`${app} is an app agents stay out of (${kind}): ask the user to do that part.`;

// ---- Phones the user carries ----

const list = (key: string) =>
	String(settings.get(key) ?? "")
		.split(/[,;\n\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);

/** Whether the machine is a phone the user carries. */
export const carried = (id: string) => list("carried").some((c) => c.toLowerCase() === id.toLowerCase());

/** The test builds agents may install on a carried phone: com.example.app.* */
export const testApps = () => list("testApps");

/** Whether a package or bundle id is one of the test builds. */
export function isTestApp(id: string): boolean {
	return testApps().some((p) => {
		const re = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
		return re.test(id);
	});
}

export function carriedRefusal(name: string): string {
	const apps = testApps();
	return `${name} is the phone the user carries: agents may only install and uninstall test builds (${apps.length ? apps.join(", ") : "none listed yet"}) and read their logs, with machine_app. Ask the user for anything else.`;
}
