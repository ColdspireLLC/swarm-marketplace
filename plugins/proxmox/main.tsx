// Proxmox: a Proxmox VE server or cluster in Swarm.
//
// - Its page of the rail (page.tsx): the cluster's overview, every VM and
//   container, the tasks, the storage and each node; a guest opened
//   beside them, with its power actions, graphs, hardware and snapshots.
// - Its page of Settings (settings.tsx): the address and an API token,
//   and Proxmox's own certificate, trusted by its fingerprint.
// - For agents (cli.ts, skills/): swarm proxmox …, so the token stays in
//   the keychain.
import { settings, ui } from "swarm";
import { registerCli } from "./cli";
import { renderPage } from "./page";
import { settingsPage } from "./settings";
import { shape } from "./servers";
import { checkBackups, stopWatchingBackups, watchBackups } from "./watch";
import { conn, forget, PAGE, readList, stopAll, syncNav } from "./store";
import { registerLogOverlay } from "./view";

export function activate() {
	registerCli();
	ui.shareIcon({ id: "logo", path: "proxmox.svg" });
	ui.nav({ id: PAGE, title: "Proxmox", icon: "proxmox:logo", order: 51, fill: true, bare: true, items: [], render: renderPage });
	ui.page({ id: PAGE, title: "Proxmox", icon: "proxmox:logo", render: settingsPage });
	registerLogOverlay();
	// A ticket kept as a sign-in renews it changes nothing shown.
	let was = shape();
	settings.onChange(() => {
		const now = shape();
		if (now === was) return ui.update();
		was = now;
		forget();
		ui.update();
		if (conn()) void readList();
	});
	syncNav();
	if (conn()) void readList();
	// Every server's backups: the first look is where failures are told from.
	void checkBackups().finally(watchBackups);
}

export function deactivate() {
	stopAll();
	stopWatchingBackups();
}
