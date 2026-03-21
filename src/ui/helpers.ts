import dagre from "@dagrejs/dagre";
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

interface DagNodeSpec<T> {
	id: string;
	width: number;
	height: number;
	data: T;
}

function layoutDag<T>(
	nodes: DagNodeSpec<T>[],
	edges: Array<{ from: string; to: string }>,
	options?: {
		rankdir?: "LR" | "TB";
		nodesep?: number;
		ranksep?: number;
		marginx?: number;
		marginy?: number;
	},
): Array<T & { x: number; y: number }> {
	const graph = new dagre.graphlib.Graph();
	graph.setGraph({
		rankdir: options?.rankdir ?? "LR",
		nodesep: options?.nodesep ?? 56,
		ranksep: options?.ranksep ?? 120,
		marginx: options?.marginx ?? 48,
		marginy: options?.marginy ?? 48,
		ranker: "tight-tree",
	});
	graph.setDefaultEdgeLabel(() => ({}));

	for (const node of nodes) {
		graph.setNode(node.id, { width: node.width, height: node.height });
	}

	for (const edge of edges) {
		graph.setEdge(edge.from, edge.to);
	}

	dagre.layout(graph);

	return nodes.map((node) => {
		const layoutNode = graph.node(node.id);
		return {
			...node.data,
			x: Math.round(layoutNode.x - node.width / 2),
			y: Math.round(layoutNode.y - node.height / 2),
		};
	});
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

export function compactId(value: string | null | undefined, head = 8, tail = 4): string {
	if (!value) {
		return "n/a";
	}
	if (value.length <= head + tail + 1) {
		return value;
	}
	return `${value.slice(0, head)}...${value.slice(-tail)}`;
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

export function centeredLanePositions(count: number, center: number, gap: number): number[] {
	if (count <= 1) {
		return [center];
	}
	const start = center - ((count - 1) * gap) / 2;
	return Array.from({ length: count }, (_, index) => Math.round(start + index * gap));
}

export function sessionStateLabel(session: JarvisSessionMetadata): string {
	const threadStatus = session.context?.thread_status ?? "";
	const turnStatus = session.context?.turn_status ?? "";
	if (threadStatus.length > 0 && threadStatus.toLowerCase() !== "idle") {
		return threadStatus;
	}
	if (turnStatus.length > 0 && turnStatus.toLowerCase() !== "idle") {
		return turnStatus;
	}
	if (threadStatus.length > 0) {
		return threadStatus;
	}
	if (turnStatus.length > 0) {
		return turnStatus;
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
	if (session.context?.control_namespace) {
		tokens.push(`ns:${session.context.control_namespace}`);
	}
	if (session.context?.deployment) {
		tokens.push(`deploy:${session.context.deployment}`);
	}
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

	const subagents = (session.context?.subagents ?? []).slice(0, 4);
	const eventCount = session.context?.recent_events?.length ?? 0;
	const edges: TopologyEdgeModel[] = [
		{ id: "ticket-main", from: "ticket", to: "main", tone: "primary" },
		{ id: "main-feed", from: "main", to: "events", tone: "success" },
		{ id: "feed-activity", from: "events", to: "activity", tone: "primary" },
		{ id: "activity-transcript", from: "activity", to: "transcript", tone: "warning" },
	];

	const nodeSpecs: DagNodeSpec<TopologyNodeModel>[] = [
		{
			id: "ticket",
			width: TOPOLOGY_NODE_WIDTH,
			height: TOPOLOGY_NODE_HEIGHT,
			data: {
				id: "ticket",
				label: "Trigger",
				type: "trigger",
				status: session.context?.task_note ? "ready" : "idle",
				x: 0,
				y: 0,
				meta: "execution contract",
			},
		},
		{
			id: "main",
			width: TOPOLOGY_NODE_WIDTH,
			height: TOPOLOGY_NODE_HEIGHT,
			data: {
				id: "main",
				label: session.namespace,
				type: "agent",
				status: sessionStateLabel(session),
				x: 0,
				y: 0,
				meta: `${compactId(session.context?.codex_session_id, 8, 4)} · ${sessionStateLabel(session)}`,
			},
		},
		{
			id: "events",
			width: TOPOLOGY_NODE_WIDTH,
			height: TOPOLOGY_NODE_HEIGHT,
			data: {
				id: "events",
				label: "Runtime Feed",
				type: "processor",
				status: eventCount > 0 ? "healthy" : "idle",
				x: 0,
				y: 0,
				meta: `${eventCount} recent events`,
			},
		},
		{
			id: "activity",
			width: TOPOLOGY_NODE_WIDTH,
			height: TOPOLOGY_NODE_HEIGHT,
			data: {
				id: "activity",
				label: "Observed Activity",
				type: "analysis",
				status: session.context?.event_log_path ? "healthy" : "idle",
				x: 0,
				y: 0,
				meta: session.context?.event_log_path ? "event log tail" : "awaiting event log",
			},
		},
		{
			id: "transcript",
			width: TOPOLOGY_NODE_WIDTH,
			height: TOPOLOGY_NODE_HEIGHT,
			data: {
				id: "transcript",
				label: "Transcript",
				type: "resource",
				status: session.context?.transcript_path ? "ready" : "idle",
				x: 0,
				y: 0,
				meta: session.context?.transcript_path ? "jsonl export" : "not exported",
			},
		},
	];

	for (const [index, subagent] of subagents.entries()) {
		nodeSpecs.push({
			id: subagent.thread_id,
			width: TOPOLOGY_NODE_WIDTH,
			height: TOPOLOGY_NODE_HEIGHT,
			data: {
				id: subagent.thread_id,
				label: `Branch ${index + 1}`,
				type: "agent",
				status: subagent.status,
				x: 0,
				y: 0,
				meta: `${subagent.tool} · ${compactId(subagent.thread_id, 6, 4)}`,
			},
		});
		edges.push({
			id: `main-${subagent.thread_id}`,
			from: "main",
			to: subagent.thread_id,
			tone: index % 2 === 0 ? "accent" : "primary",
		});
		edges.push({
			id: `${subagent.thread_id}-activity`,
			from: subagent.thread_id,
			to: "activity",
			tone: index % 2 === 0 ? "success" : "muted",
		});
	}

	if (subagents.length === 0) {
		nodeSpecs.push({
			id: "branches",
			width: TOPOLOGY_NODE_WIDTH,
			height: TOPOLOGY_NODE_HEIGHT,
			data: {
				id: "branches",
				label: "Branch Queue",
				type: "agent",
				status: "idle",
				x: 0,
				y: 0,
				meta: "no spawned subagents",
			},
		});
		edges.push({
			id: "main-branches",
			from: "main",
			to: "branches",
			tone: "muted",
		});
		edges.push({
			id: "branches-activity",
			from: "branches",
			to: "activity",
			tone: "muted",
		});
	}

	const nodes = layoutDag(nodeSpecs, edges, {
		rankdir: "LR",
		nodesep: 34,
		ranksep: 84,
		marginx: 28,
		marginy: 36,
	});

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
			detail: session.context?.task_note ?? "execution contract unavailable",
		},
		{
			id: "thread",
			label: "Start Thread",
			status: session.context?.thread_status ?? "idle",
			icon: "C",
			detail: session.context?.codex_session_id ?? "thread not started",
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
			detail: `${subagent.tool} · ${subagent.latest_message ?? subagent.prompt_preview ?? "awaiting branch detail"}`,
		});
	}

	steps.push({
		id: "reasoning",
		label: "Summarize Runtime",
		status: session.context?.last_activity ? "running" : "idle",
		icon: "R",
		detail: session.context?.last_activity ?? session.context?.live_message ?? "awaiting runtime summary",
	});

	return steps;
}

