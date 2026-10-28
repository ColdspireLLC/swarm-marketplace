// Flux vocabulary shared by the server, CLI, and app. Pure data: no Node or
// React imports, so both bundles can use it.

export const STATUSES = [
  "backlog",
  "todo",
  "progress",
  "review",
  "complete",
  "canceled",
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  backlog: "Backlog",
  todo: "Todo",
  progress: "In Progress",
  review: "In Review",
  complete: "Complete",
  canceled: "Canceled",
};

/** Statuses that count as finished work. */
export const CLOSED_STATUSES: ReadonlySet<Status> = new Set([
  "complete",
  "canceled",
]);

/** The order Flux shows status groups in, most active first. */
export const STATUS_DISPLAY_ORDER: readonly Status[] = [
  "review",
  "progress",
  "todo",
  "backlog",
  "complete",
  "canceled",
];

export const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

export const PRIORITY_LEVEL: Record<Priority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

export const COLORS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;
export type ColorName = (typeof COLORS)[number];

/**
 * Words people and agents use for each status, so `--status done` or
 * `in_review` land where they mean.
 */
const STATUS_ALIASES: Record<string, Status> = {
  backlog: "backlog",
  todo: "todo",
  "to-do": "todo",
  open: "todo",
  progress: "progress",
  "in-progress": "progress",
  in_progress: "progress",
  inprogress: "progress",
  started: "progress",
  doing: "progress",
  review: "review",
  "in-review": "review",
  in_review: "review",
  inreview: "review",
  complete: "complete",
  completed: "complete",
  done: "complete",
  closed: "complete",
  canceled: "canceled",
  cancelled: "canceled",
  "won't-do": "canceled",
  wontfix: "canceled",
};

export function parseStatus(value: string): Status | null {
  return (
    STATUS_ALIASES[value.trim().toLowerCase().replace(/\s+/g, "-")] ?? null
  );
}

export function parsePriority(value: string): Priority | null {
  const normalized = value.trim().toLowerCase();
  if ((PRIORITIES as readonly string[]).includes(normalized)) {
    return normalized as Priority;
  }
  if (normalized === "no-priority" || normalized === "0") return "none";
  const byLevel = PRIORITIES.find(
    (priority) => String(PRIORITY_LEVEL[priority]) === normalized,
  );
  return byLevel ?? null;
}

/** `ABC-12` style identifier; Flux keys are 2-5 letters. */
export const ISSUE_KEY_PATTERN = /\b([A-Za-z]{2,5})-(\d{1,7})\b/;

export function parseIssueKey(
  value: string,
): { projectKey: string; number: number } | null {
  const match = /^\s*([A-Za-z]{2,5})-(\d{1,7})\s*$/.exec(value);
  if (!match) return null;
  return { projectKey: match[1]!.toUpperCase(), number: Number(match[2]) };
}
