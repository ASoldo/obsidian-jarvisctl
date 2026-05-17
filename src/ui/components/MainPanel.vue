<script setup lang="ts">
import { computed, ref } from "vue";
import type {
	JarvisActivitySection,
	JarvisControlPlaneState,
	JarvisClusterState,
	JarvisSessionMetadata,
	JarvisWorkerMetadata,
} from "../../types/domain";
import type { JarvisDashboardHost } from "../bridge";
import {
	buildWorkflow,
	metricsSnapshot,
	sessionTone,
	sessionStateLabel,
	statusTone,
	workerStatusLabel,
} from "../helpers";
import ApplicationsTab from "./ApplicationsTab.vue";
import ClusterOpsPanel from "./ClusterOpsPanel.vue";
import ControlPlanePanel from "./ControlPlanePanel.vue";
import ObservabilitySection from "./ObservabilitySection.vue";
import OperatorConsole from "./OperatorConsole.vue";
import RuntimeTab from "./RuntimeTab.vue";
import SurfaceCard from "./SurfaceCard.vue";
import WorkersPanel from "./WorkersPanel.vue";
import WorkflowPanel from "./WorkflowPanel.vue";

type SurfaceId =
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

interface SurfaceModel {
	id: SurfaceId;
	eyebrow: string;
	title: string;
	icon: string;
	meta: string[];
	statusLabel: string;
	statusTone: "live" | "warning" | "error" | "idle" | "info";
}

const props = defineProps<{
	host: JarvisDashboardHost;
	session: JarvisSessionMetadata | null;
	sessions: JarvisSessionMetadata[];
	workers: JarvisWorkerMetadata[];
	selectedWorker: JarvisWorkerMetadata | null;
	selectedWorkerKey: string | null;
	controlPlane: JarvisControlPlaneState | null;
	cluster: JarvisClusterState;
	activitySections: JarvisActivitySection[];
}>();

const emit = defineEmits<{
	(event: "select-worker", value: string): void;
}>();

const activeSurface = ref<SurfaceId>("operator");
const metrics = computed(() => metricsSnapshot(props.session));
const workflowSteps = computed(() => buildWorkflow(props.session));
const activeWorkerCount = computed(() => props.workers.filter((worker) => worker.loaded).length);
const activeWorkflowStep = computed(
	() =>
		workflowSteps.value.find((step) => {
			const tone = statusTone(step.status);
			return tone === "live" || tone === "warning" || tone === "error";
		}) ??
		workflowSteps.value[0] ??
		null,
);

