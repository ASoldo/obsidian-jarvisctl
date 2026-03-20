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

const props = defineProps<{
	host: JarvisDashboardHost;
	session: JarvisSessionMetadata | null;
	activitySections: JarvisActivitySection[];
	section: RuntimeSection;
}>();

const events = computed(() => (props.session?.context?.recent_events ?? []).slice(-12).reverse());
const subagents = computed(() =>
	(props.session?.context?.subagents ?? []).slice().sort((left, right) => left.updated_at_epoch_ms - right.updated_at_epoch_ms),
);
const commandText = computed(() => props.session?.shell_command ?? "n/a");

function eventTone(event: JarvisRuntimeFeedEntry): "live" | "warning" | "error" | "idle" | "info" {
	return statusTone(event.status ?? event.kind);
}

function subagentTone(subagent: JarvisRuntimeSubagentMetadata): "live" | "warning" | "error" | "idle" | "info" {
	return statusTone(subagent.status);
}
</script>

<template>
	<div v-if="session" class="cp-runtime-tab">
		<div class="cp-runtime-toolbar">
			<div class="cp-runtime-toolbar__actions">
				<button type="button" class="cp-button cp-button--primary" title="Attach to namespace" @click="host.attach(session)">
					↗
				</button>
				<button
					type="button"
					class="cp-button"
					title="Continue ticket"
					:disabled="!session.context?.task_note"
					@click="host.continueTicket(session)"
				>
					↻
				</button>
				<button
					type="button"
					class="cp-button"
					title="Start fresh ticket session"
					:disabled="!session.context?.task_note"
					@click="host.freshTicket(session)"
				>
					＋
				</button>
				<button
					type="button"
					class="cp-button"
					title="Open ticket note"
					:disabled="!session.context?.task_note"
					@click="host.openTicket(session)"
				>
					⌘
				</button>
				<button
					type="button"
					class="cp-button"
					title="Open transcript"
					:disabled="!session.context?.transcript_path"
					@click="host.openTranscript(session)"
				>
					≡
				</button>
			</div>
			<div class="cp-runtime-toolbar__actions cp-runtime-toolbar__actions--right">
				<button type="button" class="cp-button" title="Tell agent0" @click="host.tellAgent(session)">✎</button>
				<button type="button" class="cp-button" title="Copy attach command" @click="host.copyAttach(session)">⧉</button>
				<button type="button" class="cp-button cp-button--danger" title="Close namespace" @click="host.closeNamespace(session)">
					×
				</button>
			</div>
		</div>

		<section v-if="section === 'snapshot'" class="cp-runtime-section-shell">
			<div class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Session Snapshot</p>
					<h3 class="cp-panel__title">Runtime Contract</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ session.backend }}</span>
					<span v-for="token in describeSessionTokens(session)" :key="token" class="cp-chip">{{ token }}</span>
				</div>
			</div>
			<div class="cp-runtime-section__body">
				<div class="cp-snapshot-grid">
					<div class="cp-kv-card cp-kv-card--hero">
						<div class="cp-kv-card__label">Task</div>
						<div class="cp-kv-card__value cp-kv-card__value--strong">
							{{ session.context?.task_title ?? "Live operator surface watch" }}
						</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Codex Session</div>
						<div class="cp-kv-card__value">{{ session.context?.codex_session_id ?? "n/a" }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Thread</div>
						<div class="cp-kv-card__value">{{ session.context?.thread_status ?? "idle" }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Turn</div>
						<div class="cp-kv-card__value">{{ session.context?.turn_status ?? "idle" }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Launch Mode</div>
						<div class="cp-kv-card__value">{{ session.context?.launch_mode ?? "n/a" }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Backend</div>
						<div class="cp-kv-card__value">{{ session.backend }}</div>
					</div>
					<div class="cp-kv-card">
						<div class="cp-kv-card__label">Created</div>
						<div class="cp-kv-card__value">{{ formatDateTime(session.created_at_epoch_ms) }}</div>
					</div>
					<div class="cp-kv-card cp-kv-card--wide">
						<div class="cp-kv-card__label">Last Activity</div>
						<div class="cp-kv-card__value">{{ session.context?.last_activity ?? "No activity yet" }}</div>
					</div>
					<div class="cp-kv-card cp-kv-card--wide">
						<div class="cp-kv-card__label">Transcript</div>
						<div class="cp-kv-card__value cp-kv-card__value--mono">
							{{ session.context?.transcript_path ?? "Transcript not exported" }}
						</div>
					</div>
					<div class="cp-kv-card cp-kv-card--wide">
						<div class="cp-kv-card__label">Event Log</div>
						<div class="cp-kv-card__value cp-kv-card__value--mono">
							{{ session.context?.event_log_path ?? "Event log not exported" }}
						</div>
					</div>
					<div class="cp-kv-card cp-kv-card--wide">
						<div class="cp-kv-card__label">Ticket Note</div>
						<div class="cp-kv-card__value cp-kv-card__value--mono">
							{{ session.context?.task_note ?? "No ticket note" }}
						</div>
					</div>
					<div class="cp-kv-card cp-kv-card--wide">
						<div class="cp-kv-card__label">Working Dir</div>
						<div class="cp-kv-card__value cp-kv-card__value--mono">
							{{ session.working_directory ?? "n/a" }}
						</div>
					</div>
					<div class="cp-kv-card cp-kv-card--full">
						<div class="cp-kv-card__label">Live Message</div>
						<ExpandableText :text="session.context?.live_message ?? 'No live summary yet.'" :lines="6" />
					</div>
					<div class="cp-kv-card cp-kv-card--full">
						<div class="cp-kv-card__label">Command</div>
						<div class="cp-kv-card__value cp-kv-card__value--mono">{{ commandText }}</div>
					</div>
				</div>
			</div>
		</section>

		<section v-else-if="section === 'feed'" class="cp-runtime-section-shell">
			<div class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Runtime Feed</p>
					<h3 class="cp-panel__title">Live Events</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ events.length }} events</span>
					<StatusBadge :label="session.context?.turn_status ?? 'idle'" :tone="sessionTone(session)" compact />
				</div>
			</div>
			<div class="cp-runtime-section__body">
				<div v-if="events.length === 0" class="cp-empty-state">No runtime events yet.</div>
				<div v-else class="cp-feed-list">
					<article v-for="event in events" :key="event.id" class="cp-feed-card">
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
					</article>
				</div>
			</div>
		</section>

		<section v-else-if="section === 'activity'" class="cp-runtime-section-shell">
			<div class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Observed Activity</p>
					<h3 class="cp-panel__title">Event Log Tail</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ activitySections.length }} sections</span>
					<span class="cp-chip">event log</span>
				</div>
			</div>
			<div class="cp-runtime-section__body">
				<div v-if="activitySections.length === 0" class="cp-empty-state">No observed log output yet.</div>
					<div v-else class="cp-activity-list">
						<article v-for="(sectionItem, index) in activitySections" :key="`${sectionItem.kind}-${index}`" class="cp-activity-card">
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
		</section>

		<section v-else-if="section === 'branches'" class="cp-runtime-section-shell">
			<div class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Subagent Branches</p>
					<h3 class="cp-panel__title">Branch Runtime</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ subagents.length }} tracked</span>
				</div>
			</div>
			<div class="cp-runtime-section__body">
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
		</section>

		<section v-else class="cp-runtime-section-shell">
			<div class="cp-runtime-section__header">
				<div>
					<p class="cp-panel__eyebrow">Agents</p>
					<h3 class="cp-panel__title">Execution Controls</h3>
				</div>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ session.agents.length }} total</span>
				</div>
			</div>
			<div class="cp-runtime-section__body">
				<div class="cp-agent-list">
					<article v-for="agent in session.agents" :key="agent.name" class="cp-agent-card">
						<div class="cp-agent-card__head">
							<div>
								<div class="cp-agent-card__title">{{ agent.name }}</div>
								<div class="cp-agent-card__meta">PID {{ agent.pid }} · {{ agent.running ? "running" : "idle" }}</div>
							</div>
							<StatusBadge :label="agent.running ? 'running' : 'idle'" :tone="agent.running ? 'live' : 'idle'" compact />
						</div>
						<div class="cp-agent-card__actions">
							<button type="button" class="cp-mini-button" @click="host.tellAgent(session, agent.name)">Tell</button>
							<button type="button" class="cp-mini-button cp-mini-button--primary" @click="host.execAgent(session, agent.name)">Exec</button>
							<button type="button" class="cp-mini-button" @click="host.interruptAgent(session, agent.name)">Interrupt</button>
							<button type="button" class="cp-mini-button" @click="host.copyExec(session, agent.name)">Copy Exec</button>
						</div>
					</article>
				</div>
			</div>
		</section>
	</div>

	<div v-else class="cp-empty-state cp-empty-state--large">
		No namespace selected.
	</div>
</template>
