// iOS simulators, on a Mac: simctl for the devices, their apps and
// settings, and WebDriverAgent, built once for the simulator and run on
// each agent simulator on a port of its own, for touches and reading the
// screen. Everything runs on the Mac (where.ts), through Swarm.
import { iosKeepsOverrides, disabledPath, slimmedLabels, slimmedPlist } from "./slimios";
import { MAX_ELEMENTS, type Element } from "./elements";
import { pickModel, pngSize, SimError, unbase64, type Runtime } from "./devices";
export { SimError, unbase64 } from "./devices";
export type { Runtime } from "./devices";
import { runAt, sh, type Where } from "./where";

const out = (r: { stdout: string; stderr: string }) => (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-6).join("\n");

/** Runs a shell script on the Mac, its arguments $1…; an error unless it exits 0. */
export async function mac(w: Where, script: string, args: string[] = [], o: { timeout?: number; input?: string } = {}): Promise<string> {
	const r = await runAt(w, "sh", ["-c", script, "sh", ...args], { timeout: o.timeout ?? 60_000, input: o.input });
	if (r.timedOut) throw new SimError(`Timed out on ${w.label}: ${out(r)}`);
	if (r.code !== 0) throw new SimError(out(r) || `exit ${r.code} on ${w.label}`);
	return r.stdout;
}

const simctl = (w: Where, args: string[], o: { timeout?: number; input?: string } = {}) => mac(w, `xcrun simctl "$@"`, args, o);

export interface SimDevice {
	udid: string;
	name: string;
	state: string;
	runtime: string;
	/** The runtime's version, 26.5. */
	version: string;
	deviceType: string;
}

/** The simulators simctl lists, available ones. */
export async function devices(w: Where): Promise<SimDevice[]> {
	const j = JSON.parse(await simctl(w, ["list", "devices", "available", "-j"]));
	const list: SimDevice[] = [];
	for (const [runtime, ds] of Object.entries<any[]>(j.devices ?? {})) {
		const version = /iOS-(\d+)-(\d+)/.exec(runtime)?.slice(1).join(".") ?? "";
		if (!/SimRuntime\.iOS-/.test(runtime)) continue;
		for (const d of ds) list.push({ udid: d.udid, name: d.name, state: d.state, runtime, version, deviceType: d.deviceTypeIdentifier ?? "" });
	}
	return list;
}

export async function runtimes(w: Where): Promise<Runtime[]> {
	const j = JSON.parse(await simctl(w, ["list", "runtimes", "available", "-j"]));
	return (j.runtimes ?? [])
		.filter((r: any) => r.platform === "iOS" && r.isAvailable !== false)
		.map((r: any) => ({ identifier: r.identifier, version: r.version, name: r.name, types: (r.supportedDeviceTypes ?? []).map((t: any) => ({ identifier: t.identifier, name: t.name, family: t.productFamily })) }));
}

/** An agent simulator's name: "Swarm agent 1 · iPhone 17 Pro". */
export const agentName = (n: number, model: string) => `Swarm agent ${n} · ${model}`;
export const agentPrefix = (n: number) => `Swarm agent ${n} · `;

/** The agent simulator of slot n, made of the model if there's none. */
export async function ensureAgent(w: Where, n: number, wanted: string): Promise<{ device: SimDevice; created: boolean }> {
	const have = (await devices(w)).find((d) => d.name.startsWith(agentPrefix(n)));
	if (have) return { device: have, created: false };
	const pick = pickModel(await runtimes(w), wanted);
	if (!pick) throw new SimError(wanted ? `No iOS runtime on ${w.label} has a ${wanted}: xcrun simctl list devicetypes lists the models.` : `${w.label} has no iOS simulator runtime: install one in Xcode (Settings, Components).`);
	const udid = (await simctl(w, ["create", agentName(n, pick.type.name), pick.type.identifier, pick.runtime.identifier])).trim();
	const device = (await devices(w)).find((d) => d.udid === udid);
	if (!device) throw new SimError(`simctl made ${udid} but doesn't list it.`);
	return { device, created: true };
}