export interface WorkflowLayoutNode extends WorkflowStepModel {
	x: number;
	y: number;
}

export const TOPOLOGY_NODE_WIDTH = 204;
export const TOPOLOGY_NODE_HEIGHT = 74;
export const WORKFLOW_NODE_WIDTH = 208;
export const WORKFLOW_NODE_HEIGHT = 74;

export function buildWorkflowLayout(session: JarvisSessionMetadata | null): WorkflowLayoutNode[] {
	const steps = buildWorkflow(session);
	if (steps.length === 0) {
		return [];
	}

	const edges: Array<{ from: string; to: string }> = [
		{ from: "ticket", to: "thread" },
		{ from: "thread", to: "feed" },
		{ from: "feed", to: "reasoning" },
	];

	for (const step of steps) {
		if (!["ticket", "thread", "feed", "reasoning"].includes(step.id)) {
			edges.push({ from: "thread", to: step.id });
			edges.push({ from: step.id, to: "reasoning" });
		}
	}

	const nodeSpecs = steps.map((step) => ({
		id: step.id,
		width: WORKFLOW_NODE_WIDTH,
		height: WORKFLOW_NODE_HEIGHT,
		data: {
			...step,
			x: 0,
			y: 0,
		},
	}));

	return layoutDag(nodeSpecs, edges, {
		rankdir: "LR",
		nodesep: 28,
		ranksep: 86,
		marginx: 28,
		marginy: 36,
	});
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
