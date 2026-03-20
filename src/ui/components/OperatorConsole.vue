<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
	JarvisRuntimeFeedEntry,
	JarvisRuntimeSubagentAction,
	JarvisRuntimeSubagentMetadata,
	JarvisSessionMetadata,
} from "../../types/domain";
import type { JarvisDashboardHost, JarvisOperatorMessageRequest, JarvisOperatorMode } from "../bridge";
import { formatClock, sessionTone, sessionStateLabel, shortPath, statusTone } from "../helpers";
import ExpandableText from "./ExpandableText.vue";
import StatusBadge from "./StatusBadge.vue";

interface ConsoleTargetOption {
	value: string;
	label: string;
	hint: string;
	kind: "agent" | "subagent";
	relay: boolean;
}

interface ConsoleEntry {
	id: string;
	role: "assistant" | "operator" | "subagent" | "system";
	label: string;
	detail: string;
	timestamp_epoch_ms: number;
	status?: string | null;
}

const props = defineProps<{
	host: JarvisDashboardHost;
	session: JarvisSessionMetadata | null;
}>();

const draftTarget = ref<string>("");
const draftMode = ref<JarvisOperatorMode>("auto");
const draftAttachmentPath = ref("");
const draftMessage = ref("");
const sending = ref(false);
const attachmentFileInput = ref<HTMLInputElement | null>(null);

const targetOptions = computed<ConsoleTargetOption[]>(() => {
	if (!props.session) {
		return [];
	}

	const agentOptions = props.session.agents.map<ConsoleTargetOption>((agent) => ({
		value: `agent:${agent.name}`,
		label: agent.name,
		hint: agent.running ? "direct agent channel" : "idle agent channel",
		kind: "agent",
		relay: false,
	}));

	const subagentOptions = (props.session.context?.subagents ?? []).map<ConsoleTargetOption>((subagent, index) => ({
		value: `subagent:${subagent.thread_id}`,
		label: `Branch ${index + 1}`,
		hint: `${subagent.tool} · relayed through agent0`,
		kind: "subagent",
		relay: true,
	}));

	return [...agentOptions, ...subagentOptions];
});

watch(
	() => [props.session?.namespace, targetOptions.value[0]?.value] as const,
	([namespace, firstOption]) => {
		if (!namespace) {
			draftTarget.value = "";
			return;
		}
		if (!targetOptions.value.some((option) => option.value === draftTarget.value)) {
			draftTarget.value = firstOption ?? "";
		}
	},
	{ immediate: true },
);

const selectedTarget = computed(
	() => targetOptions.value.find((option) => option.value === draftTarget.value) ?? targetOptions.value[0] ?? null,
);

const currentModeLabel = computed(() => {
		switch (draftMode.value) {
			case "steer":
				return "send immediately";
			case "queue":
				return "queue after active turn";
			default:
				return "automatic";
		}
	},
);

const conversationEntries = computed<ConsoleEntry[]>(() => {
	if (!props.session) {
		return [];
	}

	const entries: ConsoleEntry[] = [];
	for (const event of props.session.context?.recent_events ?? []) {
		const entry = mapEventToConversationEntry(event);
		if (entry) {
			entries.push(entry);
		}
	}

	for (const subagent of props.session.context?.subagents ?? []) {
		for (const action of subagent.recent_actions ?? []) {
			entries.push(mapActionToConversationEntry(subagent, action));
		}
	}

	return entries
		.sort((left, right) => left.timestamp_epoch_ms - right.timestamp_epoch_ms)
		.slice(-24);
});

const composerDisabled = computed(() => !props.session || sending.value);
const hasAttachment = computed(() => draftAttachmentPath.value.trim().length > 0);

