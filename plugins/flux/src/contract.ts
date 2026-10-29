// The shapes the port works in, as bb's plugin had them (its
// src/shared/contract.ts), less what Swarm has no use for.
import type { CommentAgent } from "./agent";
import type { ColorName, Priority, Status } from "./flux";

export interface Member {
	id: string;
	name: string;
	username: string;
	email: string;
	avatarUrl: string | null;
	avatarColor: ColorName;
}

export interface Project {
	id: string;
	key: string;
	name: string;
	emoji: string | null;
	icon: string | null;
	color: ColorName;
	position: number;
	/** The Swarm project agents start in for this Flux project, if linked. */
	swarmProjectId: string | null;
}

export interface Label {
	id: string;
	name: string;
	color: ColorName;
}

export interface Issue {
	id: string;
	key: string;
	number: number;
	projectId: string;
	title: string;
	status: Status;
	priority: Priority;
	assigneeIds: string[];
	labelIds: string[];
	subscriberIds: string[];
	creatorId: string | null;
	parentId: string | null;
	dueDate: string | null;
	position: number;
	createdAt: string;
	updatedAt: string;
	/** Swarm's threads attached to it. */
	threadIds: string[];
	subIssueCount: number;
	subIssueDoneCount: number;
}

export interface Comment {
	id: string;
	authorId: string | null;
	markdown: string;
	html: string;
	agent: CommentAgent | null;
	createdAt: string;
	updatedAt: string;
}

export interface IssueDetail {
	issue: Issue;
	url: string;
	descriptionMarkdown: string;
	descriptionHtml: string;
	comments: Comment[];
	parent: Issue | null;
	subIssues: Issue[];
}

export interface IssuePatch {
	title?: string;
	status?: Status;
	priority?: Priority;
	assigneeIds?: string[];
	labelIds?: string[];
	dueDate?: string | null;
	parentId?: string | null;
	projectId?: string;
	position?: number;
	/** A member who follows the issue from now on, as a commenter does. */
	subscribe?: string;
}
