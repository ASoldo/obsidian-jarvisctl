<script setup lang="ts">
import { computed } from "vue";

type Tone = "live" | "warning" | "error" | "idle" | "info";

const props = withDefaults(
	defineProps<{
		label: string;
		tone?: Tone;
		compact?: boolean;
	}>(),
	{
		tone: "idle",
		compact: false,
	},
);

const toneClass = computed(() => `cp-badge--${props.tone}`);
const stateClass = computed(() => `cp-badge--state-${props.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
</script>

<template>
	<span :class="['cp-badge', toneClass, stateClass, compact && 'cp-badge--compact']">
		<span class="cp-badge__dot" aria-hidden="true" />
		<span>{{ label }}</span>
	</span>
</template>