async function handleSend(): Promise<void> {
	if (!props.session || !selectedTarget.value || sending.value) {
		return;
	}

	const request: JarvisOperatorMessageRequest = {
		targetId: selectedTarget.value.value.replace(/^[^:]+:/, ""),
		targetKind: selectedTarget.value.kind,
		targetLabel: selectedTarget.value.label,
		mode: draftMode.value,
		message: draftMessage.value,
		attachmentPath: draftAttachmentPath.value,
	};

	sending.value = true;
	try {
		await props.host.sendOperatorMessage(props.session, request);
		draftMessage.value = "";
		draftAttachmentPath.value = "";
	} finally {
		sending.value = false;
	}
}

async function handlePickVaultAttachment(): Promise<void> {
	if (!props.session || sending.value) {
		return;
	}
	const path = await props.host.pickVaultAttachment(props.session);
	if (path) {
		draftAttachmentPath.value = path;
	}
}

function handleOpenExternalAttachment(): void {
	attachmentFileInput.value?.click();
}

async function handleExternalAttachmentChange(event: Event): Promise<void> {
	if (!props.session || sending.value) {
		return;
	}
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) {
		return;
	}
	const path = await props.host.pickExternalAttachment(props.session, file);
	if (path) {
		draftAttachmentPath.value = path;
	}
	input.value = "";
}

async function handlePasteClipboardAttachment(): Promise<void> {
	if (!props.session || sending.value) {
		return;
	}
	const path = await props.host.pasteClipboardAttachment(props.session);
	if (path) {
		draftAttachmentPath.value = path;
	}
}

function clearAttachment(): void {
	draftAttachmentPath.value = "";
}

function mapEventToConversationEntry(event: JarvisRuntimeFeedEntry): ConsoleEntry | null {
	if (!event.detail && !event.title) {
		return null;
	}

	const kind = (event.kind ?? "").toLowerCase();
	if (kind === "assistant") {
		return {
			id: event.id,
			role: "assistant",
			label: event.actor ?? "assistant",
			detail: event.detail ?? event.title,
			timestamp_epoch_ms: event.timestamp_epoch_ms,
			status: event.status,
		};
	}

	if (kind === "operator") {
		return {
			id: event.id,
			role: "operator",
			label: event.actor ?? "operator",
			detail: event.detail ?? event.title,
			timestamp_epoch_ms: event.timestamp_epoch_ms,
			status: event.status,
		};
	}

	if (kind === "subagent") {
		return {
			id: event.id,
			role: "subagent",
			label: event.actor ?? "subagent",
			detail: event.detail ?? event.title,
			timestamp_epoch_ms: event.timestamp_epoch_ms,
			status: event.status,
		};
	}

	return {
		id: event.id,
		role: "system",
		label: event.kind,
		detail: event.detail ?? event.title,
		timestamp_epoch_ms: event.timestamp_epoch_ms,
		status: event.status,
	};
}

function mapActionToConversationEntry(
	subagent: JarvisRuntimeSubagentMetadata,
	action: JarvisRuntimeSubagentAction,
): ConsoleEntry {
	return {
		id: `${subagent.thread_id}:${action.id}`,
		role: "subagent",
		label: subagent.tool,
		detail: action.detail ?? action.title,
		timestamp_epoch_ms: action.timestamp_epoch_ms,
		status: action.status ?? subagent.status,
	};
}
</script>

