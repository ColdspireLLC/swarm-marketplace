// Flux's "Delete this issue?": a question before what can't be undone,
// with Cancel and the danger's own button, Delete. Escape, a click
// outside and Cancel keep it.
import { ui } from "swarm";

type Asking = { title: string; text: string; action: string; run: () => unknown; cancel?: string; onCancel?: () => unknown };

const asking = ui.state<Asking | null>(null);

/** Asks before run: title, then text, and the action's button. cancel names the button that keeps it (Cancel), and onCancel is told it was kept, by it, Escape or a click outside. */
export function confirm(title: string, text: string, action: string, run: () => unknown, opts: { cancel?: string; onCancel?: () => unknown } = {}) {
	asking.value = { title, text, action, run, ...opts };
	ui.showOverlay("flux-confirm");
}

function close() {
	closeConfirm();
	ui.hideOverlay("flux-confirm");
}

/** Forgets the question, as Swarm closes its dialog: kept, not run. */
export function closeConfirm() {
	const a = asking.value;
	asking.value = null;
	a?.onCancel?.();
}

export function Confirm() {
	const a = asking.value;
	if (!a) return null;
	const go = () => {
		asking.value = null;
		ui.hideOverlay("flux-confirm");
		void Promise.resolve(a.run()).catch((e: unknown) => ui.toast(e instanceof Error ? e.message : String(e)));
	};
	return (
		<ui.box style={{ width: 400, gap: 8, padding: 20 }}>
			<ui.text style={{ fontSize: 16, fontWeight: 600 }}>{a.title}</ui.text>
			<ui.text style={{ color: "text2" }}>{a.text}</ui.text>
			<ui.box style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
				<ui.button kind="secondary" onClick={close}>{a.cancel ?? "Cancel"}</ui.button>
				<ui.button kind="danger" onClick={go}>{a.action}</ui.button>
			</ui.box>
		</ui.box>
	);
}
