<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
	defineProps<{
		text?: string | null;
		lines?: number;
		alwaysExpanded?: boolean;
	}>(),
	{
		text: "",
		lines: 3,
		alwaysExpanded: false,
	},
);

const expanded = ref(false);

const collapsible = computed(() => (props.text ?? "").length > 180 || (props.text ?? "").includes("\n"));
const isExpanded = computed(() => props.alwaysExpanded || expanded.value);
</script>

<template>
	<div v-if="text" class="cp-expandable">
		<p v-if="isExpanded || !collapsible" class="cp-expandable__body cp-expandable__body--expanded">
			{{ text }}
		</p>
		<p
			v-else
			:class="[
				'cp-expandable__body',
				lines === 2 && 'cp-clamp-2',
				lines === 3 && 'cp-clamp-3',
				lines === 4 && 'cp-clamp-4',
				lines >= 5 && 'cp-clamp-6',
			]"
		>
			{{ text }}
		</p>
		<button
			v-if="collapsible && !alwaysExpanded"
			type="button"
			class="cp-icon-button cp-icon-button--small cp-inline-button"
			:title="expanded ? 'Show less' : 'Read more'"
			:aria-label="expanded ? 'Show less' : 'Read more'"
			@click="expanded = !expanded"
		>
			<span class="cp-button__icon" aria-hidden="true">{{ expanded ? "▴" : "▾" }}</span>
		</button>
	</div>
</template>
