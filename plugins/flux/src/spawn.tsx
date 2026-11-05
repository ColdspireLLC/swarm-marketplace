// Agent configurations: the agent, model, effort and mode Start agent
// starts with, kept by name. Default is what it opens with; the others
// are picked in its menu. Flux's page of Settings lists and edits them.
import { storage, ui } from "swarm";

export interface SpawnConfig {
	id: string;
	name: string;
	provider: string;
	model: string;
	effort: string;
	approval: string;
}

/** What an agent starts with: the picker's four, empty for Swarm's own. */
export type Choice = Pick<SpawnConfig, "provider" | "model" | "effort" | "approval">;

export const DEFAULT_ID = "default";
const KEY = "spawnConfigs";

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** Every configuration kept, Default first: Swarm's own choices until it's saved. */
export function spawnConfigs(): SpawnConfig[] {
	const raw = storage.get<unknown>(KEY);
	const kept = (Array.isArray(raw) ? raw : []).flatMap((item): SpawnConfig[] => {
		if (!item || typeof item !== "object") return [];
		const it = item as Record<string, unknown>;
		const id = text(it.id);
		if (!id) return [];
		return [{ id, name: text(it.name).trim() || "Untitled", provider: text(it.provider), model: text(it.model), effort: text(it.effort), approval: text(it.approval) }];
	});
	const def = kept.find((c) => c.id === DEFAULT_ID) ?? { id: DEFAULT_ID, name: "Default", provider: "", model: "", effort: "", approval: "" };
	return [{ ...def, name: "Default" }, ...kept.filter((c) => c.id !== DEFAULT_ID)];
}

export function spawnConfig(id: string): SpawnConfig {
	return spawnConfigs().find((c) => c.id === id) ?? spawnConfigs()[0]!;
}

function keep(list: SpawnConfig[]) {
	storage.set(KEY, list);
}

/** Whether a choice is what a configuration has. */
export function same(config: SpawnConfig, choice: Choice): boolean {
	return config.provider === choice.provider && config.model === choice.model && config.effort === choice.effort && config.approval === choice.approval;
}

/** Writes choice into the configuration id. */
export function saveConfig(id: string, choice: Choice) {
	keep(spawnConfigs().map((c) => (c.id === id ? { ...c, ...pick(choice) } : c)));
}

/** Keeps choice as a new configuration named name, and returns its id. */
export function addConfig(name: string, choice: Choice): string {
	const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
	keep([...spawnConfigs(), { id, name: name.trim() || "Untitled", ...pick(choice) }]);
	return id;
}

export function renameConfig(id: string, name: string) {
	if (id === DEFAULT_ID) return;
	keep(spawnConfigs().map((c) => (c.id === id ? { ...c, name } : c)));
}

export function deleteConfig(id: string) {
	if (id === DEFAULT_ID) return;
	keep(spawnConfigs().filter((c) => c.id !== id));
}

function pick(choice: Choice): Choice {
	return { provider: choice.provider, model: choice.model, effort: choice.effort, approval: choice.approval };
}

/** A name for a new configuration that no other has. */
export function freshName(): string {
	const names = new Set(spawnConfigs().map((c) => c.name.trim().toLowerCase()));
	for (let n = 1; ; n++) if (!names.has(`configuration ${n}`)) return `Configuration ${n}`;
}

// Settings' rows: the name typed into a new one's field, and the
// configuration whose name is being changed.
const st = ui.store({ renaming: "", name: "" });

/**
 * Flux's page of Settings' agent configurations: each one's name, its
 * agent and mode, which change it at once, and Rename and Delete; New
 * configuration, a copy of Default, below.
 */
export function SpawnConfigs() {
	const list = spawnConfigs();
	return (
		<ui.box style={{ gap: 12 }}>
			<ui.box style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
				<ui.box style={{ flex: 1, minWidth: 0, gap: 4 }}>
					<ui.text style={{ fontWeight: 600 }}>Agent configurations</ui.text>
					<ui.text style={{ fontSize: "small", color: "text2" }}>The agent, model and mode Start agent starts with. It opens on Default; the others are a click away in its Configuration menu, which also saves what's picked.</ui.text>
				</ui.box>
				<ui.button
					kind="secondary"
					size="sm"
					icon="plus"
					onClick={() => {
						const def = list[0]!;
						const id = addConfig(freshName(), def);
						st.renaming = id;
						st.name = spawnConfig(id).name;
					}}
				>
					New configuration
				</ui.button>
			</ui.box>
			<ui.box style={{ borderRadius: "card", border: "1px solid border", backgroundColor: "raised", overflow: "hidden" }}>
				{list.map((config, i) => (
					<ui.box key={config.id} label={`Configuration ${config.name}`} style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingLeft: 12, paddingRight: 8, height: 44, borderTop: i === 0 ? "none" : "1px solid divider" }}>
						{st.renaming === config.id ? (
							<ui.field
								key={"rename-" + config.id}
								label={`Name of ${config.name}`}
								value={st.name}
								autoFocus
								onChange={(value) => { st.name = value; }}
								onSubmit={() => finishRename(config.id)}
								style={{ flex: 1, minWidth: 140, height: 28 }}
							/>
						) : (
							<ui.text style={{ flex: 1, minWidth: 140, fontWeight: config.id === DEFAULT_ID ? 500 : 400 }} maxLines={1}>{config.name}</ui.text>
						)}
						{ui.agentPicker({ provider: config.provider, value: config.model, effort: config.effort, onChange: (value) => saveConfig(config.id, { ...config, provider: value.provider, model: value.model, effort: value.effort ?? "" }) })}
						{ui.modePicker({ provider: config.provider, value: config.approval, onChange: (value) => saveConfig(config.id, { ...config, approval: value }) })}
						{config.id === DEFAULT_ID ? (
							<ui.box style={{ width: 28 }} />
						) : st.renaming === config.id ? (
							<ui.iconButton icon="check" label={`Save the name of ${config.name}`} style={{ width: 28, height: 28 }} onClick={() => finishRename(config.id)} />
						) : (
							<ui.menu label={`Actions for ${config.name}`} tooltip="Configuration actions" style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: "control", color: "text2", hover: { backgroundColor: "hover", color: "text" }, checked: { backgroundColor: "hover", color: "text" } }}>
								<ui.icon icon="more" style={{ width: 14, height: 14, color: "currentColor" }} />
								<ui.item icon="pencil" onClick={() => { st.renaming = config.id; st.name = config.name; }}>Rename</ui.item>
								<ui.separator />
								<ui.item icon="trash" danger onClick={() => deleteConfig(config.id)}>Delete</ui.item>
							</ui.menu>
						)}
					</ui.box>
				))}
			</ui.box>
		</ui.box>
	);
}

function finishRename(id: string) {
	if (st.name.trim()) renameConfig(id, st.name.trim());
	st.renaming = "";
}
