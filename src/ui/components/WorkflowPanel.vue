<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { JarvisSessionMetadata } from "../../types/domain";
import { buildWorkflow, formatClock, shortPath, statusTone, type WorkflowStepModel } from "../helpers";
import StatusBadge from "./StatusBadge.vue";
import ExpandableText from "./ExpandableText.vue";

const props = defineProps<{
	session: JarvisSessionMetadata | null;
}>();

const steps = computed(() => buildWorkflow(props.session));
const selectedStepId = ref<string | null>(null);

watch(
	() => props.session?.namespace,
	() => {
		selectedStepId.value = steps.value[0]?.id ?? null;
	},
	{ immediate: true },
);

const selectedStep = computed<WorkflowStepModel | null>(
	() => steps.value.find((step) => step.id === selectedStepId.value) ?? steps.value[0] ?? null,
);
</script>

<template>
	<aside class="cp-panel cp-workflow-panel">
		<div class="cp-panel__header">
			<div>
				<p class="cp-panel__eyebrow">Automation Workflow</p>
				<h2 class="cp-panel__title">Execution Graph</h2>
			</div>
			<StatusBadge
				:label="session?.context?.thread_status ?? 'idle'"
				:tone="statusTone(session?.context?.thread_status)"
				compact
			/>
		</div>

		<div class="cp-panel__body cp-panel__body--scroll">
			<div v-if="!session" class="cp-empty-state">Select a namespace to inspect its automation chain.</div>
			<template v-else>
				<div class="cp-workflow-shell">
					<div class="cp-workflow-lane cp-grid-surface">
						<div class="cp-workflow-line" />
						<button
							v-for="(step, index) in steps"
							:key="step.id"
							type="button"
							:class="['cp-workflow-step', selectedStepId === step.id && 'is-active']"
							@click="selectedStepId = step.id"
						>
								<div class="cp-workflow-step__rail">
									<div class="cp-workflow-step__dot" />
									<div class="cp-workflow-step__count">{{ index + 1 }}</div>
								</div>
							<div class="cp-workflow-step__card">
								<div class="cp-workflow-step__icon">{{ step.icon }}</div>
								<div class="cp-workflow-step__body">
									<div class="cp-workflow-step__title">{{ step.label }}</div>
									<div
										class="cp-workflow-step__detail"
										:title="step.detail ?? 'waiting for runtime data'"
									>
										{{ step.detail ?? "waiting for runtime data" }}
									</div>
								</div>
								<StatusBadge :label="step.status" :tone="statusTone(step.status)" compact />
							</div>
						</button>
					</div>

					<div v-if="selectedStep" class="cp-workflow-inspector">
						<div class="cp-workflow-inspector__header">
							<h3 class="cp-workflow-inspector__title">{{ selectedStep.label }}</h3>
							<span class="cp-chip">{{ formatClock(Date.now()) }}</span>
						</div>
						<div class="cp-workflow-inspector__meta">
							<span class="cp-chip">{{ session.namespace }}</span>
							<StatusBadge :label="selectedStep.status" :tone="statusTone(selectedStep.status)" compact />
						</div>
						<ExpandableText
							:text="selectedStep.detail ?? 'No branch detail available.'"
							:always-expanded="true"
						/>
						<div class="cp-workflow-inspector__resource">
							<div class="cp-panel__eyebrow">Execution Contract</div>
							<div class="cp-workflow-inspector__copy" :title="session.context?.task_note ?? ''">
								{{ shortPath(session.context?.task_note) }}
							</div>
						</div>
					</div>
				</div>
			</template>
		</div>
	</aside>
</template>
