// Markdown that describes an issue to an agent: used for @-mentions, the
// prompt seeded when starting an agent, and `swarm flux show`.
import { fluxAssetId } from "./assets";
import type { IssueDetail, Label, Member, Project } from "./contract";
import { PRIORITY_LABELS, STATUS_LABELS } from "./flux";
import { MARKDOWN_IMAGE, mapOutsideCode } from "./markdown";

const RECENT_COMMENTS = 5;
const MAX_DESCRIPTION_CHARS = 20_000;
const MAX_COMMENT_CHARS = 4_000;
/** The agent tool that shows an issue's images. */
export const IMAGE_TOOL = "flux_issue_images";
/** The most images a started agent gets with its first message. */
export const MAX_START_IMAGES = 10;

export interface Lookup {
  members: readonly Member[];
  labels: readonly Label[];
  projects: readonly Project[];
  /** The Flux the issue is from, to tell its images from other links. */
  baseUrl: string;
}

export function memberName(lookup: Lookup, id: string | null): string {
  if (!id) return "Unknown";
  const member = lookup.members.find((candidate) => candidate.id === id);
  return member ? `${member.name} (@${member.username})` : "Former member";
}

function clip(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}\n\n…(truncated; ${text.length - max} more characters)`
    : text;
}

export function issueFacts(detail: IssueDetail, lookup: Lookup): string[] {
  const { issue } = detail;
  const project = lookup.projects.find((item) => item.id === issue.projectId);
  const assignees = issue.assigneeIds.map((id) => memberName(lookup, id));
  const labels = issue.labelIds
    .map((id) => lookup.labels.find((label) => label.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return [
    `- Status: ${STATUS_LABELS[issue.status]}`,
    `- Priority: ${PRIORITY_LABELS[issue.priority]}`,
    `- Project: ${project ? `${project.name} (${project.key})` : "Unknown"}`,
    `- Assignees: ${assignees.length ? assignees.join(", ") : "Unassigned"}`,
    ...(labels.length ? [`- Labels: ${labels.join(", ")}`] : []),
    ...(issue.dueDate ? [`- Due: ${issue.dueDate}`] : []),
    ...(detail.parent
      ? [`- Parent: ${detail.parent.key} · ${detail.parent.title}`]
      : []),
    `- Link: ${detail.url}`,
  ];
}

/** Full context block: the issue, its sub-issues, and recent discussion. */
export function issueContext(detail: IssueDetail, lookup: Lookup): string {
  const { issue } = detail;
  const images = issueImageIds(detail, lookup.baseUrl);
  const numbered = (markdown: string) =>
    numberImages(markdown, images, lookup.baseUrl);
  const sections = [
    `# ${issue.key} · ${issue.title}`,
    issueFacts(detail, lookup).join("\n"),
    `## Description\n\n${
      detail.descriptionMarkdown
        ? clip(numbered(detail.descriptionMarkdown), MAX_DESCRIPTION_CHARS)
        : "_No description._"
    }`,
  ];
  if (detail.subIssues.length > 0) {
    sections.push(
      `## Sub-issues\n\n${detail.subIssues
        .map(
          (sub) =>
            `- [${sub.status === "complete" ? "x" : " "}] ${sub.key} · ${sub.title} (${STATUS_LABELS[sub.status]})`,
        )
        .join("\n")}`,
    );
  }
  if (detail.comments.length > 0) {
    const recent = detail.comments.slice(-RECENT_COMMENTS);
    const skipped = detail.comments.length - recent.length;
    sections.push(
      `## ${skipped > 0 ? `Latest ${recent.length} of ${detail.comments.length} comments` : "Comments"}\n\n${recent
        .map(
          (comment) =>
            `**${memberName(lookup, comment.authorId)}** · ${comment.createdAt.slice(0, 16).replace("T", " ")}\n\n${clip(numbered(comment.markdown), MAX_COMMENT_CHARS)}`,
        )
        .join("\n\n---\n\n")}`,
    );
  }
  if (images.length > 0) {
    sections.push(
      `## Images\n\n${images.length === 1 ? "This issue has 1 image, written [Image 1]" : `This issue has ${images.length} images, written [Image 1] to [Image ${images.length}]`}. Flux shows them only to its members, so look at them with the \`${IMAGE_TOOL}\` tool (issue "${issue.key}").`,
    );
  }
  return sections.join("\n\n");
}

