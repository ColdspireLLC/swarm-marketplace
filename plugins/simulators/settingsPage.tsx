// The plugin's page of Settings: how many simulators the agents get and
// how much each may take, where they run, and what slimming leaves on.
// The settings are plugin.json's, hidden from the plain list, which this
// page lays out.
import { settings, ui, type Child } from "swarm";
import { ANDROID_CATEGORIES, ANDROID_SETTINGS, androidMemory } from "./slimandroid";
import { IOS_CATEGORIES } from "./slimios";
import { joinedMachines } from "./where";

/** Text settings being edited, saved with Enter or Save. */
const draft = ui.store(new Map<string, string>(), { shallow: true });
/** The computers joined to Swarm, for the pickers: looked up as the page first shows. */
const joined = ui.store({ at: 0, list: [] as { id: string; name: string; os?: string; connected: boolean }[] });

function lookJoined() {
	if (joined.at) return;
	joined.at = Date.now();
	setTimeout(() => void joinedMachines().then((l) => (joined.list = l)), 0);
}

const text = (key: string) => String(settings.get(key) ?? "");

function save(key: string) {
	if (!draft.has(key)) return;
	settings.set({ [key]: draft.get(key)!.trim() });
	draft.delete(key);
}

function row(title: string, about: Child, control: Child, below?: Child): Child {
	return (
		<ui.box label={title} style={{ gap: 8, padding: "s5 s6" }}>
			<ui.box style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
				<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
					<ui.text style={{ fontWeight: 500 }}>{title}</ui.text>
					<ui.text style={{ fontSize: "small", color: "text2" }}>{about}</ui.text>
				</ui.box>
				{control}
			</ui.box>
			{below}
		</ui.box>
	);
}

function section(title: string, ...rows: Child[]): Child {
	return (
		<ui.box style={{ gap: 8 }}>
			<ui.text style={{ fontSize: "small", fontWeight: 600, color: "text2", paddingLeft: 4 }}>{title}</ui.text>
			<ui.box style={{ borderRadius: "card", backgroundColor: "raised", border: "1px solid border", overflow: "hidden" }}>
				{rows.map((r, i) => (
					<ui.box key={i} style={i ? { borderTop: "1px solid divider" } : {}}>
						{r}
					</ui.box>
				))}
			</ui.box>
		</ui.box>
	);
}

function toggle(key: string): Child {
	return <ui.toggle checked={settings.get(key) !== false} onChange={(on) => void settings.set({ [key]: on })} />;
}

/**
 * A number setting: typed (saved with Enter), or
 * stepped with − and +, kept within min and max. scale is how many of the
 * setting's units one shown is (1024 MB a GB).
 */
function number(key: string, o: { min: number; max: number; fallback: number; scale?: number; unit?: string; label: string }): Child {
	const k = o.scale ?? 1;
	const now = Math.round(Number(settings.get(key) ?? o.fallback) / k);
	const typed = draft.get(key);
	const set = (v: number) => {
		draft.delete(key);
		if (Number.isFinite(v)) settings.set({ [key]: Math.min(o.max, Math.max(o.min, Math.round(v))) * k });
	};
	if ((ui.format ?? 0) >= 18) {
		// Swarm's own number field (UI format 18).
		return <ui.number value={now} min={o.min} max={o.max} unit={o.unit || undefined} label={o.label} onChange={(v) => set(v)} />;
	}
	// A Swarm before it: the plugin's own.
	return (
		<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", flexShrink: 0 }}>
			<ui.button size="sm" kind="ghost" label="−" tooltip={`Fewer: ${o.label}`} disabled={now <= o.min} onClick={() => set(now - 1)} />
			<ui.field
				key={key}
				value={typed ?? String(now)}
				style={{ width: 52, textAlign: "center", fontFamily: "mono" }}
				onChange={(v) => void draft.set(key, v.replace(/[^0-9]/g, ""))}
				onSubmit={(v) => set(Number(v))}
			/>
			<ui.button size="sm" kind="ghost" label="+" tooltip={`More: ${o.label}`} disabled={now >= o.max} onClick={() => set(now + 1)} />
			{/* The unit's room on every row, so the steppers line up. */}
			<ui.box style={{ width: 22 }}>{o.unit ? <ui.text style={{ color: "text2" }}>{o.unit}</ui.text> : null}</ui.box>
		</ui.box>
	);
}

