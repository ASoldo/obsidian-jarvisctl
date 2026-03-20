<script setup lang="ts">
import { computed } from "vue";
import type { JarvisActivitySection, JarvisSessionMetadata } from "../../types/domain";
import type { JarvisDashboardHost } from "../bridge";
import ApplicationsTab from "./ApplicationsTab.vue";
import RuntimeTab from "./RuntimeTab.vue";
import TopologyTab from "./TopologyTab.vue";
import WorkflowPanel from "./WorkflowPanel.vue";

type MainTab =
	| "topology"
	| "workflow"
	| "applications"
	| "snapshot"
	| "feed"
	| "activity"
	| "branches"
	| "agents";

const props = defineProps<{
	host: JarvisDashboardHost;
	session: JarvisSessionMetadata | null;
	sessions: JarvisSessionMetadata[];
	activitySections: JarvisActivitySection[];
	mainTab: MainTab;
}>();

const emit = defineEmits<{
	(event: "update:mainTab", value: MainTab): void;
}>();

const tabs = computed(
	() =>
		[
			{ id: "topology", label: "Cluster Topology", icon: "◎" },
			{ id: "workflow", label: "Execution Graph", icon: "⑇" },
			{ id: "applications", label: "Applications", icon: "▤" },
			{ id: "snapshot", label: "Session Snapshot", icon: "◇" },
			{ id: "feed", label: "Runtime Feed", icon: "≣" },
			{ id: "activity", label: "Observed Activity", icon: "◫" },
			{ id: "branches", label: "Subagent Branches", icon: "⑂" },
			{ id: "agents", label: "Execution Controls", icon: "⚙" },
		] as const,
);
</script>

<template>
	<section class="cp-panel cp-main-panel">
		<div class="cp-panel__header cp-panel__header--tabs">
			<div class="cp-panel__header-caption">
				<p class="cp-panel__eyebrow">Main System Surface</p>
			</div>
			<div class="cp-surface-tab-strip">
				<button
					v-for="tab in tabs"
					:key="tab.id"
					type="button"
					:class="['cp-surface-tab', mainTab === tab.id && 'is-active']"
					:title="tab.label"
					:aria-label="tab.label"
					@click="emit('update:mainTab', tab.id as MainTab)"
				>
					<span class="cp-surface-tab__icon" aria-hidden="true">{{ tab.icon }}</span>
					<span v-if="mainTab === tab.id" class="cp-surface-tab__label">{{ tab.label }}</span>
				</button>
			</div>
		</div>

		<div class="cp-panel__body cp-main-panel__body">
			<TopologyTab v-if="props.mainTab === 'topology'" :session="session" />
			<WorkflowPanel v-else-if="props.mainTab === 'workflow'" :session="session" embedded />
			<ApplicationsTab v-else-if="props.mainTab === 'applications'" :host="host" :sessions="sessions" />
			<RuntimeTab
				v-else
				:host="host"
				:session="session"
				:activity-sections="activitySections"
				:section="props.mainTab"
			/>
		</div>
	</section>
</template>
