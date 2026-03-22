<script setup lang="ts">
import { computed } from "vue";
import type {
	JarvisApplicationStatus,
	JarvisControlPlaneResource,
	JarvisControlPlaneState,
	JarvisCronJobStatus,
	JarvisDeploymentStatus,
	JarvisEnvBindingStatus,
	JarvisJobStatus,
	JarvisResourcePolicyStatus,
	JarvisServiceStatus,
	JarvisSessionMetadata,
	JarvisStatusCondition,
	JarvisStatusEvent,
	JarvisVolumeBindingStatus,
	JarvisWorkerMetadata,
} from "../../types/domain";
import type { JarvisDashboardHost } from "../bridge";
import { compactId, formatDateTime, humanizeIdentifier, statusTone, truncate } from "../helpers";
import RuntimeOffloadPanel from "./RuntimeOffloadPanel.vue";
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{
	host: JarvisDashboardHost;
	session: JarvisSessionMetadata | null;
	sessions: JarvisSessionMetadata[];
	controlPlane: JarvisControlPlaneState | null;
	workers: JarvisWorkerMetadata[];
}>();

interface WorkerLaneCard {
	id: string;
	label: string;
	meta: string;
	admission: string;
	workers: JarvisWorkerMetadata[];
}

const currentDeployment = computed(() => {
	const deployment = props.session?.context?.deployment;
	if (!deployment || !props.controlPlane) {
		return null;
	}
	return (
		props.controlPlane.deployments.find((resource) => resource.summary.name === deployment) ?? null
	);
});

const scopedWorkers = computed(() => {
	if (!props.controlPlane) {
		return props.workers;
	}
	return props.workers.filter((worker) => worker.namespace === props.controlPlane?.namespace);
});

const workerLaneCards = computed<WorkerLaneCard[]>(() => {
	const lanes = new Map<
		string,
		{
			label: string;
			workers: JarvisWorkerMetadata[];
			classes: Set<string>;
			pools: Set<string>;
			localities: Set<string>;
			availableSlots: number;
			loaded: number;
		}
	>();

	for (const worker of scopedWorkers.value) {
		const pool = worker.pool?.trim();
		const primaryClass = worker.classes?.find(Boolean)?.trim();
		const key = pool ? `pool:${pool}` : primaryClass ? `class:${primaryClass}` : `worker:${worker.name}`;
		const label = pool
			? `${pool} pool`
			: primaryClass
				? `${primaryClass} lane`
				: worker.name;
		const entry =
			lanes.get(key) ??
			{
				label,
				workers: [],
				classes: new Set<string>(),
				pools: new Set<string>(),
				localities: new Set<string>(),
				availableSlots: 0,
				loaded: 0,
			};
		entry.workers.push(worker);
		for (const className of worker.classes ?? []) {
			if (className) {
				entry.classes.add(className);
			}
		}
		if (pool) {
			entry.pools.add(pool);
		}
		if (worker.locality) {
			entry.localities.add(worker.locality);
		}
		entry.availableSlots += worker.availableSlots ?? 0;
		if (worker.loaded) {
			entry.loaded += 1;
		}
		lanes.set(key, entry);
	}

	return Array.from(lanes.entries())
		.map(([id, entry]) => {
			const parts: string[] = [];
			if (entry.classes.size > 0) {
				parts.push(`classes ${Array.from(entry.classes).join(", ")}`);
			}
			if (entry.localities.size > 0) {
				parts.push(Array.from(entry.localities).join(", "));
			}
			parts.push(`${entry.workers.length} workers`);
			parts.push(`${entry.availableSlots} free slots`);
			return {
				id,
				label: entry.label,
				meta: parts.join(" · "),
				admission:
					entry.workers.find((worker) => (worker.admissionCode ?? "") !== "ready")?.admission ??
					(entry.loaded > 0 ? "loaded" : "ready"),
				workers: entry.workers.sort((left, right) => left.name.localeCompare(right.name)),
			};
		})
		.sort((left, right) => left.label.localeCompare(right.label));
});

