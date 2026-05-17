<script setup lang="ts">
import { computed, reactive } from "vue";
import type {
	JarvisBootstrapRequest,
	JarvisClusterNode,
	JarvisClusterState,
	JarvisFanoutRequest,
	JarvisStartSessionRequest,
	JarvisVisitRequest,
} from "../../types/domain";
import type { JarvisDashboardHost } from "../bridge";
import { statusTone } from "../helpers";
import StatusBadge from "./StatusBadge.vue";

const props = defineProps<{
	host: JarvisDashboardHost;
	cluster: JarvisClusterState;
}>();

const visitForm = reactive<JarvisVisitRequest>({
	namespace: "",
	node: "auto",
	text: "Inspect this node and report Jarvis/Codex readiness.",
	timeoutSeconds: "900",
});

const sessionForm = reactive<JarvisStartSessionRequest>({
	namespace: "",
	node: "auto",
	taskNote: "",
	message: "",
});

const fanoutForm = reactive<JarvisFanoutRequest>({
	nodes: "",
	text: "Report node readiness and local vault/memory availability.",
	timeoutSeconds: "900",
});

const bootstrapForm = reactive<JarvisBootstrapRequest>({
	name: "",
	host: "",
	user: "rootster",
	workspaceRoot: "/home/rootster/work",
});

const readyNodeCount = computed(() => props.cluster.doctor.filter((check) => check.available && hasCodexAuth(check)).length);

const reachableLinkCount = computed(
	() => props.cluster.links.filter((link) => link.reachable ?? link.ok ?? false).length,
);

function nodeDetail(node: JarvisClusterNode, key: string): string {
	return String(node.detail ?? "").match(new RegExp(`${key}=([^ ]+)`))?.[1] ?? "";
}

function hasCodexAuth(check: ReturnType<typeof doctorFor>): boolean {
	if (!check) {
		return false;
	}
	return check.codex_auth_present === true || check.facts?.codex_auth === "present";
}

function factNumber(check: ReturnType<typeof doctorFor>, field: "auth_leases" | "visit_artifacts"): number {
	const directField = field === "auth_leases" ? check?.stale_auth_leases : check?.stale_visit_artifacts;
	const value = directField ?? check?.facts?.[field] ?? 0;
	return Number(value) || 0;
}

function doctorFor(node: JarvisClusterNode) {
	return props.cluster.doctor.find((check) => check.node === node.name) ?? null;
}

function nodeLabel(node: JarvisClusterNode): string {
	const doctor = doctorFor(node);
	if (!doctor) {
		return node.status ?? "unknown";
	}
	if (doctor.available && hasCodexAuth(doctor)) {
		return "ready";
	}
	if (doctor.available) {
		return "needs auth";
	}
	return "blocked";
}

function nodeTone(node: JarvisClusterNode): "live" | "warning" | "error" | "idle" | "info" {
	const label = nodeLabel(node);
	if (label === "ready") {
		return "live";
	}
	if (label === "blocked") {
		return "error";
	}
	return statusTone(label);
}
</script>

