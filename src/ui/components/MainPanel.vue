<script setup lang="ts">
import { computed, ref } from "vue";
import type {
	JarvisActivitySection,
	JarvisControlPlaneState,
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
import ControlPlanePanel from "./ControlPlanePanel.vue";
import ObservabilitySection from "./ObservabilitySection.vue";
import OperatorConsole from "./OperatorConsole.vue";
import RuntimeTab from "./RuntimeTab.vue";
import StatusBadge from "./StatusBadge.vue";
import SurfaceCard from "./SurfaceCard.vue";
import TopologyTab from "./TopologyTab.vue";
import WorkersPanel from "./WorkersPanel.vue";
import WorkflowPanel from "./WorkflowPanel.vue";

const props = defineProps<{
	host: JarvisDashboardHost;
	session: JarvisSessionMetadata | null;
	sessions: JarvisSessionMetadata[];
	workers: JarvisWorkerMetadata[];
	selectedWorker: JarvisWorkerMetadata | null;
	selectedWorkerKey: string | null;
	controlPlane: JarvisControlPlaneState | null;
	activitySections: JarvisActivitySection[];
}>();

defineEmits<{
	(event: "select-worker", value: string): void;
}>();

const collapsedSections = ref<Record<string, boolean>>({
	operator: false,
	topology: false,
	workflow: false,
	controlPlane: false,
	applications: false,
	workers: false,
	snapshot: false,
	feed: false,
	activity: false,
	branches: false,
	agents: false,
	logs: false,
	events: false,
	reasoning: false,
	metrics: false,
});

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

function toggleSection(id: keyof typeof collapsedSections.value): void {
	collapsedSections.value[id] = !collapsedSections.value[id];
}
</script>

<template>
	<section class="cp-panel cp-main-panel">
		<div class="cp-panel__header cp-main-panel__header">
			<div class="cp-panel__header-caption">
				<p class="cp-panel__eyebrow">Main System Surface</p>
			</div>

			<div class="cp-main-panel__summary">
				<span class="cp-chip">Tokens: {{ metrics.Tokens }}</span>
				<span class="cp-chip">Latency: {{ metrics.Latency }}</span>
				<span v-if="activeWorkflowStep" class="cp-chip">Step: {{ activeWorkflowStep.label }}</span>
				<StatusBadge
					v-if="session"
					:label="sessionStateLabel(session)"
					:tone="sessionTone(session)"
					compact
				/>
			</div>
		</div>

		<div class="cp-panel__body cp-main-panel__body">
			<div class="cp-main-surface-stack">
			<SurfaceCard
				eyebrow="Operator Console"
				title="Agent Chat"
				icon="✎"
				:meta="[
					session ? `${session.agents.length} agents` : 'no namespace',
					session ? `${session.context?.subagents?.length ?? 0} subagents` : '0 subagents',
				]"
				:status-label="session ? sessionStateLabel(session) : 'idle'"
				:status-tone="session ? sessionTone(session) : 'idle'"
				:collapsed="collapsedSections.operator"
				@toggle="toggleSection('operator')"
			>
				<OperatorConsole :host="host" :session="session" />
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Cluster Topology"
				title="Namespace Graph"
				icon="◎"
				:meta="[
					session ? session.namespace : 'select namespace',
					session ? `${session.context?.subagents?.length ?? 0} branches` : '0 branches',
				]"
				:status-label="session ? sessionStateLabel(session) : 'idle'"
				:status-tone="session ? sessionTone(session) : 'idle'"
				:collapsed="collapsedSections.topology"
				@toggle="toggleSection('topology')"
			>
				<TopologyTab :session="session" />
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Automation Workflow"
				title="Execution Graph"
				icon="⑇"
				:meta="[
					activeWorkflowStep ? `focus ${activeWorkflowStep.label}` : 'awaiting runtime',
					`${workflowSteps.length} nodes`,
				]"
				:status-label="session ? sessionStateLabel(session) : 'idle'"
				:status-tone="session ? sessionTone(session) : 'idle'"
				:collapsed="collapsedSections.workflow"
				@toggle="toggleSection('workflow')"
			>
				<WorkflowPanel :session="session" embedded />
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Control Plane"
				title="Policies And Workloads"
				icon="⌘"
				:meta="[
					controlPlane ? `${controlPlane.resources.length} resources` : 'no control namespace',
					selectedWorker?.namespace ?? session?.context?.control_namespace ?? 'n/a',
				]"
				:status-label="controlPlane ? 'tracked' : 'idle'"
				:status-tone="controlPlane ? 'info' : 'idle'"
				:collapsed="collapsedSections.controlPlane"
				@toggle="toggleSection('controlPlane')"
			>
				<ControlPlanePanel
					:session="session"
					:control-plane="controlPlane"
					:workers="workers"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Application Matrix"
				title="Namespaces"
				icon="▤"
				:meta="[`${sessions.length} listed`, 'action grid']"
				status-label="ready"
				status-tone="info"
				:collapsed="collapsedSections.applications"
				@toggle="toggleSection('applications')"
			>
				<ApplicationsTab :host="host" :sessions="sessions" />
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Worker Pool"
				title="Bounded Workers"
				icon="⬡"
				:meta="[
					selectedWorker ? `${selectedWorker.namespace}/${selectedWorker.name}` : `${workers.length} registered`,
					activeWorkerCount ? `${activeWorkerCount} loaded` : 'cold pool',
				]"
				:status-label="selectedWorker ? workerStatusLabel(selectedWorker) : (activeWorkerCount ? 'loaded' : (workers[0] ? workerStatusLabel(workers[0]) : 'idle'))"
				:status-tone="selectedWorker ? statusTone(workerStatusLabel(selectedWorker)) : (activeWorkerCount ? 'live' : (workers[0] ? statusTone(workerStatusLabel(workers[0])) : 'idle'))"
				:collapsed="collapsedSections.workers"
				@toggle="toggleSection('workers')"
			>
				<WorkersPanel
					:workers="workers"
					:selected-worker-key="selectedWorkerKey"
					@select-worker="$emit('select-worker', $event)"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Runtime Contract"
				title="Session Snapshot"
				icon="◇"
				:meta="[
					session?.backend ?? 'n/a',
					session?.context?.launch_mode ?? 'launch n/a',
				]"
				:status-label="session ? session.context?.turn_status ?? 'idle' : 'idle'"
				:status-tone="session ? statusTone(session.context?.turn_status) : 'idle'"
				:collapsed="collapsedSections.snapshot"
				@toggle="toggleSection('snapshot')"
			>
				<RuntimeTab
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="snapshot"
					embedded
					:show-toolbar="false"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Runtime Feed"
				title="Live Events"
				icon="≣"
				:meta="[`${session?.context?.recent_events?.length ?? 0} events`, session?.context?.last_activity ?? 'idle']"
				:status-label="session ? session.context?.turn_status ?? 'idle' : 'idle'"
				:status-tone="session ? sessionTone(session) : 'idle'"
				:collapsed="collapsedSections.feed"
				@toggle="toggleSection('feed')"
			>
				<RuntimeTab
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="feed"
					embedded
					:show-toolbar="false"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Observed Activity"
				title="Event Log Tail"
				icon="◫"
				:meta="[`${activitySections.length} sections`, session?.context?.event_log_path ? 'live tail' : 'no log']"
				:status-label="session?.context?.event_log_path ? 'healthy' : 'idle'"
				:status-tone="session?.context?.event_log_path ? 'live' : 'idle'"
				:collapsed="collapsedSections.activity"
				@toggle="toggleSection('activity')"
			>
				<RuntimeTab
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="activity"
					embedded
					:show-toolbar="false"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Subagent Branches"
				title="Branch Runtime"
				icon="⑂"
				:meta="[`${session?.context?.subagents?.length ?? 0} tracked`, activeWorkflowStep?.label ?? 'runtime']"
				:status-label="session?.context?.subagents?.length ? 'tracking' : 'idle'"
				:status-tone="session?.context?.subagents?.length ? 'live' : 'idle'"
				:collapsed="collapsedSections.branches"
				@toggle="toggleSection('branches')"
			>
				<RuntimeTab
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="branches"
					embedded
					:show-toolbar="false"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Execution Controls"
				title="Agents"
				icon="⚙"
				:meta="[`${session?.agents.length ?? 0} total`, session?.backend ?? 'n/a']"
				:status-label="session ? sessionStateLabel(session) : 'idle'"
				:status-tone="session ? sessionTone(session) : 'idle'"
				:collapsed="collapsedSections.agents"
				@toggle="toggleSection('agents')"
			>
				<RuntimeTab
					:host="host"
					:session="session"
					:activity-sections="activitySections"
					section="agents"
					embedded
					:show-toolbar="false"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Logs"
				title="Console Tail"
				icon="≡"
				:meta="['last 40 lines', session?.context?.event_log_path ? 'event sourced' : 'waiting']"
				:status-label="session?.context?.event_log_path ? 'streaming' : 'idle'"
				:status-tone="session?.context?.event_log_path ? 'info' : 'idle'"
				:collapsed="collapsedSections.logs"
				@toggle="toggleSection('logs')"
			>
				<ObservabilitySection
					:session="session"
					:activity-sections="activitySections"
					section="logs"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Events"
				title="Structured Runtime Events"
				icon="◈"
				:meta="[`${session?.context?.recent_events?.length ?? 0} tracked`, 'runtime feed']"
				:status-label="session?.context?.recent_events?.length ? 'ready' : 'idle'"
				:status-tone="session?.context?.recent_events?.length ? 'info' : 'idle'"
				:collapsed="collapsedSections.events"
				@toggle="toggleSection('events')"
			>
				<ObservabilitySection
					:session="session"
					:activity-sections="activitySections"
					section="events"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="AI Reasoning"
				title="Assistant And Branch Thinking"
				icon="◍"
				:meta="[`${session?.context?.subagents?.length ?? 0} branch lanes`, session?.context?.live_message ?? 'runtime summary']"
				:status-label="activeWorkflowStep?.status ?? 'idle'"
				:status-tone="statusTone(activeWorkflowStep?.status)"
				:collapsed="collapsedSections.reasoning"
				@toggle="toggleSection('reasoning')"
			>
				<ObservabilitySection
					:session="session"
					:activity-sections="activitySections"
					section="reasoning"
				/>
			</SurfaceCard>

			<SurfaceCard
				eyebrow="Metrics"
				title="Runtime Summary"
				icon="◉"
				:meta="[metrics.Thread, metrics.Turn]"
				:status-label="session ? sessionStateLabel(session) : 'idle'"
				:status-tone="session ? sessionTone(session) : 'idle'"
				:collapsed="collapsedSections.metrics"
				@toggle="toggleSection('metrics')"
			>
				<ObservabilitySection
					:session="session"
					:activity-sections="activitySections"
					section="metrics"
				/>
			</SurfaceCard>
			</div>
		</div>
	</section>
</template>
