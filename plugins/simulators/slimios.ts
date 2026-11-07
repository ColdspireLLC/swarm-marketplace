// Slim iOS simulators: launchd services they rarely need (Siri,
// Spotlight, widgets, photo analysis…) turned off, after simslim
// (MobAI-App/simslim, MIT): its categories and labels, iOS 26.5's. It
// measured 258 processes and 4.0 GB stock, 70 and 0.9 GB slim.
//
// The overrides are launchd's own: a flat plist of label → disabled in
// the host's folder of the device, which launchd_sim reads as it boots,
// so a simulator written while it's shut down boots slim. It outlives
// simctl erase (it's not in the device's data). Entries this didn't write
// are kept. Only iOS 18.5 and later keep them. No Swarm here, for the
// tests.

const A = (labels: string) => labels.split(/\s+/).filter(Boolean).map((l) => `com.apple.${l}`);

/** simslim's categories: what each turns off, as the agent's note says it, and its labels. */
export const IOS_CATEGORIES: Record<string, { what: string; labels: string[] }> = {
	widgets: { what: "widgets and Live Activities", labels: A("PosterBoard chronod liveactivitiesd navd") },
	siri: {
		what: "Siri, dictation and Apple Intelligence",
		labels: A(
			"assistant_cdmd assistant_service siriactionsd siriinferenced siriknowledged sirittsd siri.context.service siri.acousticsignature corespeechd voiced voicebankingd speechmodeltrainingd intelligenceplatformd intelligencecontextd intelligenceflowd intelligencetasksd generativeexperiencesd knowledgeconstructiond naturallanguaged textunderstandingd modelcatalogd modelmanagerd mlhostd mlruntimed suggestd parsecd parsec-fbf proactiveeventtrackerd",
		),
	},
	search: { what: "Spotlight", labels: A("searchd searchtoold spotlightknowledged spotlightknowledged.updater corespotlightservice") },
	icloud: {
		what: "iCloud and the Apple Account",
		labels: A(
			"appleaccountd appleaccounttransparencyd appleidsetupd akd amsaccountsd amsengagementd amsondevicestoraged cloudd cloudphotod ckdiscretionaryd cloudsettingssyncagent bird syncdefaultsd cdpd sosd SecureBackupDaemon TrustedPeersHelper protectedcloudstorage.protectedcloudkeysyncing icloudmailagent icloudsubscriptionoptimizerd communicationtrustd",
		),
	},
	store: {
		what: "push notifications, StoreKit and the App Store",
		labels: A("appstored appstorecomponentsd apsd itunescloudd itunesstored storekitd amsaccountsd amsengagementd amsondevicestoraged passd financed videosubscriptionsd assetsubscriptiond musicd"),
	},
	pim: { what: "Mail, Calendar, Contacts and Reminders", labels: A("email.maild exchangesyncd dataaccess.dataaccessd calaccessd remindd contactsd contacts.postersyncd peopled") },
	web: {
		what: "Safari's sync, web push and universal links",
		labels: A("SafariBookmarksSyncAgent Safari.History Safari.passwordbreachd Safari.SafeBrowsing.Service safarifetcherd WebBookmarks.webbookmarksd webkit.adattributiond webkit.webpushd webprivacyd swcd"),
	},
	family: { what: "Screen Time and Family Sharing", labels: A("familycircled FamilyControlsAgent familynotification askpermissiond asktod ScreenTimeAgent ScreenTimeSettingsAgent UsageTrackingAgent") },
	health: {
		what: "HealthKit, HomeKit and Fitness",
		labels: A("healthd healthappd healthcontentd healtheventsd healthrecordsd finhealthd homed homeeventsd fitcore fitcore.session fitnesscoachingd fitnessintelligenced activityawardsd activitysharingd"),
	},
	photos: { what: "the Photos library and its analysis", labels: A("photoanalysisd photosface mediaanalysisd mediaanalysisd.service mediastream.mstreamd medialibraryd assetsd assetsd.nebulad") },
	apps: {
		what: "News, Weather, Maps, Tips and Game Center",
		labels: A("newsd weatherd Maps.mapssyncd Maps.mapspushd Maps.geocorrectiond maps.destinationd MapKit.SnapshotService jetpackassetd tipsd gamesaved GameController.gamecontrollerd"),
	},
	messaging: {
		what: "iMessage and FaceTime",
		labels: A("identityservicesd ids_simd imautomatichistorydeletionagent imcore.imtransferagent imdpersistence.IMDPersistenceAgent facetimemessagestored telephonyutilities.callservicesd"),
	},
	connectivity: { what: "AirDrop, Continuity and CarPlay", labels: A("rapportd companiond carkitd wcd tvremoted avatarsd stickersd sociallayerd announced navd findmy.findmylocated") },
	telemetry: {
		what: "diagnostics and ads",
		labels: A("ap.adprivacyd ap.promotedcontentd diagnosticextensionsd feedbackd rtcreportingd securityuploadd geoanalyticsd triald followupd purplebuddy.budd devicecheckd"),
	},
	mdm: { what: "device management", labels: A("remotemanagementd RemoteManagementAgent managedassetsd") },
	other: {
		what: "Wallet, App Clips and asset downloads",
		labels: A(
			"financed passd merchantd coreidvd businessservicesd deviceaccessd replicatord linkd ind storagedatad StatusKitAgent countryd mobileassetd managedconfiguration.passcodenagd accessibility.axassetsd ClipServices.clipserviced",
		),
	},
};

