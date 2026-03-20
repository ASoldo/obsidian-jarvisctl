<script setup lang="ts">
import { computed, markRaw, ref, watch } from "vue";
import { VueFlow, Position, type Edge, type Node } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import type { JarvisSessionMetadata } from "../../types/domain";
import {
	buildTopology,
	formatDateTime,
	nodeTone,
	sessionStateLabel,
	statusTone,
	TOPOLOGY_NODE_HEIGHT,
} from "../helpers";
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

const canvasHeight = computed(() => {
	const bottomEdge = graph.value.nodes.reduce(
		(max, node) => Math.max(max, node.y + TOPOLOGY_NODE_HEIGHT),
		0,
	);
	return `${Math.max(440, bottomEdge + 36)}px`;
});

const flowKey = computed(() =>
	[
		props.session?.namespace ?? "none",
		graph.value.nodes.length,
		graph.value.edges.length,
		props.session?.context?.recent_events?.length ?? 0,
		props.session?.context?.subagents?.length ?? 0,
	].join(":"),
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

const flowEdges = computed<Edge[]>(() =>
	graph.value.edges.map((edge) => ({
		id: edge.id,
		source: edge.from,
		target: edge.to,
		sourceHandle: "source-right",
		targetHandle: "target-left",
		type: "smoothstep",
		animated: false,
		style: {
			stroke: edgeColor(edge.tone),
			strokeWidth: 2.4,
		},
	})),
);

function onNodeClick(event: { node: { id: string } }): void {
	selectedNodeId.value = event.node.id;
}
</script>

<template>
	<div class="cp-topology-tab">
		<div class="flex min-h-0 flex-col gap-3">
			<div class="cp-topology-canvas cp-grid-surface" :style="{ height: canvasHeight }">
				<div class="cp-flow-scene-shell cp-flow-scene-shell--topology" :style="{ height: canvasHeight }">
					<VueFlow
						:key="flowKey"
						class="cp-vue-flow cp-vue-flow--topology"
						:nodes="flowNodes"
						:edges="flowEdges"
						:node-types="nodeTypes"
						:min-zoom="0.18"
						:max-zoom="1.6"
						:nodes-draggable="false"
						:nodes-connectable="false"
						:elements-selectable="true"
						:zoom-on-scroll="true"
						:zoom-on-pinch="true"
						:pan-on-drag="true"
						:pan-on-scroll="false"
						:prevent-scrolling="true"
						:fit-view-on-init="true"
						:fit-view-options="{ padding: 0.14, minZoom: 0.18, maxZoom: 1.15 }"
						@node-click="onNodeClick"
					>
						<Background :gap="18" :size="1" pattern-color="color-mix(in srgb, var(--cp-border) 24%, transparent)" />
					</VueFlow>
				</div>
			</div>

			<aside
				v-if="session && selectedNode"
				class="grid gap-3 rounded-2xl border border-[color:var(--cp-border)] bg-[color:var(--cp-panel)] p-4"
			>
				<div class="cp-inspector__head">
					<div>
						<p class="cp-panel__eyebrow">Selected Node</p>
						<h3 class="cp-inspector__title">{{ selectedNode.label }}</h3>
					</div>
					<StatusBadge :label="selectedNode.status" :tone="statusTone(selectedNode.status)" compact />
				</div>
				<div class="flex min-w-0 flex-col gap-3">
					<div class="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[color:var(--cp-border)] bg-[color:var(--cp-panel)] px-4 py-3">
						<div class="cp-kv-card__label">Namespace</div>
						<div class="cp-kv-card__value max-w-full text-right">{{ session.namespace }}</div>
					</div>
					<div class="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[color:var(--cp-border)] bg-[color:var(--cp-panel)] px-4 py-3">
						<div class="cp-kv-card__label">State</div>
						<div class="cp-kv-card__value max-w-full text-right">{{ sessionStateLabel(session) }}</div>
					</div>
					<div class="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[color:var(--cp-border)] bg-[color:var(--cp-panel)] px-4 py-3">
						<div class="cp-kv-card__label">Created</div>
						<div class="cp-kv-card__value max-w-full text-right">{{ formatDateTime(session.created_at_epoch_ms) }}</div>
					</div>
					<div class="grid gap-2 rounded-2xl border border-[color:var(--cp-border)] bg-[color:var(--cp-panel)] px-4 py-3">
						<div class="cp-kv-card__label">Detail</div>
						<div class="cp-kv-card__value">
							{{ selectedNode.meta ?? session.context?.last_activity ?? "No detail" }}
						</div>
					</div>
				</div>
			</aside>
		</div>
	</div>
</template>
