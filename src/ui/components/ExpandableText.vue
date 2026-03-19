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
		<p
			:class="[
				'cp-expandable__body',
				!isExpanded && collapsible && lines === 2 && 'cp-clamp-2',
				!isExpanded && collapsible && lines === 3 && 'cp-clamp-3',
				!isExpanded && collapsible && lines >= 4 && 'cp-clamp-4',
			]"
		>
			{{ text }}
		</p>
		<button
			v-if="collapsible && !alwaysExpanded"
			type="button"
			class="cp-inline-button"
			@click="expanded = !expanded"
		>
			{{ expanded ? "Show less" : "Read more" }}
		</button>
	</div>
</template>
