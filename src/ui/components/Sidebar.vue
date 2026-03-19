<script setup lang="ts">
import type { RepositoryGroupModel } from "../helpers";
import { relativeAge, sessionTone, shortPath, truncate } from "../helpers";
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
</script>

<template>
	<aside class="cp-panel cp-sidebar">
		<div class="cp-panel__header">
			<div>
				<p class="cp-panel__eyebrow">Source Of Truth</p>
				<h2 class="cp-panel__title">Repositories &amp; Agents</h2>
			</div>
			<StatusBadge :label="`${sessions.length} live`" tone="live" compact />
		</div>

		<div class="cp-panel__body cp-panel__body--scroll">
			<section class="cp-sidebar-section">
				<div class="cp-section__header">
					<h3 class="cp-section__title">Projects</h3>
					<button
						type="button"
						class="cp-section__meta-button"
						@click="emit('select-repository', null)"
					>
						All
					</button>
				</div>
				<div class="cp-repo-list">
					<button
						v-for="repository in repositories"
						:key="repository.id"
						type="button"
						:class="[
							'cp-repo-item',
							selectedRepository === repository.id && 'is-active',
						]"
						@click="emit('select-repository', repository.id)"
					>
						<div class="cp-repo-item__top">
							<span class="cp-repo-item__name">{{ repository.label }}</span>
							<span class="cp-repo-item__count">{{ repository.sessions.length }}</span>
						</div>
						<p class="cp-repo-item__path" :title="repository.path">{{ shortPath(repository.path) }}</p>
					</button>
				</div>
			</section>

			<section class="cp-sidebar-section">
				<div class="cp-section__header">
					<h3 class="cp-section__title">Agent Runtime</h3>
					<span class="cp-section__meta">{{ sessions.length }} namespaces</span>
				</div>
				<div class="cp-runtime-list">
					<button
						v-for="session in sessions"
						:key="session.namespace"
						type="button"
						:class="[
							'cp-runtime-item',
							selectedNamespace === session.namespace && 'is-active',
						]"
						:title="session.context?.task_title ?? session.namespace"
						@click="emit('select-namespace', session.namespace)"
					>
						<div class="cp-runtime-item__top">
							<div>
								<div class="cp-runtime-item__title">{{ session.namespace }}</div>
								<div class="cp-runtime-item__subtitle">
									{{ truncate(session.context?.task_title ?? "Live runtime namespace", 42) }}
								</div>
							</div>
							<StatusBadge
								:label="session.context?.thread_status ?? (session.agents.some((agent) => agent.running) ? 'running' : 'idle')"
								:tone="sessionTone(session)"
								compact
							/>
						</div>
						<div class="cp-runtime-item__meta">
							<span>{{ session.backend }}</span>
							<span>{{ session.agents.length }} agents</span>
							<span>{{ relativeAge(session.created_at_epoch_ms) }}</span>
						</div>
					</button>
				</div>
			</section>

			<section class="cp-sidebar-section">
				<div class="cp-section__header">
					<h3 class="cp-section__title">Operational Resources</h3>
				</div>
				<div v-if="selectedSession" class="cp-resource-list">
					<button
						v-if="selectedSession.context?.task_note"
						type="button"
						class="cp-resource-item"
						@click="emit('open-ticket', selectedSession)"
					>
						<div class="cp-resource-item__label">Execution Contract</div>
						<div class="cp-resource-item__value" :title="selectedSession.context?.task_note ?? ''">
							{{ shortPath(selectedSession.context?.task_note) }}
						</div>
					</button>
					<button
						v-if="selectedSession.context?.transcript_path"
						type="button"
						class="cp-resource-item"
						@click="emit('open-transcript', selectedSession)"
					>
						<div class="cp-resource-item__label">Transcript</div>
						<div class="cp-resource-item__value" :title="selectedSession.context?.transcript_path ?? ''">
							{{ shortPath(selectedSession.context?.transcript_path) }}
						</div>
					</button>
					<div class="cp-resource-item">
						<div class="cp-resource-item__label">Event Log</div>
						<div class="cp-resource-item__value" :title="selectedSession.context?.event_log_path ?? ''">
							{{ shortPath(selectedSession.context?.event_log_path) }}
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
