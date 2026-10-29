// Flux's command palette for a property (bb's command-palette.tsx): a
// dialog over the page, titled for what it changes, a search, the choices
// with their marks and a check on what every issue has; ↑ ↓ and Enter, or
// 1–9, choose. It changes every issue it was opened for: the selection,
// or the one the keys are on, or the page's.
import { ui, type Child } from "swarm";
import { CLOSED_STATUSES, PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS } from "./flux";
import type { Issue, IssuePatch } from "./contract";
import { dueChoices } from "./dates";
import { openDuePicker } from "./due";
import { hub } from "./hub";
import { navMark } from "./marks";
import { labelMark, memberMark, priorityMark, statusMark } from "./menumarks";

export type PaletteKind = "status" | "priority" | "assignee" | "label" | "project" | "due" | "parent";

const TITLES: Record<PaletteKind, string> = {
	status: "Change status…",
	priority: "Change priority…",
	assignee: "Assign to…",
	label: "Change or add labels…",
	project: "Move to project…",
	due: "Set due date…",
	parent: "Set parent issue…",
};

let open: { kind: PaletteKind; ids: string[]; apply: (id: string, patch: IssuePatch) => unknown } | null = null;
let search = "";
let sel = 0;

/** Opens the palette of kind for the issues ids; apply changes one. */
export function openPalette(kind: PaletteKind, ids: string[], apply: (id: string, patch: IssuePatch) => unknown) {
	if (ids.length === 0) return;
	open = { kind, ids, apply };
	search = "";
	sel = 0;
	ui.showOverlay("flux-palette");
}

function close() {
	open = null;
	ui.hideOverlay("flux-palette");
}

interface Row {
	key: string;
	label: string;
	detail?: string;
	mark: Record<string, unknown>;
	on: boolean;
	run: () => void;
}

function rows(issues: Issue[]): Row[] {
	const o = open!;
	const flux = hub.active;
	const each = (patch: (issue: Issue) => IssuePatch) => { for (const issue of issues) void o.apply(issue.id, patch(issue)); };
	const all = (has: (issue: Issue) => boolean) => issues.every(has);
	// A toggle: off for every issue when every one has it, else on for each.
	const toggle = (list: (issue: Issue) => string[], id: string, field: "assigneeIds" | "labelIds") => {
		const on = all((issue) => list(issue).includes(id));
		each((issue) => ({ [field]: on ? list(issue).filter((x) => x !== id) : [...new Set([...list(issue), id])] }));
	};
	const me = flux.me?.id;
	switch (o.kind) {
		case "status":
			return STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s], mark: statusMark(s), on: all((i) => i.status === s), run: () => each(() => ({ status: s })) }));
		case "priority":
			return [...PRIORITIES.filter((p) => p === "none"), ...PRIORITIES.filter((p) => p !== "none")].map((p) => ({ key: p, label: PRIORITY_LABELS[p], mark: priorityMark(p), on: all((i) => i.priority === p), run: () => each(() => ({ priority: p })) }));
		case "assignee": {
			// You first, as Flux's.
			const members = [...flux.memberList()].sort((a, b) => Number(b.id === me) - Number(a.id === me));
			return members.map((m) => ({ key: m.id, label: m.id === me ? `${m.name} (you)` : m.name, detail: "@" + m.username, mark: memberMark(m), on: all((i) => i.assigneeIds.includes(m.id)), run: () => toggle((i) => i.assigneeIds, m.id, "assigneeIds") }));
		}
		case "label": {
			const out: Row[] = flux.labels().map((l) => ({ key: l.id, label: l.name, mark: labelMark(l.color), on: all((i) => i.labelIds.includes(l.id)), run: () => toggle((i) => i.labelIds, l.id, "labelIds") }));
			const name = search.trim();
			if (name && !flux.labels().some((l) => l.name.toLowerCase() === name.toLowerCase())) {
				out.push({
					key: "create",
					label: `Create “${name}”`,
					mark: { icon: "plus" },
					on: false,
					run: () => void flux.createLabel(name).then((label) => each((i) => ({ labelIds: [...new Set([...i.labelIds, label.id])] })), (e: unknown) => ui.toast(`Couldn't create the label: ${e instanceof Error ? e.message : String(e)}`)),
				});
			}
			return out;
		}
		case "project":
			return flux.projects().map((p) => ({ key: p.id, label: p.name, detail: p.key, mark: navMark(p), on: all((i) => i.projectId === p.id), run: () => each(() => ({ projectId: p.id })) }));
		case "due": {
			const first = issues[0]!;
			return [
				...dueChoices().map((c) => ({ key: c.label, label: c.label, detail: c.hint, mark: { icon: "calendar" }, on: all((i) => i.dueDate === c.value), run: () => each(() => ({ dueDate: c.value })) })),
				{ key: "custom", label: "Custom…", mark: { icon: "calendar" }, on: false, run: () => openDuePicker(first.dueDate, (dueDate) => each(() => ({ dueDate }))) },
				...(issues.some((i) => i.dueDate) ? [{ key: "none", label: "No due date", mark: { icon: "x" }, on: false, run: () => each(() => ({ dueDate: null })) }] : []),
			];
		}
		case "parent": {
			const ids = new Set(issues.map((i) => i.id));
			const project = issues[0]!.projectId;
			const out: Row[] = flux.issues()
				.filter((i) => i.projectId === project && !ids.has(i.id) && !CLOSED_STATUSES.has(i.status) && !issues.some((x) => i.parentId === x.id))
				.map((i) => ({ key: i.id, label: i.title, detail: i.key, mark: statusMark(i.status), on: all((x) => x.parentId === i.id), run: () => each(() => ({ parentId: i.id })) }));
			if (issues.some((i) => i.parentId)) out.unshift({ key: "none", label: "Remove parent", mark: { icon: "x" }, on: false, run: () => each(() => ({ parentId: null })) });
			return out;
		}
	}
}

