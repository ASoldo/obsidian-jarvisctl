<script setup lang="ts">
import type { JarvisWorkerMetadata } from "../../types/domain";
import {
	humanizeIdentifier,
	statusTone,
	workerBackendLabel,
	workerScope,
	workerStatusLabel,
} from "../helpers";
import EntityAvatar from "./EntityAvatar.vue";
import ExpandableText from "./ExpandableText.vue";
import StatusBadge from "./StatusBadge.vue";
import { computed } from "vue";

const props = defineProps<{
	workers: JarvisWorkerMetadata[];
	selectedWorkerKey: string | null;
}>();

const emit = defineEmits<{
	(event: "select-worker", value: string): void;
}>();

const focusedWorker = computed(() => {
	if (!props.selectedWorkerKey) {
		return props.workers[0] ?? null;
	}
	return (
		props.workers.find(
			(worker) => `${worker.namespace}/${worker.name}` === props.selectedWorkerKey,
		) ?? props.workers[0] ?? null
	);
});

const orderedWorkers = computed(() => {
	const selectedKey = props.selectedWorkerKey;
	return [...props.workers].sort((left, right) => {
		const leftSelected = `${left.namespace}/${left.name}` === selectedKey;
		const rightSelected = `${right.namespace}/${right.name}` === selectedKey;
		if (leftSelected !== rightSelected) {
			return leftSelected ? -1 : 1;
		}
		return `${left.namespace}/${left.name}`.localeCompare(`${right.namespace}/${right.name}`);
	});
});
</script>

<template>
	<div class="cp-workers-panel">
		<div v-if="workers.length === 0" class="cp-empty-state">
			No registered workers are visible from the current `jarvisctl` binary.
		</div>

		<div v-else class="cp-worker-grid">
			<div v-if="focusedWorker" class="cp-worker-focus">
				<div class="cp-worker-focus__head">
					<div>
						<div class="cp-panel__eyebrow">Focused Worker</div>
						<div class="cp-worker-card__title">{{ focusedWorker.name }}</div>
					</div>
					<div class="cp-worker-card__status">
						<StatusBadge
							:label="workerStatusLabel(focusedWorker)"
							:tone="focusedWorker.loaded ? 'live' : statusTone(workerStatusLabel(focusedWorker))"
							compact
						/>
						<span class="cp-chip">{{ focusedWorker.namespace }}</span>
					</div>
				</div>
				<div class="cp-kv-inline">
					<span class="cp-chip">{{ workerBackendLabel(focusedWorker) }}</span>
					<span class="cp-chip">{{ focusedWorker.classes?.join(", ") || "unclassified" }}</span>
					<span class="cp-chip">pool {{ focusedWorker.pool ?? "default" }}</span>
					<span class="cp-chip">slots {{ focusedWorker.availableSlots ?? "n/a" }}/{{ focusedWorker.maxConcurrent ?? "n/a" }}</span>
				</div>
				<div v-if="focusedWorker.admissionReason" class="cp-status-list__message">
					{{ focusedWorker.admissionReason }}
				</div>
			</div>

			<article
				v-for="worker in orderedWorkers"
				:key="`${worker.namespace}/${worker.name}`"
				role="button"
				tabindex="0"
				:class="[
					'cp-worker-card',
					selectedWorkerKey === `${worker.namespace}/${worker.name}` && 'is-active',
				]"
				@click="emit('select-worker', `${worker.namespace}/${worker.name}`)"
				@keydown.enter.prevent="emit('select-worker', `${worker.namespace}/${worker.name}`)"
				@keydown.space.prevent="emit('select-worker', `${worker.namespace}/${worker.name}`)"
			>
				<div class="cp-worker-card__head">
					<div class="cp-entity-heading">
						<EntityAvatar
							kind="worker"
							:scope="workerScope(worker)"
							:tone="worker.loaded ? 'live' : statusTone(workerStatusLabel(worker))"
						/>
						<div class="cp-entity-heading__body">
							<div class="cp-worker-card__title-row">
								<div class="cp-worker-card__title">{{ worker.name }}</div>
								<span class="cp-chip">{{ worker.namespace }}</span>
							</div>
							<div class="cp-worker-card__meta">
								{{ workerBackendLabel(worker) }} · {{ humanizeIdentifier(worker.role) }} ·
								{{ worker.model }}
							</div>
						</div>
					</div>

					<div class="cp-worker-card__status">
						<StatusBadge
							:label="workerStatusLabel(worker)"
							:tone="worker.loaded ? 'live' : statusTone(workerStatusLabel(worker))"
							compact
						/>
						<span class="cp-chip">{{ worker.outputMode ?? "text" }}</span>
					</div>
				</div>

				<div class="cp-worker-card__kv">
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Provider</div>
						<div class="cp-kv-card__value">{{ humanizeIdentifier(worker.provider) }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Class</div>
						<div class="cp-kv-card__value">{{ worker.classes?.join(", ") || "unclassified" }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Pool</div>
						<div class="cp-kv-card__value">{{ worker.pool ?? "default" }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Endpoint</div>
						<div class="cp-kv-card__value cp-kv-card__value--mono">{{ worker.endpoint ?? "n/a" }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Context</div>
						<div class="cp-kv-card__value">
							{{ worker.numCtx ?? "n/a" }} ctx · {{ worker.numPredict ?? "n/a" }} predict
						</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Temperature</div>
						<div class="cp-kv-card__value">{{ worker.temperature ?? "n/a" }}</div>
					</div>
				</div>

				<div class="cp-kv-inline">
					<span class="cp-chip">slots {{ worker.availableSlots ?? "n/a" }}/{{ worker.maxConcurrent ?? "n/a" }}</span>
					<span class="cp-chip">active {{ worker.activeRuns ?? 0 }}</span>
					<span class="cp-chip">pending {{ worker.pendingRuns ?? 0 }}</span>
					<span class="cp-chip">{{ worker.locality ?? workerScope(worker) }}</span>
				</div>

				<div v-if="worker.admissionReason" class="cp-status-list__message">
					{{ worker.admissionReason }}
				</div>

				<ExpandableText
					v-if="worker.systemPrompt"
					:text="worker.systemPrompt"
					:lines="4"
				/>
			</article>
		</div>
	</div>
</template>