/** Boots it and waits until it's ready (about 20 s from cold). */
export async function boot(w: Where, udid: string) {
	await simctl(w, ["bootstatus", udid, "-b"], { timeout: 240_000 });
}

export async function shutdown(w: Where, udid: string) {
	await mac(w, `xcrun simctl shutdown "$1" 2>&1 | grep -v 'current state: Shutdown' >&2; exit 0`, [udid]);
}

/** Erases it: shut down first, its apps and data gone, its slimming kept. */
export async function erase(w: Where, udid: string) {
	await shutdown(w, udid);
	await simctl(w, ["erase", udid], { timeout: 120_000 });
}

export async function remove(w: Where, udid: string) {
	await shutdown(w, udid);
	await simctl(w, ["delete", udid], { timeout: 120_000 });
}

/**
 * Writes slimming's overrides (labels off; none for stock) while it's
 * shut down: they take effect as it boots. The device's other overrides
 * stay. Says why not where its iOS doesn't keep them.
 */
export async function slim(w: Where, d: SimDevice, off: string[]): Promise<string | null> {
	if (!iosKeepsOverrides(d.version)) return `iOS ${d.version} doesn't keep launchd's overrides (18.5 and later do): ${d.name} runs stock.`;
	const path = disabledPath(d.udid);
	const existing = await mac(w, `cat "$1" 2>/dev/null; exit 0`, [path]);
	const next = slimmedPlist(existing, off);
	if (next === existing) return null;
	await mac(w, `mkdir -p "$(dirname "$1")" && cat > "$1.swarm" && mv "$1.swarm" "$1"`, [path], { input: next });
	return null;
}

/** The labels slimming has off on it, as its overrides say. */
export async function slimmed(w: Where, udid: string): Promise<string[]> {
	return slimmedLabels(await mac(w, `cat "$1" 2>/dev/null; exit 0`, [disabledPath(udid)]));
}

/** Its memory: the processes under its launchd_sim, and their footprint in MB summed (as simslim measures). */
export async function measure(w: Where, udid: string): Promise<{ processes: number; mb: number }> {
	const o = await mac(
		w,
		`p=$(pgrep -f "[l]aunchd_sim.*$1" | head -1); [ -n "$p" ] || { echo "0 0"; exit 0; }
kids() { for c in $(pgrep -P "$1"); do echo "$c"; kids "$c"; done; }
all="$p $(kids "$p")"; args=""; for x in $all; do args="$args -p $x"; done
footprint $args 2>/dev/null | awk -v n="$(echo $all | wc -w | tr -d ' ')" '/Footprint: / {for (i = 1; i <= NF; i++) if ($i == "Footprint:") {v = $(i+1); u = $(i+2); mb += (u == "GB" ? v * 1024 : u == "KB" ? v / 1024 : u == "B" ? 0 : v)}} END {printf "%d %d\\n", n, mb}'`,
		[udid],
		{ timeout: 120_000 },
	);
	const [n = 0, mb = 0] = o.trim().split(/\s+/).map(Number);
	return { processes: n, mb };
}

/** A screenshot, PNG at the device's pixels. */
export async function screenshot(w: Where, udid: string): Promise<Uint8Array> {
	const b64 = await mac(w, `f=$(mktemp -t swarm-sim); xcrun simctl io "$1" screenshot --type=png "$f" >/dev/null 2>&1 || { echo "the simulator isn't booted" >&2; exit 3; }; base64 < "$f"; rm -f "$f"`, [udid], { timeout: 60_000 });
	return unbase64(b64);
}

// ---- Apps and settings ----

export async function apps(w: Where, udid: string): Promise<{ id: string; name: string; user: boolean }[]> {
	const j = JSON.parse(await mac(w, `xcrun simctl listapps "$1" | plutil -convert json -o - -`, [udid]));
	return Object.entries<any>(j).map(([id, a]) => ({ id, name: String(a.CFBundleDisplayName || a.CFBundleName || id), user: a.ApplicationType === "User" }));
}

