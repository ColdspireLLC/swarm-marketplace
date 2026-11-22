// The Simulator page, on the window's rail: the user's own simulator, live,
// filling the page in its own shape, as bb's Simulator shows it. The
// device picker sits in the title bar (running first, then recent, then by
// OS, with a search, and New simulator at its foot); picking one shows it,
// booting it first where it's shut down. Under the screen, a pill of its
// controls: Screenshot, Record, its hardware keys where Swarm sends them,
// Dark/Light, the captures, and More (the device's settings, a deep link,
// the 120 Hz copy, and what ends its session). Under that, the captures
// strip: screenshots and clips, each opened in a viewer. The agents'
// simulators are in the picker too, to watch.
import { settings, ui, type Child, type IconName } from "swarm";
import { caps, recording, screenshot, startRecording, stopRecording, RECORD_MAX_MS } from "./captures";
import { catalog, cleanBars, create, current, deviceSetting, dims, erase, loadCatalog, looks, makeTwin, markWatched, measureScreen, openURL, page, pick, readLook, refresh, refreshIfStale, remove, saved, shutdown, toggleLook } from "./mine";
import { canTwin, isTwinName, shelves, TWIN_SUFFIX, type Device } from "./picker";
import { message, title } from "./state";
import * as hw from "./hw";
import { ago, clock, holderOf, iconOf, line, note, say, shortName } from "./pagekit";
import { capturesStrip, setStrip, stripShown, VIEWER, view, viewerBody } from "./pageCaptures";
import { doctor, examine } from "./doctor";

export const NAV = "simulator";
const SETTINGS = "swarm://settings/simulators/simulators";
const NEW = "simulators-new";
const CONFIRM = "simulators-confirm";
const LINK = "simulators-link";
const DOCTOR = "simulators-doctor";

/** How a device stands, in a few words. */
function stateSaid(d: Device): string {
	const busy = page.busy[d.id];
	if (busy) return busy + "…";
	if (d.agent) {
		const h = holderOf(d);
		return h ? title(h) : d.state === "Booted" ? "Free" : "Shut down";
	}
	return d.state === "Booted" ? "Running" : d.state === "Booting" ? "Booting…" : d.state === "Shutdown" ? "Shut down" : d.state;
}

// ---- The picker ----

function pickerItems(cur: Device | undefined): Child[] {
	const now = Date.now();
	const used = saved().used;
	const out: Child[] = [];
	const list = shelves(page.devices, used, page.query, now);
	for (const s of list) {
		out.push(<ui.heading key={"h" + s.title} text={s.title} />);
		for (const d of s.devices) {
			const said = page.busy[d.id] || d.state !== "Shutdown" || d.agent ? stateSaid(d) : used[d.id] ? `used ${ago(used[d.id]!, now)}` : "";
			out.push(<ui.item key={d.id} label={shortName(d)} icon={iconOf(d)} detail={[s.title === d.os ? "" : d.os, said].filter(Boolean).join(" · ")} badge={isTwinName(d.name) ? "120 Hz" : undefined} checked={cur?.id === d.id} onClick={() => void pick(d)} />);
		}
	}
	if (!list.length) out.push(<ui.item key="none" label={page.query ? "No simulator has that name" : page.loading ? "Looking…" : "No simulators yet"} disabled />);
	out.push(<ui.separator key="sep" />);
	out.push(<ui.item key="new" label="New simulator…" icon="plus" disabled={!!page.problem && !page.devices.some((d) => d.platform === "ios")} onClick={openNew} />);
	return out;
}

function picker(cur: Device | undefined, compact: boolean): Child {
	return (
		<ui.menu label={cur ? shortName(cur) : "Choose a simulator"} icon={cur ? iconOf(cur) : "mobile"} kind="ghost" size="sm" search="Search simulators" onChange={(q) => (page.query = q)} wide={!compact}>
			{() => pickerItems(cur)}
		</ui.menu>
	);
}

// ---- Asking first ----

