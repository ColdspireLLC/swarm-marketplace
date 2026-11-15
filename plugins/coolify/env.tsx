// A resource's environment variables, managed: each one's value hidden
// until shown, copied, edited (its name, value, and what Coolify does with
// it), deleted after a second press; new ones added one at a time or
// pasted as a .env file; all of them copied as one. Coolify uses what
// changed at the next deploy, which a note offers to start.
import { ui, type Child } from "swarm";
import * as api from "./coolify";
import type { EnvVar, Resource } from "./coolify";
import { conn, message, openedOf, press, readEnvs, type Opened } from "./store";
import { badge, faint, line, list, loading, phone, problem, refresh, sectionHead } from "./view";

interface Draft {
	was?: EnvVar;
	key: string;
	value: string;
	literal: boolean;
	multiline: boolean;
	shownOnce: boolean;
	buildtime: boolean;
	runtime: boolean;
	preview: boolean;
	reveal: boolean;
}

interface Editing {
	draft?: Draft;
	deleting: string;
	paste?: string;
	busy: boolean;
	err: string;
	/** Something changed since the last deploy. */
	changed: boolean;
	previews: boolean;
}

const editing = new Map<string, Editing>();

function editOf(r: Resource): Editing {
	let e = editing.get(r.uuid);
	if (!e) editing.set(r.uuid, (e = { deleting: "", busy: false, err: "", changed: false, previews: false }));
	return e;
}

const valueOf = (v: EnvVar) => v.real_value ?? v.value ?? null;

function draftOf(v: EnvVar | undefined, preview: boolean): Draft {
	return {
		was: v,
		key: v?.key ?? "",
		value: v ? (valueOf(v) ?? "") : "",
		literal: v?.is_literal ?? false,
		multiline: v?.is_multiline ?? false,
		shownOnce: v?.is_shown_once ?? false,
		buildtime: v?.is_buildtime ?? true,
		runtime: v?.is_runtime ?? true,
		preview: v?.is_preview ?? preview,
		reveal: !v,
	};
}

/** Runs a change, then reads the variables again. */
async function change(r: Resource, o: Opened, e: Editing, fn: () => Promise<unknown>, done: string) {
	const c = conn();
	if (!c || e.busy) return;
	e.busy = true;
	e.err = "";
	ui.update();
	try {
		await fn();
		e.changed = true;
		e.draft = undefined;
		e.deleting = "";
		e.paste = undefined;
		ui.toast(done);
		await readEnvs(r, o);
	} catch (err) {
		const m = message(err);
		e.err = /refused|may not|permission|403/i.test(m) ? `${m} Changing variables needs a token with write.` : m;
	}
	e.busy = false;
	ui.update();
}

function save(r: Resource, o: Opened, e: Editing) {
	const d = e.draft!;
	const problem = api.envKeyProblem(d.key);
	if (problem) {
		e.err = problem;
		return;
	}
	const key = d.key.trim();
	if ((o.envs ?? []).some((v) => v.key === key && v !== d.was && !!v.is_preview === d.preview)) {
		e.err = `${key} is set already: edit that one.`;
		return;
	}
	const app = r.type === "application";
	const input: api.EnvInput = { key, value: d.value, is_literal: d.literal, is_multiline: d.multiline || d.value.includes("\n"), is_shown_once: d.shownOnce, ...(app ? { is_buildtime: d.buildtime, is_runtime: d.runtime, is_preview: d.preview } : {}) };
	const c = conn()!;
	void change(r, o, e, () => api.saveEnv(c, api.kindOf(r.type), r.uuid, input, d.was), d.was ? `Saved ${key}.` : `Added ${key}.`);
}

function remove(r: Resource, o: Opened, e: Editing, v: EnvVar) {
	if (!v.uuid) return;
	const c = conn()!;
	void change(r, o, e, () => api.deleteEnv(c, api.kindOf(r.type), r.uuid, v.uuid!), `Deleted ${v.key}.`);
}

