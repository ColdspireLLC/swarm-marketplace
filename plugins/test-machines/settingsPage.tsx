// The plugin's page of Settings: the machines it found, then how it
// reaches them, by kind, then what agents stay out of. The settings are
// plugin.json's, hidden from the plain list, which this page groups.
import { settings, ui, type Child } from "swarm";
import { carried } from "./rules";
import type { Check } from "./drivers";
import { doctor } from "./ops";
import { discover, found, movesFrom, stopUsing, use, type Found } from "./discover";
import { learnTitles, message, refresh, st, wda } from "./state";

/** WebDriverAgent's build, from the page. */
const building = ui.store({ busy: false, said: "", failed: false });

async function build(team = text("wdaTeam")) {
	building.busy = true;
	building.failed = false;
	building.said = "Building on the Mac: a few minutes the first time…";
	try {
		if (team !== text("wdaTeam")) settings.set({ wdaTeam: team });
		building.said = await wda.setup(team, (l) => (building.said = l));
		ios.built = true;
	} catch (e) {
		building.said = message(e);
		building.failed = true;
	}
	building.busy = false;
}

/** What the iPhones' Mac has: WebDriverAgent built, and the signing teams it could be built for. */
const ios = ui.store({ at: 0, host: "", busy: false, built: false, teams: [] as { id: string; name: string }[], error: "" });

async function checkIos() {
	ios.busy = true;
	ios.host = text("iosHost");
	try {
		const [built, teams] = await Promise.all([wda.built(), wda.teams()]);
		ios.built = built;
		ios.teams = teams;
		ios.error = "";
	} catch (e) {
		ios.error = message(e);
	}
	ios.at = Date.now();
	ios.busy = false;
}

/** The phone a button acts on, while it does. */
const acting = ui.store({ serial: "", error: "" });

async function act(f: Found, fn: () => Promise<unknown>) {
	acting.serial = f.serial;
	acting.error = "";
	try {
		await fn();
	} catch (e) {
		acting.error = message(e);
	}
	acting.serial = "";
}

/** doctor's last checks, for the page. */
const checked = ui.store({ busy: false, checks: null as Check[] | null, error: "" });

async function check() {
	checked.busy = true;
	checked.error = "";
	try {
		checked.checks = await doctor();
	} catch (e) {
		checked.error = message(e);
	}
	checked.busy = false;
}

/** What's typed and not yet saved, by setting. */
const draft = ui.store(new Map<string, string>());
const text = (key: string) => String(settings.get(key) ?? "");

function save(key: string) {
	if (!draft.has(key)) return;
	settings.set({ [key]: draft.get(key)!.trim() });
	draft.delete(key);
}

/** A setting's row: its title and what it does, and its control. */
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

/** A switch, named by its row. */
function toggle(key: string): Child {
	return <ui.toggle checked={settings.get(key) === true} onChange={(on) => void settings.set({ [key]: on })} />;
}

/**
 * Where something's plugged in: this computer, one joined to Swarm, or an
 * ssh target. os keeps the choice to Macs.
 */
function placePicker(key: string, os?: string): Child {
	const now = text(key);
	const joined = st.joined.filter((m) => !os || m.os === os);
	const isJoined = joined.some((m) => m.id === now || m.name === now);
	const sshing = draft.has(key + ":ssh") || (now !== "" && !isJoined);
	const value = sshing ? "ssh" : isJoined ? joined.find((m) => m.id === now || m.name === now)!.name : "";
	const options = [...(os ? [] : [{ value: "", label: "This computer" }]), ...joined.map((m) => ({ value: m.name, label: m.name })), { value: "ssh", label: "Over ssh…" }];
	return (
		<ui.box style={{ gap: 8 }}>
			<ui.select
				style={{ alignSelf: "flex-start" }}
				value={value}
				options={options}
				onChange={(v) => {
					if (v === "ssh") {
						draft.set(key + ":ssh", "1");
						return;
					}
					draft.delete(key + ":ssh");
					draft.delete(key);
					settings.set({ [key]: v });
				}}
			/>
			{sshing ? input(key, "me@mac-mini.local") : null}
		</ui.box>
	);
}