export const launch = (w: Where, udid: string, id: string, args: string[] = []) => simctl(w, ["launch", "--terminate-running-process", udid, id, ...args]);
export const terminate = (w: Where, udid: string, id: string) => mac(w, `xcrun simctl terminate "$1" "$2" 2>/dev/null; exit 0`, [udid, id]);
export const install = (w: Where, udid: string, path: string) => simctl(w, ["install", udid, path], { timeout: 300_000 });
export const uninstall = (w: Where, udid: string, id: string) => simctl(w, ["uninstall", udid, id]);
export const openURL = (w: Where, udid: string, url: string) => simctl(w, ["openurl", udid, url]);
export const logs = (w: Where, udid: string, id: string) =>
	mac(w, `xcrun simctl spawn "$1" log show --last 3m --style compact --predicate "subsystem == \\"$2\\" OR process == \\"$3\\"" 2>&1 | tail -200`, [udid, id, id.split(".").pop() ?? id], { timeout: 120_000 });

/** A device setting simctl changes: appearance, text size, location, a permission, a push, the status bar. */
export async function setting(w: Where, udid: string, what: string, value: string, app?: string): Promise<string> {
	switch (what) {
		case "appearance":
			if (!/^(dark|light)$/.test(value)) throw new SimError("appearance is dark or light.");
			await simctl(w, ["ui", udid, "appearance", value]);
			return `Appearance: ${value}.`;
		case "text-size":
			await simctl(w, ["ui", udid, "content_size", value]);
			return `Text size: ${value}.`;
		case "location":
			if (value === "clear" || value === "none") await simctl(w, ["location", udid, "clear"]);
			else if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(value)) await simctl(w, ["location", udid, "set", value.replace(/\s/g, "")]);
			else throw new SimError("location is LAT,LON, or clear.");
			return `Location: ${value}.`;
		case "permission": {
			const [action, service] = value.split(/\s+/);
			if (!/^(grant|revoke|reset)$/.test(action ?? "") || !service) throw new SimError("permission is grant|revoke|reset SERVICE (all, calendar, contacts, location, location-always, photos, photos-add, media-library, microphone, motion, reminders, siri), with the app.");
			await simctl(w, ["privacy", udid, action!, service!, ...(app ? [app] : [])]);
			return `${action} ${service}${app ? ` for ${app}` : ""}.`;
		}
		case "push": {
			if (!app) throw new SimError("A push needs the app's bundle id.");
			JSON.parse(value);
			await mac(w, `f=$(mktemp -t swarm-push); cat > "$f"; xcrun simctl push "$1" "$2" "$f"; r=$?; rm -f "$f"; exit $r`, [udid, app], { input: value });
			return `Pushed to ${app}.`;
		}
		case "status-bar":
			if (value === "clear") await simctl(w, ["status_bar", udid, "clear"]);
			else await simctl(w, ["status_bar", udid, "override", "--time", "9:41", "--dataNetwork", "wifi", "--wifiBars", "3", "--cellularBars", "4", "--batteryState", "charged", "--batteryLevel", "100"]);
			return value === "clear" ? "Status bar as it is." : "Status bar: 9:41, full bars and battery.";
	}
	throw new SimError(`No setting ${what}: appearance, text-size, location, permission, push, status-bar.`);
}

/** What a simulator changing hands is cleared of: its user apps quit, permissions, location and status bar reset, light mode. */
export async function clear(w: Where, udid: string) {
	await mac(
		w,
		`for id in $(xcrun simctl listapps "$1" | plutil -convert json -o - - | /usr/bin/python3 -c 'import json,sys; [print(k) for k,v in json.load(sys.stdin).items() if v.get("ApplicationType")=="User"]' 2>/dev/null); do xcrun simctl terminate "$1" "$id" 2>/dev/null; done
xcrun simctl privacy "$1" reset all 2>/dev/null; xcrun simctl location "$1" clear 2>/dev/null; xcrun simctl status_bar "$1" clear 2>/dev/null; xcrun simctl ui "$1" appearance light 2>/dev/null; exit 0`,
		[udid],
		{ timeout: 120_000 },
	);
}

// ---- WebDriverAgent ----