<template>
	<div v-if="session" class="cp-operator-console">
		<div class="cp-operator-stream-shell">
			<div class="cp-operator-stream__header">
				<p class="cp-panel__eyebrow">Conversation</p>
				<div class="cp-panel__meta">
					<StatusBadge :label="sessionStateLabel(session)" :tone="sessionTone(session)" compact />
					<span class="cp-chip">{{ conversationEntries.length }} messages</span>
				</div>
			</div>

			<div v-if="conversationEntries.length === 0" class="cp-empty-state">
				No operator-visible exchange yet. New assistant, operator, system, and subagent activity will appear here.
			</div>
			<div v-else class="cp-operator-stream">
				<article
					v-for="entry in conversationEntries"
					:key="entry.id"
					:class="['cp-operator-entry', `is-${entry.role}`]"
				>
					<div class="cp-operator-entry__head">
						<div class="cp-operator-entry__meta">
							<span class="cp-chip">{{ entry.label }}</span>
							<StatusBadge
								v-if="entry.status"
								:label="entry.status"
								:tone="statusTone(entry.status)"
								compact
							/>
						</div>
						<span class="cp-operator-entry__time">{{ formatClock(entry.timestamp_epoch_ms) }}</span>
					</div>
					<ExpandableText :text="entry.detail" :lines="6" />
				</article>
			</div>
		</div>

		<div class="cp-operator-compose">
			<div class="cp-operator-compose__header">
				<p class="cp-panel__eyebrow">Send Context</p>
				<div class="cp-panel__meta">
					<span class="cp-chip">{{ currentModeLabel }}</span>
					<StatusBadge
						v-if="selectedTarget"
						:label="selectedTarget.relay ? 'relay' : 'direct'"
						:tone="selectedTarget.relay ? 'warning' : 'live'"
						compact
					/>
				</div>
			</div>

			<div class="cp-operator-form">
				<label class="cp-form-field">
					<span class="cp-form-field__label">Target</span>
					<select v-model="draftTarget" class="cp-form-select" :disabled="composerDisabled">
						<option v-for="option in targetOptions" :key="option.value" :value="option.value">
							{{ option.label }} · {{ option.hint }}
						</option>
					</select>
				</label>

				<label class="cp-form-field">
					<span class="cp-form-field__label">Mode</span>
					<select v-model="draftMode" class="cp-form-select" :disabled="composerDisabled">
						<option value="auto">Auto</option>
						<option value="steer">Steer now</option>
						<option value="queue">Queue next</option>
					</select>
				</label>

				<label class="cp-form-field cp-form-field--full">
					<span class="cp-form-field__label">Attachment Path</span>
					<input
						v-model="draftAttachmentPath"
						type="text"
						class="cp-form-input"
						:disabled="composerDisabled"
						placeholder="Optional file path. Relative paths resolve from the session working directory first."
					/>
					<div class="cp-attachment-action-row">
						<div class="cp-control-strip">
							<button
								type="button"
								class="cp-mini-button cp-action-button"
								:disabled="composerDisabled"
								title="Pick a vault file"
								@click="handlePickVaultAttachment"
							>
								<span class="cp-button__icon" aria-hidden="true">⌘</span>
								<span class="cp-action-button__label">Vault</span>
							</button>
							<button
								type="button"
								class="cp-mini-button cp-action-button"
								:disabled="composerDisabled"
								title="Import a local file"
								@click="handleOpenExternalAttachment"
							>
								<span class="cp-button__icon" aria-hidden="true">↑</span>
								<span class="cp-action-button__label">File</span>
							</button>
						</div>
						<div class="cp-control-strip">
							<button
								type="button"
								class="cp-mini-button cp-action-button"
								:disabled="composerDisabled"
								title="Paste clipboard asset"
								@click="handlePasteClipboardAttachment"
							>
								<span class="cp-button__icon" aria-hidden="true">⎘</span>
								<span class="cp-action-button__label">Paste</span>
							</button>
							<button
								type="button"
								class="cp-mini-button cp-action-button"
								:disabled="composerDisabled || !hasAttachment"
								title="Clear attachment"
								@click="clearAttachment"
							>
								<span class="cp-button__icon" aria-hidden="true">×</span>
								<span class="cp-action-button__label">Clear</span>
							</button>
						</div>
					</div>
					<input
						ref="attachmentFileInput"
						type="file"
						class="hidden"
						:disabled="composerDisabled"
						@change="handleExternalAttachmentChange"
					/>
				</label>

				<label class="cp-form-field cp-form-field--full">
					<span class="cp-form-field__label">Message</span>
					<textarea
						v-model="draftMessage"
						class="cp-form-textarea"
						:disabled="composerDisabled"
						placeholder="Write like a live operator note: correction, next step, review feedback, or branch routing."
					/>
				</label>
			</div>

			<div class="cp-operator-note">
				<span v-if="selectedTarget?.relay">
					Subagent targets are routed through the main session because the runtime only exposes a single direct tell agent.
				</span>
				<span v-else>
					Use the vault picker, a local file import, or clipboard paste to stage attachment context without typing paths by hand.
				</span>
			</div>

			<div class="cp-operator-action-grid">
				<div class="cp-control-strip">
					<button
						type="button"
						class="cp-mini-button cp-mini-button--primary cp-action-button"
						:disabled="composerDisabled"
						:title="sending ? 'Sending operator context' : 'Send operator context'"
						@click="handleSend"
					>
						<span class="cp-button__icon" aria-hidden="true">↗</span>
						<span class="cp-action-button__label">{{ sending ? "Sending" : "Send" }}</span>
					</button>
					<button type="button" class="cp-mini-button cp-action-button" title="Attach terminal" @click="host.attach(session)">
						<span class="cp-button__icon" aria-hidden="true">⌁</span>
						<span class="cp-action-button__label">Attach</span>
					</button>
					<button
						type="button"
						class="cp-mini-button cp-action-button"
						:title="session.context?.task_note ? 'Continue ticket' : 'Ticket unavailable'"
						:disabled="!session.context?.task_note"
						@click="host.continueTicket(session)"
					>
						<span class="cp-button__icon" aria-hidden="true">↻</span>
						<span class="cp-action-button__label">Continue</span>
					</button>
				</div>

				<div class="cp-control-strip">
					<button
						type="button"
						class="cp-mini-button cp-action-button"
						:title="session.context?.task_note ? 'Start fresh ticket session' : 'Ticket unavailable'"
						:disabled="!session.context?.task_note"
						@click="host.freshTicket(session)"
					>
						<span class="cp-button__icon" aria-hidden="true">＋</span>
						<span class="cp-action-button__label">Fresh</span>
					</button>
					<button
						type="button"
						class="cp-mini-button cp-action-button"
						:title="session.context?.task_note ? 'Open ticket note' : 'Ticket unavailable'"
						:disabled="!session.context?.task_note"
						@click="host.openTicket(session)"
					>
						<span class="cp-button__icon" aria-hidden="true">⌘</span>
						<span class="cp-action-button__label">Ticket</span>
					</button>
					<button
						type="button"
						class="cp-mini-button cp-action-button"
						:title="session.context?.transcript_path ? 'Open transcript' : 'Transcript unavailable'"
						:disabled="!session.context?.transcript_path"
						@click="host.openTranscript(session)"
					>
						<span class="cp-button__icon" aria-hidden="true">≡</span>
						<span class="cp-action-button__label">Transcript</span>
					</button>
				</div>

				<div class="cp-control-strip">
					<button type="button" class="cp-mini-button cp-action-button" title="Copy attach command" @click="host.copyAttach(session)">
						<span class="cp-button__icon" aria-hidden="true">⧉</span>
						<span class="cp-action-button__label">Copy Attach</span>
					</button>
					<button type="button" class="cp-mini-button cp-button--danger cp-action-button" title="Close namespace" @click="host.closeNamespace(session)">
						<span class="cp-button__icon" aria-hidden="true">×</span>
						<span class="cp-action-button__label">Close</span>
					</button>
				</div>
			</div>

			<div class="cp-operator-context">
				<div class="cp-operator-context__row">
					<span class="cp-form-field__label">Working Dir</span>
					<div class="cp-operator-context__value" :title="session.working_directory ?? ''">
						{{ shortPath(session.working_directory) }}
					</div>
				</div>
				<div class="cp-operator-context__row">
					<span class="cp-form-field__label">Transcript</span>
					<div class="cp-operator-context__value" :title="session.context?.transcript_path ?? ''">
						{{ shortPath(session.context?.transcript_path) }}
					</div>
				</div>
			</div>
		</div>
	</div>

	<div v-else class="cp-empty-state cp-empty-state--large">
		Select a namespace to open the operator console.
	</div>
</template>
