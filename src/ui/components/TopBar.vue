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
	(event: "refresh"): void;
	(event: "open-dashboard"): void;
	(event: "continue"): void;
}>();
</script>

<template>
	<header class="cp-topbar">
		<div class="cp-topbar__env">
			<div class="cp-topbar__label">Environment</div>
			<button type="button" class="cp-topbar__env-button">
				<span>{{ environmentLabel }}</span>
				<span class="cp-topbar__caret" aria-hidden="true">v</span>
			</button>
		</div>

		<label class="cp-search">
			<span class="cp-search__icon" aria-hidden="true">/</span>
			<input
				:value="searchQuery"
				type="search"
				class="cp-search__input"
				placeholder="Search namespaces, sessions, logs, workflows"
				@input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
			/>
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
			<button type="button" class="cp-ghost-button" @click="emit('refresh')">Sync All</button>
			<button type="button" class="cp-ghost-button cp-ghost-button--primary" @click="emit('continue')">
				Deploy
			</button>
			<button type="button" class="cp-icon-button" title="Open dashboard" @click="emit('open-dashboard')">
				D
			</button>
		</div>
	</header>
</template>
