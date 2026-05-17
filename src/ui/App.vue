<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { JarvisDashboardHost } from "./bridge";
import DeployWorkloadDialog from "./components/DeployWorkloadDialog.vue";
import MainPanel from "./components/MainPanel.vue";
import Sidebar from "./components/Sidebar.vue";
import StatusBadge from "./components/StatusBadge.vue";
import { buildRepositoryGroups, statusTone } from "./helpers";
import { SURFACE_TABS, type SurfaceId } from "./surfaces";

const props = defineProps<{
	host: JarvisDashboardHost;
}>();

const searchQuery = ref("");
const selectedRepository = ref<string | null>(null);
const selectedWorkerKey = ref<string | null>(null);
const deployDialogOpen = ref(false);
const activeSurface = ref<SurfaceId>("operator");

const allSessions = computed(() => props.host.state.sessions);
const allWorkers = computed(() => props.host.state.workers);
const controlPlane = computed(() => props.host.state.controlPlane);
const repositories = computed(() => buildRepositoryGroups(allSessions.value));

watch(
	repositories,
	(nextGroups) => {
		if (selectedRepository.value && !nextGroups.some((group) => group.id === selectedRepository.value)) {
			selectedRepository.value = null;
		}
	},
	{ immediate: true },
);

const filteredSessions = computed(() => {
	const query = searchQuery.value.trim().toLowerCase();
	return allSessions.value.filter((session) => {
		const repoMatch =
			selectedRepository.value === null || session.working_directory === selectedRepository.value;
		if (!repoMatch) {
			return false;
		}
		if (!query) {
			return true;
		}
		return [
			session.namespace,
			session.backend,
			session.context?.task_title,
			session.context?.task_note,
			session.context?.codex_session_id,
			session.context?.last_activity,
		]
			.filter(Boolean)
			.some((value) => String(value).toLowerCase().includes(query));
	});
});

const filteredWorkers = computed(() => {
	const query = searchQuery.value.trim().toLowerCase();
	if (!query) {
		return allWorkers.value;
	}
	return allWorkers.value.filter((worker) =>
		[
			worker.namespace,
			worker.name,
			worker.provider,
			worker.model,
			worker.role,
			worker.locality,
			worker.pool,
			worker.classes?.join(" "),
			worker.endpoint,
			worker.summaryStatus,
			worker.summaryDetail,
			worker.admissionReason,
		]
			.filter(Boolean)
			.some((value) => String(value).toLowerCase().includes(query)),
	);
});

const selectedSession = computed(() => {
	const selected = allSessions.value.find(
		(session) => session.namespace === props.host.state.selectedNamespace,
	);
	if (selected && filteredSessions.value.some((session) => session.namespace === selected.namespace)) {
		return selected;
	}
	return filteredSessions.value[0] ?? selected ?? allSessions.value[0] ?? null;
});

const selectedWorker = computed(() => {
	if (!selectedWorkerKey.value) {
		return null;
	}
	return (
		allWorkers.value.find(
			(worker) => `${worker.namespace}/${worker.name}` === selectedWorkerKey.value,
		) ?? null
	);
});

const selectedActivitySections = computed(() =>
	selectedSession.value ? props.host.readActivitySections(selectedSession.value, 10) : [],
);

const liveAgentCount = computed(() =>
	allSessions.value.reduce(
		(total, session) => total + session.agents.filter((agent) => agent.running).length,
		0,
	),
);

const subagentCount = computed(() =>
	allSessions.value.reduce(
		(total, session) => total + (session.context?.subagents?.length ?? 0),
		0,
	),
);

const selectedState = computed(() =>
	selectedSession.value?.context?.thread_status ??
	selectedSession.value?.context?.turn_status ??
	"idle",
);
const selectedTone = computed(() => statusTone(selectedState.value));

function openDeployDialog(): void {
	deployDialogOpen.value = true;
}

onMounted(() => {
	window.addEventListener("jarvisctl-open-deploy", openDeployDialog);
});

onBeforeUnmount(() => {
	window.removeEventListener("jarvisctl-open-deploy", openDeployDialog);
});

watch(
	selectedSession,
	(nextSession) => {
		if (nextSession && nextSession.namespace !== props.host.state.selectedNamespace) {
			props.host.selectNamespace(nextSession.namespace);
		}
	},
	{ immediate: true },
);

