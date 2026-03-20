<script setup lang="ts">
import { computed } from "vue";
import type {
	JarvisActivitySection,
	JarvisRuntimeFeedEntry,
	JarvisRuntimeSubagentMetadata,
	JarvisSessionMetadata,
} from "../../types/domain";
import type { JarvisDashboardHost } from "../bridge";
import {
	compactId,
	describeSessionTokens,
	formatClock,
	formatDateTime,
	sessionTone,
	sessionStateLabel,
	statusTone,
} from "../helpers";
import ExpandableText from "./ExpandableText.vue";
import StatusBadge from "./StatusBadge.vue";

type RuntimeSection = "snapshot" | "feed" | "activity" | "branches" | "agents";

const props = withDefaults(
	defineProps<{
		host: JarvisDashboardHost;
		session: JarvisSessionMetadata | null;
		activitySections: JarvisActivitySection[];
		section: RuntimeSection;
		embedded?: boolean;
		showToolbar?: boolean;
	}>(),
	{
		embedded: false,
		showToolbar: true,
	},
);

const events = computed(() => (props.session?.context?.recent_events ?? []).slice(-12).reverse());
const subagents = computed(() =>
	(props.session?.context?.subagents ?? [])
		.slice()
		.sort((left, right) => left.updated_at_epoch_ms - right.updated_at_epoch_ms),
);
const commandText = computed(() => props.session?.shell_command ?? "n/a");
const snapshotOverviewRows = computed(() => {
	if (!props.session) {
		return [];
	}
	return [
		{ label: "Namespace", value: props.session.namespace },
		{ label: "Session", value: compactId(props.session.context?.codex_session_id, 12, 6) },
		{ label: "Backend", value: props.session.backend },
		{ label: "Launch mode", value: props.session.context?.launch_mode ?? "n/a" },
		{ label: "Thread", value: props.session.context?.thread_status ?? "idle" },
		{ label: "Turn", value: props.session.context?.turn_status ?? "idle" },
		{ label: "Created", value: formatDateTime(props.session.created_at_epoch_ms) },
		{ label: "Last activity", value: props.session.context?.last_activity ?? "No activity yet" },
	];
});
const snapshotPathRows = computed(() => {
	if (!props.session) {
		return [];
	}
	return [
		{
			label: "Working dir",
			value: props.session.working_directory ?? "n/a",
			mono: true,
		},
		{
			label: "Ticket note",
			value: props.session.context?.task_note ?? "No ticket note",
			mono: true,
		},
		{
			label: "Transcript",
			value: props.session.context?.transcript_path ?? "Transcript not exported",
			mono: true,
		},
		{
			label: "Event log",
			value: props.session.context?.event_log_path ?? "Event log not exported",
			mono: true,
		},
	];
});

function eventTone(event: JarvisRuntimeFeedEntry): "live" | "warning" | "error" | "idle" | "info" {
	return statusTone(event.status ?? event.kind);
}

function subagentTone(subagent: JarvisRuntimeSubagentMetadata): "live" | "warning" | "error" | "idle" | "info" {
	return statusTone(subagent.status);
}
</script>