const resourceGroups = computed(() => {
	if (!props.controlPlane) {
		return [];
	}
	return [
		{ label: "Deployments", count: props.controlPlane.deployments.length },
		{ label: "Jobs", count: props.controlPlane.jobs.length },
		{ label: "CronJobs", count: props.controlPlane.cron_jobs.length },
		{ label: "Applications", count: props.controlPlane.applications.length },
		{ label: "Services", count: props.controlPlane.services.length },
		{ label: "Policies", count: props.controlPlane.network_policies.length },
		{ label: "Workers", count: scopedWorkers.value.length },
		{
			label: "Resources",
			count:
				props.controlPlane.config_maps.length +
				props.controlPlane.secrets.length +
				props.controlPlane.volumes.length,
		},
	];
});

function conditionTone(condition: JarvisStatusCondition): "live" | "warning" | "error" | "idle" | "info" {
	return statusTone(`${condition.type} ${condition.status} ${condition.reason}`);
}

function eventTone(event: JarvisStatusEvent): "live" | "warning" | "error" | "idle" | "info" {
	return statusTone(`${event.type} ${event.reason}`);
}

function policySummary(status: JarvisServiceStatus | JarvisResourcePolicyStatus): string {
	const namespaces = status.access_policy.allowed_namespaces;
	const selector = Object.entries(status.access_policy.workload_selector ?? {})
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
	if (namespaces.length === 0 && !selector) {
		return "all workloads";
	}
	const parts: string[] = [];
	if (namespaces.length > 0) {
		parts.push(`ns ${namespaces.join(", ")}`);
	}
	if (selector) {
		parts.push(selector);
	}
	return parts.join(" · ");
}

function deploymentHealth(resource: JarvisControlPlaneResource<JarvisDeploymentStatus>): string {
	if (resource.status.failed) {
		return "failed";
	}
	if (resource.status.progressing) {
		return "progressing";
	}
	if (resource.status.available) {
		return "available";
	}
	return resource.summary.status;
}

function cronHistorySummary(resource: JarvisControlPlaneResource<JarvisCronJobStatus>): string {
	const latest = resource.status.history[0];
	if (!latest) {
		return "No recent child jobs";
	}
	return `${latest.job_name} · ${latest.phase} · ${latest.workers.join(", ") || "runtime"}`;
}

function applicationHistorySummary(resource: JarvisControlPlaneResource<JarvisApplicationStatus>): string {
	const latest = resource.status.history.at(-1);
	if (!latest) {
		return "No sync history";
	}
	return `${compactId(latest.revision, 8, 6)} · ${resource.status.sync_status}/${resource.status.health_status} · ${latest.rendered_resources} resources`;
}

function bindingLabel(binding: JarvisEnvBindingStatus | JarvisVolumeBindingStatus): string {
	const details: string[] = [];
	if ("prefix" in binding && binding.prefix) {
		details.push(binding.prefix);
	}
	if ("paths" in binding && binding.paths.length > 0) {
		details.push(binding.paths.join(", "));
	}
	if (binding.optional) {
		details.push("optional");
	}
	return details.length > 0 ? `${binding.name} · ${details.join(" · ")}` : binding.name;
}

function deploymentBindingsSummary(status: JarvisDeploymentStatus): string {
	return `${status.config_maps.length} config · ${status.secrets.length} secret · ${status.volumes.length} volume`;
}

function jobRouteSummary(job: JarvisControlPlaneResource<JarvisJobStatus>): string {
	const detail = job.status.run_details?.[0];
	if (!detail) {
		return "No run detail";
	}
	const parts: string[] = [];
	if (detail.service_name) {
		parts.push(`svc ${detail.service_name}`);
	}
	if (detail.selected_class) {
		parts.push(`${detail.fallback_class ? "fallback" : "class"} ${detail.selected_class}`);
	}
	if (detail.intent) {
		parts.push(`intent ${detail.intent}`);
	}
	if (detail.worker_locality || detail.worker_pool) {
		parts.push(
			[detail.worker_locality, detail.worker_pool].filter(Boolean).join("/") || "worker lane",
		);
	}
	if (detail.worker) {
		parts.push(detail.worker);
	}
	return parts.join(" · ") || detail.reason || "No route detail";
}

