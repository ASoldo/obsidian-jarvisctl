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

type ObservabilitySection = "logs" | "events" | "reasoning" | "metrics";

const props = defineProps<{
	session: JarvisSessionMetadata | null;
	activitySections: JarvisActivitySection[];
	section: ObservabilitySection;
}>();

const logLines = computed(() => flattenActivityLines(props.activitySections).slice(-40));
const reasoning = computed(() => reasoningEntries(props.session).slice(-20).reverse());
const branchActions = computed(() => collectRecentActions(props.session?.context?.subagents).slice(0, 12));
const metrics = computed(() => metricsSnapshot(props.session));
</script>

<template>
	<div v-if="!session" class="cp-empty-state">
		Select a namespace to inspect runtime observability.
	</div>

	<div v-else-if="section === 'logs'" class="cp-bottom-console">
		<div v-if="logLines.length === 0" class="cp-empty-state">No observed log lines yet.</div>
		<div v-else class="cp-console cp-console--dense">
			<div v-for="(line, index) in logLines" :key="index" class="cp-console__line">
				{{ line }}
			</div>
		</div>
	</div>

	<div v-else-if="section === 'events'" class="cp-bottom-list cp-timeline-list">
		<article
			v-for="event in (session.context?.recent_events ?? []).slice(-20).reverse()"
			:key="event.id"
			class="cp-timeline-entry cp-event-row"
		>
			<div class="cp-timeline-entry__rail">
				<div :class="['cp-timeline-entry__dot', `is-${statusTone(event.status ?? event.kind)}`]" />
				<div class="cp-timeline-entry__line" />
			</div>
			<div class="cp-timeline-entry__body">
				<div class="cp-event-row__left">
					<StatusBadge :label="event.kind" :tone="statusTone(event.status ?? event.kind)" compact />
					<div class="cp-event-row__title">{{ event.title }}</div>
				</div>
				<div class="cp-event-row__right">
					<span class="cp-chip">{{ event.actor ?? "runtime" }}</span>
					<span class="cp-chip">{{ formatClock(event.timestamp_epoch_ms) }}</span>
				</div>
				<ExpandableText v-if="event.detail" :text="event.detail" :lines="3" />
			</div>
		</article>
	</div>

	<div v-else-if="section === 'reasoning'" class="cp-bottom-list cp-timeline-list">
		<article v-for="event in reasoning" :key="event.id" class="cp-timeline-entry cp-reasoning-row">
			<div class="cp-timeline-entry__rail">
				<div :class="['cp-timeline-entry__dot', `is-${statusTone(event.kind)}`]" />
				<div class="cp-timeline-entry__line" />
			</div>
			<div class="cp-timeline-entry__body">
				<div class="cp-reasoning-row__head">
					<div class="cp-reasoning-row__title">{{ event.title }}</div>
					<div class="cp-reasoning-row__meta">
						<StatusBadge :label="event.kind" :tone="statusTone(event.kind)" compact />
						<span class="cp-chip">{{ formatClock(event.timestamp_epoch_ms) }}</span>
					</div>
				</div>
				<ExpandableText v-if="event.detail" :text="event.detail" :lines="4" />
			</div>
		</article>

		<article v-for="action in branchActions" :key="action.id" class="cp-timeline-entry cp-reasoning-row">
			<div class="cp-timeline-entry__rail">
				<div :class="['cp-timeline-entry__dot', `is-${statusTone(action.status ?? action.kind)}`]" />
				<div class="cp-timeline-entry__line" />
			</div>
			<div class="cp-timeline-entry__body">
				<div class="cp-reasoning-row__head">
					<div class="cp-reasoning-row__title">{{ action.title }}</div>
					<div class="cp-reasoning-row__meta">
						<StatusBadge :label="action.kind" :tone="statusTone(action.status ?? action.kind)" compact />
						<span class="cp-chip">{{ formatClock(action.timestamp_epoch_ms) }}</span>
					</div>
				</div>
				<ExpandableText v-if="action.detail" :text="action.detail" :lines="4" />
			</div>
		</article>
	</div>

	<div v-else class="cp-metrics-grid">
		<div v-for="(value, label) in metrics" :key="label" class="cp-metric-card">
			<div class="cp-metric-card__label">{{ label }}</div>
			<div class="cp-metric-card__value">{{ value }}</div>
		</div>
	</div>
</template>
