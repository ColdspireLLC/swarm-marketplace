// The issue_images agent tool (bb's flux_issue_images). Flux serves an
// issue's images only to its members, so the links in `swarm flux show`
// are no use to an agent; that writes them [Image N], and this shows them.
import type { ToolContent, ToolResult } from "swarm";
import { describe } from "./client";
import { imageIds, issueImageIds, memberName } from "./prompt";
import type { Flux } from "./service";

/** Images per call: each is up to Flux's 2 MB. */
export const IMAGES_PER_CALL = 5;

const failure = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export async function issueImages(flux: Flux, params: { issue: string; images?: number[] }): Promise<ToolResult> {
	await flux.whenReady();
	const issue = flux.findIssue(params.issue);
	if (!issue) return failure(`No Flux issue matches "${params.issue}". Use a key like ABC-12; \`swarm flux list\` shows them.`);
	const detail = flux.detail(issue.id);
	const key = detail.issue.key;
	const ids = issueImageIds(detail, flux.baseUrl);
	if (ids.length === 0) return `${key} has no images.`;
	const wanted = params.images ?? ids.slice(0, IMAGES_PER_CALL).map((_, i) => i + 1);
	const missing = wanted.filter((n) => n > ids.length);
	if (missing.length > 0) {
		return failure(`${key} has ${ids.length === 1 ? "only [Image 1]" : `[Image 1] to [Image ${ids.length}]`}; there's no ${missing.map((n) => `[Image ${n}]`).join(", ")}.`);
	}
	const lookup = { members: flux.memberList(), labels: [], projects: [], baseUrl: flux.baseUrl };
	const place = (id: string): string => {
		if (imageIds(detail.descriptionMarkdown, flux.baseUrl).includes(id)) return "in the description";
		const c = detail.comments.find((each) => imageIds(each.markdown, flux.baseUrl).includes(id));
		return c ? `in a comment by ${memberName(lookup, c.authorId)}, ${c.createdAt.slice(0, 16).replace("T", " ")}` : "";
	};
	const content: ToolContent[] = [];
	for (const n of wanted.slice(0, IMAGES_PER_CALL)) {
		const id = ids[n - 1]!;
		try {
			const asset = await flux.requireClient().asset(id);
			content.push({ type: "text", text: `[Image ${n}] ${place(id)}`.trim() }, { type: "image", data: base64(new Uint8Array(asset.bytes)), mimeType: asset.contentType });
		} catch (e) {
			content.push({ type: "text", text: `[Image ${n}] couldn't be loaded: ${describe(e)}` });
		}
	}
	const rest = ids.length - Math.max(...wanted);
	if (!params.images && rest > 0) content.push({ type: "text", text: `${key} has ${ids.length} images; ask for the others with images: [${IMAGES_PER_CALL + 1}, …] (up to ${IMAGES_PER_CALL} at a time).` });
	return { content };
}

// The engine's own base64, ES2026's.
function base64(bytes: Uint8Array): string {
	return bytes.toBase64();
}