function importPaste(r: Resource, o: Opened, e: Editing) {
	const vars = api.parseDotenv(e.paste ?? "");
	if (!vars.length) {
		e.err = "No KEY=value lines in what's pasted.";
		return;
	}
	const app = r.type === "application";
	const c = conn()!;
	void change(r, o, e, () => api.bulkEnvs(c, api.kindOf(r.type), r.uuid, vars.map((v) => ({ ...v, is_multiline: v.value.includes("\n"), ...(app ? { is_preview: e.previews } : {}) }))), `Imported ${vars.length} variable${vars.length === 1 ? "" : "s"}.`);
}

/** The editor of a variable: its name, its value, and what Coolify does with it. */
function editor(r: Resource, o: Opened, e: Editing): Child {
	const d = e.draft!;
	const app = r.type === "application";
	const multi = d.multiline || d.value.includes("\n");
	const label = (text: string) => <ui.text style={{ fontSize: "small", fontWeight: 500, color: "text2" }}>{text}</ui.text>;
	return (
		<ui.box key={`edit-${d.was?.key ?? "new"}`} style={{ gap: 12, padding: phone.on ? 14 : "s5", backgroundColor: phone.on ? undefined : "raised" }}>
			<ui.box style={{ gap: 6 }}>
				{label("Name")}
				<ui.field key="env-key" value={d.key} placeholder="MY_VARIABLE" autoFocus={!d.was} onChange={(v) => { d.key = v.toUpperCase().replace(/\s+/g, "_"); e.err = ""; }} onSubmit={() => save(r, o, e)} style={{ fontFamily: "mono" }} />
			</ui.box>
			<ui.box style={{ gap: 6 }}>
				<ui.box style={{ flexDirection: "row", alignItems: "center" }}>
					{label("Value")}
					<ui.spacer />
					{!multi ? <ui.iconButton icon={d.reveal ? "eye-off" : "eye"} label={d.reveal ? "Hide the value" : "Show the value"} onClick={() => void (d.reveal = !d.reveal)} style={{ width: 22, height: 22 }} /> : null}
				</ui.box>
				<ui.field key="env-value" value={d.value} placeholder={d.was && valueOf(d.was) == null ? "Hidden: type a new value to replace it" : "Its value"} multiline={multi} secret={!multi && !d.reveal} autoFocus={!!d.was} onChange={(v) => { d.value = v; e.err = ""; }} onSubmit={multi ? undefined : () => save(r, o, e)} style={{ fontFamily: "mono", ...(multi ? { minHeight: 80 } : {}) }} />
			</ui.box>
			<ui.box style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 8, columnGap: 20 }}>
				{app ? <ui.checkbox label="Available while building" checked={d.buildtime} onChange={(v) => void (d.buildtime = v)} /> : null}
				{app ? <ui.checkbox label="Available while running" checked={d.runtime} onChange={(v) => void (d.runtime = v)} /> : null}
				<ui.checkbox label="Multiline" checked={multi} onChange={(v) => void (d.multiline = v)} />
				<ui.checkbox label="Literal, no $VAR expansion" checked={d.literal} onChange={(v) => void (d.literal = v)} />
				<ui.checkbox label="Hide the value once saved" checked={d.shownOnce} onChange={(v) => void (d.shownOnce = v)} />
				{app ? <ui.checkbox label="For preview deployments" checked={d.preview} onChange={(v) => void (d.preview = v)} /> : null}
			</ui.box>
			{e.err ? problem(e.err) : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				<ui.button kind={phone.on ? "secondary" : "ghost"} size={phone.on ? "md" : "sm"} onClick={() => { e.draft = undefined; e.err = ""; }} style={phone.on ? { flex: 1 } : undefined}>Cancel</ui.button>
				<ui.button kind="primary" size={phone.on ? "md" : "sm"} disabled={e.busy} onClick={() => save(r, o, e)} style={phone.on ? { flex: 1 } : undefined}>{e.busy ? "Saving…" : d.was ? "Save" : "Add"}</ui.button>
			</ui.box>
		</ui.box>
	);
}