export function Palette() {
	const o = open;
	if (!o) return null;
	const flux = hub.active;
	const issues = o.ids.map((id) => flux.issue(id)).filter((i): i is Issue => !!i);
	if (issues.length === 0) return null;
	// The rows for what's typed: worked out again when one's chosen, as
	// Enter can come before the render of the last keys typed.
	const filtered = () => {
		const needle = search.trim().toLowerCase();
		return rows(issues).filter((r) => r.key === "create" || !needle || r.label.toLowerCase().includes(needle) || (r.detail ?? "").toLowerCase().includes(needle)).slice(0, 50);
	};
	const needle = search.trim().toLowerCase();
	const found = filtered();
	sel = Math.min(Math.max(sel, 0), Math.max(found.length - 1, 0));
	const choose = (n: number) => {
		// Once: Enter is the field's and the dialog's both.
		if (open !== o) return;
		const now = filtered();
		const row = now[Math.min(n, now.length - 1)];
		if (!row) return;
		close();
		row.run();
	};
	const keys = ["ArrowUp", "ArrowDown", "Enter", "Escape", ...(needle ? [] : ["1", "2", "3", "4", "5", "6", "7", "8", "9"])];
	const subject = issues.length === 1 ? `${issues[0]!.key} ${issues[0]!.title}` : `${issues.length} issues`;
	return (
		<ui.box
			keys={keys}
			onKeyDown={(k) => {
				if (k.key === "ArrowUp") sel = (sel - 1 + found.length) % Math.max(found.length, 1);
				else if (k.key === "ArrowDown") sel = (sel + 1) % Math.max(found.length, 1);
				else if (k.key === "Enter") choose(sel);
				else if (k.key === "Escape") close();
				else if (/^[1-9]$/.test(k.key)) choose(Number(k.key) - 1);
			}}
			style={{ width: 480, maxHeight: 460, padding: 8, gap: 4 }}
		>
			<ui.box style={{ gap: 2, padding: "s2 s3" }}>
				<ui.text style={{ fontSize: "small", color: "text3" }} maxLines={1}>{subject}</ui.text>
			</ui.box>
			<ui.field key={"palette-" + o.kind} autoFocus value={search} placeholder={TITLES[o.kind]} onChange={(value) => { search = value; sel = 0; }} onSubmit={(value) => { if (value !== search) { search = value; sel = 0; } choose(sel); }} style={{ fontSize: 15, backgroundColor: "transparent", boxShadow: "none", padding: "s2 s3" }} />
			<ui.box style={{ height: 1, backgroundColor: "divider", marginLeft: -8, marginRight: -8 }} />
			<ui.scroll style={{ maxHeight: 380 }}>
				{found.length === 0 ? <ui.text style={{ padding: "s4", color: "text3" }}>Nothing matches.</ui.text> : null}
				{found.map((r, n) => (
					<ui.pressable key={r.key} label={r.label} role="option" checked={n === sel} onClick={() => choose(n)} style={{ flexDirection: "row", gap: 10, alignItems: "center", height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: "control", backgroundColor: n === sel ? "hover" : "transparent", hover: { backgroundColor: "hover" } }}>
						{mark(r.mark)}
						<ui.text style={{ flex: 1, minWidth: 0, fontSize: 14 }} maxLines={1}>{r.label}</ui.text>
						{r.detail ? <ui.text style={{ fontSize: "small", color: "text3" }}>{r.detail}</ui.text> : null}
						{r.on ? <ui.icon icon="check" style={{ width: 14, height: 14, color: "accent" }} /> : null}
						{!needle && n < 9 ? <ui.text style={{ fontSize: 12, color: "text3", width: 12, textAlign: "right" }}>{String(n + 1)}</ui.text> : null}
					</ui.pressable>
				))}
			</ui.scroll>
		</ui.box>
	);
}

/** A row's mark: its picture, its letter on its color, or its icon. */
function mark(m: Record<string, unknown>): Child {
	const box = { width: 16, height: 16, flexShrink: 0 } as const;
	if (typeof m.mark === "string" || m.mark instanceof Uint8Array) return <ui.image src={m.mark} alt="" style={box} />;
	if (typeof m.initial === "string") {
		return (
			<ui.box style={{ ...box, borderRadius: 4, backgroundColor: (m.tint as string) as never, alignItems: "center", justifyContent: "center" }}>
				<ui.text style={{ color: "white", fontSize: 10, fontWeight: 700 }}>{m.initial}</ui.text>
			</ui.box>
		);
	}
	if (typeof m.icon === "string") return <ui.icon icon={m.icon as never} style={{ ...box, color: "text2" }} />;
	return <ui.box style={box} />;
}
