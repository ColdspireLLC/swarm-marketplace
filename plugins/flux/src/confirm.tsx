// Flux's "Delete this issue?": a question before what can't be undone,
// with Cancel and the danger's own button, Delete. Escape, a click
// outside and Cancel keep it.
import { ui } from "swarm";

let asking: { title: string; text: string; action: string; run: () => unknown } | null = null;

/** Asks before run: title, then text, and the action's button. */
export function confirm(title: string, text: string, action: string, run: () => unknown) {
	asking = { title, text, action, run };
	ui.showOverlay("flux-confirm");
}

function close() {
	closeConfirm();
	ui.hideOverlay("flux-confirm");
}

/** Forgets the question, as Swarm closes its dialog. */
export function closeConfirm() {
	asking = null;
}

export function Confirm() {
	const a = asking;
	if (!a) return null;
	const go = () => {
		close();
		void Promise.resolve(a.run()).catch((e: unknown) => ui.toast(e instanceof Error ? e.message : String(e)));
	};
	return (
		<ui.box style={{ width: 400, gap: 8, padding: 20 }}>
			<ui.text style={{ fontSize: 16, fontWeight: 600 }}>{a.title}</ui.text>
			<ui.text style={{ color: "text2" }}>{a.text}</ui.text>
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
				<ui.button kind="secondary" onClick={close}>Cancel</ui.button>
				<ui.button kind="danger" onClick={go}>{a.action}</ui.button>
			</ui.box>
		</ui.box>
	);
}