const ask = ui.store({ what: null as null | { kind: "erase" | "delete"; d: Device } });

function confirm(kind: "erase" | "delete", d: Device) {
	ask.what = { kind, d };
	ui.showOverlay(CONFIRM);
}

function confirmBody(): Child {
	const a = ask.what;
	if (!a) return null;
	const close = () => {
		ask.what = null;
		ui.hideOverlay(CONFIRM);
	};
	const erasing = a.kind === "erase";
	return (
		<ui.box style={{ padding: "s2 s6 s6", gap: 16 }}>
			<ui.text style={{ color: "text2" }}>{erasing ? `${a.d.name} is shut down, and its apps, data and settings are gone for good: it starts as new.` : `${a.d.name} is deleted from ${page.place}, with its apps and data. Erasing only clears it.`}</ui.text>
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				<ui.button label="Cancel" kind="ghost" onClick={close} />
				<ui.button
					label={erasing ? "Erase" : "Delete"}
					kind="danger"
					onClick={() => {
						close();
						void (erasing ? erase(a.d) : remove(a.d));
					}}
				/>
			</ui.box>
		</ui.box>
	);
}

// ---- New simulator ----

const draft = ui.store({ runtime: "", type: "", name: "", busy: false, error: "" });

function openNew() {
	Object.assign(draft, { runtime: "", type: "", name: "", busy: false, error: "" });
	void loadCatalog();
	ui.showOverlay(NEW);
}

function labelled(label: string, control: Child): Child {
	return (
		<ui.box style={{ gap: 6 }}>
			<ui.text style={{ fontSize: "small", fontWeight: 500, color: "text2" }}>{label}</ui.text>
			{control}
		</ui.box>
	);
}

