<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { JarvisDashboardHost } from "../bridge";
import type {
	JarvisControlPlaneResource,
	JarvisControlPlaneState,
	JarvisServiceStatus,
	JarvisSessionMetadata,
	JarvisWorkerMetadata,
	JarvisWorkerOffloadRequest,
	JarvisWorkerOffloadResult,
} from "../../types/domain";
import { humanizeIdentifier, shortPath, statusTone, truncate } from "../helpers";
import ExpandableText from "./ExpandableText.vue";
import StatusBadge from "./StatusBadge.vue";

interface OffloadPreset {
	id: string;
	label: string;
	serviceName: string;
	prompt: string;
	hint: string;
}

interface ServiceLaneCard {
	resource: JarvisControlPlaneResource<JarvisServiceStatus>;
	workers: JarvisWorkerMetadata[];
	hotPath: boolean;
	providers: string[];
	models: string[];
}

const props = defineProps<{
	host: JarvisDashboardHost;
	session: JarvisSessionMetadata | null;
	sessions: JarvisSessionMetadata[];
	controlPlane: JarvisControlPlaneState | null;
	workers: JarvisWorkerMetadata[];
}>();

const selectedRuntimeNamespace = ref("");
const selectedServiceName = ref("");
const prompt = ref("");
const lastResult = ref<JarvisWorkerOffloadResult | null>(null);
const errorMessage = ref<string | null>(null);
const running = ref(false);

const presets: OffloadPreset[] = [
	{
		id: "route",
		label: "Route Task",
		serviceName: "routing-svc",
		prompt:
			'Return strict JSON only with schema {"lane":"junior-code|mid-code|heavy-code","confidence":number,"reason":"string"}. Decide lane for task: write a JavaScript function normalizeTitleCase(input) that converts slug-like text into title-cased words.',
		hint: "Nemotron route lane on NVIDIA Build",
	},
	{
		id: "code",
		label: "Generate Helper",
		serviceName: "code-svc",
		prompt:
			'Return strict JSON only with schema {"language":"javascript","entrypoint":"string","code":"string"}. Write a JavaScript function named normalizeTitleCase(input) that converts slug-like text into title-cased words separated by single spaces.',
		hint: "Kimi junior-code lane on NVIDIA Build",
	},
];

const boundRuntimeSessions = computed(() => {
	if (!props.controlPlane) {
		return [];
	}
	return [...props.sessions]
		.filter((session) => session.context?.control_namespace?.trim() === props.controlPlane?.namespace)
		.sort((left, right) => right.created_at_epoch_ms - left.created_at_epoch_ms);
});

const attachedToControlNamespace = computed(() => boundRuntimeSessions.value.length > 0);

const selectedRuntime = computed(() => {
	if (selectedRuntimeNamespace.value) {
		return (
			boundRuntimeSessions.value.find((session) => session.namespace === selectedRuntimeNamespace.value) ??
			null
		);
	}
	return boundRuntimeSessions.value[0] ?? null;
});

const serviceLaneCards = computed<ServiceLaneCard[]>(() => {
	if (!props.controlPlane) {
		return [];
	}
	const workerIndex = new Map<string, JarvisWorkerMetadata>(
		props.workers.map((worker) => [`${worker.namespace}/${worker.name}`, worker] as const),
	);
	return [...props.controlPlane.services]
		.map((resource) => {
			const workers = resource.status.endpoints
				.map((endpoint) => workerIndex.get(endpoint))
				.filter((worker): worker is JarvisWorkerMetadata => Boolean(worker));
			return {
				resource,
				workers,
				hotPath:
					props.controlPlane?.namespace === "openclaw" &&
					(resource.summary.name === "routing-svc" || resource.summary.name === "code-svc"),
				providers: [...new Set(workers.map((worker) => worker.provider).filter(Boolean))],
				models: [...new Set(workers.map((worker) => worker.model).filter(Boolean))],
			};
		})
		.sort((left, right) => {
			if (left.hotPath !== right.hotPath) {
				return left.hotPath ? -1 : 1;
			}
			return left.resource.summary.name.localeCompare(right.resource.summary.name);
		});
});

const stableNvidiaCards = computed(() =>
	serviceLaneCards.value.filter(
		(card) => card.hotPath && card.providers.length > 0 && card.providers.every((provider) => provider === "nvidia"),
	),
);

watch(
	() => serviceLaneCards.value.map((card) => card.resource.summary.name).join("|"),
	() => {
		if (!selectedServiceName.value || !serviceLaneCards.value.some((card) => card.resource.summary.name === selectedServiceName.value)) {
			selectedServiceName.value =
				serviceLaneCards.value.find((card) => card.resource.summary.name === "code-svc")?.resource.summary.name ??
				serviceLaneCards.value[0]?.resource.summary.name ??
				"";
		}
	},
	{ immediate: true },
);

