<script setup lang="ts">
import type { JarvisDashboardHost } from "../bridge";
import type { JarvisSessionMetadata } from "../../types/domain";
import {
	applicationHealthStatus,
	applicationSyncStatus,
	formatDateTime,
	sessionTone,
	shortPath,
} from "../helpers";
import StatusBadge from "./StatusBadge.vue";

defineProps<{
	host: JarvisDashboardHost;
	sessions: JarvisSessionMetadata[];
}>();
</script>

<template>
	<div class="cp-applications">
		<div class="cp-table-shell">
			<div class="cp-table-shell__head">
				<span>Application</span>
				<span>Sync</span>
				<span>Health</span>
				<span>Updated</span>
				<span>Actions</span>
			</div>
			<div class="cp-table-shell__body">
				<div v-if="sessions.length === 0" class="cp-empty-state">
					No namespaces match the current filter.
				</div>
				<div
					v-for="session in sessions"
					:key="session.namespace"
					class="cp-table-row"
				>
					<div class="cp-table-row__primary">
						<div class="cp-table-row__title">{{ session.namespace }}</div>
						<div class="cp-table-row__subtitle">
							{{ session.context?.task_title ?? shortPath(session.context?.task_note) }}
						</div>
					</div>
					<div class="cp-table-row__cell">
						<StatusBadge :label="applicationSyncStatus(session)" :tone="sessionTone(session)" compact />
					</div>
					<div class="cp-table-row__cell">
						<StatusBadge
							:label="applicationHealthStatus(session)"
							:tone="session.context?.last_error ? 'error' : session.agents.some((agent) => agent.running) ? 'live' : 'idle'"
							compact
						/>
					</div>
					<div class="cp-table-row__cell cp-table-row__cell--mono">
						{{ formatDateTime(session.created_at_epoch_ms) }}
					</div>
					<div class="cp-table-row__actions">
						<button type="button" class="cp-mini-button cp-mini-button--primary" @click="host.attach(session)">
							Attach
						</button>
						<button
							type="button"
							class="cp-mini-button"
							:disabled="!session.context?.task_note"
							@click="host.continueTicket(session)"
						>
							Continue
						</button>
						<button
							type="button"
							class="cp-mini-button"
							:disabled="!session.context?.task_note"
							@click="host.openTicket(session)"
						>
							Ticket
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