/** The .env paste: what's pasted, and what importing it does. */
function pastePanel(r: Resource, o: Opened, e: Editing): Child {
	const vars = api.parseDotenv(e.paste ?? "");
	const have = new Set((o.envs ?? []).filter((v) => !!v.is_preview === e.previews).map((v) => v.key));
	const updated = vars.filter((v) => have.has(v.key)).length;
	return (
		<ui.box key="paste" style={{ gap: 10, padding: phone.on ? 14 : "s5", backgroundColor: phone.on ? undefined : "raised" }}>
			<ui.text style={{ fontSize: "small", fontWeight: 500, color: "text2" }}>Paste a .env file</ui.text>
			<ui.field key="env-paste" value={e.paste ?? ""} multiline autoFocus placeholder="KEY=value, a line each" onChange={(v) => { e.paste = v; e.err = ""; }} style={{ fontFamily: "mono", minHeight: 120 }} />
			<ui.text style={faint}>{vars.length ? `${vars.length} variable${vars.length === 1 ? "" : "s"}: ${vars.length - updated} new${updated ? `, ${updated} changed` : ""}. Those not in it stay as they are.` : "KEY=value lines; quotes, export and # comments are fine."}</ui.text>
			{e.err ? problem(e.err) : null}
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
				<ui.button kind={phone.on ? "secondary" : "ghost"} size={phone.on ? "md" : "sm"} onClick={() => { e.paste = undefined; e.err = ""; }} style={phone.on ? { flex: 1 } : undefined}>Cancel</ui.button>
				<ui.button kind="primary" size={phone.on ? "md" : "sm"} disabled={e.busy || !vars.length} onClick={() => importPaste(r, o, e)} style={phone.on ? { flex: 1 } : undefined}>{e.busy ? "Importing…" : `Import${vars.length ? ` ${vars.length}` : ""}`}</ui.button>
			</ui.box>
		</ui.box>
	);
}

/**
 * A variable on a phone: its name over its value, Show beside them and the
 * rest in a menu (four buttons a finger's size don't fit beside a name);
 * deleting asks under it, the buttons the row's width.
 */
function phoneRow(r: Resource, o: Opened, e: Editing, v: EnvVar): Child {
	const value = valueOf(v);
	const shown = o.shown.has(v.key);
	const confirming = e.deleting === v.key;
	const app = r.type === "application";
	const marks = [app && v.is_buildtime && !v.is_runtime ? "Build" : "", app && v.is_runtime && !v.is_buildtime ? "Runtime" : "", v.is_literal ? "Literal" : ""].filter(Boolean);
	return (
		<ui.box key={v.uuid ?? v.key} style={{ padding: "8 6 8 14", gap: 8 }}>
			<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", minHeight: 40 }}>
				<ui.box style={{ flex: 1, minWidth: 0, gap: 3 }}>
					<ui.text style={{ fontFamily: "mono", fontSize: 12, fontWeight: 500, ...line }} selectable>{v.key}</ui.text>
					<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", minWidth: 0 }}>
						<ui.text style={{ fontFamily: "mono", fontSize: 12, color: value == null ? "text3" : "text2", flex: 1, ...line }} selectable={shown}>{value == null ? (v.is_shown_once ? "hidden once saved" : "hidden") : shown ? value || "(empty)" : "••••••••"}</ui.text>
						{marks.map((m) => <ui.box key={m}>{badge("muted", m)}</ui.box>)}
					</ui.box>
				</ui.box>
				{value != null ? <ui.iconButton icon={shown ? "eye-off" : "eye"} label={`${shown ? "Hide" : "Show"} ${v.key}`} onClick={() => void (shown ? o.shown.delete(v.key) : o.shown.add(v.key))} /> : null}
				<ui.menu label="" tooltip={`More for ${v.key}`} icon="more" kind="ghost">
					{value != null ? <ui.item icon="copy" label="Copy the value" onClick={() => { ui.copy(value); ui.toast(`Copied ${v.key}.`); }} /> : null}
					<ui.item icon="pencil" label="Edit" onClick={() => { e.draft = draftOf(v, e.previews); e.err = ""; e.paste = undefined; }} />
					<ui.separator />
					<ui.item icon="trash" label="Delete…" danger onClick={() => void (e.deleting = v.key)} />
				</ui.menu>
			</ui.box>
			{confirming ? (
				<ui.box style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
					<ui.button kind="secondary" onClick={() => void (e.deleting = "")} style={{ flex: 1 }}>Keep</ui.button>
					<ui.button kind="danger" disabled={e.busy} onClick={() => remove(r, o, e, v)} style={{ flex: 1 }}>Delete</ui.button>
				</ui.box>
			) : null}
		</ui.box>
	);
}