function newBody(): Child {
	const c = catalog.value;
	if (!c) return <ui.box style={{ padding: "s6", alignItems: "center" }}>{catalog.problem ? <ui.text style={{ color: "red" }}>{catalog.problem}</ui.text> : <ui.spinner />}</ui.box>;
	if (!c.runtimes.length) return <ui.text style={{ padding: "s6", color: "text2" }}>{`${page.place} has no simulator runtime: install one in Xcode (Settings, Components).`}</ui.text>;
	const rt = c.runtimes.find((r) => r.id === draft.runtime) ?? c.runtimes[0]!;
	const types = rt.types;
	const type = types.find((t) => t.id === draft.type) ?? types.find((t) => t.family === "iPhone") ?? types[0];
	const name = draft.name || type?.name || "";
	const go = async () => {
		if (!type || !name.trim()) return;
		draft.busy = true;
		draft.error = (await create(name.trim(), type.id, rt.id)) ?? "";
		draft.busy = false;
		if (!draft.error) ui.hideOverlay(NEW);
	};
	return (
		<ui.box style={{ padding: "s4 s6 s6", gap: 14 }}>
			{labelled("System", <ui.select label="System" style={{ alignSelf: "flex-start" }} value={rt.id} options={c.runtimes.map((r) => ({ value: r.id, label: r.name }))} onChange={(v) => Object.assign(draft, { runtime: v, type: "", name: "" })} />)}
			{labelled("Model", <ui.select label="Model" style={{ alignSelf: "flex-start" }} value={type?.id ?? ""} options={types.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => Object.assign(draft, { type: v, name: "" })} />)}
			{labelled("Name", <ui.field value={name} placeholder={type?.name} onChange={(v) => (draft.name = v)} onSubmit={() => void go()} />)}
			{draft.error ? <ui.text style={{ fontSize: "small", color: "red" }}>{draft.error}</ui.text> : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				<ui.button label="Cancel" kind="ghost" onClick={() => ui.hideOverlay(NEW)} />
				<ui.button label={draft.busy ? "Creating…" : "Create"} kind="primary" disabled={draft.busy || !type || !name.trim()} onClick={() => void go()} />
			</ui.box>
		</ui.box>
	);
}

// ---- Open a link ----

const link = ui.store({ url: "", busy: false, error: "" });

function linkBody(): Child {
	const d = current();
	if (!d) return null;
	const go = async () => {
		const url = link.url.trim();
		if (!url) return;
		link.busy = true;
		link.error = (await openURL(d, url)) ?? "";
		link.busy = false;
		if (!link.error) {
			ui.hideOverlay(LINK);
			say(`Opened ${url}`);
		}
	};
	return (
		<ui.box style={{ padding: "s4 s6 s6", gap: 14 }}>
			<ui.text style={{ color: "text2", fontSize: "small" }}>{`A web address, or a deep link of an app on ${d.name} (myapp://…), opened as tapping it would.`}</ui.text>
			<ui.field value={link.url} placeholder="https://… or myapp://path" autoFocus onChange={(v) => (link.url = v)} onSubmit={() => void go()} />
			{link.error ? <ui.text style={{ fontSize: "small", color: "red" }}>{link.error}</ui.text> : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				<ui.button label="Cancel" kind="ghost" onClick={() => ui.hideOverlay(LINK)} />
				<ui.button label={link.busy ? "Opening…" : "Open"} kind="primary" disabled={link.busy || !link.url.trim()} onClick={() => void go()} />
			</ui.box>
		</ui.box>
	);
}

// ---- More ----

const TEXT_SIZES: [string, string][] = [
	["extra-small", "Extra small"],
	["small", "Small"],
	["medium", "Medium"],
	["large", "Large (default)"],
	["extra-large", "Extra large"],
	["extra-extra-large", "XXL"],
	["extra-extra-extra-large", "XXXL"],
	["accessibility-large", "Accessibility L"],
	["accessibility-extra-extra-extra-large", "Accessibility XXXL"],
];
const ANDROID_SCALES: [string, string][] = [
	["0.85", "Small"],
	["1.0", "Default"],
	["1.15", "Large"],
	["1.3", "Largest"],
	["2.0", "Accessibility"],
];
const PLACES: [string, string][] = [
	["37.3349,-122.0090", "Cupertino"],
	["40.7580,-73.9855", "New York"],
	["51.5007,-0.1246", "London"],
	["48.8584,2.2945", "Paris"],
	["35.6595,139.7005", "Tokyo"],
	["-33.8568,151.2153", "Sydney"],
];

/** The device's settings: text size, location, a clean status bar. */
function deviceMenu(d: Device, busy: boolean): Child {
	const ios = d.platform === "ios";
	return (
		<ui.menu key="device" label="Device settings" icon="sliders">
			<ui.menu label="Text size" icon="heading">
				{(ios ? TEXT_SIZES : ANDROID_SCALES).map(([v, l]) => (
					<ui.item key={v} label={l} disabled={busy} onClick={() => void deviceSetting(d, "text-size", v)} />
				))}
			</ui.menu>
			<ui.menu label="Location" icon="map-pin">
				{PLACES.map(([v, l]) => (
					<ui.item key={v} label={l} detail={v} disabled={busy} onClick={() => void deviceSetting(d, "location", v).then((e) => !e && say(`${d.name} is in ${l}`))} />
				))}
				{ios ? <ui.separator /> : null}
				{ios ? <ui.item label="No location" disabled={busy} onClick={() => void deviceSetting(d, "location", "clear")} /> : null}
			</ui.menu>
			<ui.item label="Clean status bar" detail="9:41, full bars and battery: for screenshots" checked={!!cleanBars.get(d.id)} keepOpen disabled={busy} onClick={() => void deviceSetting(d, "status-bar", cleanBars.get(d.id) ? "clear" : "clean")} />
			<ui.item label={looks.get(d.id) === "dark" ? "Light appearance" : "Dark appearance"} icon={looks.get(d.id) === "dark" ? "sun" : "moon"} disabled={busy} onClick={() => void toggleLook(d)} />
		</ui.menu>
	);
}

/** More: the device's settings and a link, the 120 Hz copy, then what ends its session. */
function moreMenu(d: Device | undefined, compact = false): Child {
	const busy = !!(d && page.busy[d.id]);
	const mine = d && !d.agent;
	const on = mine && d.state === "Booted";
	// On a phone, what the row under the device leaves out.
	const rest = compact && on && hw.keysFor(d).length ? hw.keysFor(d).slice(3) : [];
	const dark = d ? looks.get(d.id) === "dark" : false;
	const shown = stripShown(compact);
	return (
		<ui.menu label="More" icon="more" kind="ghost" size="sm" wide>
			{() => [
				...rest.map((k) => <ui.item key={"k" + k.name} label={k.label} icon={k.icon} detail={k.tip} disabled={busy} onClick={() => void hw.press(d!, k.name).then((e) => e && (page.error = e))} />),
				rest.length ? <ui.item key="dark" label={dark ? "Light appearance" : "Dark appearance"} icon={dark ? "sun" : "moon"} disabled={busy} onClick={() => void toggleLook(d!)} /> : null,
				rest.length ? <ui.item key="caps" label="Captures" icon="images" detail={caps.list.length ? `${caps.list.length} screenshots and recordings` : "Screenshots and recordings you take"} checked={shown} onClick={() => setStrip(compact, !shown)} /> : null,
				rest.length ? <ui.separator key="s0" /> : null,
				on ? deviceMenu(d, busy) : null,
				on ? (
					<ui.item
						key="link"
						label="Open a link…"
						icon="external"
						onClick={() => {
							Object.assign(link, { url: "", busy: false, error: "" });
							ui.showOverlay(LINK);
						}}
					/>
				) : null,
				d && mine && canTwin(d, page.devices) ? <ui.item key="twin" label="Make a 120 Hz copy" icon="speedometer" detail="A twin of this model whose display runs at 120 Hz" disabled={busy} onClick={() => void makeTwin(d)} /> : null,
				mine ? <ui.heading key="ends" text="Ends this session" /> : null,
				mine ? <ui.item key="off" label="Shut down" icon="stop" disabled={busy || d.state !== "Booted"} onClick={() => void shutdown(d)} /> : null,
				mine ? <ui.item key="erase" label="Erase content and settings…" icon="eraser" danger disabled={busy} onClick={() => confirm("erase", d)} /> : null,
				mine ? <ui.item key="del" label="Delete simulator…" icon="trash" danger disabled={busy} onClick={() => confirm("delete", d)} /> : null,
				mine ? <ui.separator key="s2" /> : null,
				<ui.item key="refresh" label="Look again" icon="refresh" onClick={() => void refresh()} />,
				<ui.item
					key="doctor"
					label="Doctor…"
					icon="heart-pulse"
					detail="Everything simulators need, checked"
					onClick={() => {
						void examine();
						ui.showOverlay(DOCTOR);
					}}
				/>,
				<ui.item key="settings" label="Simulators settings" icon="settings" href={SETTINGS} />,
			]}
		</ui.menu>
	);
}

// ---- The head ----

/** The recording under way: a red dot, its time, and Stop. */
function recordingPill(): Child {
	const r = recording.now;
	if (!r) return null;
	const secs = (ui.now(1000) - r.at) / 1000;
	return (
		<ui.pressable label={`Stop recording ${r.device.name}`} role="button" onClick={() => void stopNow()} style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, backgroundColor: "color-mix(in srgb, red 14%, transparent)", hover: { backgroundColor: "color-mix(in srgb, red 22%, transparent)" } }}>
			<ui.box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "red", animation: r.stopping ? undefined : { name: "pulse" } }} />
			<ui.text style={{ fontSize: "small", fontWeight: 600, color: "red", fontVariantNumeric: "tabular-nums" }}>{r.stopping ? "Saving…" : `${clock(secs)} / ${clock(RECORD_MAX_MS / 1000)}`}</ui.text>
			{r.stopping ? null : <ui.icon icon="stop" style={{ width: 12, height: 12, color: "red" }} />}
		</ui.pressable>
	);
}

