<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { JarvisSessionMetadata } from "../../types/domain";
import {
	buildWorkflow,
	shortPath,
	statusTone,
	type WorkflowStepModel,
} from "../helpers";
import StatusBadge from "./StatusBadge.vue";
import ExpandableText from "./ExpandableText.vue";

const props = defineProps<{
	session: JarvisSessionMetadata | null;
	embedded?: boolean;
}>();

const steps = computed(() => buildWorkflow(props.session));
const selectedStepId = ref<string | null>(null);
const inspectorCollapsed = ref(false);

watch(
	() => props.session?.namespace,
	() => {
		selectedStepId.value =
			steps.value.find((step) => {
				const tone = statusTone(step.status);
				return tone === "live" || tone === "warning" || tone === "error";
			})?.id ??
			steps.value[0]?.id ??
			null;
		inspectorCollapsed.value = false;
	},
	{ immediate: true },
);

const selectedStep = computed<WorkflowStepModel | null>(
	() => steps.value.find((step) => step.id === selectedStepId.value) ?? steps.value[0] ?? null,
);
</script>

<template>
	<component
		:is="embedded ? 'div' : 'aside'"
		:class="[embedded ? 'cp-workflow-panel-embedded' : 'cp-panel cp-workflow-panel']"
	>
		<div v-if="!embedded" class="cp-panel__header">
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

		<div :class="[embedded ? 'cp-workflow-panel__body-embedded' : 'cp-panel__body cp-panel__body--scroll']">
			<div v-if="!session" class="cp-empty-state">Select a namespace to inspect its automation chain.</div>
			<template v-else>
				<div class="cp-workflow-linear">
					<div class="cp-workflow-step-list">
						<button
							v-for="step in steps"
							:key="step.id"
							type="button"
							:class="[
								'cp-workflow-step-card',
								selectedStep?.id === step.id && 'is-active',
							]"
							@click="selectedStepId = step.id"
						>
							<span class="cp-workflow-step-card__icon">{{ step.icon }}</span>
							<span class="cp-workflow-step-card__copy">
								<span class="cp-workflow-step-card__title">{{ step.label }}</span>
								<span class="cp-workflow-step-card__detail">{{ step.detail }}</span>
							</span>
							<StatusBadge :label="step.status" :tone="statusTone(step.status)" compact />
						</button>
					</div>

					<aside
						v-if="selectedStep"
						class="grid gap-3 rounded-2xl border border-[color:var(--cp-border)] bg-[color:var(--cp-panel)] p-4"
					>
						<div class="cp-workflow-inspector__header">
							<h3 class="cp-workflow-inspector__title">{{ selectedStep.label }}</h3>
							<div class="cp-workflow-inspector__meta">
								<span class="cp-chip">{{ session.namespace }}</span>
								<StatusBadge :label="selectedStep.status" :tone="statusTone(selectedStep.status)" compact />
								<button
									type="button"
									class="cp-icon-button cp-icon-button--circle"
									:title="inspectorCollapsed ? 'Expand execution detail' : 'Collapse execution detail'"
									@click="inspectorCollapsed = !inspectorCollapsed"
								>
									{{ inspectorCollapsed ? "+" : "−" }}
								</button>
							</div>
						</div>
						<div v-if="!inspectorCollapsed" class="grid gap-3">
							<ExpandableText
								:text="selectedStep.detail ?? 'No branch detail available.'"
								:always-expanded="true"
							/>
							<div class="grid gap-2 rounded-2xl border border-[color:var(--cp-border)] bg-[color:var(--cp-panel-strong)] px-4 py-3">
								<div class="cp-panel__eyebrow">Execution Contract</div>
								<div class="cp-workflow-inspector__copy" :title="session.context?.task_note ?? ''">
									{{ shortPath(session.context?.task_note) }}
								</div>
							</div>
						</div>
					</aside>
				</div>
			</template>
		</div>
	</component>
</template>