<template>
	<div v-if="session" :class="['cp-runtime-tab', embedded && 'is-embedded']">
		<div v-if="showToolbar" class="cp-runtime-toolbar">
			<div class="cp-runtime-toolbar__actions">
				<div class="cp-control-strip">
					<button type="button" class="cp-button cp-button--primary cp-action-button" title="Attach to namespace" @click="host.attach(session)">
						<span class="cp-button__icon" aria-hidden="true">↗</span>
						<span class="cp-action-button__label">Attach</span>
					</button>
					<button
						type="button"
						class="cp-button cp-action-button"
						title="Continue ticket"
						:disabled="!session.context?.task_note"
						@click="host.continueTicket(session)"
					>
						<span class="cp-button__icon" aria-hidden="true">↻</span>
						<span class="cp-action-button__label">Continue</span>
					</button>
					<button
						type="button"
						class="cp-button cp-action-button"
						title="Start fresh ticket session"
						:disabled="!session.context?.task_note"
						@click="host.freshTicket(session)"
					>
						<span class="cp-button__icon" aria-hidden="true">＋</span>
						<span class="cp-action-button__label">Fresh</span>
					</button>
					<button
						type="button"
						class="cp-button cp-action-button"
						title="Open ticket note"
						:disabled="!session.context?.task_note"
						@click="host.openTicket(session)"
					>
						<span class="cp-button__icon" aria-hidden="true">⌘</span>
						<span class="cp-action-button__label">Ticket</span>
					</button>
					<button
						type="button"
						class="cp-button cp-action-button"
						title="Open transcript"
						:disabled="!session.context?.transcript_path"
						@click="host.openTranscript(session)"
					>
						<span class="cp-button__icon" aria-hidden="true">≡</span>
						<span class="cp-action-button__label">Transcript</span>
					</button>
				</div>
			</div>
			<div class="cp-runtime-toolbar__actions cp-runtime-toolbar__actions--right">
				<div class="cp-control-strip cp-control-strip--right">
					<button type="button" class="cp-button cp-action-button" title="Tell agent0" @click="host.tellAgent(session)">
						<span class="cp-button__icon" aria-hidden="true">✎</span>
						<span class="cp-action-button__label">Tell</span>
					</button>
					<button type="button" class="cp-button cp-action-button" title="Copy attach command" @click="host.copyAttach(session)">
						<span class="cp-button__icon" aria-hidden="true">⧉</span>
						<span class="cp-action-button__label">Copy Attach</span>
					</button>
					<button type="button" class="cp-button cp-button--danger cp-action-button" title="Close namespace" @click="host.closeNamespace(session)">
						<span class="cp-button__icon" aria-hidden="true">×</span>
						<span class="cp-action-button__label">Close</span>
					</button>
				</div>
			</div>
		</div>

		<div class="cp-runtime-section-shell">
			<div v-if="!embedded && section === 'snapshot'" class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Session Snapshot</p>
					<h3 class="cp-panel__title">Runtime Contract</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ session.backend }}</span>
					<span v-for="token in describeSessionTokens(session)" :key="token" class="cp-chip">{{ token }}</span>
				</div>
			</div>

			<div v-if="!embedded && section === 'feed'" class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Runtime Feed</p>
					<h3 class="cp-panel__title">Live Events</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ events.length }} events</span>
					<StatusBadge :label="session.context?.turn_status ?? 'idle'" :tone="sessionTone(session)" compact />
				</div>
			</div>

			<div v-if="!embedded && section === 'activity'" class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Observed Activity</p>
					<h3 class="cp-panel__title">Event Log Tail</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ activitySections.length }} sections</span>
					<span class="cp-chip">event log</span>
				</div>
			</div>

			<div v-if="!embedded && section === 'branches'" class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Subagent Branches</p>
					<h3 class="cp-panel__title">Branch Runtime</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ subagents.length }} tracked</span>
				</div>
			</div>

			<div v-if="!embedded && section === 'agents'" class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Agents</p>
					<h3 class="cp-panel__title">Execution Controls</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ session.agents.length }} total</span>
				</div>
			</div>

			<div class="cp-runtime-section__body">
				<div v-if="section === 'snapshot'" class="cp-snapshot-stack">
					<section class="cp-snapshot-hero">
						<div class="cp-snapshot-hero__copy">
							<p class="cp-panel__eyebrow">Runtime Summary</p>
							<h4 class="cp-snapshot-hero__title">{{ session.context?.task_title ?? "Live operator surface watch" }}</h4>
							<p class="cp-snapshot-hero__subtitle">{{ session.context?.last_activity ?? "No activity yet" }}</p>
						</div>
						<div class="cp-snapshot-hero__status">
							<div class="cp-snapshot-hero__status-group">
								<span class="cp-chip">Thread</span>
								<StatusBadge :label="session.context?.thread_status ?? 'idle'" :tone="statusTone(session.context?.thread_status)" compact />
							</div>
							<div class="cp-snapshot-hero__status-group">
								<span class="cp-chip">Turn</span>
								<StatusBadge :label="session.context?.turn_status ?? 'idle'" :tone="statusTone(session.context?.turn_status)" compact />
							</div>
							<div class="cp-snapshot-hero__status-group">
								<span class="cp-chip">Subagents</span>
								<span class="cp-chip">{{ session.context?.subagents?.length ?? 0 }}</span>
							</div>
						</div>
					</section>

					<section class="cp-snapshot-section">
						<div class="cp-snapshot-section__head">
							<div>
								<p class="cp-panel__eyebrow">Overview</p>
								<h4 class="cp-snapshot-section__title">Runtime contract</h4>
							</div>
							<div class="cp-panel__meta">
								<span v-for="token in describeSessionTokens(session)" :key="token" class="cp-chip">{{ token }}</span>
							</div>
						</div>
						<div class="cp-data-table">
							<div v-for="row in snapshotOverviewRows" :key="row.label" class="cp-data-table__row">
								<div class="cp-data-table__label">{{ row.label }}</div>
								<div class="cp-data-table__value">{{ row.value }}</div>
							</div>
						</div>
					</section>

					<section class="cp-snapshot-section">
						<div class="cp-snapshot-section__head">
							<div>
								<p class="cp-panel__eyebrow">Resources</p>
								<h4 class="cp-snapshot-section__title">Files and workspace</h4>
							</div>
						</div>
						<div class="cp-data-table">
							<div v-for="row in snapshotPathRows" :key="row.label" class="cp-data-table__row">
								<div class="cp-data-table__label">{{ row.label }}</div>
								<div :class="['cp-data-table__value', row.mono && 'cp-data-table__value--mono']">{{ row.value }}</div>
							</div>
						</div>
					</section>

					<div class="cp-snapshot-notes">
						<section class="cp-snapshot-note">
							<div class="cp-snapshot-note__label">Live message</div>
							<ExpandableText :text="session.context?.live_message ?? 'No live summary yet.'" :lines="6" />
						</section>
						<section class="cp-snapshot-note">
							<div class="cp-snapshot-note__label">Launch command</div>
							<div class="cp-data-table__value cp-data-table__value--mono">{{ commandText }}</div>
						</section>
					</div>
				</div>

				<div v-else-if="section === 'feed'">
					<div v-if="events.length === 0" class="cp-empty-state">No runtime events yet.</div>
					<div v-else class="cp-feed-list cp-timeline-list">
						<article v-for="event in events" :key="event.id" class="cp-timeline-entry cp-feed-card">
							<div class="cp-timeline-entry__rail">
								<div :class="['cp-timeline-entry__dot', `is-${eventTone(event)}`]" />
								<div class="cp-timeline-entry__line" />
							</div>
							<div class="cp-timeline-entry__body">
								<div class="cp-feed-card__top">
									<div class="cp-feed-card__chips">
										<span class="cp-chip">{{ event.kind }}</span>
										<StatusBadge v-if="event.status" :label="event.status" :tone="eventTone(event)" compact />
										<span v-if="event.actor" class="cp-chip">{{ event.actor }}</span>
									</div>
									<span class="cp-feed-card__time">{{ formatClock(event.timestamp_epoch_ms) }}</span>
								</div>
								<div class="cp-feed-card__title">{{ event.title }}</div>
								<ExpandableText v-if="event.detail" :text="event.detail" :lines="6" />
							</div>
						</article>
					</div>
				</div>

				<div v-else-if="section === 'activity'">
					<div v-if="activitySections.length === 0" class="cp-empty-state">No observed log output yet.</div>
					<div v-else class="cp-activity-list">
						<article
							v-for="(sectionItem, index) in activitySections"
							:key="`${sectionItem.kind}-${index}`"
							class="cp-activity-card"
						>
							<div class="cp-activity-card__head">
								<StatusBadge :label="sectionItem.label" :tone="statusTone(sectionItem.kind ?? sectionItem.label)" compact />
							</div>
							<ExpandableText v-if="sectionItem.summary" :text="sectionItem.summary" :lines="4" />
							<div v-if="sectionItem.lines.length > 0" class="cp-console">
								<div v-for="(line, lineIndex) in sectionItem.lines" :key="lineIndex" class="cp-console__line">
									{{ line }}
								</div>
							</div>
						</article>
					</div>
				</div>

				<div v-else-if="section === 'branches'">
					<div class="cp-branch-root">
						<div class="cp-branch-root__title">Main Thread</div>
						<div class="cp-branch-root__meta">{{ session.context?.thread_id ?? "main" }} · {{ sessionStateLabel(session) }}</div>
					</div>
					<div v-if="subagents.length === 0" class="cp-empty-state">No spawned subagents yet.</div>
					<div v-else class="cp-branch-list">
						<article v-for="subagent in subagents" :key="subagent.thread_id" class="cp-branch-card">
							<div class="cp-branch-card__rail">
								<div class="cp-branch-card__dot" />
								<div class="cp-branch-card__line" />
							</div>
							<div class="cp-branch-card__body">
								<div class="cp-branch-card__head">
									<div>
										<div class="cp-branch-card__title">agent {{ subagent.thread_id.slice(0, 8) }}</div>
										<div class="cp-branch-card__meta">
											{{ subagent.tool }}<span v-if="subagent.model"> · {{ subagent.model }}</span
											><span v-if="subagent.reasoning_effort"> · {{ subagent.reasoning_effort }}</span>
										</div>
									</div>
									<div class="cp-branch-card__status">
										<StatusBadge :label="subagent.status" :tone="subagentTone(subagent)" compact />
										<span class="cp-chip">{{ formatClock(subagent.updated_at_epoch_ms) }}</span>
									</div>
								</div>
								<ExpandableText v-if="subagent.prompt_preview" :text="subagent.prompt_preview" :lines="4" />
								<ExpandableText v-if="subagent.latest_message" :text="subagent.latest_message" :lines="6" />
								<div v-if="(subagent.recent_actions?.length ?? 0) > 0" class="cp-branch-actions">
									<div v-for="action in subagent.recent_actions" :key="action.id" class="cp-branch-action">
										<div class="cp-branch-action__head">
											<span class="cp-chip">{{ action.title }}</span>
											<StatusBadge v-if="action.status" :label="action.status" :tone="statusTone(action.status)" compact />
											<span class="cp-chip">{{ formatClock(action.timestamp_epoch_ms) }}</span>
										</div>
										<ExpandableText v-if="action.detail" :text="action.detail" :lines="4" />
									</div>
								</div>
							</div>
						</article>
					</div>
				</div>

				<div v-else class="cp-agent-list">
					<article v-for="agent in session.agents" :key="agent.name" class="cp-agent-card">
						<div class="cp-agent-card__head">
							<div>
								<div class="cp-agent-card__title">{{ agent.name }}</div>
								<div class="cp-agent-card__meta">PID {{ agent.pid }} · {{ agent.running ? "running" : "idle" }}</div>
							</div>
							<StatusBadge :label="agent.running ? 'running' : 'idle'" :tone="agent.running ? 'live' : 'idle'" compact />
						</div>
						<div class="cp-agent-card__actions">
							<div class="cp-control-strip">
								<button type="button" class="cp-mini-button cp-action-button" title="Tell agent" @click="host.tellAgent(session, agent.name)">
									<span class="cp-button__icon" aria-hidden="true">✎</span>
									<span class="cp-action-button__label">Tell</span>
								</button>
								<button type="button" class="cp-mini-button cp-mini-button--primary cp-action-button" title="Open exec terminal" @click="host.execAgent(session, agent.name)">
									<span class="cp-button__icon" aria-hidden="true">▶</span>
									<span class="cp-action-button__label">Exec</span>
								</button>
								<button type="button" class="cp-mini-button cp-action-button" title="Interrupt agent" @click="host.interruptAgent(session, agent.name)">
									<span class="cp-button__icon" aria-hidden="true">‖</span>
									<span class="cp-action-button__label">Interrupt</span>
								</button>
								<button type="button" class="cp-mini-button cp-action-button" title="Copy exec command" @click="host.copyExec(session, agent.name)">
									<span class="cp-button__icon" aria-hidden="true">⧉</span>
									<span class="cp-action-button__label">Copy Exec</span>
								</button>
							</div>
						</div>
					</article>
				</div>
			</div>
		</div>
	</div>

	<div v-else class="cp-empty-state cp-empty-state--large">
		No namespace selected.
	</div>
</template>