watch(
	() => [
		boundRuntimeSessions.value.map((session) => session.namespace).join("|"),
		props.session?.namespace ?? "",
	] as const,
	() => {
		const focusedNamespace = props.session?.namespace;
		const focusedBound =
			focusedNamespace &&
			boundRuntimeSessions.value.some((session) => session.namespace === focusedNamespace);
		if (focusedBound) {
			selectedRuntimeNamespace.value = focusedNamespace;
			return;
		}
		if (
			!selectedRuntimeNamespace.value ||
			!boundRuntimeSessions.value.some((session) => session.namespace === selectedRuntimeNamespace.value)
		) {
			selectedRuntimeNamespace.value = boundRuntimeSessions.value[0]?.namespace ?? "";
		}
	},
	{ immediate: true },
);

function presetForService(serviceName: string): OffloadPreset | null {
	return presets.find((preset) => preset.serviceName === serviceName) ?? null;
}

function loadPreset(preset: OffloadPreset): void {
	selectedServiceName.value = preset.serviceName;
	prompt.value = preset.prompt;
	errorMessage.value = null;
}

function parseResponse(response: string | null | undefined): string {
	if (!response) {
		return "No inline response captured.";
	}
	try {
		return JSON.stringify(JSON.parse(response), null, 2);
	} catch {
		return response;
	}
}

function formatError(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return String(error);
}

function buildRequest(): JarvisWorkerOffloadRequest | null {
	if (!selectedRuntime.value || !props.controlPlane) {
		return null;
	}
	const serviceName = selectedServiceName.value.trim();
	const requestPrompt = prompt.value.trim();
	if (!serviceName || !requestPrompt) {
		return null;
	}
	return {
		controlNamespace: props.controlPlane.namespace,
		serviceName,
		prompt: requestPrompt,
	};
}

async function runOffload(): Promise<void> {
	if (!selectedRuntime.value) {
		return;
	}
	const request = buildRequest();
	if (!request) {
		errorMessage.value = "Select a service and enter a bounded prompt first.";
		return;
	}
	running.value = true;
	errorMessage.value = null;
	try {
		lastResult.value = await props.host.runWorkerOffload(selectedRuntime.value, request);
	} catch (error) {
		errorMessage.value = formatError(error);
	} finally {
		running.value = false;
	}
}
</script>

