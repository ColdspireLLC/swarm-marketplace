// The Simulator page's captures: the strip under the device (this
// device's or all, Select to delete several) and the viewer a capture
// opens in (Copy, Save, Add to message; a recording played).
import { storage, ui, type Child } from "swarm";
import { bytesOf, caps, remove as removeCaptures, thumbOf, type Capture } from "./captures";
import { current, dims } from "./mine";
import { ago, clock, say, shortName } from "./pagekit";
import { message, title } from "./state";
import * as hw from "./hw";

export const VIEWER = "simulators-capture";


const strip = ui.store({ selecting: false, picked: new Set<string>(), armed: false });
export const view = ui.store({ id: "", busy: "", error: "" });

/** Whether the strip shows: the user's choice, kept; shown on a computer and hidden on a phone at first. */
export function stripShown(compact: boolean): boolean {
	const v = storage.get<{ desktop?: boolean; phone?: boolean }>("strip") ?? {};
	return compact ? !!v.phone : v.desktop !== false;
}
export function setStrip(compact: boolean, on: boolean) {
	storage.set("strip", { ...(storage.get<object>("strip") ?? {}), [compact ? "phone" : "desktop"]: on });
}

function openCapture(c: Capture) {
	if (strip.selecting) {
		const p = new Set(strip.picked);
		if (p.has(c.id)) p.delete(c.id);
		else p.add(c.id);
		strip.picked = p;
		strip.armed = false;
		return;
	}
	Object.assign(view, { id: c.id, busy: "", error: "" });
	ui.showOverlay(VIEWER);
}

function tile(c: Capture, compact: boolean): Child {
	const t = thumbOf(c);
	const picked = strip.picked.has(c.id);
	const h = compact ? 88 : 96;
	const size = c.w && c.h ? { w: c.w, h: c.h } : dims.get(c.device);
	const width = Math.round(h * (size ? size.w / size.h : 0.46));
	const said = `${c.kind === "mp4" ? "Recording" : "Screenshot"} of ${c.name}, ${ago(c.at, Date.now())}${c.thread ? `, by ${title(c.thread)}` : ""}`;
	return (
		<ui.pressable key={c.id} label={said} role={strip.selecting ? "checkbox" : "button"} checked={strip.selecting ? picked : undefined} onClick={() => openCapture(c)} style={{ position: "relative", height: h, width, flexShrink: 0, borderRadius: 8, overflow: "hidden", backgroundColor: "black", border: picked ? "2px solid accent" : "1px solid border", hover: { borderColor: picked ? "accent" : "borderStrong" } }}>
			{t ? <ui.image src={t} alt={said} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <ui.box style={{ height: "100%", width: "100%", backgroundColor: "hover", animation: c.size ? { name: "shimmer" } : undefined }} />}
			{c.kind === "mp4" ? (
				<ui.box style={{ position: "absolute", left: 4, bottom: 4, flexDirection: "row", alignItems: "center", gap: 3, padding: "1px 5px", borderRadius: 4, backgroundColor: "rgba(0,0,0,0.65)" }}>
					<ui.icon icon={c.size ? "play" : "video"} style={{ width: 9, height: 9, color: "white" }} />
					<ui.text style={{ fontSize: "caption", color: "white", fontVariantNumeric: "tabular-nums" }}>{c.size ? clock(c.secs ?? 0) : "REC"}</ui.text>
				</ui.box>
			) : null}
			{strip.selecting ? (
				<ui.box style={{ position: "absolute", right: 4, top: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: picked ? "accent" : "rgba(0,0,0,0.45)", border: "1.5px solid white", alignItems: "center", justifyContent: "center" }}>
					{picked ? <ui.icon icon="check" style={{ width: 11, height: 11, color: "white" }} /> : null}
				</ui.box>
			) : null}
		</ui.pressable>
	);
}

/** Whether the strip shows the device on screen's captures, or every device's: the user's choice, kept. */
const scopeOf = () => (storage.get<string>("stripScope") === "device" ? "device" : "all");

export function capturesStrip(compact: boolean): Child {
	const cur = current();
	const scope = scopeOf();
	const list = scope === "device" && cur ? caps.list.filter((c) => c.device === cur.id) : caps.list;
	const n = strip.picked.size;
	const endSelect = () => Object.assign(strip, { selecting: false, picked: new Set<string>(), armed: false });
	return (
		<ui.box style={{ gap: 8, padding: compact ? "s2 s4 s4" : "s3 s6 s5", borderTop: "1px solid divider" }}>
			<ui.box style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 }}>
				<ui.text style={{ fontSize: "small", fontWeight: 600 }}>Captures</ui.text>
				<ui.text style={{ fontSize: "small", color: "text3" }}>{String(list.length)}</ui.text>
				{cur && caps.list.some((c) => c.device !== cur.id) && !strip.selecting ? (
					<ui.segmented label="Whose captures" value={scope} options={[{ value: "all", label: "All" }, { value: "device", label: compact ? "This one" : shortName(cur) }]} onChange={(v) => storage.set("stripScope", v)} style={{ marginLeft: 6 }} />
				) : null}
				<ui.spacer />
				{strip.selecting ? (
					<>
						<ui.button label={n === list.length ? "Select none" : "Select all"} kind="ghost" size="sm" onClick={() => Object.assign(strip, { picked: n === list.length ? new Set() : new Set(list.map((c) => c.id)), armed: false })} />
						<ui.button
							label={strip.armed ? `Delete ${n} for good` : `Delete${n ? ` ${n}` : ""}`}
							kind={strip.armed ? "danger" : "soft"}
							size="sm"
							disabled={!n}
							onClick={() => {
								if (!strip.armed) {
									strip.armed = true;
									return;
								}
								void removeCaptures([...strip.picked]);
								endSelect();
							}}
						/>
						<ui.button label="Done" kind="ghost" size="sm" onClick={endSelect} />
					</>
				) : list.length ? (
					<ui.button label="Select" kind="ghost" size="sm" onClick={() => (strip.selecting = true)} />
				) : null}
			</ui.box>
			{list.length ? (
				<ui.scroll style={{ flexDirection: "row" }}>
					<ui.box style={{ flexDirection: "row", gap: 8, paddingBottom: 2 }}>{list.slice(0, 60).map((c) => tile(c, compact))}</ui.box>
				</ui.scroll>
			) : (
				<ui.text style={{ fontSize: "small", color: "text3", paddingBottom: 4 }}>Screenshots and recordings you take show here.</ui.text>
			)}
		</ui.box>
	);
}

