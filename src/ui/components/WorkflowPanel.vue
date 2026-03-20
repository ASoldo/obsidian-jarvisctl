<script setup lang="ts">
import { computed, markRaw, ref, watch } from "vue";
import { VueFlow, Position, type Edge, type Node } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import type { JarvisSessionMetadata } from "../../types/domain";
import {
	buildWorkflow,
	buildWorkflowLayout,
	shortPath,
	statusTone,
	truncate,
	type WorkflowStepModel,
} from "../helpers";
import StatusBadge from "./StatusBadge.vue";
import ExpandableText from "./ExpandableText.vue";
import FlowCardNode from "./graph/FlowCardNode.vue";

const props = defineProps<{
	session: JarvisSessionMetadata | null;
	embedded?: boolean;
}>();

const steps = computed(() => buildWorkflow(props.session));
const selectedStepId = ref<string | null>(null);
const inspectorCollapsed = ref(false);
const nodeTypes = { flowCard: markRaw(FlowCardNode) };

watch(
	() => props.session?.namespace,
	() => {
		selectedStepId.value = steps.value[0]?.id ?? null;
		inspectorCollapsed.value = false;
	},
	{ immediate: true },
);

const selectedStep = computed<WorkflowStepModel | null>(
	() => steps.value.find((step) => step.id === selectedStepId.value) ?? steps.value[0] ?? null,
);

const laidOutSteps = computed(() => buildWorkflowLayout(props.session));

const flowNodes = computed<Node[]>(() => {
	if (!props.session) {
		return [];
	}
	return laidOutSteps.value.map((step) => ({
		id: step.id,
		type: "flowCard",
		position: { x: step.x, y: step.y },
		draggable: false,
		selectable: true,
		connectable: false,
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
		style: { width: "276px" },
		data: {
			variant: "workflow",
			icon: step.icon,
			title: step.label,
			subtitle: truncate(step.detail, 68),
			status: step.status,
		},
	}));
});

function edgeColor(kind: "primary" | "success" | "warning" | "muted"): string {
	switch (kind) {
		case "primary":
			return "color-mix(in srgb, var(--cp-blue) 72%, white 28%)";
		case "success":
			return "color-mix(in srgb, var(--cp-emerald) 72%, white 28%)";
		case "warning":
			return "color-mix(in srgb, var(--cp-amber) 72%, white 28%)";
		default:
			return "color-mix(in srgb, var(--cp-text-dim) 44%, transparent)";
	}
}

const flowEdges = computed<Edge[]>(() => {
	const edges: Edge[] = [];
	if (!props.session) {
		return edges;
	}

	const branchNodes = steps.value.filter(
		(step) => !["ticket", "thread", "feed", "reasoning"].includes(step.id),
	);

	edges.push({
		id: "ticket-thread",
		source: "ticket",
		target: "thread",
		sourceHandle: "source-right",
		targetHandle: "target-left",
		type: "smoothstep",
		style: { stroke: edgeColor("primary"), strokeWidth: 2.2 },
	});
	edges.push({
		id: "thread-feed",
		source: "thread",
		target: "feed",
		sourceHandle: "source-right",
		targetHandle: "target-left",
		type: "smoothstep",
		style: { stroke: edgeColor("success"), strokeWidth: 2.2 },
	});

	branchNodes.forEach((step, index) => {
		edges.push({
			id: `thread-${step.id}`,
			source: "thread",
			target: step.id,
			sourceHandle: "source-right",
			targetHandle: "target-left",
			type: "smoothstep",
			style: {
				stroke: edgeColor(index % 2 === 0 ? "primary" : "warning"),
				strokeWidth: 2.2,
			},
		});
		edges.push({
			id: `${step.id}-reasoning`,
			source: step.id,
			target: "reasoning",
			sourceHandle: "source-right",
			targetHandle: "target-left",
			type: "smoothstep",
			style: { stroke: edgeColor("muted"), strokeWidth: 2 },
		});
	});

	edges.push({
		id: "feed-reasoning",
		source: "feed",
		target: "reasoning",
		sourceHandle: "source-right",
		targetHandle: "target-left",
		type: "smoothstep",
		style: { stroke: edgeColor("success"), strokeWidth: 2.2 },
	});

	return edges;
});

function onNodeClick(event: { node: { id: string } }): void {
	selectedStepId.value = event.node.id;
}
</script>

<template>
	<component
		:is="embedded ? 'section' : 'aside'"
		:class="[embedded ? 'cp-workflow-panel-embedded' : 'cp-panel cp-workflow-panel']"
	>
		<div class="cp-panel__header">
			<div>
				<p class="cp-panel__eyebrow">Automation Workflow</p>
				<h2 class="cp-panel__title">Execution Graph</h2>
			</div>
			<StatusBadge
				:label="session?.context?.thread_status ?? 'idle'"
				:tone="statusTone(session?.context?.thread_status)"
				compact
			/>
		</div>

		<div class="cp-panel__body cp-panel__body--scroll">
			<div v-if="!session" class="cp-empty-state">Select a namespace to inspect its automation chain.</div>
			<template v-else>
				<div class="cp-workflow-shell">
					<div class="cp-workflow-canvas cp-grid-surface">
						<div class="cp-flow-scene-shell cp-flow-scene-shell--workflow">
							<VueFlow
								class="cp-vue-flow cp-vue-flow--workflow"
								:nodes="flowNodes"
								:edges="flowEdges"
								:node-types="nodeTypes"
								:min-zoom="1"
								:max-zoom="1"
								:nodes-draggable="false"
								:nodes-connectable="false"
								:elements-selectable="true"
								:zoom-on-scroll="false"
								:zoom-on-pinch="false"
								:pan-on-drag="false"
								:pan-on-scroll="false"
								:prevent-scrolling="false"
								:fit-view-on-init="false"
								:default-viewport="{ zoom: 1, x: 0, y: 0 }"
								@node-click="onNodeClick"
							>
								<Background :gap="18" :size="1" pattern-color="color-mix(in srgb, var(--cp-border) 24%, transparent)" />
							</VueFlow>
						</div>
					</div>

					<div v-if="selectedStep" class="cp-workflow-inspector">
						<div class="cp-workflow-inspector__header">
							<h3 class="cp-workflow-inspector__title">{{ selectedStep.label }}</h3>
							<div class="cp-workflow-inspector__meta">
								<span class="cp-chip">{{ session.namespace }}</span>
								<StatusBadge :label="selectedStep.status" :tone="statusTone(selectedStep.status)" compact />
								<button
									type="button"
									class="cp-icon-button cp-icon-button--small"
									:title="inspectorCollapsed ? 'Expand execution detail' : 'Collapse execution detail'"
									@click="inspectorCollapsed = !inspectorCollapsed"
								>
									{{ inspectorCollapsed ? "+" : "−" }}
								</button>
							</div>
						</div>
						<div v-if="!inspectorCollapsed" class="cp-workflow-inspector__stack">
							<ExpandableText
								:text="selectedStep.detail ?? 'No branch detail available.'"
								:always-expanded="true"
							/>
							<div class="cp-workflow-inspector__resource">
								<div class="cp-panel__eyebrow">Execution Contract</div>
								<div class="cp-workflow-inspector__copy" :title="session.context?.task_note ?? ''">
									{{ shortPath(session.context?.task_note) }}
								</div>
							</div>
						</div>
					</div>
				</div>
			</template>
		</div>
	</component>
</template>
