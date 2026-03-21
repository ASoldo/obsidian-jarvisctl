<script setup lang="ts">
import { computed } from "vue";
import type { EntityScope } from "../helpers";

type EntityAvatarKind =
	| "session"
	| "agent"
	| "subagent"
	| "worker"
	| "operator"
	| "assistant"
	| "system";

const props = withDefaults(
	defineProps<{
		kind: EntityAvatarKind;
		scope?: EntityScope;
		tone?: "live" | "warning" | "error" | "idle" | "info";
		size?: "sm" | "md";
	}>(),
	{
		scope: "local",
		tone: "idle",
		size: "md",
	},
);

const scopeBadge = computed(() => {
	switch (props.scope) {
		case "cloud":
			return "C";
		case "remote":
			return "R";
		default:
			return "L";
	}
});
</script>

<template>
	<div :class="['cp-entity-avatar', `is-${kind}`, `is-${scope}`, `is-${tone}`, `is-${size}`]">
		<svg
			v-if="kind === 'session' || kind === 'agent' || kind === 'assistant'"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.6"
			aria-hidden="true"
		>
			<path d="M7 18h9a4 4 0 0 0 .5-8 5.6 5.6 0 0 0-10.6-1.8A3.6 3.6 0 0 0 7 18Z" />
			<path d="M9.5 13h5" />
			<path d="M12 10.5v5" />
		</svg>
		<svg
			v-else-if="kind === 'subagent'"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.6"
			aria-hidden="true"
		>
			<circle cx="7" cy="7" r="2.25" />
			<circle cx="17" cy="6" r="2.25" />
			<circle cx="17" cy="18" r="2.25" />
			<path d="M9.4 7h3.5a4.1 4.1 0 0 1 4.1 4.1V15" />
			<path d="M12.5 13.5h4.5" />
		</svg>
		<svg
			v-else-if="kind === 'worker'"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.6"
			aria-hidden="true"
		>
			<rect x="7" y="7" width="10" height="10" rx="2.2" />
			<path d="M10.5 10.5h3v3h-3z" />
			<path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9h2.5M2.5 15h2.5M19 9h2.5M19 15h2.5" />
		</svg>
		<svg
			v-else-if="kind === 'operator'"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.6"
			aria-hidden="true"
		>
			<path d="M4 17.5V20h2.5L17.8 8.7l-2.5-2.5z" />
			<path d="M13.9 5.9l2.5 2.5" />
			<path d="M4 20h16" />
		</svg>
		<svg
			v-else
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.6"
			aria-hidden="true"
		>
			<path d="M5 7h14M5 12h14M5 17h9" />
		</svg>
		<span class="cp-entity-avatar__scope">{{ scopeBadge }}</span>
	</div>
</template>