/** Flux's own images in `markdown`, in order, without repeats. */
export function imageIds(markdown: string, baseUrl: string): string[] {
  const ids: string[] = [];
  if (!markdown.includes("![")) return ids;
  mapOutsideCode(markdown, (part) => {
    for (const match of part.matchAll(MARKDOWN_IMAGE)) {
      const id = fluxAssetId(match[2]!, baseUrl);
      if (id && !ids.includes(id)) ids.push(id);
    }
    return part;
  });
  return ids;
}

/**
 * `markdown` with each image in `ids` written `[Image N]`, N its place in
 * `ids`. Flux serves its images only to its members, so neither Swarm's timeline
 * nor an agent can load the links.
 */
export function numberImages(
  markdown: string,
  ids: readonly string[],
  baseUrl: string,
): string {
  if (ids.length === 0 || !markdown.includes("![")) return markdown;
  return mapOutsideCode(markdown, (part) =>
    part.replace(MARKDOWN_IMAGE, (whole, _alt: string, url: string) => {
      const index = ids.indexOf(fluxAssetId(url, baseUrl) ?? "");
      return index >= 0 ? `[Image ${index + 1}]` : whole;
    }),
  );
}

/**
 * Every Flux image in an issue, the description's and then each comment's in
 * order: the numbering `[Image N]` uses everywhere an agent reads the issue.
 */
export function issueImageIds(detail: IssueDetail, baseUrl: string): string[] {
  const ids = imageIds(detail.descriptionMarkdown, baseUrl);
  for (const comment of detail.comments) {
    for (const id of imageIds(comment.markdown, baseUrl)) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * The first `max` of Flux's images in `markdown`, which go with a message as
 * attachments, and the Markdown with them written `[Image N]`. The rest keep
 * their links.
 */
export function attachedImages(
  markdown: string,
  baseUrl: string,
  max = MAX_START_IMAGES,
): { markdown: string; ids: string[] } {
  const ids = imageIds(markdown, baseUrl).slice(0, max);
  return { markdown: numberImages(markdown, ids, baseUrl), ids };
}

/**
 * What the composer is seeded with when starting an agent on an issue: short
 * enough to read and edit, with the rest one command away. The description's
 * images are listed in `imageIds` to attach.
 */
export function startPrompt(
  detail: IssueDetail,
  baseUrl: string,
): { prompt: string; imageIds: string[] } {
  const { issue } = detail;
  const lines = [`Work on Flux issue ${issue.key}: ${issue.title}`];
  let imageIds: string[] = [];
  if (detail.descriptionMarkdown) {
    const description = attachedImages(
      clip(detail.descriptionMarkdown, 6_000),
      baseUrl,
    );
    imageIds = description.ids;
    lines.push("", description.markdown);
  }
  const more = [
    detail.subIssues.length > 0 &&
      `${detail.subIssues.length} sub-issue${detail.subIssues.length === 1 ? "" : "s"}`,
    detail.comments.length > 0 &&
      `${detail.comments.length} comment${detail.comments.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  if (more.length > 0) {
    lines.push(
      "",
      `The issue also has ${more.join(" and ")}; read them with \`swarm flux show ${issue.key}\`.`,
    );
  }
  return { prompt: lines.join("\n"), imageIds };
}

/**
 * Standing instructions for a thread attached to an issue. Values come from
 * thread metadata anyone can write, so only the validated key is interpolated.
 */
export function threadInstructions(issueKey: string): string {
  return [
    `This thread is attached to Flux issue ${issueKey}. Keep that issue current as you work:`,
    `- Read it first: \`swarm flux show ${issueKey}\`.`,
    `- Post a short comment at real milestones (plan settled, change ready, blocked): \`swarm flux comment ${issueKey} --body "..."\`. Mention people with @username, and projects by key (@ABC).`,
    `- When the work is ready for someone to look at, move it to review: \`swarm flux update ${issueKey} --status review\`. Use \`--status complete\` only when nothing is left to check.`,
    "- Don't paste the whole diff into comments; summarize what changed and how you verified it.",
  ].join("\n");
}
