// Coolify: a self-hosted Coolify in Swarm.
//
// - Its page of the rail (page.tsx): an overview of what needs you, what
//   deploys and what deployed; every deployment; each of Coolify's projects;
//   the servers; and a resource opened beside them, with its facts, its
//   deployments and rollbacks, its logs as they come, and its env vars.
// - In a thread (context.tsx): how the application its project deploys to
//   is doing, with Deploy; and a note to its agent naming it.
// - For agents (cli.ts, skills/): swarm coolify …; and Coolify's own MCP
//   server, through the plugin, so the token stays in the keychain
//   (settings.tsx).
// - Watching (store.ts): every deployment that runs, whoever started it,
//   with a toast as it ends; failed ones hand an agent the log to fix.
import { http, settings, ui } from "swarm";
import { registerCli } from "./cli";
import { registerContext } from "./context";
import { renderPage } from "./page";
import { mcpRoute, settingsPage } from "./settings";
import { conn, forget, PAGE, readList, stopWatching, syncNav, watch } from "./store";
import { registerLogOverlay } from "./view";

export function activate() {
	registerCli();
	// The rail and Settings draw a plugin's SVG by the name it shares it as.
	ui.shareIcon({ id: "logo", path: "coolify.svg" });
	ui.nav({ id: PAGE, title: "Coolify", icon: "coolify:logo", order: 50, fill: true, bare: true, items: [], render: renderPage });
	ui.page({ id: PAGE, title: "Coolify", icon: "coolify:logo", render: settingsPage });
	registerContext();
	registerLogOverlay();
	http.route("POST", "/mcp", mcpRoute, { auth: "none" });
	http.route("GET", "/mcp", mcpRoute, { auth: "none" });
	http.route("DELETE", "/mcp", mcpRoute, { auth: "none" });
	let was = `${settings.get("url")}\n${settings.get("token")}`;
	settings.onChange((v) => {
		const now = `${v.url}\n${v.token}`;
		// Another setting (the agents' access) changes what shows: New app.
		if (now === was) return ui.update();
		was = now;
		forget();
		ui.update();
		if (conn()) void readList();
	});
	syncNav();
	if (conn()) {
		void readList();
		watch();
	}
}

export function deactivate() {
	stopWatching();
}
