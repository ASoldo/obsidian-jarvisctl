<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { JarvisDashboardHost } from "./bridge";
import BottomPanel from "./components/BottomPanel.vue";
import MainPanel from "./components/MainPanel.vue";
import Sidebar from "./components/Sidebar.vue";
import TopBar from "./components/TopBar.vue";
import { buildRepositoryGroups } from "./helpers";

type MainTab =
	| "topology"
	| "workflow"
	| "applications"
	| "snapshot"
	| "feed"
	| "activity"
	| "branches"
	| "agents";
type BottomTab = "logs" | "events" | "reasoning" | "metrics";

const props = defineProps<{
	host: JarvisDashboardHost;
}>();

const searchQuery = ref("");
const selectedRepository = ref<string | null>(null);
const mainTab = ref<MainTab>("snapshot");
const bottomTab = ref<BottomTab>("reasoning");
const bottomCollapsed = ref(true);

const allSessions = computed(() => props.host.state.sessions);
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

const selectedSession = computed(() => {
	const selected = allSessions.value.find(
		(session) => session.namespace === props.host.state.selectedNamespace,
	);
	if (selected && filteredSessions.value.some((session) => session.namespace === selected.namespace)) {
		return selected;
	}
	return filteredSessions.value[0] ?? selected ?? allSessions.value[0] ?? null;
});

const selectedActivitySections = computed(() =>
	selectedSession.value ? props.host.readActivitySections(selectedSession.value, 10) : [],
);

const environmentLabel = computed(() => {
	if (!selectedRepository.value) {
		return "All Repos";
	}
	return repositories.value.find((group) => group.id === selectedRepository.value)?.label ?? "All Repos";
});

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

watch(
	selectedSession,
	(nextSession) => {
		if (nextSession && nextSession.namespace !== props.host.state.selectedNamespace) {
			props.host.selectNamespace(nextSession.namespace);
		}
	},
	{ immediate: true },
);

function handleContinue(): void {
	if (selectedSession.value?.context?.task_note) {
		void props.host.continueTicket(selectedSession.value);
		return;
	}
	void props.host.refresh();
}

function cycleEnvironment(): void {
	const options = [null, ...repositories.value.map((group) => group.id)];
	if (options.length === 0) {
		selectedRepository.value = null;
		return;
	}
	const index = options.findIndex((value) => value === selectedRepository.value);
	selectedRepository.value = options[(index + 1 + options.length) % options.length] ?? null;
}
</script>

<template>
	<div class="cp-root">
		<TopBar
			:environment-label="environmentLabel"
			:search-query="searchQuery"
			:namespace-count="allSessions.length"
			:agent-count="liveAgentCount"
			:subagent-count="subagentCount"
			:focus-label="selectedSession?.namespace ?? 'none'"
			:selected-state="selectedState"
			@update:search-query="searchQuery = $event"
			@toggle-environment="cycleEnvironment()"
			@refresh="host.refresh()"
			@open-dashboard="host.openDashboard()"
			@continue="handleContinue"
		/>

		<div :class="['cp-dashboard-grid', bottomCollapsed && 'is-bottom-collapsed']">
			<Sidebar
				:repositories="repositories"
				:sessions="filteredSessions"
				:selected-namespace="selectedSession?.namespace ?? null"
				:selected-repository="selectedRepository"
				:selected-session="selectedSession"
				@select-repository="selectedRepository = $event"
				@select-namespace="host.selectNamespace($event)"
				@open-ticket="host.openTicket($event)"
				@open-transcript="host.openTranscript($event)"
			/>

			<MainPanel
				:host="host"
				:session="selectedSession"
				:sessions="filteredSessions"
				:activity-sections="selectedActivitySections"
				:main-tab="mainTab"
				@update:main-tab="mainTab = $event"
			/>

			<BottomPanel
				:session="selectedSession"
				:activity-sections="selectedActivitySections"
				:bottom-tab="bottomTab"
				:collapsed="bottomCollapsed"
				@update:bottom-tab="bottomTab = $event"
				@toggle-collapsed="bottomCollapsed = !bottomCollapsed"
			/>
		</div>
	</div>
</template>
