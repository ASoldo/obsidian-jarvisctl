import type {
	JarvisActivitySection,
	JarvisRuntimeFeedEntry,
	JarvisRuntimeSubagentAction,
	JarvisRuntimeSubagentMetadata,
	JarvisSessionMetadata,
} from "../types/domain";

export interface TopologyNodeModel {
	id: string;
	label: string;
	type: "trigger" | "agent" | "processor" | "api" | "analysis" | "resource";
	status: string;
	x: number;
	y: number;
	meta?: string;
}

export interface TopologyEdgeModel {
	id: string;
	from: string;
	to: string;
	tone?: "primary" | "success" | "warning" | "danger" | "muted" | "accent";
}

export interface WorkflowStepModel {
	id: string;
	label: string;
	status: string;
	icon: string;
	detail?: string;
}

export interface RepositoryGroupModel {
	id: string;
	label: string;
	path: string;
	sessions: JarvisSessionMetadata[];
}

export function relativeAge(timestampEpochMs: number): string {
	const elapsedSeconds = Math.max(
		0,
		Math.floor((Date.now() - Number(timestampEpochMs)) / 1000),
	);
	if (elapsedSeconds < 60) {
		return `${elapsedSeconds}s`;
	}
	const elapsedMinutes = Math.floor(elapsedSeconds / 60);
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes}m`;
	}
	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 48) {
		return `${elapsedHours}h`;
	}
	return `${Math.floor(elapsedHours / 24)}d`;
}

export function shortPath(value: string | null | undefined): string {
	if (!value) {
		return "n/a";
	}
	if (value.length <= 48) {
		return value;
	}
	return `...${value.slice(-45)}`;
}

export function truncate(value: string | null | undefined, length = 140): string {
	if (!value) {
		return "";
	}
	if (value.length <= length) {
		return value;
	}
	return `${value.slice(0, Math.max(0, length - 1))}...`;
}

export function formatClock(timestampEpochMs: number | null | undefined): string {
	if (!timestampEpochMs) {
		return "--:--";
	}
	return new Date(timestampEpochMs).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function formatDateTime(timestampEpochMs: number | null | undefined): string {
	if (!timestampEpochMs) {
		return "n/a";
	}
	return new Date(timestampEpochMs).toLocaleString();
}

export function sessionStateLabel(session: JarvisSessionMetadata): string {
	if ((session.context?.thread_status ?? "").length > 0) {
		return session.context?.thread_status ?? "idle";
	}
	if ((session.context?.turn_status ?? "").length > 0) {
		return session.context?.turn_status ?? "idle";
	}
	if (session.agents.some((agent) => agent.running)) {
		return "running";
	}
	return "idle";
}

export function statusTone(value: string | null | undefined): "live" | "warning" | "error" | "idle" | "info" {
	const normalized = (value ?? "").toLowerCase();
	if (
		normalized.includes("error") ||
		normalized.includes("fail") ||
		normalized.includes("panic")
	) {
		return "error";
	}
	if (
		normalized.includes("warning") ||
		normalized.includes("drift") ||
		normalized.includes("queue") ||
		normalized.includes("wait")
	) {
		return "warning";
	}
	if (
		normalized.includes("run") ||
		normalized.includes("progress") ||
		normalized.includes("sync") ||
		normalized.includes("ready") ||
		normalized.includes("healthy") ||
		normalized.includes("completed")
	) {
		return "live";
	}
	if (normalized.includes("info") || normalized.includes("observe")) {
		return "info";
	}
	return "idle";
}

export function sessionTone(session: JarvisSessionMetadata): "live" | "warning" | "error" | "idle" | "info" {
	if (session.context?.last_error) {
		return "error";
	}
	return statusTone(sessionStateLabel(session));
}

export function describeSessionTokens(session: JarvisSessionMetadata): string[] {
	const tokens = [session.backend];
	if (session.context?.launch_mode) {
		tokens.push(session.context.launch_mode);
	}
	tokens.push(sessionStateLabel(session));
	const subagents = session.context?.subagents?.length ?? 0;
	if (subagents > 0) {
		tokens.push(`${subagents} subagents`);
	}
	return tokens;
}

export function buildRepositoryGroups(sessions: JarvisSessionMetadata[]): RepositoryGroupModel[] {
	const groups = new Map<string, RepositoryGroupModel>();
	for (const session of sessions) {
		const path = session.working_directory ?? "/unknown";
		const label = path.split("/").filter(Boolean).pop() ?? "workspace";
		const existing = groups.get(path);
		if (existing) {
			existing.sessions.push(session);
			continue;
		}
		groups.set(path, {
			id: path,
			label,
			path,
			sessions: [session],
		});
	}
	return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function buildTopology(session: JarvisSessionMetadata | null): {
	nodes: TopologyNodeModel[];
	edges: TopologyEdgeModel[];
} {
	if (!session) {
		return { nodes: [], edges: [] };
	}

	const nodes: TopologyNodeModel[] = [
		{
			id: "ticket",
			label: "Trigger",
			type: "trigger",
			status: session.context?.task_note ? "ready" : "idle",
			x: 84,
			y: 70,
			meta: shortPath(session.context?.task_note),
		},
		{
			id: "main",
			label: session.namespace,
			type: "agent",
			status: sessionStateLabel(session),
			x: 292,
			y: 118,
			meta: session.context?.codex_session_id ?? session.agents[0]?.name ?? "agent0",
		},
		{
			id: "events",
			label: "Runtime Feed",
			type: "processor",
			status: (session.context?.recent_events?.length ?? 0) > 0 ? "healthy" : "idle",
			x: 110,
			y: 250,
			meta: `${session.context?.recent_events?.length ?? 0} events`,
		},
		{
			id: "activity",
			label: "Observed Activity",
			type: "analysis",
			status: session.context?.event_log_path ? "healthy" : "idle",
			x: 348,
			y: 258,
			meta: shortPath(session.context?.event_log_path),
		},
		{
			id: "transcript",
			label: "Transcript",
			type: "resource",
			status: session.context?.transcript_path ? "ready" : "idle",
			x: 520,
			y: 170,
			meta: shortPath(session.context?.transcript_path),
		},
	];

	const edges: TopologyEdgeModel[] = [
		{ id: "ticket-main", from: "ticket", to: "main", tone: "primary" },
		{ id: "main-feed", from: "main", to: "events", tone: "success" },
		{ id: "main-observed", from: "main", to: "activity", tone: "accent" },
		{ id: "main-transcript", from: "main", to: "transcript", tone: "warning" },
	];

	for (const [index, subagent] of (session.context?.subagents ?? []).slice(0, 4).entries()) {
		nodes.push({
			id: subagent.thread_id,
			label: `Branch ${index + 1}`,
			type: "agent",
			status: subagent.status,
			x: 522,
			y: 48 + index * 78,
			meta: truncate(subagent.latest_message ?? subagent.prompt_preview, 44),
		});
		edges.push({
			id: `main-${subagent.thread_id}`,
			from: "main",
			to: subagent.thread_id,
			tone: index % 2 === 0 ? "accent" : "primary",
		});
	}

	return { nodes, edges };
}

export function buildWorkflow(session: JarvisSessionMetadata | null): WorkflowStepModel[] {
	if (!session) {
		return [];
	}
	const steps: WorkflowStepModel[] = [
		{
			id: "ticket",
			label: "Load Ticket",
			status: session.context?.task_note ? "synced" : "idle",
			icon: "T",
			detail: shortPath(session.context?.task_note),
		},
		{
			id: "thread",
			label: "Start Thread",
			status: session.context?.thread_status ?? "idle",
			icon: "C",
			detail: session.context?.codex_session_id ?? "pending",
		},
		{
			id: "feed",
			label: "Collect Events",
			status: (session.context?.recent_events?.length ?? 0) > 0 ? "running" : "idle",
			icon: "E",
			detail: `${session.context?.recent_events?.length ?? 0} runtime events`,
		},
	];

	for (const [index, subagent] of (session.context?.subagents ?? []).slice(0, 4).entries()) {
		steps.push({
			id: subagent.thread_id,
			label: `Branch ${index + 1}`,
			status: subagent.status,
			icon: "B",
			detail: truncate(subagent.latest_message ?? subagent.prompt_preview, 72),
		});
	}

	steps.push({
		id: "reasoning",
		label: "Summarize Runtime",
		status: session.context?.last_activity ? "running" : "idle",
		icon: "R",
		detail: truncate(session.context?.last_activity ?? session.context?.live_message, 72),
	});

	return steps;
}

export function reasoningEntries(session: JarvisSessionMetadata | null): JarvisRuntimeFeedEntry[] {
	if (!session) {
		return [];
	}
	return (session.context?.recent_events ?? []).filter((entry) =>
		["assistant", "operator", "subagent"].includes(entry.kind),
	);
}

export function flattenActivityLines(sections: JarvisActivitySection[]): string[] {
	const lines: string[] = [];
	for (const section of sections) {
		if (section.summary) {
			lines.push(`[${section.label}] ${section.summary}`);
		}
		lines.push(...section.lines);
	}
	return lines;
}

export function collectRecentActions(
	subagents: JarvisRuntimeSubagentMetadata[] | null | undefined,
): JarvisRuntimeSubagentAction[] {
	return (subagents ?? [])
		.flatMap((subagent) => subagent.recent_actions ?? [])
		.sort((left, right) => right.timestamp_epoch_ms - left.timestamp_epoch_ms);
}

export function metricsSnapshot(session: JarvisSessionMetadata | null): Record<string, string> {
	return {
		Tokens: `${session?.context?.recent_events?.length ?? 0} events`,
		Latency: session?.context?.turn_status === "inProgress" ? "active" : "steady",
		Branches: `${session?.context?.subagents?.length ?? 0}`,
		Agents: `${session?.agents.length ?? 0}`,
		Thread: session?.context?.thread_status ?? "idle",
		Turn: session?.context?.turn_status ?? "idle",
	};
}

export function applicationSyncStatus(session: JarvisSessionMetadata): string {
	if (session.context?.last_error) {
		return "OutOfSync";
	}
	if ((session.context?.recent_events?.length ?? 0) > 0) {
		return "Synced";
	}
	return "Idle";
}

export function applicationHealthStatus(session: JarvisSessionMetadata): string {
	if (session.context?.last_error) {
		return "Degraded";
	}
	if (session.agents.some((agent) => agent.running)) {
		return "Healthy";
	}
	return "Idle";
}

export function nodeTone(status: string): string {
	const tone = statusTone(status);
	switch (tone) {
		case "live":
			return "emerald";
		case "warning":
			return "amber";
		case "error":
			return "rose";
		case "info":
			return "sky";
		default:
			return "slate";
	}
}
