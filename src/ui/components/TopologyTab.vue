<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { JarvisSessionMetadata } from "../../types/domain";
import { buildTopology, formatDateTime, nodeTone, sessionStateLabel } from "../helpers";
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{
	session: JarvisSessionMetadata | null;
}>();

const graph = computed(() => buildTopology(props.session));
const selectedNodeId = ref<string | null>(null);

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

const NODE_WIDTH = 148;
const NODE_HEIGHT = 68;

function anchor(nodeId: string, side: "left" | "right" | "top" | "bottom"): { x: number; y: number } {
	const node = graph.value.nodes.find((item) => item.id === nodeId);
	if (!node) {
		return { x: 0, y: 0 };
	}
	switch (side) {
		case "left":
			return { x: node.x, y: node.y + NODE_HEIGHT / 2 };
		case "right":
			return { x: node.x + NODE_WIDTH, y: node.y + NODE_HEIGHT / 2 };
		case "top":
			return { x: node.x + NODE_WIDTH / 2, y: node.y };
		case "bottom":
			return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT };
	}
}

function edgePath(fromId: string, toId: string): string {
	const fromNode = graph.value.nodes.find((item) => item.id === fromId);
	const toNode = graph.value.nodes.find((item) => item.id === toId);
	if (!fromNode || !toNode) {
		return "";
	}

	const dx = toNode.x - fromNode.x;
	const dy = toNode.y - fromNode.y;
	const horizontal = Math.abs(dx) >= Math.abs(dy);
	const from = horizontal
		? anchor(fromId, dx >= 0 ? "right" : "left")
		: anchor(fromId, dy >= 0 ? "bottom" : "top");
	const to = horizontal
		? anchor(toId, dx >= 0 ? "left" : "right")
		: anchor(toId, dy >= 0 ? "top" : "bottom");

	if (horizontal) {
		const midX = from.x + (to.x - from.x) / 2;
		return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
	}

	const midY = from.y + (to.y - from.y) / 2;
	return `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
}
</script>

<template>
	<div class="cp-topology-tab">
		<div class="cp-topology-canvas cp-grid-surface">
			<div class="cp-topology-scene">
				<svg class="cp-topology-svg" viewBox="0 0 980 430" preserveAspectRatio="none">
					<path
						v-for="edge in graph.edges"
						:key="edge.id"
						:d="edgePath(edge.from, edge.to)"
						:class="['cp-topology-edge', `cp-topology-edge--${edge.tone ?? 'muted'}`]"
					/>
				</svg>

				<button
					v-for="node in graph.nodes"
					:key="node.id"
					type="button"
					:class="[
						'cp-topology-node',
						`cp-topology-node--${nodeTone(node.status)}`,
						selectedNodeId === node.id && 'is-active',
					]"
					:style="{ left: `${node.x}px`, top: `${node.y}px` }"
					@click="selectedNodeId = node.id"
				>
					<div class="cp-topology-node__head">
						<div class="cp-topology-node__type">{{ node.type }}</div>
						<div class="cp-topology-node__state">{{ node.status }}</div>
					</div>
					<div class="cp-topology-node__title">{{ node.label }}</div>
					<div class="cp-topology-node__meta" :title="node.meta ?? 'runtime'">{{ node.meta ?? "runtime" }}</div>
				</button>
				</div>
		</div>

		<div v-if="session && selectedNode" class="cp-inspector">
			<div class="cp-inspector__head">
				<div>
					<p class="cp-panel__eyebrow">Selected Node</p>
					<h3 class="cp-inspector__title">{{ selectedNode.label }}</h3>
				</div>
				<StatusBadge :label="selectedNode.status" :tone="nodeTone(selectedNode.status) === 'emerald' ? 'live' : nodeTone(selectedNode.status) === 'amber' ? 'warning' : nodeTone(selectedNode.status) === 'rose' ? 'error' : 'idle'" compact />
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