function row(r: Resource, o: Opened, e: Editing, v: EnvVar): Child {
	if (e.draft?.was === v) return editor(r, o, e);
	if (phone.on) return phoneRow(r, o, e, v);
	const value = valueOf(v);
	const shown = o.shown.has(v.key);
	const confirming = e.deleting === v.key;
	const app = r.type === "application";
	return (
		<ui.box key={v.uuid ?? v.key} style={{ flexDirection: "row", gap: 10, alignItems: "center", minHeight: 38, padding: "0 s3 0 s5" }}>
			<ui.text style={{ fontFamily: "mono", fontSize: 12, fontWeight: 500, width: 200, flexShrink: 0, ...line }} selectable>{v.key}</ui.text>
			<ui.text style={{ fontFamily: "mono", fontSize: 12, color: value == null ? "text3" : "text2", flex: 1, ...line }} selectable={shown}>{value == null ? (v.is_shown_once ? "hidden once saved" : "hidden") : shown ? value || "(empty)" : "••••••••"}</ui.text>
			{app && v.is_buildtime && !v.is_runtime ? badge("muted", "Build") : null}
			{app && v.is_runtime && !v.is_buildtime ? badge("muted", "Runtime") : null}
			{v.is_literal ? badge("muted", "Literal") : null}
			{confirming ? (
				<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", flexShrink: 0 }}>
					<ui.button kind="ghost" size="sm" onClick={() => void (e.deleting = "")}>Keep</ui.button>
					<ui.button kind="danger" size="sm" disabled={e.busy} onClick={() => remove(r, o, e, v)}>{`Delete ${v.key}`}</ui.button>
				</ui.box>
			) : (
				<ui.box style={{ flexDirection: "row", gap: 2, alignItems: "center", flexShrink: 0 }}>
					{value != null ? <ui.iconButton icon={shown ? "eye-off" : "eye"} label={`${shown ? "Hide" : "Show"} ${v.key}`} onClick={() => void (shown ? o.shown.delete(v.key) : o.shown.add(v.key))} /> : null}
					{value != null ? <ui.iconButton icon="copy" label={`Copy ${v.key}`} onClick={() => { ui.copy(value); ui.toast(`Copied ${v.key}.`); }} /> : null}
					<ui.iconButton icon="pencil" label={`Edit ${v.key}`} onClick={() => { e.draft = draftOf(v, e.previews); e.err = ""; e.paste = undefined; }} />
					<ui.iconButton icon="trash" label={`Delete ${v.key}`} onClick={() => void (e.deleting = v.key)} />
				</ui.box>
			)}
		</ui.box>
	);
}


/** The tab's head on a phone: the count, Copy as .env and Refresh on a line, Add and Paste under it the row's width, Production or Previews under those. */
function phoneHead(r: Resource, o: Opened, e: Editing, count: number, previews: number, readable: EnvVar[], app: boolean): Child {
	return (
		<ui.box style={{ gap: 10 }}>
			{sectionHead(
				`${count} variable${count === 1 ? "" : "s"}`,
				readable.length ? <ui.iconButton key="copyall" icon="copy" label="Copy as .env" onClick={() => { ui.copy(api.toDotenv(readable.map((v) => ({ key: v.key, value: valueOf(v)! })))); ui.toast(`Copied ${readable.length} variable${readable.length === 1 ? "" : "s"} as .env.`); }} /> : null,
				refresh(o.envsReading, () => void readEnvs(r, o)),
			)}
			<ui.box style={{ flexDirection: "row", gap: 8 }}>
				<ui.button kind="secondary" icon="plus" onClick={() => { e.draft = draftOf(undefined, e.previews); e.paste = undefined; e.err = ""; }} style={{ flex: 1 }}>Add variable</ui.button>
				<ui.button kind="secondary" icon="paperclip" onClick={() => { e.paste = e.paste === undefined ? "" : undefined; e.draft = undefined; e.err = ""; }} style={{ flex: 1 }}>Paste .env</ui.button>
			</ui.box>
			{app && (previews || e.previews) ? <ui.segmented key="which" label="Which variables" style={{ alignSelf: "stretch" }} value={e.previews ? "preview" : "production"} options={[{ value: "production", label: "Production" }, { value: "preview", label: `Previews${previews ? ` ${previews}` : ""}` }]} onChange={(v) => { e.previews = v === "preview"; e.draft = undefined; }} /> : null}
		</ui.box>
	);
}

