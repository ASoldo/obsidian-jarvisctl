<script setup lang="ts">
import type { RepositoryGroupModel } from "../helpers";
import { relativeAge, sessionTone, shortPath } from "../helpers";
import type { JarvisSessionMetadata } from "../../types/domain";
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{
	repositories: RepositoryGroupModel[];
	sessions: JarvisSessionMetadata[];
	selectedNamespace: string | null;
	selectedRepository: string | null;
	selectedSession: JarvisSessionMetadata | null;
}>();

const emit = defineEmits<{
	(event: "select-repository", value: string | null): void;
	(event: "select-namespace", value: string): void;
	(event: "open-ticket", session: JarvisSessionMetadata): void;
	(event: "open-transcript", session: JarvisSessionMetadata): void;
}>();

function backendMarker(backend: string | null | undefined): string {
	const value = (backend ?? "").toLowerCase();
	if (value.includes("codex")) {
		return "CX";
	}
	if (value.includes("native")) {
		return "NT";
	}
	return "RT";
}

function runtimeStateLabel(session: JarvisSessionMetadata): string {
	return session.context?.thread_status ?? (session.agents.some((agent) => agent.running) ? "running" : "idle");
}
</script>

<template>
	<aside class="cp-panel cp-sidebar" aria-label="Source of truth">
		<div class="cp-panel__header">
			<p class="cp-panel__eyebrow">Source Of Truth</p>
			<StatusBadge :label="`${sessions.length} live`" tone="live" compact />
		</div>

		<div class="cp-panel__body cp-panel__body--scroll">
				<section class="cp-sidebar-section">
					<div class="cp-section__header">
						<p class="cp-panel__eyebrow">Projects</p>
					<button
						type="button"
						class="cp-section__meta-button"
						title="Show all projects"
						aria-label="Show all projects"
						@click="emit('select-repository', null)"
					>
						<span class="cp-button__icon" aria-hidden="true">◎</span>
					</button>
					</div>
					<div class="cp-repo-list">
						<div
							v-for="repository in repositories"
							:key="repository.id"
							role="button"
							tabindex="0"
							:class="[
								'cp-repo-item',
								selectedRepository === repository.id && 'is-active',
							]"
							@click="emit('select-repository', repository.id)"
							@keydown.enter.prevent="emit('select-repository', repository.id)"
							@keydown.space.prevent="emit('select-repository', repository.id)"
						>
							<div class="cp-repo-item__top">
								<span class="cp-repo-item__name" :title="repository.label">{{ repository.label }}</span>
								<span class="cp-repo-item__count-chip">{{ repository.sessions.length }}</span>
							</div>
							<p class="cp-repo-item__path" :title="repository.path">{{ shortPath(repository.path) }}</p>
						</div>
					</div>
				</section>

			<section class="cp-sidebar-section cp-sidebar-section--runtime">
				<div class="cp-section__header">
					<p class="cp-panel__eyebrow">Agent Runtime</p>
					<span class="cp-section__meta">{{ sessions.length }} namespaces</span>
					</div>
					<div class="cp-runtime-list">
						<div
							v-for="session in sessions"
							:key="session.namespace"
							role="button"
							tabindex="0"
							:class="[
								'cp-runtime-item',
								'cp-runtime-item--compact',
								selectedNamespace === session.namespace && 'is-active',
							]"
							:title="session.context?.task_title ?? session.namespace"
							@click="emit('select-namespace', session.namespace)"
							@keydown.enter.prevent="emit('select-namespace', session.namespace)"
							@keydown.space.prevent="emit('select-namespace', session.namespace)"
						>
							<div class="cp-runtime-item__row">
								<div class="cp-runtime-item__title" :title="session.namespace">{{ session.namespace }}</div>
								<div class="cp-runtime-item__summary">
									<span
										:class="['cp-runtime-item__state-chip', `is-${sessionTone(session)}`]"
										:title="runtimeStateLabel(session)"
										:aria-label="runtimeStateLabel(session)"
									/>
									<span
										class="cp-runtime-item__meta-chip"
										:title="session.backend"
								>
									{{ backendMarker(session.backend) }}
								</span>
								<span
									class="cp-runtime-item__meta-chip"
									:title="`${session.agents.length} agents`"
								>
									{{ session.agents.length }}A
								</span>
								<span
									class="cp-runtime-item__meta-chip"
									:title="relativeAge(session.created_at_epoch_ms)"
								>
									{{ relativeAge(session.created_at_epoch_ms) }}
									</span>
								</div>
							</div>
						</div>
					</div>
				</section>

			<section class="cp-sidebar-section">
				<div class="cp-section__header">
					<p class="cp-panel__eyebrow">Operational Resources</p>
				</div>
					<div v-if="selectedSession" class="cp-resource-list">
						<div v-if="selectedSession.context?.task_note" class="cp-resource-block">
							<div class="cp-resource-block__label">Execution Contract</div>
							<div
								role="button"
								tabindex="0"
								class="cp-resource-item"
								@click="emit('open-ticket', selectedSession)"
								@keydown.enter.prevent="emit('open-ticket', selectedSession)"
								@keydown.space.prevent="emit('open-ticket', selectedSession)"
							>
								<div class="cp-resource-item__value" :title="selectedSession.context?.task_note ?? ''">
									{{ shortPath(selectedSession.context?.task_note) }}
								</div>
							</div>
						</div>
						<div v-if="selectedSession.context?.transcript_path" class="cp-resource-block">
							<div class="cp-resource-block__label">Transcript</div>
							<div
								role="button"
								tabindex="0"
								class="cp-resource-item"
								@click="emit('open-transcript', selectedSession)"
								@keydown.enter.prevent="emit('open-transcript', selectedSession)"
								@keydown.space.prevent="emit('open-transcript', selectedSession)"
							>
								<div class="cp-resource-item__value" :title="selectedSession.context?.transcript_path ?? ''">
									{{ shortPath(selectedSession.context?.transcript_path) }}
								</div>
							</div>
						</div>
					<div class="cp-resource-block">
						<div class="cp-resource-block__label">Event Log</div>
						<div class="cp-resource-item">
							<div class="cp-resource-item__value" :title="selectedSession.context?.event_log_path ?? ''">
								{{ shortPath(selectedSession.context?.event_log_path) }}
							</div>
						</div>
					</div>
				</div>
				<div v-else class="cp-empty-state">
					Select a namespace to inspect linked ticket, transcript, and event resources.
				</div>
			</section>
		</div>
	</aside>
</template>