<template>
	<section v-if="attachedToControlNamespace && controlPlane" class="cp-control-plane-section">
		<div class="cp-control-plane-section__head">
			<div>
				<p class="cp-panel__eyebrow">OpenClaw Runtime Offload</p>
				<h4 class="cp-control-plane-section__title">Run worker services from the parked namespace</h4>
			</div>
			<div class="cp-control-plane-card__badges">
				<StatusBadge
					:label="stableNvidiaCards.length >= 2 ? 'nvidia hot path' : 'runtime attached'"
					:tone="stableNvidiaCards.length >= 2 ? 'live' : 'info'"
					compact
				/>
				<span class="cp-chip">{{ selectedRuntime?.namespace ?? session?.namespace ?? "n/a" }}</span>
			</div>
		</div>

		<div class="cp-kv-inline">
			<span class="cp-chip">control ns {{ controlPlane.namespace }}</span>
			<span class="cp-chip">runtime {{ selectedRuntime?.namespace ?? "n/a" }}</span>
			<span v-if="stableNvidiaCards.length >= 2" class="cp-chip">
				NVIDIA Build stable lanes active
			</span>
		</div>

		<div class="cp-offload-service-grid">
			<article
				v-for="card in serviceLaneCards.slice(0, 4)"
				:key="card.resource.summary.name"
				class="cp-control-plane-card cp-offload-card"
			>
				<div class="cp-control-plane-card__head">
					<div>
						<div class="cp-control-plane-card__title">{{ card.resource.summary.name }}</div>
						<div class="cp-control-plane-card__meta">
							{{ card.workers.length }} endpoints · {{ humanizeIdentifier(card.resource.status.strategy) }}
						</div>
					</div>
					<div class="cp-control-plane-card__badges">
						<StatusBadge
							:label="card.hotPath ? 'stable lane' : 'service lane'"
							:tone="card.hotPath ? 'live' : 'info'"
							compact
						/>
						<StatusBadge
							v-if="card.providers[0]"
							:label="card.providers.join(', ')"
							:tone="card.providers.every((provider) => provider === 'nvidia') ? 'live' : 'info'"
							compact
						/>
					</div>
				</div>
				<div class="cp-kv-inline">
					<span v-if="card.resource.status.class_name" class="cp-chip">
						class {{ card.resource.status.class_name }}
					</span>
					<span
						v-for="worker in card.workers.slice(0, 2)"
						:key="worker.name"
						class="cp-chip"
					>
						{{ worker.name }}
					</span>
				</div>
				<div class="cp-status-list__message">
					{{ truncate(card.models.join(" · ") || "No resolved worker model", 180) }}
				</div>
				<div class="cp-offload-card__actions">
					<button
						v-if="presetForService(card.resource.summary.name)"
						type="button"
						class="cp-button"
						@click="loadPreset(presetForService(card.resource.summary.name)!)"
					>
						Load preset
					</button>
					<button
						type="button"
						class="cp-button"
						@click="selectedServiceName = card.resource.summary.name"
					>
						Use service
					</button>
				</div>
			</article>
		</div>

		<div class="cp-offload-workbench">
			<div class="cp-operator-compose__header">
				<div>
					<p class="cp-panel__eyebrow">Offload Composer</p>
					<div class="cp-operator-stream__title">Bound a prompt to a worker service</div>
				</div>
				<div class="cp-operator-action-grid">
					<button type="button" class="cp-button" @click="loadPreset(presets[0])">
						Route preset
					</button>
					<button type="button" class="cp-button" @click="loadPreset(presets[1])">
						Code preset
					</button>
				</div>
			</div>

			<div class="cp-operator-form">
				<div class="cp-form-field">
					<label class="cp-form-field__label" for="cp-offload-runtime">Runtime</label>
					<select id="cp-offload-runtime" v-model="selectedRuntimeNamespace" class="cp-form-select">
						<option
							v-for="runtime in boundRuntimeSessions"
							:key="runtime.namespace"
							:value="runtime.namespace"
						>
							{{ runtime.namespace }}
						</option>
					</select>
				</div>
				<div class="cp-form-field">
					<label class="cp-form-field__label" for="cp-offload-service">Service</label>
					<select id="cp-offload-service" v-model="selectedServiceName" class="cp-form-select">
						<option
							v-for="card in serviceLaneCards"
							:key="card.resource.summary.name"
							:value="card.resource.summary.name"
						>
							{{ card.resource.summary.name }}
						</option>
					</select>
				</div>
				<div class="cp-form-field cp-form-field--full">
					<label class="cp-form-field__label">Runtime Path</label>
					<div class="cp-operator-note">
						{{ selectedRuntime?.namespace ?? "runtime" }} -> {{ controlPlane.namespace }}/{{ selectedServiceName || "service" }}
						via <code>worker offload --via-runtime-namespace</code>
					</div>
				</div>
				<div class="cp-form-field cp-form-field--full">
					<label class="cp-form-field__label" for="cp-offload-prompt">Prompt</label>
					<textarea
						id="cp-offload-prompt"
						v-model="prompt"
						class="cp-form-textarea cp-offload-textarea"
						placeholder="Enter a bounded prompt for the selected worker service..."
					/>
				</div>
			</div>

			<div class="cp-operator-note">
				OpenClaw stable hot path on this machine is NVIDIA Build:
				<template v-if="stableNvidiaCards.length > 0">
					{{ stableNvidiaCards.map((card) => `${card.resource.summary.name} -> ${card.models.join(", ")}`).join(" · ") }}
				</template>
				<template v-else>
					no stable NVIDIA service mapping is currently visible.
				</template>
			</div>

			<div class="cp-operator-action-grid">
				<button
					v-if="selectedRuntime"
					type="button"
					class="cp-button"
					@click="host.selectNamespace(selectedRuntime.namespace)"
				>
					Focus runtime
				</button>
				<button
					type="button"
					class="cp-button cp-button--primary"
					:disabled="running || !selectedRuntime || !selectedServiceName || !prompt.trim()"
					@click="runOffload"
				>
					{{ running ? "Running..." : "Run offload" }}
				</button>
			</div>

			<div v-if="errorMessage" class="cp-operator-note">{{ errorMessage }}</div>

			<article v-if="lastResult" class="cp-control-plane-card cp-offload-result">
				<div class="cp-control-plane-card__head">
					<div>
						<div class="cp-control-plane-card__title">Last offload result</div>
						<div class="cp-control-plane-card__meta">
							{{ lastResult.service_name }} · {{ lastResult.job_name }}
						</div>
					</div>
					<div class="cp-control-plane-card__badges">
						<StatusBadge :label="lastResult.phase" :tone="statusTone(lastResult.phase)" compact />
						<StatusBadge
							v-if="lastResult.worker_provider"
							:label="lastResult.worker_provider"
							:tone="lastResult.worker_provider === 'nvidia' ? 'live' : 'info'"
							compact
						/>
					</div>
				</div>
				<div class="cp-kv-inline">
					<span v-if="lastResult.selected_class" class="cp-chip">
						{{ lastResult.fallback_class ? "fallback" : "class" }} {{ lastResult.selected_class }}
					</span>
					<span v-if="lastResult.worker" class="cp-chip">{{ lastResult.worker }}</span>
					<span v-if="lastResult.worker_model" class="cp-chip">{{ lastResult.worker_model }}</span>
					<span v-if="lastResult.worker_locality" class="cp-chip">{{ lastResult.worker_locality }}</span>
					<span v-if="lastResult.output_path" class="cp-chip">out {{ shortPath(lastResult.output_path) }}</span>
				</div>
				<div v-if="lastResult.validation_message" class="cp-status-list__message">
					{{ lastResult.validation_message }}
				</div>
				<ExpandableText :text="parseResponse(lastResult.response)" :lines="8" />
			</article>
		</div>
	</section>
</template>
