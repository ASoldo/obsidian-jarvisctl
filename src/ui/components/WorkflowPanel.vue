<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { JarvisSessionMetadata } from "../../types/domain";
import { buildWorkflow, shortPath, statusTone, type WorkflowStepModel } from "../helpers";
import StatusBadge from "./StatusBadge.vue";
import ExpandableText from "./ExpandableText.vue";

interface WorkflowGraphNode extends WorkflowStepModel {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface WorkflowGraphEdge {
	id: string;
	from: string;
	to: string;
	tone: "primary" | "success" | "warning" | "accent" | "muted";
}

const props = defineProps<{
	session: JarvisSessionMetadata | null;
	embedded?: boolean;
}>();

const steps = computed(() => buildWorkflow(props.session));
const selectedStepId = ref<string | null>(null);
const inspectorCollapsed = ref(false);

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

const graphNodes = computed<WorkflowGraphNode[]>(() => {
	if (steps.value.length === 0) {
		return [];
	}

	const leftColumnX = 34;
	const rightColumnX = 316;
	const leftWidth = 182;
	const rightWidth = 204;
	const cardHeight = 64;
	const topY = 34;
	const verticalGap = 86;

	const nodes: WorkflowGraphNode[] = [];
	const ticket = steps.value.find((step) => step.id === "ticket");
	const thread = steps.value.find((step) => step.id === "thread");
	const feed = steps.value.find((step) => step.id === "feed");
	const reasoning = steps.value.find((step) => step.id === "reasoning");
	const branches = steps.value.filter(
		(step) => !["ticket", "thread", "feed", "reasoning"].includes(step.id),
	);

	if (ticket) {
		nodes.push({ ...ticket, x: leftColumnX, y: topY, width: leftWidth, height: cardHeight });
	}
	if (thread) {
		nodes.push({
			...thread,
			x: leftColumnX,
			y: topY + verticalGap,
			width: leftWidth,
			height: cardHeight,
		});
	}
	if (feed) {
		nodes.push({
			...feed,
			x: leftColumnX,
			y: topY + verticalGap * 2,
			width: leftWidth,
			height: cardHeight,
		});
	}

	branches.forEach((step, index) => {
		nodes.push({
			...step,
			x: rightColumnX,
			y: topY + 28 + index * 74,
			width: rightWidth,
			height: 66,
		});
	});

	if (reasoning) {
		nodes.push({
			...reasoning,
			x: rightColumnX,
			y: topY + 28 + Math.max(branches.length, 1) * 74 + 96,
			width: rightWidth,
			height: cardHeight,
		});
	}

	return nodes;
});

const graphEdges = computed<WorkflowGraphEdge[]>(() => {
	const edges: WorkflowGraphEdge[] = [];
	const has = (id: string) => graphNodes.value.some((node) => node.id === id);
	if (has("ticket") && has("thread")) {
		edges.push({ id: "ticket-thread", from: "ticket", to: "thread", tone: "primary" });
	}
	if (has("thread") && has("feed")) {
		edges.push({ id: "thread-feed", from: "thread", to: "feed", tone: "success" });
	}

	const branchNodes = graphNodes.value.filter(
		(node) => !["ticket", "thread", "feed", "reasoning"].includes(node.id),
	);
	branchNodes.forEach((node, index) => {
		edges.push({
			id: `thread-${node.id}`,
			from: "thread",
			to: node.id,
			tone: index % 2 === 0 ? "accent" : "warning",
		});
		edges.push({
			id: `${node.id}-reasoning`,
			from: node.id,
			to: "reasoning",
			tone: "muted",
		});
	});

	if (branchNodes.length === 0 && has("feed") && has("reasoning")) {
		edges.push({ id: "feed-reasoning", from: "feed", to: "reasoning", tone: "accent" });
	}

	return edges;
});

function nodeById(id: string): WorkflowGraphNode | undefined {
	return graphNodes.value.find((node) => node.id === id);
}

function nodeCenter(id: string): { x: number; y: number } {
	const node = nodeById(id);
	if (!node) {
		return { x: 0, y: 0 };
	}
	return {
		x: node.x + node.width / 2,
		y: node.y + node.height / 2,
	};
}

function edgePath(fromId: string, toId: string): string {
	const from = nodeCenter(fromId);
	const to = nodeCenter(toId);
	const midX = from.x + (to.x - from.x) * 0.42;
	return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
}
</script>

<template>
	<component
		:is="embedded ? 'section' : 'aside'"
		:class="[embedded ? 'cp-subpanel cp-workflow-panel-embedded' : 'cp-panel cp-workflow-panel']"
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
						<div class="cp-workflow-scene">
							<svg class="cp-workflow-svg" viewBox="0 0 560 420" preserveAspectRatio="none">
								<path
									v-for="edge in graphEdges"
									:key="edge.id"
									:d="edgePath(edge.from, edge.to)"
									:class="['cp-workflow-edge', `cp-workflow-edge--${edge.tone}`]"
								/>
							</svg>
							<button
								v-for="node in graphNodes"
								:key="node.id"
								type="button"
								:class="['cp-workflow-node', selectedStepId === node.id && 'is-active']"
								:style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, minHeight: `${node.height}px` }"
								:title="node.detail ?? node.label"
								@click="selectedStepId = node.id"
							>
								<div class="cp-workflow-node__head">
									<div class="cp-workflow-node__icon">{{ node.icon }}</div>
									<div class="cp-workflow-node__body">
										<div class="cp-workflow-node__title">{{ node.label }}</div>
										<div class="cp-workflow-node__detail">
											{{ node.detail ?? "waiting for runtime data" }}
										</div>
									</div>
									<StatusBadge :label="node.status" :tone="statusTone(node.status)" compact />
								</div>
							</button>
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