function head(compact: boolean): Child {
	// Looked at again every 30 s while the page shows (a simulator booted or shut down elsewhere shows
	// so); what the page does itself is looked at again as it's done.
	ui.now(30_000);
	refreshIfStale(30_000);
	const cur = current();
	return (
		<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
			{compact ? null : picker(cur, compact)}
			{!compact && cur ? <ui.text style={{ fontSize: "small", color: "text3", ...line }}>{[cur.os, isTwinName(cur.name) ? "120 Hz" : "", page.place].filter(Boolean).join(" · ")}</ui.text> : null}
			{compact ? null : <ui.spacer />}
			{compact ? null : recordingPill()}
			{moreMenu(cur, compact)}
		</ui.box>
	);
}

// ---- The controls ----

/** A control of the pill: its icon and its name, the name under the icon on a phone. */
function tool(icon: IconName, label: string, onClick: () => unknown, o: { disabled?: boolean; tip?: string; tone?: "red" | "accent"; compact?: boolean; active?: boolean } = {}): Child {
	// On a phone each takes an even share of the row, as a tab bar's do.
	const color = o.disabled ? "text3" : (o.tone ?? "text");
	return (
		<ui.pressable
			key={label}
			label={o.tip ?? label}
			role="button"
			disabled={o.disabled}
			onClick={onClick}
			style={{
				flexDirection: o.compact ? "column" : "row",
				alignItems: "center",
				justifyContent: "center",
				gap: o.compact ? 3 : 6,
				flex: o.compact ? 1 : undefined,
				minWidth: o.compact ? 0 : undefined,
				minHeight: o.compact ? 52 : 30,
				padding: o.compact ? "6px 0 5px" : "0 10px",
				borderRadius: o.compact ? 10 : 999,
				backgroundColor: o.active ? "hover" : "transparent",
				hover: o.disabled ? undefined : { backgroundColor: "hover" },
			}}
		>
			<ui.icon icon={icon} style={{ width: o.compact ? 20 : 14, height: o.compact ? 20 : 14, color }} />
			<ui.text style={{ fontSize: o.compact ? "caption" : "small", fontWeight: 500, color, whiteSpace: "nowrap", ...(o.compact ? { color: o.disabled ? "text3" : (o.tone ?? "text2") } : {}) }}>{label}</ui.text>
		</ui.pressable>
	);
}

