<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { JarvisClusterState, JarvisTicketSummary } from "../../types/domain";
import type { JarvisDashboardHost } from "../bridge";
import { statusTone } from "../helpers";
import StatusBadge from "./StatusBadge.vue";

type DeployMode = "start-session" | "visit" | "fanout" | "dispatch";

const props = defineProps<{
	host: JarvisDashboardHost;
	tickets: JarvisTicketSummary[];
	cluster: JarvisClusterState;
}>();

const emit = defineEmits<{
	(event: "close"): void;
}>();

const query = ref("");
const selectedStatus = ref<string | null>(null);
const selectedTicketPath = ref("");
const mode = ref<DeployMode>("start-session");
const form = reactive({
	namespace: "",
	node: "auto",
	nodes: "",
	timeoutSeconds: "900",
	message: "",
	labels: [] as string[],
});

const statusOptions = computed(() =>
	Array.from(new Set(props.tickets.map((ticket) => ticket.status).filter(Boolean) as string[])).sort(),
);

const labelOptions = computed(() =>
	Array.from(
		new Set(
			props.tickets.flatMap((ticket) => [
				...(ticket.tags ?? []),
				ticket.priority ? `priority:${ticket.priority}` : "",
				ticket.owner ? `owner:${ticket.owner}` : "",
				ticket.codex_model ? `model:${ticket.codex_model}` : "",
				ticket.codex_reasoning_effort ? `effort:${ticket.codex_reasoning_effort}` : "",
			]),
		),
	)
		.filter(Boolean)
		.sort(),
);

const selectedTicket = computed(
	() => props.tickets.find((ticket) => ticket.path === selectedTicketPath.value) ?? null,
);

const filteredTickets = computed(() => {
	const needle = query.value.trim().toLowerCase();
	return props.tickets
		.filter((ticket) => !selectedStatus.value || ticket.status === selectedStatus.value)
		.filter((ticket) => {
			if (!needle) {
				return true;
			}
			return [
				ticket.title,
				ticket.path,
				ticket.status,
				ticket.priority,
				ticket.owner,
				ticket.project,
				ticket.repo_path,
				ticket.codex_model,
				ticket.codex_reasoning_effort,
				ticket.tags.join(" "),
			]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(needle));
		})
		.slice(0, 12);
});

const nodeOptions = computed(() => ["auto", ...props.cluster.nodes.map((node) => node.name)]);

watch(
	selectedTicket,
	(ticket) => {
		if (!ticket) {
			return;
		}
		form.namespace = slugify(ticket.title || ticket.path);
		form.message = buildDefaultPrompt(ticket);
	},
	{ immediate: false },
);

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function buildDefaultPrompt(ticket: JarvisTicketSummary): string {
	return [
		`Work from ticket: ${ticket.title}`,
		`Ticket note: ${ticket.absolute_path}`,
		ticket.repo_path ? `Repo: ${ticket.repo_path}` : "",
		ticket.project ? `Project: ${ticket.project}` : "",
		"Read the ticket as source of truth, execute the request, update progress/outcome, and report verification.",
	]
		.filter(Boolean)
		.join("\n");
}

function toggleLabel(label: string): void {
	if (form.labels.includes(label)) {
		form.labels = form.labels.filter((entry) => entry !== label);
		return;
	}
	form.labels = [...form.labels, label];
}

async function deploy(): Promise<void> {
	const ticket = selectedTicket.value;
	if (mode.value === "dispatch") {
		await props.host.dispatchOnce();
		emit("close");
		return;
	}
	if (mode.value === "visit") {
		await props.host.runClusterVisit({
			namespace: form.namespace,
			node: form.node,
			text: form.message || (ticket ? buildDefaultPrompt(ticket) : "Inspect node readiness."),
			timeoutSeconds: form.timeoutSeconds,
		});
		emit("close");
		return;
	}
	if (mode.value === "fanout") {
		await props.host.runClusterFanout({
			nodes: form.nodes,
			text: form.message || (ticket ? buildDefaultPrompt(ticket) : "Report node readiness."),
			timeoutSeconds: form.timeoutSeconds,
		});
		emit("close");
		return;
	}
	if (!ticket) {
		return;
	}
	await props.host.startClusterSession({
		namespace: form.namespace,
		node: form.node,
		taskNote: ticket.absolute_path,
		message: form.message,
	});
	emit("close");
}
</script>