<template>
	<div class="cp-cluster-ops">
		<section class="cp-control-plane-overview">
			<div class="cp-control-plane-overview__copy">
				<p class="cp-panel__eyebrow">Cluster Control</p>
				<h4 class="cp-panel__title">Jarvis orchestration</h4>
				<p class="cp-control-plane-overview__subtitle">
					Scheduler, remote Codex visits, auth leases, GPG capsules, bootstrap, and dispatch are available here.
				</p>
			</div>
			<div class="cp-control-plane-overview__chips">
				<span class="cp-chip">{{ cluster.nodes.length }} nodes</span>
				<span class="cp-chip">{{ readyNodeCount }} ready</span>
				<span class="cp-chip">{{ cluster.index.sessions.length }} indexed sessions</span>
				<span class="cp-chip">{{ cluster.index.visits.length }} visits</span>
				<span class="cp-chip">{{ reachableLinkCount }}/{{ cluster.links.length }} links</span>
				<span class="cp-chip">{{ cluster.gpg.ok ? "GPG ready" : "GPG attention" }}</span>
			</div>
		</section>

		<section class="cp-control-plane-section">
			<div class="cp-control-plane-section__head">
				<div>
					<p class="cp-panel__eyebrow">Nodes</p>
					<h4 class="cp-control-plane-section__title">Placement and reachability</h4>
				</div>
				<div class="cp-operator-action-grid">
					<button type="button" class="cp-mini-button" title="Dispatch once" @click="host.dispatchOnce()">▶</button>
					<button type="button" class="cp-mini-button" title="Reconcile" @click="host.reconcileNodes()">↻</button>
					<button type="button" class="cp-mini-button" title="Rotate encrypted capsule key" @click="host.rotateCapsuleKey()">◇</button>
				</div>
			</div>
			<div class="cp-node-grid">
				<article v-for="node in cluster.nodes" :key="node.name" class="cp-control-plane-card">
					<div class="cp-control-plane-card__head">
						<div>
							<div class="cp-control-plane-card__title">{{ node.name }}</div>
							<div class="cp-control-plane-card__meta">
								{{ nodeDetail(node, "roles") || "worker" }} · {{ nodeDetail(node, "addr") || nodeDetail(node, "ssh") || "local" }}
							</div>
						</div>
						<StatusBadge :label="nodeLabel(node)" :tone="nodeTone(node)" compact />
					</div>
					<div class="cp-kv-inline">
						<button type="button" class="cp-mini-button" title="Sync Codex auth" @click="host.syncNodeAuth(node.name)">A</button>
						<button type="button" class="cp-mini-button" title="Cordon node" @click="host.cordonNode(node.name)">C</button>
						<button type="button" class="cp-mini-button" title="Uncordon node" @click="host.uncordonNode(node.name)">U</button>
						<span class="cp-chip">leases {{ factNumber(doctorFor(node), "auth_leases") }}</span>
						<span class="cp-chip">artifacts {{ factNumber(doctorFor(node), "visit_artifacts") }}</span>
					</div>
				</article>
				<div v-if="cluster.nodes.length === 0" class="cp-empty-state">No registered nodes.</div>
			</div>
		</section>

		<section class="cp-control-plane-section">
			<div class="cp-control-plane-section__head">
				<div>
					<p class="cp-panel__eyebrow">Operator Actions</p>
					<h4 class="cp-control-plane-section__title">Remote work without terminal handoff</h4>
				</div>
			</div>
			<div class="cp-cluster-form-grid">
				<form class="cp-cluster-form" @submit.prevent="host.runClusterVisit(visitForm)">
					<div class="cp-control-plane-card__title">Visit</div>
					<input v-model="visitForm.namespace" class="cp-form-input" placeholder="namespace" />
					<input v-model="visitForm.node" class="cp-form-input" placeholder="node or auto" />
					<input v-model="visitForm.timeoutSeconds" class="cp-form-input" placeholder="timeout seconds" />
					<textarea v-model="visitForm.text" class="cp-form-textarea cp-cluster-form__textarea" placeholder="remote prompt" />
					<button type="submit" class="cp-ghost-button cp-cluster-form__submit">Run Visit</button>
				</form>

				<form class="cp-cluster-form" @submit.prevent="host.startClusterSession(sessionForm)">
					<div class="cp-control-plane-card__title">Start Session</div>
					<input v-model="sessionForm.namespace" class="cp-form-input" placeholder="namespace" />
					<input v-model="sessionForm.node" class="cp-form-input" placeholder="node or auto" />
					<input v-model="sessionForm.taskNote" class="cp-form-input" placeholder="ticket/task note path" />
					<textarea v-model="sessionForm.message" class="cp-form-textarea cp-cluster-form__textarea" placeholder="operator message" />
					<button type="submit" class="cp-ghost-button cp-cluster-form__submit">Start</button>
				</form>

				<form class="cp-cluster-form" @submit.prevent="host.runClusterFanout(fanoutForm)">
					<div class="cp-control-plane-card__title">Fanout</div>
					<input v-model="fanoutForm.nodes" class="cp-form-input" placeholder="nodes, comma separated" />
					<input v-model="fanoutForm.timeoutSeconds" class="cp-form-input" placeholder="timeout seconds" />
					<textarea v-model="fanoutForm.text" class="cp-form-textarea cp-cluster-form__textarea" placeholder="fanout prompt" />
					<button type="submit" class="cp-ghost-button cp-cluster-form__submit">Fanout</button>
				</form>

				<form class="cp-cluster-form" @submit.prevent="host.bootstrapClusterNode(bootstrapForm)">
					<div class="cp-control-plane-card__title">Bootstrap Node</div>
					<input v-model="bootstrapForm.name" class="cp-form-input" placeholder="node name" />
					<input v-model="bootstrapForm.host" class="cp-form-input" placeholder="ssh host" />
					<input v-model="bootstrapForm.user" class="cp-form-input" placeholder="ssh user" />
					<input v-model="bootstrapForm.workspaceRoot" class="cp-form-input" placeholder="workspace root" />
					<button type="submit" class="cp-ghost-button cp-cluster-form__submit">Bootstrap</button>
				</form>
			</div>
		</section>

		<section class="cp-control-plane-section">
			<div class="cp-control-plane-section__head">
				<div>
					<p class="cp-panel__eyebrow">Security</p>
					<h4 class="cp-control-plane-section__title">GPG, capsule key, auth lease audit</h4>
				</div>
				<StatusBadge :label="cluster.gpg.ok ? 'ready' : 'attention'" :tone="cluster.gpg.ok ? 'live' : 'warning'" compact />
			</div>
			<div class="cp-control-plane-columns">
				<div class="cp-control-plane-column">
					<div class="cp-control-plane-column__label">GPG / Capsules</div>
					<article class="cp-control-plane-card">
						<div class="cp-status-list__message">{{ cluster.gpg.detail }}</div>
						<div class="cp-kv-inline">
							<span class="cp-chip">retries {{ cluster.policy?.retries ?? "-" }}</span>
							<span class="cp-chip">timeout {{ cluster.policy?.timeout_seconds ?? "-" }}s</span>
							<span class="cp-chip">cleanup {{ cluster.policy?.cleanup_retention_days ?? "-" }}d</span>
						</div>
					</article>
				</div>
				<div class="cp-control-plane-column">
					<div class="cp-control-plane-column__label">Auth Audit</div>
					<article v-for="event in cluster.audit.slice(0, 5)" :key="`${event.timestamp}-${event.node}-${event.namespace}`" class="cp-control-plane-card">
						<div class="cp-control-plane-card__title">{{ event.action ?? event.event ?? "auth" }}</div>
						<div class="cp-control-plane-card__meta">{{ event.node ?? "-" }} · {{ event.namespace ?? "-" }}</div>
					</article>
					<div v-if="cluster.audit.length === 0" class="cp-empty-state">No auth audit events.</div>
				</div>
			</div>
		</section>

		<section class="cp-control-plane-section">
			<div class="cp-control-plane-section__head">
				<div>
					<p class="cp-panel__eyebrow">Cross-node Index</p>
					<h4 class="cp-control-plane-section__title">Sessions and visits</h4>
				</div>
			</div>
			<div class="cp-control-plane-columns">
				<div class="cp-control-plane-column">
					<div class="cp-control-plane-column__label">Sessions</div>
					<article v-for="session in cluster.index.sessions.slice(0, 6)" :key="session.namespace" class="cp-control-plane-card">
						<div class="cp-control-plane-card__title">{{ session.namespace }}</div>
						<div class="cp-control-plane-card__meta">{{ session.context?.labels?.["jarvisctl.io/node"] ?? session.working_directory ?? "-" }}</div>
					</article>
				</div>
				<div class="cp-control-plane-column">
					<div class="cp-control-plane-column__label">Visits</div>
					<article v-for="visit in cluster.index.visits.slice(0, 6)" :key="`${visit.namespace}-${visit.node}`" class="cp-control-plane-card">
						<div class="cp-control-plane-card__head">
							<div>
								<div class="cp-control-plane-card__title">{{ visit.namespace }}</div>
								<div class="cp-control-plane-card__meta">{{ visit.node }} · {{ visit.from_node ?? "local" }}</div>
							</div>
							<StatusBadge :label="visit.status ?? visit.cleanup_status ?? 'unknown'" :tone="statusTone(visit.status ?? visit.cleanup_status)" compact />
						</div>
					</article>
				</div>
			</div>
		</section>
	</div>
</template>
