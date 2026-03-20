<script setup lang="ts">
import { computed } from "vue";
import type { JarvisActivitySection, JarvisSessionMetadata } from "../../types/domain";
import {
	collectRecentActions,
	flattenActivityLines,
	formatClock,
	metricsSnapshot,
	reasoningEntries,
	statusTone,
} from "../helpers";
import StatusBadge from "./StatusBadge.vue";
import ExpandableText from "./ExpandableText.vue";

type BottomTab = "logs" | "events" | "reasoning" | "metrics";

const props = defineProps<{
	session: JarvisSessionMetadata | null;
	activitySections: JarvisActivitySection[];
	bottomTab: BottomTab;
	collapsed?: boolean;
}>();

const emit = defineEmits<{
	(event: "update:bottomTab", value: BottomTab): void;
	(event: "toggle-collapsed"): void;
}>();

const logLines = computed(() => flattenActivityLines(props.activitySections).slice(-40));
const reasoning = computed(() => reasoningEntries(props.session).slice(-20).reverse());
const branchActions = computed(() => collectRecentActions(props.session?.context?.subagents).slice(0, 12));
const metrics = computed(() => metricsSnapshot(props.session));
const tabs = [
	{ id: "logs", label: "Logs", icon: "≡" },
	{ id: "events", label: "Events", icon: "◫" },
	{ id: "reasoning", label: "AI Reasoning", icon: "◈" },
	{ id: "metrics", label: "Metrics", icon: "◍" },
] as const;
</script>

<template>
	<section :class="['cp-panel', 'cp-bottom-panel', props.collapsed && 'is-collapsed']">
		<div class="cp-panel__header cp-panel__header--tabs">
			<div class="cp-surface-tab-strip cp-surface-tab-strip--footer">
				<button
					v-for="tab in tabs"
					:key="tab.id"
					type="button"
					:class="['cp-surface-tab', bottomTab === tab.id && 'is-active']"
					:title="tab.label"
					@click="emit('update:bottomTab', tab.id as BottomTab)"
				>
					<span class="cp-surface-tab__icon" aria-hidden="true">{{ tab.icon }}</span>
					<span class="cp-surface-tab__label">{{ tab.label }}</span>
				</button>
			</div>
			<div class="cp-panel__meta">
				<span class="cp-chip">Tokens: {{ session?.context?.recent_events?.length ?? 0 }}</span>
				<span class="cp-chip">Latency: {{ session?.context?.turn_status === 'inProgress' ? 'active' : 'steady' }}</span>
				<span class="cp-chip">GPU: n/a</span>
				<button
					type="button"
					class="cp-icon-button cp-icon-button--small"
					:title="props.collapsed ? 'Expand observability panel' : 'Collapse observability panel'"
					@click="emit('toggle-collapsed')"
				>
					{{ props.collapsed ? "+" : "−" }}
				</button>
			</div>
		</div>

		<div v-show="!props.collapsed" class="cp-panel__body cp-panel__body--scroll">
			<div v-if="!session" class="cp-empty-state">Select a namespace to inspect logs, events, reasoning, and metrics.</div>

			<div v-else-if="bottomTab === 'logs'" class="cp-bottom-console">
				<div v-if="logLines.length === 0" class="cp-empty-state">No observed log lines yet.</div>
				<div v-else class="cp-console cp-console--dense">
					<div v-for="(line, index) in logLines" :key="index" class="cp-console__line">
						{{ line }}
					</div>
				</div>
			</div>

			<div v-else-if="bottomTab === 'events'" class="cp-bottom-list">
				<article v-for="event in (session.context?.recent_events ?? []).slice(-20).reverse()" :key="event.id" class="cp-event-row">
					<div class="cp-event-row__left">
						<StatusBadge :label="event.kind" :tone="statusTone(event.status ?? event.kind)" compact />
						<div class="cp-event-row__title">{{ event.title }}</div>
					</div>
					<div class="cp-event-row__right">
						<span class="cp-chip">{{ event.actor ?? 'runtime' }}</span>
						<span class="cp-chip">{{ formatClock(event.timestamp_epoch_ms) }}</span>
					</div>
					<ExpandableText v-if="event.detail" :text="event.detail" :lines="3" />
				</article>
			</div>

			<div v-else-if="bottomTab === 'reasoning'" class="cp-bottom-list">
				<article v-for="event in reasoning" :key="event.id" class="cp-reasoning-row">
					<div class="cp-reasoning-row__head">
						<div class="cp-reasoning-row__title">{{ event.title }}</div>
						<div class="cp-reasoning-row__meta">
							<StatusBadge :label="event.kind" :tone="statusTone(event.kind)" compact />
							<span class="cp-chip">{{ formatClock(event.timestamp_epoch_ms) }}</span>
						</div>
					</div>
					<ExpandableText v-if="event.detail" :text="event.detail" :lines="4" />
				</article>
				<article v-for="action in branchActions" :key="action.id" class="cp-reasoning-row">
					<div class="cp-reasoning-row__head">
						<div class="cp-reasoning-row__title">{{ action.title }}</div>
						<div class="cp-reasoning-row__meta">
							<StatusBadge :label="action.kind" :tone="statusTone(action.status ?? action.kind)" compact />
							<span class="cp-chip">{{ formatClock(action.timestamp_epoch_ms) }}</span>
						</div>
					</div>
					<ExpandableText v-if="action.detail" :text="action.detail" :lines="4" />
				</article>
			</div>

			<div v-else class="cp-metrics-grid">
				<div v-for="(value, label) in metrics" :key="label" class="cp-metric-card">
					<div class="cp-metric-card__label">{{ label }}</div>
					<div class="cp-metric-card__value">{{ value }}</div>
				</div>
			</div>
		</div>
	</section>
</template>