const surfaces = computed<SurfaceModel[]>(() => [
	{
		id: "operator",
		eyebrow: "Operator Console",
		title: "Agent Chat",
		icon: "✎",
		meta: [
			props.session ? `${props.session.agents.length} agents` : "no namespace",
			props.session ? `${props.session.context?.subagents?.length ?? 0} subagents` : "0 subagents",
		],
		statusLabel: props.session ? sessionStateLabel(props.session) : "idle",
		statusTone: props.session ? sessionTone(props.session) : "idle",
	},
	{
		id: "workflow",
		eyebrow: "Automation Workflow",
		title: "Execution Steps",
		icon: "⑇",
		meta: [
			activeWorkflowStep.value ? `focus ${activeWorkflowStep.value.label}` : "awaiting runtime",
			`${workflowSteps.value.length} steps`,
		],
		statusLabel: props.session ? sessionStateLabel(props.session) : "idle",
		statusTone: props.session ? sessionTone(props.session) : "idle",
	},
	{
		id: "cluster",
		eyebrow: "Cluster Ops",
		title: "Nodes And Remote Codex",
		icon: "⌬",
		meta: [`${props.cluster.nodes.length} nodes`, `${props.cluster.index.visits.length} visits`],
		statusLabel: props.cluster.gpg.ok ? "secure" : "check gpg",
		statusTone: props.cluster.gpg.ok ? "live" : "warning",
	},
	{
		id: "controlPlane",
		eyebrow: "Control Plane",
		title: "Policies And Workloads",
		icon: "⌘",
		meta: [
			props.controlPlane ? `${props.controlPlane.resources.length} resources` : "no control namespace",
			props.selectedWorker?.namespace ?? props.session?.context?.control_namespace ?? "n/a",
		],
		statusLabel: props.controlPlane ? "tracked" : "idle",
		statusTone: props.controlPlane ? "info" : "idle",
	},
	{
		id: "applications",
		eyebrow: "Application Matrix",
		title: "Namespaces",
		icon: "▤",
		meta: [`${props.sessions.length} listed`, "action grid"],
		statusLabel: "ready",
		statusTone: "info",
	},
	{
		id: "workers",
		eyebrow: "Worker Pool",
		title: "Bounded Workers",
		icon: "⬡",
		meta: [
			props.selectedWorker ? `${props.selectedWorker.namespace}/${props.selectedWorker.name}` : `${props.workers.length} registered`,
			activeWorkerCount.value ? `${activeWorkerCount.value} loaded` : "cold pool",
		],
		statusLabel: props.selectedWorker
			? workerStatusLabel(props.selectedWorker)
			: activeWorkerCount.value
				? "loaded"
				: props.workers[0]
					? workerStatusLabel(props.workers[0])
					: "idle",
		statusTone: props.selectedWorker
			? statusTone(workerStatusLabel(props.selectedWorker))
			: activeWorkerCount.value
				? "live"
				: props.workers[0]
					? statusTone(workerStatusLabel(props.workers[0]))
					: "idle",
	},
	{
		id: "snapshot",
		eyebrow: "Runtime Contract",
		title: "Session Snapshot",
		icon: "◇",
		meta: [props.session?.backend ?? "n/a", props.session?.context?.launch_mode ?? "launch n/a"],
		statusLabel: props.session ? props.session.context?.turn_status ?? "idle" : "idle",
		statusTone: props.session ? statusTone(props.session.context?.turn_status) : "idle",
	},
	{
		id: "feed",
		eyebrow: "Runtime Feed",
		title: "Live Events",
		icon: "≣",
		meta: [`${props.session?.context?.recent_events?.length ?? 0} events`, props.session?.context?.last_activity ?? "idle"],
		statusLabel: props.session ? props.session.context?.turn_status ?? "idle" : "idle",
		statusTone: props.session ? sessionTone(props.session) : "idle",
	},
	{
		id: "activity",
		eyebrow: "Observed Activity",
		title: "Event Log Tail",
		icon: "◫",
		meta: [`${props.activitySections.length} sections`, props.session?.context?.event_log_path ? "live tail" : "no log"],
		statusLabel: props.session?.context?.event_log_path ? "healthy" : "idle",
		statusTone: props.session?.context?.event_log_path ? "live" : "idle",
	},
	{
		id: "branches",
		eyebrow: "Subagent Branches",
		title: "Branch Runtime",
		icon: "⑂",
		meta: [`${props.session?.context?.subagents?.length ?? 0} tracked`, activeWorkflowStep.value?.label ?? "runtime"],
		statusLabel: props.session?.context?.subagents?.length ? "tracking" : "idle",
		statusTone: props.session?.context?.subagents?.length ? "live" : "idle",
	},
	{
		id: "agents",
		eyebrow: "Execution Controls",
		title: "Agents",
		icon: "⚙",
		meta: [`${props.session?.agents.length ?? 0} total`, props.session?.backend ?? "n/a"],
		statusLabel: props.session ? sessionStateLabel(props.session) : "idle",
		statusTone: props.session ? sessionTone(props.session) : "idle",
	},
	{
		id: "logs",
		eyebrow: "Logs",
		title: "Console Tail",
		icon: "≡",
		meta: ["last 40 lines", props.session?.context?.event_log_path ? "event sourced" : "waiting"],
		statusLabel: props.session?.context?.event_log_path ? "streaming" : "idle",
		statusTone: props.session?.context?.event_log_path ? "info" : "idle",
	},
	{
		id: "events",
		eyebrow: "Events",
		title: "Structured Runtime Events",
		icon: "◈",
		meta: [`${props.session?.context?.recent_events?.length ?? 0} tracked`, "runtime feed"],
		statusLabel: props.session?.context?.recent_events?.length ? "ready" : "idle",
		statusTone: props.session?.context?.recent_events?.length ? "info" : "idle",
	},
	{
		id: "reasoning",
		eyebrow: "AI Reasoning",
		title: "Assistant And Branch Thinking",
		icon: "◍",
		meta: [`${props.session?.context?.subagents?.length ?? 0} branch lanes`, props.session?.context?.live_message ?? "runtime summary"],
		statusLabel: activeWorkflowStep.value?.status ?? "idle",
		statusTone: statusTone(activeWorkflowStep.value?.status),
	},
	{
		id: "metrics",
		eyebrow: "Metrics",
		title: "Runtime Summary",
		icon: "◉",
		meta: [metrics.value.Thread, metrics.value.Turn],
		statusLabel: props.session ? sessionStateLabel(props.session) : "idle",
		statusTone: props.session ? sessionTone(props.session) : "idle",
	},
]);