/** Where WebDriverAgent's built for the simulator, on the Mac, kept across restarts. */
const WDA = "$HOME/Library/Caches/swarm-simulators/wda";
/** Slot n's WebDriverAgent listens on this port of the Mac (simulators share its network). */
export const wdaPort = (n: number) => 8300 + n;

/** Builds WebDriverAgent for the simulator where it isn't: no signing needed, a few minutes the first time. */
export async function buildWDA(w: Where) {
	await mac(
		w,
		`set -e; mkdir -p ${WDA}; cd ${WDA}
ls Build/Products/*iphonesimulator*.xctestrun >/dev/null 2>&1 && exit 0
[ -d src/.git ] || git clone -q --depth 1 https://github.com/appium/WebDriverAgent src
xcrun xcodebuild build-for-testing -project src/WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination "generic/platform=iOS Simulator" -derivedDataPath ${WDA} CODE_SIGNING_ALLOWED=NO > build.log 2>&1 || { tail -30 build.log; exit 1; }`,
		[],
		{ timeout: 600_000 },
	);
}

const sessions = new Map<string, string>();

async function wdaHTTP(w: Where, port: number, method: string, path: string, body?: unknown, timeoutS = 60): Promise<any> {
	const r = await runAt(w, "curl", ["-sS", "-g", "--max-time", String(timeoutS), "-X", method, "-H", "Content-Type: application/json", ...(body === undefined ? [] : ["--data-binary", "@-"]), `http://127.0.0.1:${port}${path}`], {
		input: body === undefined ? undefined : JSON.stringify(body),
		timeout: (timeoutS + 5) * 1000,
	});
	if (r.code !== 0) throw new SimError(`WebDriverAgent isn't answering (${out(r) || `curl ${r.code}`})`);
	const v = JSON.parse(r.stdout)?.value;
	if (v && typeof v === "object" && "error" in v) throw new SimError(`WebDriverAgent: ${v.message || v.error}`);
	return v;
}

/** WebDriverAgent on slot n's simulator, started (and built) where it isn't answering. */
export async function wda(w: Where, n: number, udid: string): Promise<number> {
	const port = wdaPort(n);
	const ok = await wdaHTTP(w, port, "GET", "/status", undefined, 3).then(
		() => true,
		() => false,
	);
	if (ok) return port;
	sessions.delete(udid);
	await buildWDA(w);
	await mac(
		w,
		`x=$(ls ${WDA}/Build/Products/*iphonesimulator*.xctestrun | head -1)
pkill -f "swarm-sim-wda-$1" 2>/dev/null
TEST_RUNNER_USE_PORT=$2 nohup xcrun xcodebuild test-without-building -xctestrun "$x" -destination "id=$1" -derivedDataPath "${WDA}/run-$1" SWARM_TAG=swarm-sim-wda-$1 < /dev/null > "${WDA}/run-$1.log" 2>&1 &
for i in $(seq 90); do curl -s --max-time 1 "http://127.0.0.1:$2/status" >/dev/null && exit 0; sleep 1; done
echo "WebDriverAgent didn't start in 90 s: ${WDA}/run-$1.log on the Mac says why" >&2; exit 1`,
		[udid, String(port)],
		{ timeout: 180_000 },
	);
	return port;
}

/** Stops slot n's WebDriverAgent (as its simulator shuts down). */
export async function stopWDA(w: Where, udid: string) {
	sessions.delete(udid);
	await mac(w, `pkill -f "swarm-sim-wda-$1" 2>/dev/null; exit 0`, [udid]).catch(() => {});
}

async function inSession(w: Where, port: number, udid: string, method: string, path: string, body?: unknown): Promise<any> {
	const s = async () => {
		let id = sessions.get(udid);
		if (!id) {
			id = String((await wdaHTTP(w, port, "POST", "/session", { capabilities: { alwaysMatch: {} } }))?.sessionId ?? "");
			if (!id) throw new SimError("WebDriverAgent made no session.");
			sessions.set(udid, id);
		}
		return id;
	};
	try {
		return await wdaHTTP(w, port, method, `/session/${await s()}${path}`, body);
	} catch (e) {
		if (!(e instanceof SimError) || !/session/i.test(e.message)) throw e;
		sessions.delete(udid);
		return wdaHTTP(w, port, method, `/session/${await s()}${path}`, body);
	}
}