export function environmentTab(r: Resource, o: Opened): Child {
	if (o.envs === undefined && !o.envsErr && !o.envsReading) void readEnvs(r, o);
	if (o.envsErr && !o.envs) return problem(o.envsErr);
	if (!o.envs) return loading("Reading variables…");
	const e = editOf(r);
	const app = r.type === "application";
	const previews = o.envs.filter((v) => v.is_preview).length;
	const vars = o.envs.filter((v) => !!v.is_preview === e.previews).sort((a, b) => a.key.localeCompare(b.key));
	const readable = vars.filter((v) => valueOf(v) != null);
	const hidden = vars.length > readable.length;
	const items: Child[] = [];
	if (e.draft && !e.draft.was) items.push(editor(r, o, e));
	if (e.paste !== undefined) items.push(pastePanel(r, o, e));
	for (const v of vars) items.push(row(r, o, e, v));
	const redeploy = () => {
		e.changed = false;
		void press(r, openedOf(r), r.type.startsWith("standalone-") ? "restart" : "deploy");
	};
	return (
		<ui.box style={{ gap: 8 }}>
			{e.changed ? (
				<ui.box style={{ flexDirection: "row", gap: "s4", alignItems: "flex-start", padding: "s4 s5", borderRadius: "card", backgroundColor: "accentSoft" }}>
					<ui.icon icon="info" style={{ width: 15, height: 15, color: "accent", flexShrink: 0 }} />
					<ui.box style={{ flex: 1, minWidth: 0, gap: 8 }}>
						<ui.text>{`Coolify uses the new variables from the next ${r.type.startsWith("standalone-") ? "restart" : "deploy"}.`}</ui.text>
						<ui.box style={{ flexDirection: "row", gap: 6 }}>
							<ui.button kind="primary" size="sm" icon={r.type.startsWith("standalone-") ? "refresh" : "rocket"} onClick={redeploy}>{r.type.startsWith("standalone-") ? "Restart now" : "Redeploy now"}</ui.button>
							<ui.button kind="ghost" size="sm" onClick={() => void (e.changed = false)}>Later</ui.button>
						</ui.box>
					</ui.box>
				</ui.box>
			) : null}
			{phone.on ? phoneHead(r, o, e, vars.length, previews, readable, app) : null}
			{phone.on ? null : sectionHead(
				`${vars.length} variable${vars.length === 1 ? "" : "s"}`,
				app && (previews || e.previews) ? <ui.segmented key="which" label="Which variables" value={e.previews ? "preview" : "production"} options={[{ value: "production", label: "Production" }, { value: "preview", label: `Previews${previews ? ` ${previews}` : ""}` }]} onChange={(v) => { e.previews = v === "preview"; e.draft = undefined; }} /> : null,
				readable.length ? <ui.iconButton key="copyall" icon="copy" label="Copy as .env" onClick={() => { ui.copy(api.toDotenv(readable.map((v) => ({ key: v.key, value: valueOf(v)! })))); ui.toast(`Copied ${readable.length} variable${readable.length === 1 ? "" : "s"} as .env.`); }} /> : null,
				<ui.button key="paste" kind="ghost" size="sm" icon="paperclip" onClick={() => { e.paste = e.paste === undefined ? "" : undefined; e.draft = undefined; e.err = ""; }}>Paste .env…</ui.button>,
				<ui.button key="add" size="sm" icon="plus" onClick={() => { e.draft = draftOf(undefined, e.previews); e.paste = undefined; e.err = ""; }}>Add variable</ui.button>,
				refresh(o.envsReading, () => void readEnvs(r, o)),
			)}
			{items.length ? list(items) : <ui.text style={{ color: "text3", padding: 12 }}>{e.previews ? "No variables for previews." : "No variables yet."}</ui.text>}
			{e.err && !e.draft && e.paste === undefined ? problem(e.err) : null}
			{hidden ? <ui.text style={phone.on ? { ...faint, whiteSpace: "normal" } : faint}>Values Coolify doesn't send need a token with read:sensitive; those set to hide once saved stay hidden.</ui.text> : null}
		</ui.box>
	);
}
