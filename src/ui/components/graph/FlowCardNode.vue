<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { statusTone } from "../../helpers";
import StatusBadge from "../StatusBadge.vue";

interface FlowCardNodeData {
	icon?: string;
	title?: string;
	subtitle?: string;
	meta?: string;
	status?: string;
	kind?: string;
	variant?: "topology" | "workflow";
}

const props = defineProps<NodeProps<FlowCardNodeData>>();
</script>

<template>
	<div
		:class="['cp-flow-card', props.data.variant === 'workflow' ? 'cp-flow-card--workflow' : 'cp-flow-card--topology', props.selected && 'is-selected']"
		:title="props.data.subtitle || props.data.meta || props.data.title || String(props.label ?? props.id)"
	>
		<Handle id="target-left" type="target" :position="Position.Left" class="cp-flow-handle" />
		<Handle id="target-top" type="target" :position="Position.Top" class="cp-flow-handle" />
		<Handle id="source-right" type="source" :position="Position.Right" class="cp-flow-handle" />
		<Handle id="source-bottom" type="source" :position="Position.Bottom" class="cp-flow-handle" />

		<div v-if="props.data.variant === 'workflow'" class="cp-flow-card__workflow-head">
			<div class="cp-flow-card__icon">{{ props.data.icon ?? "•" }}</div>
			<div class="cp-flow-card__body">
				<div class="cp-flow-card__title">{{ props.data.title ?? props.label ?? props.id }}</div>
			</div>
			<StatusBadge :label="props.data.status ?? 'idle'" :tone="statusTone(props.data.status)" compact />
		</div>

		<div v-else class="cp-flow-card__topology-head">
			<div class="cp-flow-card__title">{{ props.data.title ?? props.label ?? props.id }}</div>
			<StatusBadge :label="props.data.status ?? 'idle'" :tone="statusTone(props.data.status)" compact />
		</div>
	</div>
</template>