async function stopNow() {
	const r = await stopRecording();
	if (typeof r === "string") page.error = r;
	else say(`Recording saved, ${clock(r.secs ?? 0)}`);
}

function controls(d: Device, compact: boolean): Child {
	const busy = !!page.busy[d.id];
	const dark = looks.get(d.id) === "dark";
	const rec = recording.now;
	const recHere = rec?.device.id === d.id;
	const shown = stripShown(compact);
	const items: Child[] = [];
	if (!d.agent) {
		items.push(
			tool(
				"camera",
				"Screenshot",
				() =>
					void screenshot(d)
						.then(() => say("Screenshot saved to your captures"))
						.catch((e) => (page.error = message(e))),
				{ disabled: busy, compact, tip: `A screenshot of ${d.name}, into your captures` },
			),
			recHere
				? tool("stop", rec!.stopping ? "Saving…" : "Stop", () => void stopNow(), { tone: "red", compact, disabled: rec!.stopping, tip: "Stop recording and keep the clip" })
				: tool("video", "Record", () => void startRecording(d).then((e) => e && (page.error = e)), { disabled: busy || !!rec, compact, tip: rec ? `${rec.device.name} is being recorded` : `Record ${d.name}'s screen, up to 3 minutes` }),
		);
		for (const k of keysShown(d, compact)) items.push(tool(k.icon, k.label, () => void hw.press(d, k.name).then((e) => e && (page.error = e)), { disabled: busy, compact, tip: k.tip }));
		if (!compact || !hw.keysFor(d).length) items.push(tool(dark ? "sun" : "moon", dark ? "Light" : "Dark", () => void toggleLook(d), { disabled: busy, compact, tip: `Switch ${d.name} to its ${dark ? "light" : "dark"} appearance` }));
	}
	if (!compact || !hw.keysFor(d).length || d.agent) items.push(tool("images", compact ? "Captures" : `Captures${caps.list.length ? ` ${caps.list.length}` : ""}`, () => setStrip(compact, !shown), { compact, active: shown, tip: shown ? "Hide the captures" : "Show the captures" }));
	return (
		<ui.box style={{ alignItems: compact ? "stretch" : "center", alignSelf: "stretch", paddingTop: compact ? 10 : 12 }}>
			<ui.box style={compact ? { flexDirection: "row", alignItems: "center", padding: "2px 4px", borderRadius: 16, backgroundColor: "color-mix(in srgb, text 5%, bg)" } : { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 2, padding: 3, borderRadius: 18, backgroundColor: "raised", border: "1px solid border", boxShadow: "0 1px 2px rgba(0,0,0,0.06)", maxWidth: "100%" }}>{items}</ui.box>
		</ui.box>
	);
}