<template>
	<div class="cp-dialog-backdrop" @click.self="emit('close')">
		<section class="cp-deploy-dialog" role="dialog" aria-modal="true" aria-label="Deploy workload">
			<header class="cp-deploy-dialog__head">
				<div>
					<p class="cp-panel__eyebrow">Deploy</p>
					<h3 class="cp-deploy-dialog__title">Start workload from ticket</h3>
				</div>
				<button type="button" class="cp-icon-button" title="Close" @click="emit('close')">×</button>
			</header>

			<div class="cp-deploy-dialog__body">
				<aside class="cp-deploy-picker">
					<label class="cp-search cp-search--dialog">
						<span class="cp-search__icon" aria-hidden="true">⌕</span>
						<input v-model="query" class="cp-search__input" type="search" placeholder="Fuzzy search tickets, projects, labels" />
					</label>
					<div class="cp-chip-row">
						<button
							type="button"
							:class="['cp-filter-pill', selectedStatus === null ? 'is-selected' : '']"
							@click="selectedStatus = null"
						>
							all
						</button>
						<button
							v-for="status in statusOptions"
							:key="status"
							type="button"
							:class="['cp-filter-pill', selectedStatus === status ? 'is-selected' : '']"
							@click="selectedStatus = status"
						>
							{{ status }}
						</button>
					</div>
					<div class="cp-ticket-result-list">
						<button
							v-for="ticket in filteredTickets"
							:key="ticket.path"
							type="button"
							:class="['cp-ticket-result', selectedTicketPath === ticket.path ? 'is-selected' : '']"
							@click="selectedTicketPath = ticket.path"
						>
							<span class="cp-ticket-result__title">{{ ticket.title }}</span>
							<span class="cp-ticket-result__meta">{{ ticket.project ?? ticket.path }}</span>
							<span class="cp-ticket-result__chips">
								<StatusBadge :label="ticket.status ?? 'capture'" :tone="statusTone(ticket.status)" compact />
								<span v-if="ticket.priority" class="cp-chip">{{ ticket.priority }}</span>
								<span v-if="ticket.owner" class="cp-chip">{{ ticket.owner }}</span>
							</span>
						</button>
					</div>
				</aside>

				<form class="cp-deploy-form" @submit.prevent="deploy">
					<div class="cp-form-field">
						<label class="cp-form-field__label">Workload type</label>
						<select v-model="mode" class="cp-form-select">
							<option value="start-session">Remote Codex session</option>
							<option value="visit">Single-node visit</option>
							<option value="fanout">Fanout visit</option>
							<option value="dispatch">Run dispatch scan</option>
						</select>
					</div>
					<div class="cp-form-field">
						<label class="cp-form-field__label">Node</label>
						<select v-model="form.node" class="cp-form-select" :disabled="mode === 'fanout' || mode === 'dispatch'">
							<option v-for="node in nodeOptions" :key="node" :value="node">{{ node }}</option>
						</select>
					</div>
					<div class="cp-form-field">
						<label class="cp-form-field__label">Namespace</label>
						<input v-model="form.namespace" class="cp-form-input" placeholder="generated from ticket title" :disabled="mode === 'dispatch'" />
					</div>
					<div class="cp-form-field">
						<label class="cp-form-field__label">Fanout nodes</label>
						<input v-model="form.nodes" class="cp-form-input" placeholder="archiebald, archiechokie" :disabled="mode !== 'fanout'" />
					</div>
					<div class="cp-form-field">
						<label class="cp-form-field__label">Timeout</label>
						<input v-model="form.timeoutSeconds" class="cp-form-input" placeholder="900" :disabled="mode === 'dispatch'" />
					</div>
					<div class="cp-form-field">
						<label class="cp-form-field__label">Selected ticket</label>
						<div class="cp-deploy-ticket-card">
							<div class="cp-control-plane-card__title">{{ selectedTicket?.title ?? "Pick a ticket" }}</div>
							<div class="cp-control-plane-card__meta">{{ selectedTicket?.repo_path ?? selectedTicket?.path ?? "Ticket properties populate workload defaults." }}</div>
							<div v-if="selectedTicket" class="cp-chip-row">
								<span v-if="selectedTicket.codex_driver" class="cp-chip">{{ selectedTicket.codex_driver }}</span>
								<span v-if="selectedTicket.codex_model" class="cp-chip">{{ selectedTicket.codex_model }}</span>
								<span v-if="selectedTicket.codex_reasoning_effort" class="cp-chip">{{ selectedTicket.codex_reasoning_effort }}</span>
								<span v-if="selectedTicket.codex_sandbox_mode" class="cp-chip">{{ selectedTicket.codex_sandbox_mode }}</span>
								<span v-if="selectedTicket.codex_finish_mode" class="cp-chip">finish {{ selectedTicket.codex_finish_mode }}</span>
							</div>
						</div>
					</div>
					<div class="cp-form-field cp-form-field--full">
						<label class="cp-form-field__label">Labels</label>
						<div class="cp-chip-row">
							<button
								v-for="label in labelOptions.slice(0, 18)"
								:key="label"
								type="button"
								:class="['cp-filter-pill', form.labels.includes(label) ? 'is-selected' : '']"
								@click="toggleLabel(label)"
							>
								{{ label }}
							</button>
						</div>
					</div>
					<div class="cp-form-field cp-form-field--full">
						<label class="cp-form-field__label">Prompt / operator message</label>
						<textarea v-model="form.message" class="cp-form-textarea cp-deploy-message" placeholder="Prompt sent to Codex or remote visit" />
					</div>
					<div class="cp-deploy-dialog__actions">
						<button type="button" class="cp-ghost-button cp-deploy-button" @click="emit('close')">Cancel</button>
						<button type="submit" class="cp-ghost-button cp-ghost-button--primary cp-deploy-button" :disabled="mode === 'start-session' && !selectedTicket">
							Deploy
						</button>
					</div>
				</form>
			</div>
		</section>
	</div>
</template>
