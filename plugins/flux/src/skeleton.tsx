// Flux's loading states, as bb's (ListSkeleton, DetailSkeleton): the shape
// of what's coming, drawn on the surfaces it will have, the light of
// Swarm's skeletons passing over every bone at once, each as big as what
// it stands for, so nothing moves as it comes. The board's columns and
// cards, the list's heading and rows, an issue's page; and a card or a row
// on its way while a long column scrolls.
import { ui, type Style } from "swarm";

const BONE: Style = { borderRadius: 4, backgroundColor: "hover", animation: { name: "shimmer" }, flexShrink: 0 };

/** A bone: a line or a mark still to come. */
export function Bone({ width, height = 10, round = false, style }: { width: number | `${number}%`; height?: number; round?: boolean; style?: Style }) {
	return <ui.box style={{ ...BONE, width, height, ...(round ? { borderRadius: "full" } : null), ...style }} />;
}

// Each card's title as long as a title is, varied so a column reads as one.
const TITLES: `${number}%`[] = ["78%", "56%", "88%", "64%", "72%", "48%"];

/** A card's shape, as tall as the card it stands for: its key, its status and title, its fields, the day it was made. */
export function CardBones({ n = 0 }: { n?: number }) {
	return (
		<ui.box style={{ width: "100%", flexDirection: "row", gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: 8, backgroundColor: "overlay", border: "1px solid border", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
			<ui.box style={{ flex: 1, minWidth: 0, gap: 0 }}>
				<ui.box style={{ flexDirection: "row", alignItems: "center", height: 16 }}>
					<Bone width={52} height={8} />
				</ui.box>
				<ui.box style={{ flexDirection: "row", gap: 6, alignItems: "center", height: 20, marginTop: 4 }}>
					<Bone width={14} height={14} round />
					<Bone width={TITLES[n % TITLES.length]!} height={12} />
				</ui.box>
				<ui.box style={{ flexDirection: "row", gap: 4, alignItems: "center", height: 22, marginTop: 8 }}>
					<Bone width={22} height={20} />
					{n % 3 !== 1 ? <Bone width={56} height={20} /> : null}
					{n % 2 === 0 ? <Bone width={44} height={20} /> : null}
				</ui.box>
				<ui.box style={{ flexDirection: "row", alignItems: "center", height: 16, marginTop: 8 }}>
					<Bone width={72} height={8} />
				</ui.box>
			</ui.box>
			<ui.box style={{ flexShrink: 0, alignItems: "flex-end" }}>
				<Bone width={20} height={20} round />
			</ui.box>
		</ui.box>
	);
}

/** A list row's shape: priority, key, status, title, assignee. */
export function RowBones({ n = 0 }: { n?: number }) {
	return (
		<ui.box style={{ width: "100%", flexDirection: "row", gap: 8, alignItems: "center", height: 40, paddingLeft: 8, paddingRight: 8 }}>
			<ui.box style={{ width: 16 }} />
			<Bone width={14} height={14} />
			<Bone width={48} height={8} />
			<Bone width={14} height={14} round />
			<ui.box style={{ flex: 1, minWidth: 0 }}>
				<Bone width={TITLES[n % TITLES.length]!} height={10} />
			</ui.box>
			<Bone width={20} height={20} round />
		</ui.box>
	);
}

/** The board while the first sync comes: columns of cards. */
export function BoardBones({ edge }: { edge: number }) {
	return (
		<ui.box label="Loading Flux…" style={{ flex: 1, minHeight: 0, flexDirection: "row", gap: 20, overflow: "hidden", alignItems: "stretch", paddingLeft: edge, paddingRight: edge, paddingTop: 16, paddingBottom: 32, media: [{ minWidth: 768, style: { paddingLeft: 20, paddingRight: 20 } }] }}>
			{[5, 3, 4, 2].map((cards, column) => (
				<ui.box key={"col" + column} style={{ width: 346, flexShrink: 0, height: "100%", overflow: "hidden", gap: 6, padding: 8, borderRadius: 14, backgroundColor: "color-mix(in srgb, text 4%, bg)" }}>
					<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 32, flexShrink: 0, paddingLeft: 8, paddingRight: 8 }}>
						<Bone width={16} height={16} round />
						<Bone width={[72, 88, 64, 96][column]!} height={12} />
						<Bone width={12} height={12} />
					</ui.box>
					{Array.from({ length: cards }, (_, n) => <CardBones key={"card" + n} n={column * 2 + n} />)}
				</ui.box>
			))}
		</ui.box>
	);
}

/** The list while the first sync comes: a group's heading and its rows. */
export function ListBones({ edge }: { edge: number }) {
	return (
		<ui.box label="Loading Flux…" style={{ flex: 1, minHeight: 0, overflow: "hidden", paddingLeft: edge, paddingRight: edge, paddingTop: 12 }}>
			<ui.box style={{ flexDirection: "row", gap: 8, alignItems: "center", height: 32, paddingLeft: 8, borderRadius: "control", backgroundColor: "hover", marginBottom: 4 }}>
				<Bone width={12} height={12} />
				<Bone width={14} height={14} round />
				<Bone width={80} height={10} />
			</ui.box>
			{Array.from({ length: 9 }, (_, n) => <RowBones key={"row" + n} n={n} />)}
		</ui.box>
	);
}

/** An issue's page while it comes, under its breadcrumb in the title bar: its title, its properties, its description, as the page lays them out. */
export function IssueBones() {
	return (
		<ui.box label="Loading the issue…" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
			<ui.box style={{ flexDirection: "row", gap: 40, width: "100%", maxWidth: 928, alignSelf: "center", paddingLeft: 16, paddingRight: 16, paddingTop: 24, media: [{ minWidth: 700, style: { paddingLeft: 32, paddingRight: 32, paddingTop: 40 } }] }}>
				<ui.box style={{ flex: 1, minWidth: 0, gap: 14 }}>
					<Bone width="66%" height={28} style={{ borderRadius: 6 }} />
					<Bone width="34%" height={12} />
					<ui.box style={{ gap: 10, marginTop: 24 }}>
						<Bone width="100%" height={10} />
						<Bone width="94%" height={10} />
						<Bone width="82%" height={10} />
						<Bone width="58%" height={10} />
					</ui.box>
				</ui.box>
				<ui.box style={{ display: "none", width: 240, gap: 14, media: [{ minWidth: 900, style: { display: "flex" } }] }}>
					{[64, 80, 56, 72, 48].map((w, n) => (
						<ui.box key={"p" + n} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
							<Bone width={72} height={8} />
							<Bone width={14} height={14} round />
							<Bone width={w} height={10} />
						</ui.box>
					))}
				</ui.box>
			</ui.box>
		</ui.box>
	);
}