const activeSurfaceModel = computed(
	() => surfaces.value.find((surface) => surface.id === activeSurface.value) ?? surfaces.value[0],
);
</script>

<template>
	<section class="cp-panel cp-main-panel">
		<div class="cp-panel__header cp-main-panel__header cp-main-panel__header--tabs">
			<div class="cp-main-surface-tabs" role="tablist" aria-label="Main system surfaces">
				<button
					v-for="surface in surfaces"
					:key="surface.id"
					type="button"
					:class="['cp-main-surface-tab', activeSurface === surface.id && 'is-active']"
					:title="surface.title"
					role="tab"
					:aria-selected="activeSurface === surface.id"
					@click="activeSurface = surface.id"
				>
					<span class="cp-button__icon" aria-hidden="true">{{ surface.icon }}</span>
					<span class="cp-main-surface-tab__label">{{ surface.title }}</span>
				</button>
			</div>

			<div class="cp-main-panel__summary">
				<span class="cp-chip">Tokens: {{ metrics.Tokens }}</span>
				<span class="cp-chip">Latency: {{ metrics.Latency }}</span>
				<span v-if="activeWorkflowStep" class="cp-chip">Step: {{ activeWorkflowStep.label }}</span>
			</div>
		</div>

		<div class="cp-panel__body cp-main-panel__body">
			<SurfaceCard
				v-if="activeSurfaceModel"
				:eyebrow="activeSurfaceModel.eyebrow"
				:title="activeSurfaceModel.title"
				:icon="activeSurfaceModel.icon"
				:meta="activeSurfaceModel.meta"
				:status-label="activeSurfaceModel.statusLabel"
				:status-tone="activeSurfaceModel.statusTone"
				:toggleable="false"
			>
				<OperatorConsole v-if="activeSurface === 'operator'" :host="host" :session="session" />
				<WorkflowPanel v-else-if="activeSurface === 'workflow'" :session="session" embedded />
				<ClusterOpsPanel v-else-if="activeSurface === 'cluster'" :host="host" :cluster="cluster" />
				<ControlPlanePanel
					v-else-if="activeSurface === 'controlPlane'"
					:host="host"
					:session="session"
					:sessions="sessions"
					:control-plane="controlPlane"
					:workers="workers"
				/>
				<ApplicationsTab v-else-if="activeSurface === 'applications'" :host="host" :sessions="sessions" />
				<WorkersPanel
					v-else-if="activeSurface === 'workers'"
					:workers="workers"
					:selected-worker-key="selectedWorkerKey"
					@select-worker="emit('select-worker', $event)"
				/>
				<RuntimeTab
					v-else-if="activeSurface === 'snapshot'"
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="snapshot"
					embedded
					:show-toolbar="false"
				/>
				<RuntimeTab
					v-else-if="activeSurface === 'feed'"
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="feed"
					embedded
					:show-toolbar="false"
				/>
				<RuntimeTab
					v-else-if="activeSurface === 'activity'"
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="activity"
					embedded
					:show-toolbar="false"
				/>
				<RuntimeTab
					v-else-if="activeSurface === 'branches'"
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="branches"
					embedded
					:show-toolbar="false"
				/>
				<RuntimeTab
					v-else-if="activeSurface === 'agents'"
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="agents"
					embedded
					:show-toolbar="false"
				/>
				<ObservabilitySection
					v-else-if="activeSurface === 'logs'"
					:session="session"
					:activity-sections="activitySections"
					section="logs"
				/>
				<ObservabilitySection
					v-else-if="activeSurface === 'events'"
					:session="session"
					:activity-sections="activitySections"
					section="events"
				/>
				<ObservabilitySection
					v-else-if="activeSurface === 'reasoning'"
					:session="session"
					:activity-sections="activitySections"
					section="reasoning"
				/>
				<ObservabilitySection
					v-else
					:session="session"
					:activity-sections="activitySections"
					section="metrics"
				/>
			</SurfaceCard>
		</div>
	</section>
</template>