/** The full capture, fetched as the viewer opens it. */
const full = ui.store(new Map<string, Uint8Array>(), { shallow: true });
const loading = new Set<string>();

export function viewerBody(): Child {
	const c = caps.list.find((x) => x.id === view.id);
	if (!c) return <ui.text style={{ padding: "s6", color: "text2" }}>It's gone.</ui.text>;
	const b = full.get(c.id);
	if (!b && !loading.has(c.id) && c.size) {
		loading.add(c.id);
		void bytesOf(c)
			.then((x) => {
				if (full.size > 3) full.delete(full.keys().next().value!);
				full.set(c.id, x);
			})
			.catch((e) => (view.error = message(e)))
			.finally(() => loading.delete(c.id));
	}
	const t = thumbOf(c);
	const pic = c.kind === "png" ? b : undefined;
	const tooBig = !!b && b.length > hw.MAX_BYTES;
	const video = c.kind === "mp4" && b && !tooBig && hw.canPlay() ? hw.video(b, t) : null;
	const close = () => ui.hideOverlay(VIEWER);
	return (
		<ui.box style={{ padding: "0 s6 s6", gap: 14 }}>
			<ui.box style={{ gap: 2 }}>
				<ui.text style={{ fontWeight: 500 }}>{`${c.kind === "mp4" ? "Recording" : "Screenshot"} of ${c.name}`}</ui.text>
				<ui.text style={{ fontSize: "small", color: "text2" }}>{[ago(c.at, Date.now()), c.secs ? clock(c.secs) : "", c.thread ? `taken by ${title(c.thread)}` : "", c.title ?? ""].filter(Boolean).join(" · ")}</ui.text>
			</ui.box>
			<ui.box style={{ position: "relative", height: 520, borderRadius: 10, backgroundColor: "black", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
				{video ?? (pic || t ? <ui.image src={(pic ?? t)!} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <ui.spinner />)}
				{c.kind === "mp4" && !video ? (
					<ui.box style={{ position: "absolute", bottom: 12, padding: "4px 10px", borderRadius: 6, backgroundColor: "rgba(0,0,0,0.65)" }}>
						<ui.text style={{ fontSize: "small", color: "white" }}>{!b ? "Fetching the clip…" : tooBig ? "Too long to play here: it's on the simulators' computer" : "Update Swarm to play clips here"}</ui.text>
					</ui.box>
				) : null}
			</ui.box>
			{view.error ? <ui.text style={{ fontSize: "small", color: "red" }}>{view.error}</ui.text> : null}
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
				<ui.button
					label="Delete"
					icon="trash"
					kind="ghost"
					onClick={() => {
						close();
						void removeCaptures([c.id]);
					}}
				/>
				<ui.spacer />
				{hw.canCopyImage() && c.kind === "png" ? (
					<ui.button
						label="Copy"
						icon="copy"
						kind="soft"
						disabled={!b}
						onClick={() => {
							if (!b) return;
							hw.copyImage(b);
							say("Copied");
						}}
					/>
				) : null}
				{hw.canSaveBytes() ? <ui.button label="Save…" icon="download" kind="soft" disabled={!b || tooBig} onClick={() => b && hw.saveBytes(`${c.name.replace(/[^\w .()-]+/g, "")} ${new Date(c.at).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${c.kind}`, b)} /> : null}
				{hw.canAttach() ? attachMenu(c, tooBig ? undefined : b) : null}
			</ui.box>
		</ui.box>
	);
}

/** Add to message: into a thread's composer, as if pasted; the threads the user has, latest first. */
const threads = ui.store({ at: 0, list: [] as { id: string; title: string }[] });
function attachMenu(c: Capture, b: Uint8Array | undefined): Child {
	if (Date.now() - threads.at > 30_000) {
		threads.at = Date.now();
		void hw.recentThreads().then((l) => (threads.list = l));
	}
	return (
		<ui.menu label="Add to message" icon="paperclip" kind="primary" disabled={!b} search="Search threads">
			{() =>
				threads.list.slice(0, 30).map((t) => (
					<ui.item
						key={t.id}
						label={t.title}
						onClick={() => {
							if (!b) return;
							hw.attach(t.id, `${c.name}.${c.kind}`, b);
							ui.hideOverlay(VIEWER);
							say(`Added to “${t.title}”`);
						}}
					/>
				))
			}
		</ui.menu>
	);
}