function resourceDataSummary(resource: JarvisControlPlaneResource<JarvisResourcePolicyStatus>): string {
	if (resource.status.keys && resource.status.keys.length > 0) {
		return resource.status.keys.join(", ");
	}
	if (resource.status.paths && resource.status.paths.length > 0) {
		return resource.status.paths.join(", ");
	}
	if (typeof resource.status.entries === "number") {
		return `${resource.status.entries} entries`;
	}
	return resource.summary.detail ?? "n/a";
}
</script>

<template>
	<div class="cp-control-plane-panel">
		<div v-if="!controlPlane" class="cp-empty-state">
			No control-plane namespace is attached to the selected runtime.
		</div>

		<div v-else class="cp-control-plane-stack">
			<section class="cp-control-plane-overview">
				<div class="cp-control-plane-overview__copy">
					<p class="cp-panel__eyebrow">Tracked Namespace</p>
					<h4 class="cp-panel__title">{{ controlPlane.namespace }}</h4>
					<p class="cp-control-plane-overview__subtitle">
						Refreshed {{ formatDateTime(controlPlane.fetched_at_epoch_ms) }}
					</p>
				</div>
				<div class="cp-control-plane-overview__chips">
					<span v-for="group in resourceGroups" :key="group.label" class="cp-chip">
						{{ group.label }} {{ group.count }}
					</span>
				</div>
			</section>

			<section v-if="workerLaneCards.length > 0" class="cp-control-plane-section">
				<div class="cp-control-plane-section__head">
					<div>
						<p class="cp-panel__eyebrow">Worker Lanes</p>
						<h4 class="cp-control-plane-section__title">Classes and pools</h4>
					</div>
				</div>
				<div class="cp-control-plane-list">
					<article
						v-for="lane in workerLaneCards.slice(0, 4)"
						:key="lane.id"
						class="cp-control-plane-card"
					>
						<div class="cp-control-plane-card__head">
							<div>
								<div class="cp-control-plane-card__title">{{ lane.label }}</div>
								<div class="cp-control-plane-card__meta">{{ lane.meta }}</div>
							</div>
							<StatusBadge :label="lane.admission" :tone="statusTone(lane.admission)" compact />
						</div>
						<div class="cp-kv-inline">
							<span v-for="worker in lane.workers.slice(0, 3)" :key="worker.name" class="cp-chip">
								{{ worker.name }}
							</span>
						</div>
					</article>
				</div>
			</section>

			<RuntimeOffloadPanel
				:host="host"
				:session="session"
				:sessions="sessions"
				:control-plane="controlPlane"
				:workers="workers"
			/>

			<section v-if="currentDeployment" class="cp-control-plane-section">
				<div class="cp-control-plane-section__head">
					<div>
						<p class="cp-panel__eyebrow">Current Deployment</p>
						<h4 class="cp-control-plane-section__title">{{ currentDeployment.summary.name }}</h4>
					</div>
					<StatusBadge
						:label="deploymentHealth(currentDeployment)"
						:tone="statusTone(deploymentHealth(currentDeployment))"
						compact
					/>
				</div>
				<div class="cp-control-plane-grid">
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">ReplicaSet</div>
						<div class="cp-kv-card__value">{{ currentDeployment.status.current_replica_set ?? "n/a" }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Revision</div>
						<div class="cp-kv-card__value">{{ currentDeployment.status.current_revision ?? "n/a" }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Strategy</div>
						<div class="cp-kv-card__value">{{ humanizeIdentifier(currentDeployment.status.strategy) }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Bindings</div>
						<div class="cp-kv-card__value">{{ deploymentBindingsSummary(currentDeployment.status) }}</div>
					</div>
				</div>
				<div class="cp-kv-inline">
					<span
						v-for="binding in currentDeployment.status.config_maps"
						:key="`cfg-${binding.name}`"
						class="cp-chip"
					>
						cfg {{ bindingLabel(binding) }}
					</span>
					<span
						v-for="binding in currentDeployment.status.secrets"
						:key="`sec-${binding.name}`"
						class="cp-chip"
					>
						sec {{ bindingLabel(binding) }}
					</span>
					<span
						v-for="binding in currentDeployment.status.volumes"
						:key="`vol-${binding.name}`"
						class="cp-chip"
					>
						vol {{ bindingLabel(binding) }}
					</span>
				</div>
				<div class="cp-status-list">
					<article
						v-for="condition in currentDeployment.status.conditions.slice(0, 3)"
						:key="`${currentDeployment.summary.name}-${condition.type}`"
						class="cp-status-list__entry"
					>
						<div class="cp-status-list__head">
							<span class="cp-chip">{{ condition.type }}</span>
							<StatusBadge :label="condition.status" :tone="conditionTone(condition)" compact />
						</div>
						<div class="cp-status-list__message">{{ truncate(condition.message, 140) }}</div>
					</article>
				</div>
			</section>

			<section v-else-if="controlPlane.deployments.length > 0" class="cp-control-plane-section">
				<div class="cp-control-plane-section__head">
					<div>
						<p class="cp-panel__eyebrow">Deployments</p>
						<h4 class="cp-control-plane-section__title">Rollout status</h4>
					</div>
				</div>
				<div class="cp-control-plane-list">
					<article
						v-for="deployment in controlPlane.deployments.slice(0, 3)"
						:key="deployment.summary.name"
						class="cp-control-plane-card"
					>
						<div class="cp-control-plane-card__head">
							<div>
								<div class="cp-control-plane-card__title">{{ deployment.summary.name }}</div>
								<div class="cp-control-plane-card__meta">
									{{ deployment.status.ready_replicas }}/{{ deployment.status.replicas }} ready ·
									{{ humanizeIdentifier(deployment.status.strategy) }}
								</div>
							</div>
							<StatusBadge
								:label="deploymentHealth(deployment)"
								:tone="statusTone(deploymentHealth(deployment))"
								compact
							/>
						</div>
						<div class="cp-kv-inline">
							<span class="cp-chip">rev {{ deployment.status.current_revision ?? "n/a" }}</span>
							<span class="cp-chip">{{ deploymentBindingsSummary(deployment.status) }}</span>
							<span class="cp-chip">paused {{ deployment.status.paused ? "yes" : "no" }}</span>
						</div>
						<div class="cp-kv-inline">
							<span
								v-for="binding in deployment.status.config_maps.slice(0, 2)"
								:key="`${deployment.summary.name}-cfg-${binding.name}`"
								class="cp-chip"
							>
								cfg {{ bindingLabel(binding) }}
							</span>
							<span
								v-for="binding in deployment.status.secrets.slice(0, 2)"
								:key="`${deployment.summary.name}-sec-${binding.name}`"
								class="cp-chip"
							>
								sec {{ bindingLabel(binding) }}
							</span>
							<span
								v-for="binding in deployment.status.volumes.slice(0, 2)"
								:key="`${deployment.summary.name}-vol-${binding.name}`"
								class="cp-chip"
							>
								vol {{ bindingLabel(binding) }}
							</span>
						</div>
						<div v-if="deployment.status.conditions[0]" class="cp-status-list__message">
							{{ truncate(deployment.status.conditions[0].message, 150) }}
						</div>
					</article>
				</div>
			</section>

			<section v-if="controlPlane.applications.length > 0" class="cp-control-plane-section">
				<div class="cp-control-plane-section__head">
					<div>
						<p class="cp-panel__eyebrow">Applications</p>
						<h4 class="cp-control-plane-section__title">GitOps state</h4>
					</div>
				</div>
				<div class="cp-control-plane-list">
					<article
						v-for="application in controlPlane.applications.slice(0, 3)"
						:key="application.summary.name"
						class="cp-control-plane-card"
					>
						<div class="cp-control-plane-card__head">
							<div>
								<div class="cp-control-plane-card__title">{{ application.summary.name }}</div>
								<div class="cp-control-plane-card__meta">
									{{ application.status.source_type }} ·
									{{ compactId(application.status.resolved_revision, 8, 6) }}
								</div>
							</div>
							<div class="cp-control-plane-card__badges">
								<StatusBadge :label="application.status.sync_status" :tone="statusTone(application.status.sync_status)" compact />
								<StatusBadge :label="application.status.health_status" :tone="statusTone(application.status.health_status)" compact />
							</div>
						</div>
						<div class="cp-status-list__message">{{ applicationHistorySummary(application) }}</div>
						<div class="cp-status-list">
							<article
								v-for="event in application.status.events.slice(0, 2)"
								:key="`${application.summary.name}-${event.type}-${event.epoch_ms}`"
								class="cp-status-list__entry"
							>
								<div class="cp-status-list__head">
									<span class="cp-chip">{{ humanizeIdentifier(event.type) }}</span>
									<StatusBadge :label="event.reason" :tone="eventTone(event)" compact />
								</div>
								<div class="cp-status-list__message">{{ truncate(event.message, 140) }}</div>
							</article>
						</div>
					</article>
				</div>
			</section>

			<section v-if="controlPlane.jobs.length > 0 || controlPlane.cron_jobs.length > 0" class="cp-control-plane-section">
				<div class="cp-control-plane-section__head">
					<div>
						<p class="cp-panel__eyebrow">Jobs</p>
						<h4 class="cp-control-plane-section__title">Runs and schedules</h4>
					</div>
				</div>
				<div class="cp-control-plane-columns">
					<div v-if="controlPlane.jobs.length > 0" class="cp-control-plane-column">
						<div class="cp-control-plane-column__label">Jobs</div>
						<article
							v-for="job in controlPlane.jobs.slice(0, 3)"
							:key="job.summary.name"
							class="cp-control-plane-card"
						>
							<div class="cp-control-plane-card__head">
								<div>
									<div class="cp-control-plane-card__title">{{ job.summary.name }}</div>
									<div class="cp-control-plane-card__meta">
										{{ job.status.succeeded }}/{{ job.status.completions }} succeeded
									</div>
								</div>
								<StatusBadge :label="job.summary.status" :tone="statusTone(job.summary.status)" compact />
							</div>
							<div class="cp-kv-inline">
								<span class="cp-chip">pending {{ job.status.pending }}</span>
								<span class="cp-chip">active {{ job.status.active }}</span>
								<span class="cp-chip">failed {{ job.status.failed }}</span>
							</div>
							<div class="cp-status-list__message">{{ truncate(jobRouteSummary(job), 180) }}</div>
							<div v-if="job.status.run_details[0]?.reason" class="cp-status-list__message">
								{{ truncate(job.status.run_details[0].reason, 180) }}
							</div>
						</article>
					</div>

					<div v-if="controlPlane.cron_jobs.length > 0" class="cp-control-plane-column">
						<div class="cp-control-plane-column__label">CronJobs</div>
						<article
							v-for="cronJob in controlPlane.cron_jobs.slice(0, 3)"
							:key="cronJob.summary.name"
							class="cp-control-plane-card"
						>
							<div class="cp-control-plane-card__head">
								<div>
									<div class="cp-control-plane-card__title">{{ cronJob.summary.name }}</div>
									<div class="cp-control-plane-card__meta">{{ cronJob.status.schedule }}</div>
								</div>
								<StatusBadge :label="cronJob.summary.status" :tone="statusTone(cronJob.summary.status)" compact />
							</div>
							<div class="cp-status-list__message">{{ cronHistorySummary(cronJob) }}</div>
							<div v-if="cronJob.status.conditions[0]" class="cp-status-list__message">
								{{ truncate(cronJob.status.conditions[0].message, 140) }}
							</div>
						</article>
					</div>
				</div>
			</section>

			<section v-if="controlPlane.services.length > 0" class="cp-control-plane-section">
				<div class="cp-control-plane-section__head">
					<div>
						<p class="cp-panel__eyebrow">Services</p>
						<h4 class="cp-control-plane-section__title">Routing and intent policy</h4>
					</div>
				</div>
				<div class="cp-control-plane-list">
					<article
						v-for="service in controlPlane.services.slice(0, 4)"
						:key="service.summary.name"
						class="cp-control-plane-card"
					>
						<div class="cp-control-plane-card__head">
							<div>
								<div class="cp-control-plane-card__title">{{ service.summary.name }}</div>
								<div class="cp-control-plane-card__meta">
									{{ service.status.target_kind }} · {{ humanizeIdentifier(service.status.strategy) }}
								</div>
							</div>
							<StatusBadge :label="service.summary.status" :tone="statusTone(service.summary.status)" compact />
						</div>
						<div class="cp-kv-inline">
							<span v-if="service.status.class_name" class="cp-chip">class {{ service.status.class_name }}</span>
							<span
								v-for="intent in service.status.allowed_intents"
								:key="`${service.summary.name}-${intent}`"
								class="cp-chip"
							>
								{{ intent }}
							</span>
						</div>
						<div class="cp-status-list__message">{{ policySummary(service.status) }}</div>
						<div class="cp-status-list__message">
							{{ service.status.endpoints.join(", ") || "No resolved endpoints" }}
						</div>
					</article>
				</div>
			</section>

			<section v-if="controlPlane.network_policies.length > 0" class="cp-control-plane-section">
				<div class="cp-control-plane-section__head">
					<div>
						<p class="cp-panel__eyebrow">Network Policies</p>
						<h4 class="cp-control-plane-section__title">Session ACLs</h4>
					</div>
				</div>
				<div class="cp-control-plane-list">
					<article
						v-for="policy in controlPlane.network_policies.slice(0, 4)"
						:key="policy.summary.name"
						class="cp-control-plane-card"
					>
						<div class="cp-control-plane-card__head">
							<div>
								<div class="cp-control-plane-card__title">{{ policy.summary.name }}</div>
								<div class="cp-control-plane-card__meta">
									{{ policy.status.policy_types.join(", ") || "policy" }}
								</div>
							</div>
							<StatusBadge :label="policy.summary.status" :tone="statusTone(policy.summary.status)" compact />
						</div>
						<div class="cp-status-list__message">
							{{ policy.status.selected_sessions.join(", ") || "No selected sessions" }}
						</div>
					</article>
				</div>
			</section>

			<section
				v-if="controlPlane.config_maps.length > 0 || controlPlane.secrets.length > 0 || controlPlane.volumes.length > 0"
				class="cp-control-plane-section"
			>
				<div class="cp-control-plane-section__head">
					<div>
						<p class="cp-panel__eyebrow">Runtime Resources</p>
						<h4 class="cp-control-plane-section__title">Config, secrets, and storage</h4>
					</div>
				</div>
				<div class="cp-control-plane-columns">
					<div class="cp-control-plane-column">
						<div class="cp-control-plane-column__label">ConfigMaps</div>
						<div v-if="controlPlane.config_maps.length === 0" class="cp-empty-state">None</div>
						<article
							v-for="resource in controlPlane.config_maps.slice(0, 3)"
							:key="resource.summary.name"
							class="cp-control-plane-card"
						>
							<div class="cp-control-plane-card__title">{{ resource.summary.name }}</div>
							<div class="cp-status-list__message">{{ resourceDataSummary(resource) }}</div>
							<div class="cp-status-list__message">{{ policySummary(resource.status) }}</div>
						</article>
					</div>
					<div class="cp-control-plane-column">
						<div class="cp-control-plane-column__label">Secrets</div>
						<div v-if="controlPlane.secrets.length === 0" class="cp-empty-state">None</div>
						<article
							v-for="resource in controlPlane.secrets.slice(0, 3)"
							:key="resource.summary.name"
							class="cp-control-plane-card"
						>
							<div class="cp-control-plane-card__title">{{ resource.summary.name }}</div>
							<div class="cp-status-list__message">{{ resourceDataSummary(resource) }}</div>
							<div class="cp-status-list__message">{{ policySummary(resource.status) }}</div>
						</article>
					</div>
					<div class="cp-control-plane-column">
						<div class="cp-control-plane-column__label">Volumes</div>
						<div v-if="controlPlane.volumes.length === 0" class="cp-empty-state">None</div>
						<article
							v-for="resource in controlPlane.volumes.slice(0, 3)"
							:key="resource.summary.name"
							class="cp-control-plane-card"
						>
							<div class="cp-control-plane-card__title">{{ resource.summary.name }}</div>
							<div class="cp-status-list__message">{{ resourceDataSummary(resource) }}</div>
							<div class="cp-status-list__message">{{ policySummary(resource.status) }}</div>
						</article>
					</div>
				</div>
			</section>
		</div>
	</div>
</template>