/** What's never turned off: Siri's own daemon, Game Center's (XCUITest needs it) and sharing's (share sheets). */
export const IOS_NEVER = new Set(A("assistantd gamed sharingd"));

/** Every label slimming manages: those it turns off in one setting or another. */
export const IOS_MANAGED = new Set(Object.values(IOS_CATEGORIES).flatMap((c) => c.labels));

/** A keep list (the setting): category ids, and single labels. */
export interface Keep {
	categories: string[];
	labels: string[];
}

/** The keep setting as a list: category ids and labels, by commas or spaces; unknown words said. */
export function parseKeep(text: string, categories: Record<string, unknown>): Keep & { unknown: string[] } {
	const out = { categories: [] as string[], labels: [] as string[], unknown: [] as string[] };
	for (const w of text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)) {
		if (w in categories) out.categories.push(w);
		else if (w.includes(".")) out.labels.push(w);
		else out.unknown.push(w);
	}
	return out;
}

/**
 * The labels to turn off. A category kept keeps all its labels on, even
 * those another category lists too.
 */
export function iosLabelsOff(keep: Keep): string[] {
	const on = new Set([...IOS_NEVER, ...keep.labels, ...keep.categories.flatMap((c) => IOS_CATEGORIES[c]?.labels ?? [])]);
	const off = new Set<string>();
	for (const c of Object.values(IOS_CATEGORIES)) for (const l of c.labels) if (!on.has(l)) off.add(l);
	return [...off].sort();
}

/** What slimming leaves on, as the agent's note says it. */
export function keptNote(keep: Keep): string {
	const parts = [...keep.categories.map((c) => IOS_CATEGORIES[c]?.what ?? c), ...keep.labels];
	return parts.length ? parts.join(", ") : "nothing";
}

const unescape = (v: string) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** launchd's disabled.plist: label → disabled. An empty or missing file is no entries. */
export function parseDisabled(xml: string): Map<string, boolean> {
	const out = new Map<string, boolean>();
	for (const m of xml.matchAll(/<key>([^<]*)<\/key>\s*<(true|false)\s*\/>/g)) out.set(unescape(m[1]!), m[2] === "true");
	return out;
}

/** The plist launchd reads, of entries. */
export function disabledPlist(entries: Map<string, boolean>): string {
	const keys = [...entries.keys()].sort();
	return [
		`<?xml version="1.0" encoding="UTF-8"?>`,
		`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
		`<plist version="1.0">`,
		`<dict>`,
		...keys.map((k) => `\t<key>${escape(k)}</key>\n\t<${entries.get(k) ? "true" : "false"}/>`),
		`</dict>`,
		`</plist>`,
		"",
	].join("\n");
}

/**
 * The device's disabled.plist with these labels off: entries slimming
 * doesn't manage kept as they were, those it manages set anew (off, or
 * gone, which launchd takes as its default). An empty off list is the
 * simulator as it came.
 */
export function slimmedPlist(existing: string, off: string[]): string {
	const entries = parseDisabled(existing);
	for (const l of [...entries.keys()]) if (IOS_MANAGED.has(l)) entries.delete(l);
	for (const l of off) entries.set(l, true);
	return disabledPlist(entries);
}

/** The labels a device's plist has slimming's turned off. */
export function slimmedLabels(existing: string): string[] {
	return [...parseDisabled(existing)].filter(([l, off]) => off && IOS_MANAGED.has(l)).map(([l]) => l);
}

/** Where launchd_sim reads a device's overrides, on its Mac. */
export const disabledPath = (udid: string) => `/private/var/tmp/com.apple.CoreSimulator.SimDevice.${udid}/disabled.plist`;

/** Whether a runtime keeps the overrides: iOS 18.5 and later. */
export function iosKeepsOverrides(version: string): boolean {
	const [maj = 0, min = 0] = version.split(".").map(Number);
	return maj > 18 || (maj === 18 && min >= 5);
}
