<script setup lang="ts">
import type { JarvisActivitySection, JarvisSessionMetadata } from "../../types/domain";
import type { JarvisDashboardHost } from "../bridge";
import ApplicationsTab from "./ApplicationsTab.vue";
import RuntimeTab from "./RuntimeTab.vue";
import TopologyTab from "./TopologyTab.vue";

type MainTab = "topology" | "applications" | "runtime";

defineProps<{
	host: JarvisDashboardHost;
	session: JarvisSessionMetadata | null;
	sessions: JarvisSessionMetadata[];
	activitySections: JarvisActivitySection[];
	mainTab: MainTab;
}>();

const emit = defineEmits<{
	(event: "update:mainTab", value: MainTab): void;
}>();
</script>

<template>
	<section class="cp-panel cp-main-panel">
		<div class="cp-panel__header cp-panel__header--tabs">
			<div>
				<p class="cp-panel__eyebrow">Main System Surface</p>
				<h2 class="cp-panel__title">{{ session?.namespace ?? "Cluster Topology" }}</h2>
			</div>
			<div class="cp-tab-strip">
				<button
					v-for="tab in [
						['topology', 'Cluster Topology'],
						['applications', 'Applications'],
						['runtime', 'Agent Runtime'],
					]"
					:key="tab[0]"
					type="button"
					:class="['cp-tab', mainTab === tab[0] && 'is-active']"
					@click="emit('update:mainTab', tab[0] as MainTab)"
				>
					{{ tab[1] }}
				</button>
			</div>
		</div>

		<div class="cp-panel__body cp-panel__body--scroll cp-main-panel__body">
			<TopologyTab v-if="mainTab === 'topology'" :session="session" />
			<ApplicationsTab v-else-if="mainTab === 'applications'" :host="host" :sessions="sessions" />
			<RuntimeTab v-else :host="host" :session="session" :activity-sections="activitySections" />
		</div>
	</section>
</template>
