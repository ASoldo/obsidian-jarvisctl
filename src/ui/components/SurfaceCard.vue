<script setup lang="ts">
import StatusBadge from "./StatusBadge.vue";

defineProps<{
	eyebrow: string;
	title: string;
	icon?: string;
	meta?: string[];
	statusLabel?: string | null;
	statusTone?: "live" | "warning" | "error" | "idle" | "info";
	collapsed?: boolean;
	bodyClass?: string;
}>();

const emit = defineEmits<{
	(event: "toggle"): void;
}>();
</script>

<template>
	<section
		:aria-label="title"
		class="cp-surface-card"
	>
		<header class="cp-surface-card__header">
			<div class="cp-surface-card__identity">
				<div
					v-if="icon"
					class="cp-surface-card__icon"
					aria-hidden="true"
				>
					{{ icon }}
				</div>
				<div class="cp-surface-card__copy">
					<p class="cp-panel__eyebrow">{{ eyebrow }}</p>
				</div>
			</div>

			<div class="cp-surface-card__meta">
				<span v-for="item in meta ?? []" :key="item" class="cp-chip">{{ item }}</span>
				<StatusBadge
					v-if="statusLabel"
					:label="statusLabel"
					:tone="statusTone ?? 'info'"
					compact
				/>
				<button
					type="button"
					class="cp-icon-button cp-icon-button--circle"
					:title="collapsed ? 'Expand section' : 'Collapse section'"
					@click="emit('toggle')"
				>
					{{ collapsed ? "+" : "−" }}
				</button>
			</div>
		</header>

		<div v-show="!collapsed" :class="['cp-surface-card__body', bodyClass]">
			<slot />
		</div>
	</section>
</template>