/** The keys in the pill: all of them on a computer; on a phone the first three (Home, Apps, Rotate; Back, Home, Apps), the rest in More. */
function keysShown(d: Device, compact: boolean) {
	const all = hw.keysFor(d);
	return compact ? all.slice(0, 3) : all;
}

// ---- The page ----

/** A card in the screen's place: a sentence, and what to do about it. */
function stateCard(icon: IconName, said: string, more: string, action?: Child, spin = false): Child {
	return (
		<ui.box style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: "s8", gap: 8 }}>
			<ui.box style={{ width: 44, height: 44, borderRadius: "card", backgroundColor: "field", boxShadow: "inset 0 0 0 1px divider", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>{spin ? <ui.spinner /> : <ui.icon icon={icon} style={{ width: 20, height: 20, color: "text2" }} />}</ui.box>
			<ui.text style={{ fontWeight: 500, textAlign: "center" }}>{said}</ui.text>
			{more ? <ui.text style={{ fontSize: "small", color: "text2", textAlign: "center", maxWidth: 380 }}>{more}</ui.text> : null}
			{action ? <ui.box style={{ marginTop: 8, flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>{action}</ui.box> : null}
		</ui.box>
	);
}

/** Quick start: the user's most likely devices, a button each, while nothing runs. */
function quickStart(): Child {
	const used = saved().used;
	const mine = page.devices.filter((d) => !d.agent && d.platform === "ios");
	const first = current();
	const rest = mine
		.filter((d) => d.id !== first?.id)
		.sort((a, b) => (used[b.id] ?? 0) - (used[a.id] ?? 0))
		.slice(0, 2);
	return [first, ...rest].filter(Boolean).map((d, i) => <ui.button key={d!.id} label={`${d!.state === "Booted" ? "Show" : "Start"} ${shortName(d!)}`} icon={i ? undefined : "play"} kind={i ? "soft" : "primary"} onClick={() => void pick(d!)} />);
}

/** Its screen, live, as tall as the page leaves and in its own shape; Swarm's own view, which takes touches, keys and dropped files. */
function live(d: Device, compact: boolean): Child {
	const machine = page.machine[d.platform];
	if (!machine) return stateCard("mobile", `${d.name} is running`, `Swarm reaches ${page.place} over ssh, and can't show its screen live: join it to Swarm.`);
	if ((ui.format ?? 0) < 17) return stateCard("mobile", `${d.name} is running`, "This window is too old to show it live: update Swarm.");
	if (looks.get(d.id) === undefined) void readLook(d);
	markWatched(d.id);
	const size = hw.sizeOf(d) ?? dims.get(d.id);
	if (!size) void measureScreen(d);
	const h = d.agent ? holderOf(d) : undefined;
	const dev = d.platform === "ios" ? { simulator: d.id } : { phone: d.serial };
	const bare = hw.canBare();
	// The device's shape: its picture, and Swarm's bar over it (about 36 px) where the view has one.
	const shape = size ? { aspectRatio: bare ? size.w / size.h : size.w / (size.h + (size.w * 36) / 400), maxWidth: "100%" as const } : { alignSelf: "stretch" as const };
	const pad = compact ? 5 : 9;
	// A device's corners, as its screen's: rounder on a phone than on an iPad.
	const radius = /iPad/.test(d.name) ? 18 : compact ? 34 : 44;
	return (
		<ui.box style={{ flex: 1, minHeight: 0, alignItems: "center", padding: compact ? "8px 12px 10px" : "s6 s6 0" }}>
			<ui.box style={{ flex: 1, minHeight: 0, alignSelf: "stretch", alignItems: "center" }}>
				{bare ? (
					// Swarm draws its bezel round the screen, fitted in the room at the device's shape, as the room and a rotation change.
					hw.screen({ machine, ...dev, watch: h ? title(h) : undefined, label: d.name, bezel: pad, style: { flex: 1, alignSelf: "stretch", borderRadius: radius } }, d)
				) : (
					<ui.screen key={d.id} machine={machine} {...dev} watch={h ? title(h) : undefined} label={d.name} style={{ height: "100%", ...shape }} />
				)}
			</ui.box>
			{controls(d, compact)}
		</ui.box>
	);
}

function body(compact: boolean): Child {
	refreshIfStale();
	void settings.get("defaultDevice");
	const cur = current();
	const now = ui.now(1000);
	const said = note.text && now - note.at < 3000 ? note.text : "";
	const err = page.error ? (
		<ui.box key="err" style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: "s3 s6 0", justifyContent: "center" }}>
			<ui.icon icon="alert-circle" style={{ width: 14, height: 14, color: "red" }} />
			<ui.text style={{ fontSize: "small", color: "red", flexShrink: 1 }}>{page.error}</ui.text>
			<ui.iconButton icon="x" label="Dismiss" onClick={() => (page.error = "")} />
		</ui.box>
	) : null;
	let main: Child;
	if (!page.at && !page.devices.length) main = stateCard("mobile", "Looking for simulators…", `On ${page.place || "the Mac"}.`, undefined, true);
	else if (page.problem && !page.devices.length) main = stateCard("alert", "No simulators here", page.problem, <ui.button label="Check again" icon="refresh" kind="soft" onClick={() => void refresh()} />);
	else if (!cur) main = stateCard("mobile", "No simulators yet", `Make one of any model ${page.place} has a runtime for.`, <ui.button label="New simulator" icon="plus" kind="primary" onClick={openNew} />);
	else if (page.busy[cur.id] === "Booting" || cur.state === "Booting") main = stateCard(iconOf(cur), `Starting ${cur.name}…`, cur.platform === "android" ? "An emulator boots cold: a minute or two." : "About 20 seconds; a first boot takes longer.", undefined, true);
	else if (page.busy[cur.id] && cur.state !== "Booted") main = stateCard(iconOf(cur), `${page.busy[cur.id]} ${cur.name}…`, "", undefined, true);
	else if (cur.state !== "Booted") {
		main = cur.agent
			? stateCard(iconOf(cur), `${cur.name} is shut down`, "An agent's simulator starts as its thread needs it.")
			: stateCard(iconOf(cur), `${cur.name} is shut down`, page.devices.some((d) => !d.agent && d.state === "Booted") ? "Start it, or pick a running one above." : "Start it to use it here, live.", <>{quickStart()}</>);
	} else main = live(cur, compact);
	const busyLine = cur && page.busy[cur.id] && cur.state === "Booted" ? `${page.busy[cur.id]}…` : said;
	return (
		<ui.box style={{ flex: 1, minHeight: 0 }}>
			{compact ? (
				// On a phone the bar has the page's title: the picker is the page's first row.
				<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: "6px 12px 0 8px", minHeight: 44 }}>
					{picker(cur, compact)}
					{cur ? (
						<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1, minWidth: 0 }}>
							<ui.box style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: page.busy[cur.id] ? "accent" : cur.state === "Booted" ? "green" : "text3" }} />
							<ui.text style={{ fontSize: "small", color: "text3", ...line }}>{[cur.os, isTwinName(cur.name) ? "120 Hz" : ""].filter(Boolean).join(" · ")}</ui.text>
						</ui.box>
					) : null}
					<ui.spacer />
					{recordingPill()}
				</ui.box>
			) : null}
			{err}
			{main}
			{compact ? (
				busyLine ? (
					<ui.box style={{ alignItems: "center", paddingBottom: 6 }}>
						<ui.text style={{ fontSize: "small", color: "text2" }}>{busyLine}</ui.text>
					</ui.box>
				) : null
			) : (
				<ui.box style={{ height: 22, alignItems: "center", justifyContent: "center" }}>{busyLine ? <ui.text style={{ fontSize: "small", color: "text2" }}>{busyLine}</ui.text> : null}</ui.box>
			)}
			{stripShown(compact) ? capturesStrip(compact) : null}
		</ui.box>
	);
}

