<script setup lang="ts">
import type { RepositoryGroupModel } from "../helpers";
import {
	humanizeIdentifier,
	relativeAge,
	sessionBackendLabel,
	sessionScope,
	sessionTone,
	shortPath,
	statusTone,
	workerBackendLabel,
	workerScope,
	workerStatusLabel,
} from "../helpers";
import type { JarvisClusterNode, JarvisSessionMetadata, JarvisWorkerMetadata } from "../../types/domain";
import EntityAvatar from "./EntityAvatar.vue";
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{
	repositories: RepositoryGroupModel[];
	sessions: JarvisSessionMetadata[];
	workers: JarvisWorkerMetadata[];
	nodes: JarvisClusterNode[];
	selectedNamespace: string | null;
	selectedWorkerKey: string | null;
	selectedRepository: string | null;
	selectedSession: JarvisSessionMetadata | null;
	collapsed: boolean;
}>();

const emit = defineEmits<{
	(event: "toggle-collapsed"): void;
	(event: "select-repository", value: string | null): void;
	(event: "select-namespace", value: string): void;
	(event: "select-worker", value: string): void;
	(event: "open-ticket", session: JarvisSessionMetadata): void;
	(event: "open-transcript", session: JarvisSessionMetadata): void;
	(event: "close-namespace", session: JarvisSessionMetadata): void;
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

function nodeTone(node: JarvisClusterNode): "live" | "warning" | "idle" {
	const status = (node.status ?? "").toLowerCase();
	const detail = (node.detail ?? "").toLowerCase();
	if (status.includes("cordon") || status.includes("offline") || detail.includes("cordon")) {
		return "warning";
	}
	return status.includes("ready") || status.includes("online") || status.includes("local") || detail.includes("ssh=")
		? "live"
		: "idle";
}

function nodeRole(node: JarvisClusterNode): string {
	const labels = [];
	const detail = (node.detail ?? "").toLowerCase();
	if (detail.includes("control-plane")) {
		labels.push("control");
	}
	if (detail.includes("worker")) {
		labels.push("worker");
	}
	if (detail.includes("local")) {
		labels.push("local");
	}
	return labels.join(", ") || "node";
}

function nodeStatusLabel(node: JarvisClusterNode): string {
	const status = node.status?.trim();
	return status || (nodeTone(node) === "live" ? "ready" : "idle");
}
</script>

<template>
	<aside :class="['cp-panel cp-sidebar', collapsed && 'is-collapsed']" aria-label="Source of truth">
		<div class="cp-panel__header">
			<p class="cp-panel__eyebrow">Source Of Truth</p>
			<div class="cp-sidebar__header-actions">
				<StatusBadge :label="`${sessions.length} live`" tone="live" compact />
				<button
					type="button"
					class="cp-icon-button cp-icon-button--circle cp-sidebar__collapse-button"
					:title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
					:aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
					@click="emit('toggle-collapsed')"
				>
					{{ collapsed ? "›" : "‹" }}
				</button>
			</div>
		</div>

		<div v-if="collapsed" class="cp-sidebar-rail" aria-label="Collapsed source navigation">
			<button
				type="button"
				class="cp-sidebar-rail__button"
				title="Show all projects"
				aria-label="Show all projects"
				@click="emit('select-repository', null)"
			>
				<span aria-hidden="true">◎</span>
				<span class="cp-sidebar-rail__badge">{{ repositories.length }}</span>
			</button>
			<button
				type="button"
				class="cp-sidebar-rail__button"
				title="Cluster nodes"
				aria-label="Cluster nodes"
			>
				<span aria-hidden="true">⌬</span>
				<span class="cp-sidebar-rail__badge">{{ nodes.length }}</span>
			</button>
			<button
				v-for="session in sessions.slice(0, 6)"
				:key="session.namespace"
				type="button"
				:class="['cp-sidebar-rail__button', selectedNamespace === session.namespace && 'is-active']"
				:title="session.context?.task_title ?? session.namespace"
				:aria-label="`Select namespace ${session.namespace}`"
				@click="emit('select-namespace', session.namespace)"
			>
				<EntityAvatar kind="session" :scope="sessionScope(session)" :tone="sessionTone(session)" size="sm" />
			</button>
			<button
				type="button"
				class="cp-sidebar-rail__button"
				title="Worker pool"
				aria-label="Worker pool"
			>
				<span aria-hidden="true">⬡</span>
				<span class="cp-sidebar-rail__badge">{{ workers.length }}</span>
			</button>
			<button
				v-if="selectedSession"
				type="button"
				class="cp-sidebar-rail__button"
				title="Open selected ticket"
				aria-label="Open selected ticket"
				@click="emit('open-ticket', selectedSession)"
			>
				<span aria-hidden="true">◇</span>
			</button>
		</div>

		<div v-else class="cp-panel__body cp-panel__body--scroll">
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

			<section class="cp-sidebar-section">
				<div class="cp-section__header">
					<p class="cp-panel__eyebrow">Cluster Nodes</p>
					<span class="cp-section__meta">{{ nodes.length }} nodes</span>
				</div>
				<div v-if="nodes.length === 0" class="cp-empty-state">
					No cluster nodes are registered.
				</div>
				<div v-else class="cp-node-list">
					<div
						v-for="node in nodes"
						:key="node.name"
						class="cp-node-list__item"
						:title="node.detail"
					>
						<div class="cp-node-list__head">
							<span :class="['cp-node-list__dot', `is-${nodeTone(node)}`]" />
							<div class="cp-node-list__copy">
								<div class="cp-node-list__name">{{ node.name }}</div>
								<div class="cp-node-list__meta">{{ nodeRole(node) }}</div>
							</div>
							<StatusBadge :label="nodeStatusLabel(node)" :tone="nodeTone(node)" compact />
						</div>
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
								<div class="cp-runtime-item__identity">
									<EntityAvatar kind="session" :scope="sessionScope(session)" :tone="sessionTone(session)" size="sm" />
									<div class="cp-runtime-item__identity-copy">
										<div class="cp-runtime-item__title" :title="session.namespace">{{ session.namespace }}</div>
										<div class="cp-runtime-item__subtitle">{{ sessionBackendLabel(session) }}</div>
									</div>
								</div>
								<button
									type="button"
									class="cp-mini-button cp-button--danger cp-runtime-item__close"
									title="Close namespace"
									aria-label="Close namespace"
									@click.stop="emit('close-namespace', session)"
								>
									×
								</button>
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
					<p class="cp-panel__eyebrow">Worker Pool</p>
					<span class="cp-section__meta">{{ workers.length }} workers</span>
				</div>
				<div v-if="workers.length === 0" class="cp-empty-state">
					No worker resources are visible yet.
				</div>
				<div v-else class="cp-worker-list">
					<div
						v-for="worker in workers"
						:key="`${worker.namespace}/${worker.name}`"
						role="button"
						tabindex="0"
						:class="[
							'cp-worker-list__item',
							selectedWorkerKey === `${worker.namespace}/${worker.name}` && 'is-active',
						]"
						:title="`${worker.name} · ${worker.model}`"
						@click="emit('select-worker', `${worker.namespace}/${worker.name}`)"
						@keydown.enter.prevent="emit('select-worker', `${worker.namespace}/${worker.name}`)"
						@keydown.space.prevent="emit('select-worker', `${worker.namespace}/${worker.name}`)"
					>
						<div class="cp-worker-list__head">
							<div class="cp-runtime-item__identity">
								<EntityAvatar
									kind="worker"
									:scope="workerScope(worker)"
									:tone="worker.loaded ? 'live' : statusTone(workerStatusLabel(worker))"
									size="sm"
								/>
								<div class="cp-runtime-item__identity-copy">
									<div class="cp-runtime-item__title">{{ worker.name }}</div>
									<div class="cp-runtime-item__subtitle">
										{{ worker.model }}
									</div>
								</div>
							</div>
							<div class="cp-worker-list__status">
								<StatusBadge
									:label="workerStatusLabel(worker)"
									:tone="worker.loaded ? 'live' : statusTone(workerStatusLabel(worker))"
									compact
								/>
							</div>
						</div>
						<div class="cp-worker-list__chips">
							<span class="cp-chip">{{ workerBackendLabel(worker) }}</span>
							<span class="cp-chip">{{ humanizeIdentifier(worker.role) }}</span>
							<span class="cp-chip">pool {{ worker.pool ?? "default" }}</span>
							<span class="cp-chip">{{ worker.classes?.[0] ?? "unclassified" }}</span>
							<span class="cp-chip">{{ worker.activeRuns ?? 0 }}/{{ worker.maxConcurrent ?? 0 }} active</span>
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