function input(key: string, placeholder: string): Child {
	const value = draft.has(key) ? draft.get(key)! : text(key);
	return (
		<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
			<ui.field key={key} value={value} placeholder={placeholder} style={{ flex: 1, fontFamily: "mono" }} onChange={(v) => void draft.set(key, v)} onSubmit={() => save(key)} />
			{draft.has(key) && draft.get(key) !== text(key) ? (
				<ui.button size="sm" kind="primary" onClick={() => save(key)}>
					Save
				</ui.button>
			) : null}
		</ui.box>
	);
}

/** Where they run: the first Mac (or as iOS's, for Android), a computer joined to Swarm, or an ssh target. */
function place(key: string, empty: string, os?: string): Child {
	lookJoined();
	const now = text(key);
	const machines = joined.list.filter((m) => !os || m.os === os);
	const known = machines.find((m) => m.id === now || m.name === now);
	const sshing = draft.has(key + ":ssh") || (now !== "" && !known);
	const value = sshing ? "ssh" : known ? known.name : "";
	const options = [{ value: "", label: empty }, ...machines.map((m) => ({ value: m.name, label: m.connected ? m.name : `${m.name} (away)` })), { value: "ssh", label: "Over ssh…" }];
	return (
		<ui.box style={{ gap: 8 }}>
			<ui.select
				style={{ alignSelf: "flex-start" }}
				value={value}
				options={options}
				onChange={(v) => {
					if (v === "ssh") return void draft.set(key + ":ssh", "1");
					draft.delete(key + ":ssh");
					draft.delete(key);
					settings.set({ [key]: v });
				}}
			/>
			{sshing ? input(key, "me@mac-mini.local") : null}
		</ui.box>
	);
}

export function settingsPage(): Child {
	const memory = androidMemory(settings.get("androidMemory"));
	return (
		<ui.box style={{ gap: 20, maxWidth: 680 }}>
			<ui.text style={{ color: "text2" }}>
				Each agent gets an iOS simulator or Android emulator of its own, made and booted for it, until its turn ends. None of your simulators or their data are touched.
			</ui.text>
			{section(
				"The agents' simulators",
				row("iOS simulators", "How many agents may run at once, a thread's each: about 1 GB each slim, 3 GB stock.", number("iosAgents", { min: 0, max: 8, fallback: 2, label: "iOS simulators", unit: "" })),
				row("Android emulators", `How many agents may run at once, a thread's each: ${(memory / 1024).toFixed(1).replace(/\.0$/, "")} GB each, as set below.`, number("androidAgents", { min: 0, max: 6, fallback: 1, label: "Android emulators", unit: "" })),
				row(
					"Android emulators' memory",
					"An app under test needs room: a debug React Native build takes half a gigabyte, and with less Android stops it. Applied as each next boots, its data kept.",
					number("androidMemory", { min: 2, max: 8, fallback: 3072, scale: 1024, label: "memory for each Android emulator", unit: "GB" }),
				),
			)}
			{section(
				"Slimming",
				row("Slim simulators", "Turn off what agents' tests rarely need, for a third of the memory: on iOS Siri, Spotlight, widgets, photo analysis and more; on Android Google's apps, sync and background processes. Applied as each next boots.", toggle("slim")),
				row("Keep in iOS simulators", `Category ids or single launchd labels left on: ${Object.keys(IOS_CATEGORIES).join(", ")}.`, null, input("keepIOS", "store, web, icloud, com.apple.healthd")),
				row("Keep in Android emulators", `Category ids or single packages left on: ${[...Object.keys(ANDROID_CATEGORIES), ...Object.keys(ANDROID_SETTINGS)].join(", ")}.`, null, input("keepAndroid", "location, media")),
			)}
			{section(
				"Where they run",
				row("The Mac", "Where the iOS simulators run, with Xcode.", null, place("iosHost", "The first Mac joined to Swarm", "darwin")),
				row("Android emulators", "Where the Android emulators run, with the Android SDK.", null, place("androidHost", "Where the iOS simulators run")),
				row("iOS model", "What agents' simulators are made of. Empty: the newest iPhone Pro of the newest iOS.", null, input("iosModel", "iPhone 17 Pro")),
				row("Android SDK", "Its folder there. Empty: $ANDROID_HOME, Android Studio's, Homebrew's, or bb's Simulator plugin's.", null, input("androidSdk", "~/Library/Android/sdk")),
				row("Android system image", "What agents' emulators are made of. Empty: the newest Google APIs image installed.", null, input("androidImage", "system-images;android-36;google_apis;arm64-v8a")),
			)}
		</ui.box>
	);
}