watch(
	filteredWorkers,
	(nextWorkers) => {
		if (
			selectedWorkerKey.value &&
			!nextWorkers.some(
				(worker) => `${worker.namespace}/${worker.name}` === selectedWorkerKey.value,
			)
		) {
			selectedWorkerKey.value = null;
		}
		if (!selectedWorkerKey.value && !selectedSession.value && nextWorkers[0]) {
			selectedWorkerKey.value = `${nextWorkers[0].namespace}/${nextWorkers[0].name}`;
			props.host.selectControlNamespace(nextWorkers[0].namespace);
		}
	},
	{ immediate: true },
);

function handleSelectWorker(key: string): void {
	selectedWorkerKey.value = key;
	const worker =
		allWorkers.value.find((entry) => `${entry.namespace}/${entry.name}` === key) ?? null;
	props.host.selectControlNamespace(worker?.namespace ?? null);
}

</script>

<template>
	<div class="cp-root">
		<Teleport v-if="host.toolbarMountEl" :to="host.toolbarMountEl">
			<div class="cp-native-toolbar">
				<select
					class="dropdown cp-native-toolbar__select"
					:value="selectedRepository ?? ''"
					title="Repository scope"
					@change="selectedRepository = (($event.target as HTMLSelectElement).value || null)"
				>
					<option value="">All Repos</option>
					<option v-for="repository in repositories" :key="repository.id" :value="repository.id">
						{{ repository.label }}
					</option>
				</select>

				<label class="search-input-container cp-native-toolbar__search">
					<input
						:value="searchQuery"
						type="search"
						class="search-input"
						placeholder="Search namespaces, workers, logs"
						@input="searchQuery = ($event.target as HTMLInputElement).value"
					/>
					<button
						v-if="searchQuery"
						type="button"
						class="search-input-clear-button"
						aria-label="Clear search"
						@click.prevent="searchQuery = ''"
					/>
				</label>

				<div class="cp-native-toolbar__tabs" role="tablist" aria-label="Main system surfaces">
					<button
						v-for="surface in SURFACE_TABS"
						:key="surface.id"
						type="button"
						:class="['clickable-icon cp-native-toolbar__tab', activeSurface === surface.id && 'is-active']"
						:title="surface.title"
						:aria-label="surface.title"
						role="tab"
						:aria-selected="activeSurface === surface.id"
						@click="activeSurface = surface.id"
					>
						<span aria-hidden="true">{{ surface.icon }}</span>
					</button>
				</div>

				<div class="cp-native-toolbar__metrics">
					<span class="cp-toolbar-pill" title="Namespaces">ns {{ allSessions.length }}</span>
					<span class="cp-toolbar-pill" title="Live agents">ag {{ liveAgentCount }}</span>
					<span class="cp-toolbar-pill" title="Subagents">sub {{ subagentCount }}</span>
					<span class="cp-toolbar-pill" title="Workers">wrk {{ allWorkers.length }}</span>
					<span class="cp-toolbar-pill" title="Nodes">node {{ host.state.cluster.nodes.length }}</span>
				</div>

				<StatusBadge :label="selectedState" :tone="selectedTone" compact />
			</div>
		</Teleport>

		<div class="cp-dashboard-grid">
			<Sidebar
				:repositories="repositories"
				:sessions="filteredSessions"
				:workers="filteredWorkers"
				:nodes="host.state.cluster.nodes"
				:selected-namespace="selectedSession?.namespace ?? null"
				:selected-worker-key="selectedWorkerKey"
				:selected-repository="selectedRepository"
				:selected-session="selectedSession"
				@select-repository="selectedRepository = $event"
				@select-namespace="host.selectNamespace($event)"
				@select-worker="handleSelectWorker($event)"
				@open-ticket="host.openTicket($event)"
				@open-transcript="host.openTranscript($event)"
				@close-namespace="host.closeNamespace($event)"
			/>

			<MainPanel
				:host="host"
				:session="selectedSession"
				:sessions="filteredSessions"
				:workers="filteredWorkers"
				:selected-worker="selectedWorker"
				:selected-worker-key="selectedWorkerKey"
				:control-plane="controlPlane"
				:cluster="host.state.cluster"
				:activity-sections="selectedActivitySections"
				:active-surface="activeSurface"
				@select-worker="handleSelectWorker($event)"
			/>
		</div>

		<DeployWorkloadDialog
			v-if="deployDialogOpen"
			:host="host"
			:tickets="host.state.tickets"
			:cluster="host.state.cluster"
			@close="deployDialogOpen = false"
		/>
	</div>
</template>
