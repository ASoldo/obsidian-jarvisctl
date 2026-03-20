<script setup lang="ts">
import { computed, markRaw, ref, watch } from "vue";
import { VueFlow, Position, type Edge, type Node } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import type { JarvisSessionMetadata } from "../../types/domain";
import { buildTopology, formatDateTime, nodeTone, sessionStateLabel, statusTone } from "../helpers";
import StatusBadge from "./StatusBadge.vue";
import FlowCardNode from "./graph/FlowCardNode.vue";

const props = defineProps<{
	session: JarvisSessionMetadata | null;
}>();

const graph = computed(() => buildTopology(props.session));
const selectedNodeId = ref<string | null>(null);
const nodeTypes = { flowCard: markRaw(FlowCardNode) };

watch(
	() => props.session?.namespace,
	() => {
		selectedNodeId.value = graph.value.nodes[1]?.id ?? graph.value.nodes[0]?.id ?? null;
	},
	{ immediate: true },
);

const selectedNode = computed(() =>
	graph.value.nodes.find((node) => node.id === selectedNodeId.value) ?? graph.value.nodes[0] ?? null,
);

const flowNodes = computed<Node[]>(() =>
	graph.value.nodes.map((node) => ({
		id: node.id,
		type: "flowCard",
		position: { x: node.x, y: node.y },
		draggable: false,
		selectable: true,
		connectable: false,
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
		data: {
			variant: "topology",
			kind: node.type,
			status: node.status,
			title: node.label,
			meta: node.meta,
			tone: nodeTone(node.status),
		},
	})),
);

function edgeColor(tone: string | undefined): string {
	switch (tone) {
		case "primary":
			return "color-mix(in srgb, var(--cp-blue) 72%, white 28%)";
		case "success":
			return "color-mix(in srgb, var(--cp-emerald) 72%, white 28%)";
		case "warning":
			return "color-mix(in srgb, var(--cp-amber) 72%, white 28%)";
		case "accent":
			return "color-mix(in srgb, var(--cp-indigo) 72%, white 28%)";
		default:
			return "color-mix(in srgb, var(--cp-text-dim) 44%, transparent)";
	}
}

function edgeHandles(edgeId: string): { sourceHandle: string; targetHandle: string } {
	switch (edgeId) {
		case "ticket-main":
			return { sourceHandle: "source-right", targetHandle: "target-left" };
		case "main-feed":
			return { sourceHandle: "source-bottom", targetHandle: "target-top" };
		case "feed-activity":
			return { sourceHandle: "source-right", targetHandle: "target-left" };
		case "activity-transcript":
			return { sourceHandle: "source-bottom", targetHandle: "target-top" };
		default:
			if (edgeId.startsWith("main-")) {
				return { sourceHandle: "source-right", targetHandle: "target-left" };
			}
			if (edgeId.endsWith("-activity")) {
				return { sourceHandle: "source-right", targetHandle: "target-left" };
			}
			return { sourceHandle: "source-right", targetHandle: "target-left" };
	}
}

const flowEdges = computed<Edge[]>(() =>
	graph.value.edges.map((edge) => {
		const handles = edgeHandles(edge.id);
		return {
			id: edge.id,
			source: edge.from,
			target: edge.to,
			sourceHandle: handles.sourceHandle,
			targetHandle: handles.targetHandle,
			type: "step",
			animated: false,
			style: {
				stroke: edgeColor(edge.tone),
				strokeWidth: 2.2,
			},
		};
	}),
);

function onNodeClick(event: { node: { id: string } }): void {
	selectedNodeId.value = event.node.id;
}
</script>

<template>
		<div class="cp-topology-tab">
			<div class="cp-topology-canvas cp-grid-surface">
				<div class="cp-flow-scene-shell cp-flow-scene-shell--topology">
					<VueFlow
						class="cp-vue-flow cp-vue-flow--topology"
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

		<div v-if="session && selectedNode" class="cp-inspector">
			<div class="cp-inspector__head">
				<div>
					<p class="cp-panel__eyebrow">Selected Node</p>
					<h3 class="cp-inspector__title">{{ selectedNode.label }}</h3>
				</div>
				<StatusBadge :label="selectedNode.status" :tone="statusTone(selectedNode.status)" compact />
			</div>
			<div class="cp-inspector__grid">
				<div class="cp-kv-card">
					<div class="cp-kv-card__label">Namespace</div>
					<div class="cp-kv-card__value">{{ session.namespace }}</div>
				</div>
				<div class="cp-kv-card">
					<div class="cp-kv-card__label">State</div>
					<div class="cp-kv-card__value">{{ sessionStateLabel(session) }}</div>
				</div>
				<div class="cp-kv-card">
					<div class="cp-kv-card__label">Created</div>
					<div class="cp-kv-card__value">{{ formatDateTime(session.created_at_epoch_ms) }}</div>
				</div>
				<div class="cp-kv-card cp-kv-card--wide">
					<div class="cp-kv-card__label">Detail</div>
					<div class="cp-kv-card__value">{{ selectedNode.meta ?? session.context?.last_activity ?? "No detail" }}</div>
				</div>
			</div>
		</div>
	</div>
</template>
