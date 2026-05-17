export type SurfaceId =
	| "operator"
	| "workflow"
	| "cluster"
	| "controlPlane"
	| "applications"
	| "workers"
	| "snapshot"
	| "feed"
	| "activity"
	| "branches"
	| "agents"
	| "logs"
	| "events"
	| "reasoning"
	| "metrics";

export interface SurfaceTab {
	id: SurfaceId;
	title: string;
	icon: string;
}

export const SURFACE_TABS: SurfaceTab[] = [
	{ id: "operator", title: "Agent Chat", icon: "✎" },
	{ id: "workflow", title: "Execution Steps", icon: "▥" },
	{ id: "cluster", title: "Nodes And Remote Codex", icon: "⌬" },
	{ id: "controlPlane", title: "Policies And Workloads", icon: "⌘" },
	{ id: "applications", title: "Namespaces", icon: "▤" },
	{ id: "workers", title: "Bounded Workers", icon: "⬡" },
	{ id: "snapshot", title: "Session Snapshot", icon: "◇" },
	{ id: "feed", title: "Live Events", icon: "≣" },
	{ id: "activity", title: "Event Log Tail", icon: "◫" },
	{ id: "branches", title: "Branch Runtime", icon: "⑂" },
	{ id: "agents", title: "Agents", icon: "⚙" },
	{ id: "logs", title: "Console Tail", icon: "≡" },
	{ id: "events", title: "Structured Runtime Events", icon: "◈" },
	{ id: "reasoning", title: "Assistant And Branch Thinking", icon: "◍" },
	{ id: "metrics", title: "Runtime Summary", icon: "◉" },
];
