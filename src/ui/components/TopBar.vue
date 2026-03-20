<script setup lang="ts">
import { computed } from "vue";
import { statusTone } from "../helpers";
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{
	environmentLabel: string;
	searchQuery: string;
	namespaceCount: number;
	agentCount: number;
	subagentCount: number;
	selectedState: string;
}>();

const emit = defineEmits<{
	(event: "update:searchQuery", value: string): void;
	(event: "toggle-environment"): void;
	(event: "refresh"): void;
	(event: "open-dashboard"): void;
	(event: "continue"): void;
}>();

const selectedTone = computed(() => statusTone(props.selectedState));
</script>

<template>
	<header class="cp-topbar">
		<div class="cp-topbar__env">
			<div class="cp-topbar__env-copy">
				<div class="cp-topbar__label">Environment</div>
				<div class="cp-topbar__env-value">{{ environmentLabel }}</div>
			</div>
			<button
				type="button"
				class="cp-topbar__env-button"
				:title="`Cycle repository scope (${environmentLabel})`"
				:aria-label="`Cycle repository scope (${environmentLabel})`"
				@click="emit('toggle-environment')"
			>
				<span class="cp-button__icon" aria-hidden="true">◫</span>
			</button>
		</div>

		<label class="cp-search">
			<span class="cp-search__icon" aria-hidden="true">⌕</span>
			<input
				:value="searchQuery"
				type="search"
				class="cp-search__input"
				placeholder="Search namespaces, sessions, logs, workflows"
				@input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
			/>
			<button
				v-if="searchQuery"
				type="button"
				class="cp-search__clear"
				title="Clear search"
				@click.prevent="emit('update:searchQuery', '')"
			>
				×
			</button>
		</label>

		<div class="cp-topbar__stats">
			<div class="cp-topbar__metric">
				<span class="cp-topbar__metric-label">Namespaces</span>
				<span class="cp-topbar__metric-value">{{ namespaceCount }}</span>
			</div>
			<div class="cp-topbar__metric">
				<span class="cp-topbar__metric-label">Live Agents</span>
				<span class="cp-topbar__metric-value">{{ agentCount }}</span>
			</div>
			<div class="cp-topbar__metric">
				<span class="cp-topbar__metric-label">Subagents</span>
				<span class="cp-topbar__metric-value">{{ subagentCount }}</span>
			</div>
		</div>

		<div class="cp-topbar__actions">
			<StatusBadge :label="selectedState" :tone="selectedTone" compact />
			<div class="cp-control-strip cp-control-strip--right">
				<button
					type="button"
					class="cp-icon-button cp-topbar__action-button"
					title="Sync all"
					aria-label="Sync all"
					@click="emit('refresh')"
				>
					<span class="cp-button__icon" aria-hidden="true">↻</span>
				</button>
				<button
					type="button"
					class="cp-icon-button cp-icon-button--primary cp-topbar__action-button"
					title="Deploy"
					aria-label="Deploy"
					@click="emit('continue')"
				>
					<span class="cp-button__icon" aria-hidden="true">⇢</span>
				</button>
				<button type="button" class="cp-icon-button cp-topbar__action-button" title="Open terminal dashboard" aria-label="Open terminal dashboard" @click="emit('open-dashboard')">
					<span class="cp-button__icon" aria-hidden="true">⌘</span>
				</button>
			</div>
		</div>
	</header>
</template>
