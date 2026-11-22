// The Simulator page, on the window's rail: the user's own simulator, live,
// filling the page, as bb's Simulator shows it. The device picker sits in
// the title bar (running first, then recent, then by OS, with a search,
// and New simulator at its foot); picking one shows it, booting it first
// where it's shut down. Under the screen, its controls; More has what ends
// a session (Shut down, Erase, Delete) and the 120 Hz copy. The agents'
// simulators are in the picker too, to watch.
import { settings, ui, type Child } from "swarm";
import { catalog, create, current, dims, erase, loadCatalog, looks, makeTwin, measureScreen, page, pick, readLook, refresh, refreshIfStale, remove, saved, shutdown, toggleLook } from "./mine";
import { canTwin, isTwinName, shelves, TWIN_SUFFIX, type Device } from "./picker";
import { info, pool, title } from "./state";

export const NAV = "simulator";
const SETTINGS = "swarm://settings/simulators/simulators";
const NEW = "simulators-new";
const CONFIRM = "simulators-confirm";

const line = { flexShrink: 1, minWidth: 0, textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

/** A device's name as a row says it: a twin's without its "(120 Hz)", which its badge says. */
const shortName = (d: Device) => (isTwinName(d.name) ? d.name.slice(0, -TWIN_SUFFIX.length) : d.name);

function ago(at: number, now: number) {
	const s = Math.max(0, (now - at) / 1000);
	return s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}

/** The agent's thread that holds an agent simulator, by its UDID or serial, if one does. */
function holderOf(d: Device): string | undefined {
	const s = pool.slots.find((x) => x.holder && (info(x).udid === d.id || (d.serial && info(x).serial === d.serial)));
	return s?.holder?.thread;
}

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
			out.push(
				<ui.item
					key={d.id}
					label={shortName(d)}
					icon={d.platform === "android" ? "mobile-signal" : /iPad/.test(d.name) ? "tablet" : /Watch/.test(d.name) ? "watch" : /TV/.test(d.name) ? "tv" : "mobile"}
					detail={[s.title === d.os ? "" : d.os, said].filter(Boolean).join(" · ")}
					badge={isTwinName(d.name) ? "120 Hz" : undefined}
					checked={cur?.id === d.id}
					onClick={() => pick(d)}
				/>,
			);
		}
	}
	if (!list.length) out.push(<ui.item key="none" label={page.query ? "No simulator has that name" : page.loading ? "Looking…" : "No simulators yet"} disabled />);
	out.push(<ui.separator key="sep" />);
	out.push(<ui.item key="new" label="New simulator…" icon="plus" disabled={!!page.problem && !page.devices.some((d) => d.platform === "ios")} onClick={openNew} />);
	return out;
}