/** A text setting, saved with Enter or Save. */
function input(key: string, placeholder: string, multiline = false): Child {
	const value = draft.has(key) ? draft.get(key)! : text(key);
	return (
		<ui.box style={{ flexDirection: "row", gap: 8, alignItems: multiline ? "flex-start" : "center" }}>
			<ui.field key={key} value={value} placeholder={placeholder} multiline={multiline} style={{ flex: 1, fontFamily: "mono" }} onChange={(v) => void draft.set(key, v)} onSubmit={() => save(key)} />
			{draft.has(key) && draft.get(key) !== text(key) ? <ui.button size="sm" kind="primary" onClick={() => save(key)}>Save</ui.button> : null}
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

function machinesFound(): Child {
	return section(
		"Machines",
		<ui.box style={{ padding: "s5 s6", gap: 8 }}>
			{st.machines.length === 0 && !st.driverProblems.length ? <ui.text style={{ color: "text2" }}>None yet: add some below.</ui.text> : null}
			{st.machines.map((m) => (
				<ui.box key={m.id} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
					<ui.text style={{ fontWeight: 500 }}>{m.name}</ui.text>
					<ui.text style={{ fontSize: "small", color: "text3", fontFamily: "mono" }}>{m.id}</ui.text>
					<ui.spacer />
					{carried(m.id) ? <ui.tag tone="muted">You carry it</ui.tag> : null}
					<ui.tag tone="default">{m.driver.name}</ui.tag>
				</ui.box>
			))}
			{st.driverProblems.map((p, i) => (
				<ui.text key={"p" + i} style={{ fontSize: "small", color: "red" }}>{p}</ui.text>
			))}
			<ui.box style={{ flexDirection: "row", gap: 6 }}>
				<ui.button size="sm" kind="soft" icon="refresh" onClick={async () => { await refresh(); await learnTitles(); void discover(); }}>Look for machines again</ui.button>
				<ui.button size="sm" kind="ghost" icon="check-circle" disabled={checked.busy} onClick={() => void check()}>{checked.busy ? "Checking…" : "Check everything"}</ui.button>
			</ui.box>
			{checked.error ? <ui.text style={{ fontSize: "small", color: "red" }}>{checked.error}</ui.text> : null}
			{checked.checks ? (
				<ui.box style={{ gap: 4, paddingTop: 4 }}>
					{checked.checks.map((c, i) => (
						<ui.box key={"c" + i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
							<ui.icon icon={c.ok ? "check-circle" : "alert-circle"} style={{ width: 14, height: 14, marginTop: 2, color: c.ok ? "green" : "amber", flexShrink: 0 }} />
							<ui.text style={{ fontSize: "small" }}>
								<ui.text style={{ fontWeight: 500 }}>{c.what}</ui.text>
								{`: ${c.detail}`}
							</ui.text>
						</ui.box>
					))}
				</ui.box>
			) : null}
		</ui.box>,
	);
}

/** The iPhone's WebDriverAgent, under its row: built, or built here with a button, signed for the team the Mac's certificate is of. */
function iphoneSetup(): Child {
	if (!ios.at || ios.host !== text("iosHost")) {
		if (!ios.busy) void checkIos();
		return <ui.text style={{ fontSize: "small", color: "text3" }}>Checking WebDriverAgent on the Mac…</ui.text>;
	}
	if (ios.error) return <ui.text style={{ fontSize: "small", color: "red" }}>{ios.error}</ui.text>;
	if (ios.built && !building.busy) {
		return <ui.text style={{ fontSize: "small", color: "text2" }}>{building.said || "Ready. The first time an agent uses it, the phone asks to trust the developer: Settings, General, VPN & Device Management."}</ui.text>;
	}
	const team = text("wdaTeam") || (ios.teams.length === 1 ? ios.teams[0]!.id : "");
	const name = ios.teams.find((t) => t.id === team)?.name;
	return (
		<ui.box style={{ gap: 8 }}>
			<ui.text style={{ fontSize: "small", color: "text2" }}>
				{team
					? `Needs WebDriverAgent, built once on the Mac and signed for ${name ? `${name} (${team})` : `team ${team}`}. A few minutes the first time.`
					: ios.teams.length > 1
						? "Needs WebDriverAgent, built once on the Mac: which of its developer teams signs it?"
						: "Needs WebDriverAgent, built once on the Mac, signed with your Apple developer team. The Mac has no Apple Development certificate: sign in with your Apple ID in Xcode (Settings, Accounts) there, or give the Team ID below."}
			</ui.text>
			{!team && ios.teams.length > 1 ? <ui.select style={{ alignSelf: "flex-start" }} value="" options={[{ value: "", label: "Choose a team" }, ...ios.teams.map((t) => ({ value: t.id, label: `${t.name} (${t.id})` }))]} onChange={(v) => v && void settings.set({ wdaTeam: v })} /> : null}
			{!team && !ios.teams.length ? input("wdaTeam", "ABCDE12345") : null}
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
				<ui.button size="sm" kind="primary" icon="hammer" disabled={building.busy || !team} onClick={() => void build(team)}>{building.busy ? "Building…" : "Build WebDriverAgent"}</ui.button>
				{building.said ? <ui.text style={{ fontSize: "small", color: building.failed ? "red" : "text2" }}>{building.said}</ui.text> : null}
			</ui.box>
		</ui.box>
	);
}

/** A phone found plugged in: what it is and where, and using it or not. */
function phoneRow(f: Found): Child {
	const busy = acting.serial === f.serial;
	const kind = f.kind === "ios" ? "iPhone" : "Android";
	const moves = f.id || f.problem ? null : movesFrom(f);
	const about = f.id ? `${kind}, on ${f.placeLabel}. Agents call it ${f.id}.` : `${kind}, on ${f.placeLabel}.${moves ? ` Using it moves the plugin's ${kind === "iPhone" ? "iPhones" : "Android phones"} here: those on ${moves} stop being used.` : ""}`;
	const controls = f.id ? (
		<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
			{carried(f.id) ? <ui.tag tone="muted">You carry it</ui.tag> : <ui.tag tone="green">In use</ui.tag>}
			<ui.button size="sm" kind="ghost" disabled={busy} onClick={() => void act(f, () => stopUsing(f))}>Stop using</ui.button>
		</ui.box>
	) : f.problem ? null : (
		<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
			<ui.button size="sm" kind="primary" disabled={busy} onClick={() => void act(f, () => use(f, false))}>{busy ? "Turning on…" : "Use for testing"}</ui.button>
			<ui.button size="sm" kind="ghost" disabled={busy} onClick={() => void act(f, () => use(f, true))}>It's my phone</ui.button>
		</ui.box>
	);
	return (
		<ui.box key={f.kind + f.serial} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
			<ui.icon icon="mobile" style={{ width: 16, height: 16, marginTop: 2, color: f.id ? "text" : "text3", flexShrink: 0 }} />
			<ui.box style={{ flex: 1, minWidth: 0, gap: 4 }}>
				<ui.box style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }}>
					<ui.box style={{ flex: 1, minWidth: 0, gap: 2 }}>
						<ui.text style={{ fontWeight: 500 }}>{f.model}</ui.text>
						<ui.text style={{ fontSize: "small", color: "text2" }}>{about}</ui.text>
						{f.problem ? <ui.text style={{ fontSize: "small", color: "amber" }}>{`Can't use it yet: ${f.problem}.`}</ui.text> : null}
					</ui.box>
					{controls}
				</ui.box>
				{f.id && f.kind === "ios" && !carried(f.id) ? iphoneSetup() : null}
			</ui.box>
		</ui.box>
	);
}

/** The phones plugged into this computer and those joined to Swarm, each turned on with a button. */
function phones(): Child {
	if (!found.at && !found.busy) void discover();
	return section(
		"Phones",
		<ui.box style={{ padding: "s5 s6", gap: 14 }}>
			{found.phones.map(phoneRow)}
			{!found.phones.length ? (
				<ui.text style={{ color: "text2" }}>
					{found.busy && !found.at ? "Looking for phones…" : "No phones plugged in. Plug one into this computer or one joined to Swarm (Settings, Machines): an Android phone with USB debugging on, or an iPhone with Developer Mode on that trusts the Mac."}
				</ui.text>
			) : null}
			{acting.error ? <ui.text style={{ fontSize: "small", color: "red" }}>{acting.error}</ui.text> : null}
			{found.problems.map((p, i) => (
				<ui.text key={"p" + i} style={{ fontSize: "small", color: "red" }}>{p}</ui.text>
			))}
			<ui.box style={{ flexDirection: "row", gap: 6 }}>
				<ui.button size="sm" kind="soft" icon="refresh" disabled={found.busy} onClick={() => void discover()}>{found.busy ? "Looking…" : "Look for phones again"}</ui.button>
			</ui.box>
		</ui.box>,
	);
}

export function settingsPage(): Child {
	return (
		<ui.box style={{ gap: 20, maxWidth: 680 }}>
			<ui.text style={{ color: "text2" }}>Computers and phones your agents test on, one thread at a time on each screen. A turn ends when its thread's turn of the conversation does, and you can take any machine for yourself from the Machines panel beside a thread.</ui.text>
			{machinesFound()}
			{phones()}
			{section(
				"Computers",
				row("Swarm's machines", "The Macs, Windows and Linux computers joined to Swarm (Settings, Machines): their screens, apps and commands. A Mac needs Accessibility and Screen Recording for Swarm; on Windows, Swarm's machine runs at sign-in, in the desktop.", toggle("swarmMachines")),
				row("This computer", "The screen of the computer Swarm runs on.", toggle("thisComputer")),
				row("Over ssh", "One a line, id:kind:user@host, where kind is mac or linux. Commands and files on each, and a Mac's screen and clicks (screencapture, cliclick).", null, input("ssh", "studio:mac:me@studio.local\nbox:linux:ci@buildbox", true)),
			)}
			{section(
				"Android, by hand",
				row("Phones and emulators through adb", "The devices adb lists: screenshots, taps and typing, apps and their logs, recordings.", toggle("android")),
				row("Where they're plugged in", "The computer whose adb runs for the plugin: one joined to Swarm needs nothing more. Its aapt2 (Android's build-tools) lets agents install your test builds on a phone you carry.", null, placePicker("adbHost")),
				row("Names", "id:serial, so agents call a phone by name. Unnamed ones go by their serial.", null, input("phones", "pixel:5A150DLCH003YS, emu:emulator-5554")),
			)}
			{section(
				"iPhone, by hand",
				row("iPhones", "id:UDID of each (Finder or devicectl list devices shows it): the plugin runs WebDriverAgent for them on the Mac below. Or id:URL@UDID for a WebDriverAgent you run yourself.", null, input("iphones", "iphone:00008150-000279220A28401C")),
				row("The Mac they're plugged into", "WebDriverAgent runs and is asked from there, and installs go through its devicectl.", null, placePicker("iosHost", "darwin")),
				row(
					"WebDriverAgent",
					"Built once on that Mac, signed with your Apple developer team (Team ID: Xcode, Settings, Accounts), then started on each iPhone as it's first used.",
					null,
					<ui.box style={{ gap: 8 }}>
						{input("wdaTeam", "ABCDE12345")}
						<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
							<ui.button size="sm" kind="soft" icon="hammer" disabled={building.busy || !text("wdaTeam")} onClick={() => void build()}>{building.busy ? "Building…" : "Build WebDriverAgent"}</ui.button>
							{building.said ? <ui.text style={{ fontSize: "small", color: building.failed ? "red" : "text2" }}>{building.said}</ui.text> : null}
						</ui.box>
					</ui.box>,
				),
			)}
			{section(
				"Other machines",
				row("bb's test machines", "The machines bb's test-machines plugin has, through its command line, when bb runs beside Swarm. Turn off the drivers above for phones bb has too, so each has one line.", toggle("bb")),
				row("A demo machine", "A screen in memory, to try the tools with.", toggle("demo")),
			)}
			{section(
				"What agents stay out of",
				row("Phones you carry", "Machine ids. There agents only install and uninstall your test builds, and read their logs: no screen, no input, no commands.", null, input("carried", "galaxy")),
				row("Your test builds", "Package or bundle ids, * for any part.", null, input("testApps", "com.example.app.*")),
				row("More apps agents stay out of", "Names or ids, besides those always off limits: passwords, banking and payments, mail, messages, photos, health, the car, social posting and shopping.", null, input("sensitive", "Notion, com.example.private")),
			)}
		</ui.box>
	);
}
