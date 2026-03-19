<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { JarvisSessionMetadata } from "../../types/domain";
import { buildTopology, formatDateTime, nodeTone } from "../helpers";
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

function center(nodeId: string): { x: number; y: number } {
	const node = graph.value.nodes.find((item) => item.id === nodeId);
	if (!node) {
		return { x: 0, y: 0 };
	}
	return { x: node.x + 78, y: node.y + 26 };
}

function edgePath(fromId: string, toId: string): string {
	const from = center(fromId);
	const to = center(toId);
	const dx = Math.abs(to.x - from.x) * 0.45;
	return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}
</script>

<template>
	<div class="cp-topology-tab">
		<div class="cp-topology-canvas cp-grid-surface">
			<svg class="cp-topology-svg" viewBox="0 0 700 360" preserveAspectRatio="none">
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
				<div class="cp-topology-node__title">{{ node.label }}</div>
				<div class="cp-topology-node__meta">{{ node.meta ?? "runtime" }}</div>
			</button>
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
					<div class="cp-kv-card__label">Session</div>
					<div class="cp-kv-card__value">{{ session.context?.codex_session_id ?? "n/a" }}</div>
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
