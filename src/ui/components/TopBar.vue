<script setup lang="ts">
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{
	environmentLabel: string;
	searchQuery: string;
	namespaceCount: number;
	agentCount: number;
	subagentCount: number;
	focusLabel: string;
	selectedState: string;
}>();

const emit = defineEmits<{
	(event: "update:searchQuery", value: string): void;
	(event: "toggle-environment"): void;
	(event: "refresh"): void;
	(event: "open-dashboard"): void;
	(event: "continue"): void;
}>();
</script>

<template>
	<header class="cp-topbar">
		<div class="cp-topbar__env">
			<div class="cp-topbar__label">Environment</div>
			<button
				type="button"
				class="cp-topbar__env-button"
				title="Cycle repository scope"
				@click="emit('toggle-environment')"
			>
				<span class="cp-button__icon" aria-hidden="true">◫</span>
				<span>{{ environmentLabel }}</span>
				<span class="cp-topbar__caret" aria-hidden="true">▾</span>
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
			<div class="cp-stat-chip">
				<span class="cp-stat-chip__label">Namespaces</span>
				<span class="cp-stat-chip__value">{{ namespaceCount }}</span>
			</div>
			<div class="cp-stat-chip">
				<span class="cp-stat-chip__label">Live Agents</span>
				<span class="cp-stat-chip__value">{{ agentCount }}</span>
			</div>
			<div class="cp-stat-chip">
				<span class="cp-stat-chip__label">Subagents</span>
				<span class="cp-stat-chip__value">{{ subagentCount }}</span>
			</div>
			<div class="cp-stat-chip cp-stat-chip--focus">
				<span class="cp-stat-chip__label">Focus</span>
				<span class="cp-stat-chip__value">{{ focusLabel }}</span>
			</div>
		</div>

		<div class="cp-topbar__actions">
			<StatusBadge :label="selectedState" tone="info" compact />
			<button type="button" class="cp-ghost-button" title="Refresh runtime state" @click="emit('refresh')">
				<span class="cp-button__icon" aria-hidden="true">↻</span>
				<span>Sync All</span>
			</button>
			<button
				type="button"
				class="cp-ghost-button cp-ghost-button--primary"
				title="Continue the active ticket or refresh when no ticket is selected"
				@click="emit('continue')"
			>
				<span class="cp-button__icon" aria-hidden="true">⇢</span>
				Deploy
			</button>
			<button type="button" class="cp-icon-button" title="Open terminal dashboard" @click="emit('open-dashboard')">
				⌘
			</button>
		</div>
	</header>
</template>