/** The doctor: each check, how it stands, and its fix. */
export function doctorBody(again = true): Child {
	const list = doctor.checks;
	return (
		<ui.box style={{ padding: "s2 s6 s6", gap: 12 }}>
			{doctor.busy && !list.length ? (
				<ui.box style={{ alignItems: "center", padding: "s6" }}>
					<ui.spinner />
				</ui.box>
			) : null}
			{list.map((c, i) => (
				<ui.box key={i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
					<ui.box style={{ width: 18, height: 18, borderRadius: 9, marginTop: 1, flexShrink: 0, alignItems: "center", justifyContent: "center", backgroundColor: c.ok === true ? "color-mix(in srgb, green 16%, transparent)" : c.ok === "warn" ? "color-mix(in srgb, amber 18%, transparent)" : "color-mix(in srgb, red 16%, transparent)" }}>
						<ui.icon icon={c.ok === true ? "check" : c.ok === "warn" ? "alert" : "x"} style={{ width: 11, height: 11, color: c.ok === true ? "green" : c.ok === "warn" ? "amber" : "red" }} />
					</ui.box>
					<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
						<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
							<ui.text style={{ fontWeight: 500 }}>{c.what}</ui.text>
							<ui.text style={{ fontSize: "small", color: "text2" }}>{c.said}</ui.text>
						</ui.box>
						{c.fix && c.ok !== true ? <ui.text style={{ fontSize: "small", color: "text2" }} selectable>{c.fix}</ui.text> : null}
					</ui.box>
				</ui.box>
			))}
			{again ? <ui.box style={{ flexDirection: "row", justifyContent: "flex-end", paddingTop: 4 }}>
				<ui.button label={doctor.busy ? "Checking…" : "Check again"} icon="refresh" kind="soft" disabled={doctor.busy} onClick={() => void examine()} />
			</ui.box> : null}
		</ui.box>
	);
}

export function registerPage() {
	ui.nav({
		id: NAV,
		title: "Simulator",
		icon: "mobile",
		order: 61,
		fill: true,
		head: true,
		items: [],
		render: ({ args }) => (args.slot === "head" ? head(args.compact === "1") : body(args.compact === "1")),
	});
	ui.overlay({ id: NEW, title: "New simulator", width: 420, render: newBody });
	ui.overlay({ id: CONFIRM, title: "Are you sure?", width: 420, onClose: () => (ask.what = null), render: () => confirmBody() });
	ui.overlay({ id: LINK, title: "Open a link", width: 440, render: linkBody });
	ui.overlay({ id: DOCTOR, title: "Doctor", width: 520, render: () => doctorBody() });
	ui.overlay({ id: VIEWER, title: "Capture", width: 760, onClose: () => (view.id = ""), render: viewerBody });
}