function picker(cur: Device | undefined, compact: boolean): Child {
	return (
		<ui.menu label={cur ? shortName(cur) : "Choose a simulator"} icon={cur?.platform === "android" ? "mobile-signal" : "mobile"} kind="ghost" size="sm" search="Search simulators" onChange={(q) => (page.query = q)} wide={!compact}>
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
			<ui.box style={{ gap: 6 }}>
				<ui.text style={{ fontSize: "small", fontWeight: 500, color: "text2" }}>System</ui.text>
				<ui.select label="System" style={{ alignSelf: "flex-start" }} value={rt.id} options={c.runtimes.map((r) => ({ value: r.id, label: r.name }))} onChange={(v) => Object.assign(draft, { runtime: v, type: "", name: "" })} />
			</ui.box>
			<ui.box style={{ gap: 6 }}>
				<ui.text style={{ fontSize: "small", fontWeight: 500, color: "text2" }}>Model</ui.text>
				<ui.select label="Model" style={{ alignSelf: "flex-start" }} value={type?.id ?? ""} options={types.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => Object.assign(draft, { type: v, name: "" })} />
			</ui.box>
			<ui.box style={{ gap: 6 }}>
				<ui.text style={{ fontSize: "small", fontWeight: 500, color: "text2" }}>Name</ui.text>
				<ui.field value={name} placeholder={type?.name} onChange={(v) => (draft.name = v)} onSubmit={() => void go()} />
			</ui.box>
			{draft.error ? <ui.text style={{ fontSize: "small", color: "red" }}>{draft.error}</ui.text> : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				<ui.button label="Cancel" kind="ghost" onClick={() => ui.hideOverlay(NEW)} />
				<ui.button label={draft.busy ? "Creating…" : "Create"} kind="primary" disabled={draft.busy || !type || !name.trim()} onClick={() => void go()} />
			</ui.box>
		</ui.box>
	);
}

// ---- The page ----

/** More: the 120 Hz copy, then what ends its session. */
function moreMenu(d: Device | undefined, compact: boolean): Child {
	const busy = !!(d && page.busy[d.id]);
	const mine = d && !d.agent;
	return (
		<ui.menu label="More" icon="more" kind="ghost" size="sm" wide>
			{() => [
				d && mine && canTwin(d, page.devices) ? <ui.item key="twin" label="Make a 120 Hz copy" icon="speedometer" detail="A twin of this model whose display runs at 120 Hz" disabled={busy} onClick={() => void makeTwin(d)} /> : null,
				compact && d && mine && d.state === "Booted" ? <ui.item key="look" label={looks.get(d.id) === "dark" ? "Light appearance" : "Dark appearance"} icon={looks.get(d.id) === "dark" ? "sun" : "moon"} disabled={busy} onClick={() => void toggleLook(d)} /> : null,
				d && mine ? <ui.heading key="ends" text="Ends this session" /> : null,
				d && mine ? <ui.item key="off" label="Shut down" icon="stop" disabled={busy || d.state !== "Booted"} onClick={() => void shutdown(d)} /> : null,
				d && mine ? <ui.item key="erase" label="Erase content and settings…" icon="eraser" danger disabled={busy} onClick={() => confirm("erase", d)} /> : null,
				d && mine ? <ui.item key="del" label="Delete simulator…" icon="trash" danger disabled={busy} onClick={() => confirm("delete", d)} /> : null,
				d && mine ? <ui.separator key="s2" /> : null,
				<ui.item key="refresh" label="Look again" icon="refresh" onClick={() => void refresh()} />,
				<ui.item key="settings" label="Simulators settings" icon="settings" href={SETTINGS} />,
			]}
		</ui.menu>
	);
}

function head(compact: boolean): Child {
	// Looked at again every 5 s while the page shows: a simulator booted or shut down elsewhere shows so.
	ui.now(5000);
	refreshIfStale();
	const cur = current();
	return (
		<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
			{compact ? null : picker(cur, compact)}
			{!compact && cur ? <ui.text style={{ fontSize: "small", color: "text3", ...line }}>{[cur.os, isTwinName(cur.name) ? "120 Hz" : "", page.place].filter(Boolean).join(" · ")}</ui.text> : null}
			{compact ? null : <ui.spacer />}
			{moreMenu(cur, compact)}
		</ui.box>
	);
}

/** A card in the screen's place: a sentence, and what to do about it. */
function stateCard(icon: string, said: string, more: string, action?: Child, spin = false): Child {
	return (
		<ui.box style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: "s8", gap: 8 }}>
			<ui.box style={{ width: 44, height: 44, borderRadius: "card", backgroundColor: "field", boxShadow: "inset 0 0 0 1px divider", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>{spin ? <ui.spinner /> : <ui.icon icon={icon as any} style={{ width: 20, height: 20, color: "text2" }} />}</ui.box>
			<ui.text style={{ fontWeight: 500, textAlign: "center" }}>{said}</ui.text>
			<ui.text style={{ fontSize: "small", color: "text2", textAlign: "center", maxWidth: 380 }}>{more}</ui.text>
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
	return [first, ...rest].filter(Boolean).map((d, i) => <ui.button key={d!.id} label={`${d!.state === "Booted" ? "Show" : "Start"} ${shortName(d!)}`} icon={i ? undefined : "play"} kind={i ? "soft" : "primary"} onClick={() => pick(d!)} />);
}

/** A control under the screen: an icon over its label on a phone, beside it otherwise. */
function control(icon: string, label: string, onClick: () => unknown, o: { disabled?: boolean; tip?: string } = {}): Child {
	return <ui.button key={label} label={label} icon={icon as any} kind="ghost" size="sm" disabled={o.disabled} tooltip={o.tip} onClick={onClick} />;
}

function controls(d: Device, compact: boolean): Child {
	const busy = !!page.busy[d.id];
	const dark = looks.get(d.id) === "dark";
	if (d.agent) return null;
	return (
		<ui.box style={{ flexDirection: "row", gap: 2, alignItems: "center", justifyContent: "center", flexWrap: "wrap", padding: compact ? "s2 0" : "s3 0 0" }}>
			{control(dark ? "sun" : "moon", dark ? "Light" : "Dark", () => toggleLook(d), { disabled: busy, tip: `Switch ${d.name} to its ${dark ? "light" : "dark"} appearance` })}
			{canTwin(d, page.devices) ? control("speedometer", "120 Hz copy", () => makeTwin(d), { disabled: busy, tip: "Make a twin of this model whose display runs at 120 Hz, and show it" }) : null}
			{control("stop", "Shut down", () => shutdown(d), { disabled: busy })}
		</ui.box>
	);
}

/** Its screen, live, filling what's left; Swarm's own view, which takes touches, keys and dropped files. */
function live(d: Device, compact: boolean): Child {
	const machine = page.machine[d.platform];
	if (!machine) return stateCard("mobile", `${d.name} is running`, `Swarm reaches ${page.place} over ssh, and can't show its screen live: join it to Swarm.`);
	if ((ui.format ?? 0) < 17) return stateCard("mobile", `${d.name} is running`, "This window is too old to show it live: update Swarm.");
	if (looks.get(d.id) === undefined) void readLook(d);
	const size = dims.get(d.id);
	if (!size) void measureScreen(d);
	const h = d.agent ? holderOf(d) : undefined;
	const dev = d.platform === "ios" ? { simulator: d.id } : { phone: d.serial };
	// As tall as the page leaves, and as wide as that makes the device's own shape (its bar above the picture, 36 more); its picture at once.
	const shape = size ? { aspectRatio: size.w / (size.h + (size.w * 36) / 400), maxWidth: "100%" as const } : { alignSelf: "stretch" as const };
	return (
		<ui.box style={{ flex: 1, minHeight: 0, alignItems: "center", padding: compact ? "s3 s4 0" : "s6 s6 s5" }}>
			<ui.box style={{ flex: 1, minHeight: 0, alignSelf: "stretch", alignItems: "center" }}>
				<ui.screen key={d.id} machine={machine} {...dev} watch={h ? title(h) : undefined} label={d.name} style={{ height: "100%", ...shape }} />
			</ui.box>
			{controls(d, compact)}
		</ui.box>
	);
}

function body(compact: boolean): Child {
	refreshIfStale();
	void settings.get("defaultDevice");
	const cur = current();
	const err = page.error ? <ui.text key="err" style={{ fontSize: "small", color: "red", textAlign: "center", padding: "s3 s6 0" }}>{page.error}</ui.text> : null;
	let main: Child;
	if (!page.at && !page.devices.length) main = stateCard("mobile", "Looking for simulators…", `On ${page.place || "the Mac"}.`, undefined, true);
	else if (page.problem && !page.devices.length) main = stateCard("alert", "No simulators here", page.problem, <ui.button label="Check again" icon="refresh" kind="soft" onClick={() => void refresh()} />);
	else if (!cur) main = stateCard("mobile", "No simulators yet", `Make one of any model ${page.place} has a runtime for.`, <ui.button label="New simulator" icon="plus" kind="primary" onClick={openNew} />);
	else if (page.busy[cur.id] === "Booting" || cur.state === "Booting") main = stateCard("mobile", `Starting ${cur.name}…`, cur.platform === "android" ? "An emulator boots cold: a minute or two." : "About 20 seconds; a first boot takes longer.", undefined, true);
	else if (page.busy[cur.id]) main = stateCard("mobile", `${page.busy[cur.id]} ${cur.name}…`, "", undefined, true);
	else if (cur.state !== "Booted") {
		main = cur.agent
			? stateCard("mobile", `${cur.name} is shut down`, "An agent's simulator starts as its thread needs it.")
			: stateCard("mobile", `${cur.name} is shut down`, page.devices.some((d) => !d.agent && d.state === "Booted") ? "Start it, or pick a running one above." : "Start it to use it here, live.", <>{quickStart()}</>);
	} else main = live(cur, compact);
	return (
		<ui.box style={{ flex: 1, minHeight: 0 }}>
			{compact ? (
				// On a phone the bar has the page's title: the picker is the page's first row.
				<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: "s2 s4 0", minHeight: 44 }}>
					{picker(cur, compact)}
					{cur ? <ui.text style={{ fontSize: "small", color: "text3", ...line }}>{[cur.os, isTwinName(cur.name) ? "120 Hz" : ""].filter(Boolean).join(" · ")}</ui.text> : null}
				</ui.box>
			) : null}
			{err}
			{main}
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
	ui.overlay({ id: CONFIRM, title: "Are you sure?", width: 400, onClose: () => (ask.what = null), render: () => confirmBody() });
}