/** Screenshot pixels per WebDriverAgent point. */
async function scale(w: Where, port: number, udid: string): Promise<number> {
	const size = await inSession(w, port, udid, "GET", "/window/size");
	const shot = pngSize(await screenshot(w, udid));
	return size?.width ? shot.width / size.width : 3;
}

export const IOS_STEPS = "tap X Y, long X Y [MS], swipe X1 Y1 X2 Y2 [MS], type TEXT, key home|enter|lock|volumeup|volumedown, wait MS (screenshot pixels)";

/** Runs input steps, in screenshot pixels. */
export async function drive(w: Where, n: number, udid: string, steps: string[]) {
	const port = await wda(w, n, udid);
	const k = await scale(w, port, udid);
	const pt = (v: string) => Number(v) / k;
	for (const step of steps) {
		const [op = "", ...rest] = step.trim().split(/\s+/);
		const num = rest.map(Number);
		const xy = { tap: 2, long: 2, swipe: 4 }[op.toLowerCase()] ?? 0;
		if (rest.length < xy || num.slice(0, xy).some((v) => !Number.isFinite(v))) throw new SimError(`${step}: ${IOS_STEPS}`);
		switch (op.toLowerCase()) {
			case "tap":
				await inSession(w, port, udid, "POST", "/wda/tap", { x: pt(rest[0]!), y: pt(rest[1]!) });
				break;
			case "long":
				await inSession(w, port, udid, "POST", "/wda/touchAndHold", { x: pt(rest[0]!), y: pt(rest[1]!), duration: (num[2] || 800) / 1000 });
				break;
			case "swipe":
				await inSession(w, port, udid, "POST", "/wda/dragfromtoforduration", { fromX: pt(rest[0]!), fromY: pt(rest[1]!), toX: pt(rest[2]!), toY: pt(rest[3]!), duration: (num[4] || 300) / 1000 });
				break;
			case "type":
				await inSession(w, port, udid, "POST", "/wda/keys", { value: [...step.trim().slice(4).trimStart()] });
				break;
			case "key": {
				const name = (rest[0] ?? "").toLowerCase();
				if (name === "home") await wdaHTTP(w, port, "POST", "/wda/homescreen");
				else if (name === "enter" || name === "return") await inSession(w, port, udid, "POST", "/wda/keys", { value: ["\n"] });
				else if (name === "lock") await inSession(w, port, udid, "POST", "/wda/lock");
				else if (name === "volumeup" || name === "volumedown") await inSession(w, port, udid, "POST", "/wda/pressButton", { name: name === "volumeup" ? "volumeUp" : "volumeDown" });
				else throw new SimError(`no key ${name}: home, enter, lock, volumeup, volumedown`);
				break;
			}
			case "wait":
				await new Promise((r) => setTimeout(r, Math.min(num[0] || 500, 10_000)));
				break;
			default:
				throw new SimError(`no step ${op}: ${IOS_STEPS}`);
		}
	}
}

/** The screen as named elements, at screenshot pixels. */
export async function describe(w: Where, n: number, udid: string): Promise<Element[]> {
	const port = await wda(w, n, udid);
	const k = await scale(w, port, udid);
	const tree = await wdaHTTP(w, port, "GET", "/source?format=json", undefined, 90);
	const list: Element[] = [];
	const walk = (x: any) => {
		if (!x || list.length >= MAX_ELEMENTS) return;
		const label = String(x.label || x.name || x.value || "").trim();
		const r = x.rect;
		if (label && r && x.isVisible !== "0" && x.isVisible !== false && r.width > 0 && r.height > 0) {
			const role = String(x.type || "").replace(/^XCUIElementType/, "").toLowerCase();
			list.push({ role, label, x: r.x * k, y: r.y * k, w: r.width * k, h: r.height * k, action: /button|cell|link|switch|textfield|securetextfield|searchfield|tab|key|slider|picker|icon|menuitem/.test(role) });
		}
		for (const c of x.children ?? []) walk(c);
	};
	walk(tree);
	return list;
}

export { sh };
