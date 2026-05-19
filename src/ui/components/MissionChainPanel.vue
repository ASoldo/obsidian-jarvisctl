<script setup lang="ts">
import { computed } from "vue";
import type {
	JarvisAutonomyPolicyRule,
	JarvisAutonomyReconcileReport,
	JarvisAutonomyServiceStatus,
	JarvisCapabilityRecord,
	JarvisClusterState,
	JarvisMissionRecord,
	JarvisMissionPlan,
	JarvisMissionTemplate,
	JarvisOperatorRequestRecord,
	JarvisProposalRecord,
	JarvisRecurringMissionSmokeStatus,
	JarvisRuntimeServerRequest,
	JarvisSessionMetadata,
	JarvisTicketSummary,
	JarvisWorkerMetadata,
	JarvisWorkerLaneScorecard,
	JarvisWorkerRunRecord,
} from "../../types/domain";
import type { JarvisDashboardHost } from "../bridge";
import { relativeAge, sessionTone, statusTone } from "../helpers";
import StatusBadge from "./StatusBadge.vue";

interface MissionChainStage {
	id: string;
	label: string;
	doctrine: string;
	status: string;
	tone: "live" | "warning" | "error" | "idle" | "info";
	metric: string;
	detail: string;
	evidence: string[];
}

interface PendingServerRequest {
	session: JarvisSessionMetadata;
	request: JarvisRuntimeServerRequest;
}

interface ServerRequestDecision {
	key: string;
	label: string;
	responseJson: string;
	tone: "default" | "danger";
}

const props = defineProps<{
	sessions: JarvisSessionMetadata[];
	workers: JarvisWorkerMetadata[];
	tickets: JarvisTicketSummary[];
	missions: JarvisMissionRecord[];
	templates: JarvisMissionTemplate[];
	plans: JarvisMissionPlan[];
	policy: JarvisAutonomyPolicyRule[];
	scorecards: JarvisWorkerLaneScorecard[];
	workerRuns: JarvisWorkerRunRecord[];
	capabilities: JarvisCapabilityRecord[];
	autonomyReport: JarvisAutonomyReconcileReport | null;
	autonomyServiceStatus: JarvisAutonomyServiceStatus | null;
	missionSmokeStatus: JarvisRecurringMissionSmokeStatus | null;
	proposals: JarvisProposalRecord[];
	operatorRequests: JarvisOperatorRequestRecord[];
	cluster: JarvisClusterState;
	host: JarvisDashboardHost;
}>();

const activeTickets = computed(() =>
	props.tickets.filter((ticket) => {
		const status = (ticket.status ?? "").toLowerCase();
		return !["done", "closed", "complete", "completed", "cancelled"].includes(status);
	}),
);

const readyTickets = computed(() =>
	props.tickets.filter((ticket) => {
		const status = (ticket.status ?? "").toLowerCase();
		return status.includes("ready") || status.includes("active") || ticket.autostart;
	}),
);

const runningAgents = computed(() =>
	props.sessions.reduce(
		(total, session) => total + session.agents.filter((agent) => agent.running).length,
		0,
	),
);

const subagentCount = computed(() =>
	props.sessions.reduce(
		(total, session) => total + (session.context?.subagents?.length ?? 0),
		0,
	),
);

const pendingServerRequests = computed<PendingServerRequest[]>(() =>
	props.sessions.flatMap((session) =>
		(session.context?.server_requests ?? [])
			.filter((request) => request.status === "pending")
			.map((request) => ({ session, request })),
	),
);

const sessionsWithErrors = computed(() =>
	props.sessions.filter((session) => session.context?.last_error),
);

const schedulableNodes = computed(() =>
	props.cluster.nodes.filter((node) => {
		if (node.available === false || node.schedulable === false) {
			return false;
		}
		const value = `${node.status ?? ""} ${node.detail ?? ""}`.toLowerCase();
		return node.available === true || value.includes("reachable") || value.includes("schedulable") || value.includes("ready") || value.includes("ssh=");
	}),
);

const loadedWorkers = computed(() => props.workers.filter((worker) => worker.loaded));
const pendingProposals = computed(() => props.proposals.filter((proposal) => proposal.status === "pending"));
const pendingOperatorRequests = computed(() =>
	props.operatorRequests.filter((request) => request.status === "pending"),
);
const latestPlans = computed(() => props.plans.slice(0, 5));
const visibleScorecards = computed(() => props.scorecards.slice(0, 4));
const visibleWorkerRuns = computed(() => props.workerRuns.slice(0, 6));
const visibleCapabilities = computed(() => props.capabilities.slice(0, 5));
const visibleTemplates = computed(() => props.templates.slice(0, 7));
const visiblePolicy = computed(() => props.policy.slice(0, 5));
const reconcileBlockers = computed(() => props.autonomyReport?.blocked_actions ?? []);
const reconcileSafeActions = computed(() => props.autonomyReport?.safe_actions ?? []);
const autonomyTimerActive = computed(() => props.autonomyServiceStatus?.timer_active === "active");
const smokeReports = computed(() => props.autonomyReport?.smoke_reports ?? []);
const missionSmokeConfigured = computed(() => props.missionSmokeStatus?.configured ?? false);
const missionSmokeState = computed(() => props.missionSmokeStatus?.state ?? null);
const missionSmokeConfig = computed(() => props.missionSmokeStatus?.config ?? null);
const missionSmokeTone = computed<"live" | "warning" | "error" | "idle" | "info">(() => {
	if (!missionSmokeConfigured.value) {
		return "idle";
	}
	if (missionSmokeState.value?.last_error) {
		return "error";
	}
	if (props.missionSmokeStatus?.due) {
		return "warning";
	}
	return "live";
});
const missionSmokeLabel = computed(() => {
	if (!missionSmokeConfigured.value) {
		return "not scheduled";
	}
	if (missionSmokeState.value?.last_error) {
		return "error";
	}
	return props.missionSmokeStatus?.due ? "due" : "scheduled";
});

const latestSession = computed(() =>
	props.sessions
		.slice()
		.sort((left, right) => right.created_at_epoch_ms - left.created_at_epoch_ms)[0] ?? null,
);

const operationalReadiness = computed(() => {
	const checks = [
		props.cluster.nodes.length > 0,
		schedulableNodes.value.length === props.cluster.nodes.length && props.cluster.nodes.length > 0,
		props.cluster.links.every((link) => link.ok),
		props.cluster.gpg.ok,
		pendingServerRequests.value.length === 0,
		sessionsWithErrors.value.length === 0,
	];
	const passed = checks.filter(Boolean).length;
	return Math.round((passed / checks.length) * 100);
});

const stages = computed<MissionChainStage[]>(() => [
	{
		id: "sense",
		label: "Sense",
		doctrine: "Capture demand and source material.",
		status: props.tickets.length ? "tracking" : "idle",
		tone: props.tickets.length ? "info" : "idle",
		metric: `${props.tickets.length} tickets`,
		detail: "Tickets, prompts, attachments, and vault context become the operational intake layer.",
		evidence: [
			`${activeTickets.value.length} active tickets`,
			`${readyTickets.value.length} ready or autostart candidates`,
		],
	},
	{
		id: "triage",
		label: "Triage",
		doctrine: "Classify priority, ownership, and constraints.",
		status: activeTickets.value.length ? "ready" : "idle",
		tone: activeTickets.value.length ? "live" : "idle",
		metric: `${new Set(activeTickets.value.map((ticket) => ticket.priority ?? "normal")).size} priorities`,
		detail: "Ticket properties feed scheduler defaults for model, sandbox, reasoning, owner, and finish behavior.",
		evidence: [
			`${new Set(props.tickets.flatMap((ticket) => ticket.tags ?? [])).size} labels`,
			`${new Set(props.tickets.map((ticket) => ticket.project ?? "unassigned")).size} projects`,
		],
	},
	{
		id: "decide",
		label: "Decide",
		doctrine: "Pick the node, policy, and authority boundary.",
		status: schedulableNodes.value.length ? "schedulable" : "blocked",
		tone: schedulableNodes.value.length ? "live" : "error",
		metric: `${schedulableNodes.value.length}/${props.cluster.nodes.length} nodes`,
		detail: "The scheduler maps work to nodes using reachability, cordon state, roles, labels, and auth readiness.",
		evidence: [
			`${props.cluster.links.filter((link) => link.ok).length}/${props.cluster.links.length || 0} links healthy`,
			props.cluster.gpg.ok ? "GPG ready" : `GPG check: ${props.cluster.gpg.detail}`,
		],
	},
	{
		id: "task",
		label: "Task",
		doctrine: "Launch durable sessions and bounded worker jobs.",
		status: props.sessions.length ? "active" : "idle",
		tone: props.sessions.length ? "live" : "idle",
		metric: `${props.sessions.length} namespaces`,
		detail: "Each namespace is a contract: task note, runtime context, transcript, event log, and control actions.",
		evidence: [
			`${runningAgents.value} running agents`,
			`${loadedWorkers.value.length}/${props.workers.length} workers loaded`,
		],
	},
	{
		id: "execute",
		label: "Execute",
		doctrine: "Agents act, branch, observe, and report.",
		status: runningAgents.value ? "running" : props.sessions.length ? "steady" : "idle",
		tone: runningAgents.value ? "live" : props.sessions.length ? "info" : "idle",
		metric: `${subagentCount.value} subagents`,
		detail: "Main agents and subagents produce event-sourced runtime traces that the operator can steer live.",
		evidence: [
			latestSession.value ? `latest ${latestSession.value.namespace} ${relativeAge(latestSession.value.created_at_epoch_ms)}` : "no active runtime",
			`${props.sessions.reduce((total, session) => total + (session.context?.recent_events?.length ?? 0), 0)} recent events`,
		],
	},
	{
		id: "authorize",
		label: "Authorize",
		doctrine: "Hold sensitive moves for operator judgment.",
		status: pendingServerRequests.value.length ? "waiting" : "clear",
		tone: pendingServerRequests.value.length ? "warning" : "live",
		metric: `${pendingServerRequests.value.length} pending`,
		detail: "App-server requests surface as Action Required cards and can be approved or denied from the dashboard.",
		evidence: pendingServerRequests.value.slice(0, 2).map(({ session, request }) => `${session.namespace}: ${request.method}`),
	},
	{
		id: "verify",
		label: "Verify",
		doctrine: "Close the loop with evidence and failure handling.",
		status: sessionsWithErrors.value.length ? "degraded" : props.sessions.length ? "healthy" : "idle",
		tone: sessionsWithErrors.value.length ? "error" : props.sessions.length ? "live" : "idle",
		metric: `${sessionsWithErrors.value.length} errors`,
		detail: "Verification is event-first: transcripts, logs, completion status, and ticket outcomes stay inspectable.",
		evidence: [
			`${props.sessions.filter((session) => session.context?.transcript_path).length} transcripts`,
			`${props.sessions.filter((session) => session.context?.event_log_path).length} event logs`,
		],
	},
	{
		id: "learn",
		label: "Learn",
		doctrine: "Preserve decisions and improve the playbook.",
		status: props.missions.length || props.cluster.audit.length ? "audited" : "baseline",
		tone: props.missions.length || props.cluster.audit.length ? "info" : "idle",
		metric: `${props.missions.length} missions`,
		detail: "Session notes, audit logs, and tickets become reusable operational memory for future missions.",
		evidence: [
			props.cluster.policy ? "orchestration policy loaded" : "policy not loaded",
			`${props.cluster.audit.length} audit events`,
			`${props.cluster.index.visits.length} remote visits indexed`,
		],
	},
]);

const commandPost = computed(() => [
	{ label: "Readiness", value: `${operationalReadiness.value}%`, tone: operationalReadiness.value >= 80 ? "live" : "warning" },
	{ label: "Namespaces", value: String(props.sessions.length), tone: props.sessions.length ? "info" : "idle" },
	{ label: "Missions", value: String(props.missions.length), tone: props.missions.length ? "info" : "idle" },
	{ label: "Nodes", value: `${schedulableNodes.value.length}/${props.cluster.nodes.length}`, tone: schedulableNodes.value.length === props.cluster.nodes.length ? "live" : "warning" },
	{ label: "Approvals", value: String(pendingServerRequests.value.length + pendingProposals.value.length + pendingOperatorRequests.value.length), tone: pendingServerRequests.value.length || pendingProposals.value.length || pendingOperatorRequests.value.length ? "warning" : "live" },
] as const);

async function decideProposal(proposal: JarvisProposalRecord, status: "approved" | "rejected"): Promise<void> {
	const decision = status === "approved"
		? `Approved from Jarvis Control for ${proposal.title}.`
		: `Rejected from Jarvis Control for ${proposal.title}.`;
	await props.host.decideProposal(proposal, status, decision);
}

async function resolveOperatorRequest(request: JarvisOperatorRequestRecord, status: "approved" | "denied"): Promise<void> {
	if (status === "denied") {
		const reason = `Denied from Jarvis Control: ${request.title}.`;
		await props.host.resolveOperatorRequest(request, "denied", null, reason, reason);
		return;
	}
	const response = request.request_id ? await props.host.promptOperatorRequestResponse(request) : null;
	if (request.request_id && response === null) {
		return;
	}
	await props.host.resolveOperatorRequest(
		request,
		"approved",
		response,
		null,
		`Approved from Jarvis Control: ${request.title}.`,
	);
}

function serverRequestTitle(request: JarvisRuntimeServerRequest): string {
	const params = request.params as Record<string, unknown> | null | undefined;
	if (request.method.includes("requestApproval")) {
		return "Command approval";
	}
	const command = typeof params?.command === "string" ? params.command : null;
	return command ?? request.method.replaceAll("/", " / ");
}

function serverRequestCommand(request: JarvisRuntimeServerRequest): string | null {
	const params = request.params as Record<string, unknown> | null | undefined;
	return typeof params?.command === "string" ? params.command : null;
}

function serverRequestNode(item: PendingServerRequest): string {
	return item.session.context?.labels?.["jarvisctl.io/node"]?.trim() || "archiechokie";
}

function canRunSudoBridge(item: PendingServerRequest): boolean {
	const command = serverRequestCommand(item.request)?.toLowerCase() ?? "";
	return command.includes("sudo") || command.includes("pkexec");
}

function serverRequestDecisions(request: JarvisRuntimeServerRequest): ServerRequestDecision[] {
	const params = request.params as Record<string, unknown> | null | undefined;
	if (!Array.isArray(params?.availableDecisions)) {
		return [];
	}
	return params.availableDecisions.map((decision, index) => {
		const key =
			typeof decision === "string"
				? decision
				: decision && typeof decision === "object"
					? Object.keys(decision as Record<string, unknown>)[0] ?? `decision-${index}`
					: `decision-${index}`;
		return {
			key: `${index}:${key}`,
			label: formatDecisionLabel(key),
			responseJson: JSON.stringify(decision),
			tone: key === "cancel" ? "danger" : "default",
		};
	});
}

function formatDecisionLabel(decision: string): string {
	switch (decision) {
		case "accept":
			return "Approve";
		case "cancel":
			return "Cancel";
		case "acceptWithExecpolicyAmendment":
			return "Approve with policy";
		default:
			return decision.replaceAll(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
	}
}

async function promptServerRequest(item: PendingServerRequest): Promise<void> {
	const raw = await props.host.promptServerRequestResponse(item.session, item.request);
	if (raw === null) {
		return;
	}
	await props.host.respondServerRequest(item.session, item.request, raw, null);
}

async function sendServerRequestDecision(
	item: PendingServerRequest,
	decision: ServerRequestDecision,
): Promise<void> {
	await props.host.respondServerRequest(item.session, item.request, decision.responseJson, null);
}

async function denyServerRequest(item: PendingServerRequest): Promise<void> {
	await props.host.respondServerRequest(
		item.session,
		item.request,
		null,
		"Denied by operator from Mission Chain.",
	);
}

async function runServerRequestSudo(item: PendingServerRequest): Promise<void> {
	const command = serverRequestCommand(item.request);
	if (!command) {
		return;
	}
	const node = serverRequestNode(item);
	await props.host.runNodeSudo(node, command);
	await props.host.respondServerRequest(
		item.session,
		item.request,
		null,
		`Operator executed the privileged command on node '${node}' through Jarvis Control. Do not rerun it; verify the resulting state.`,
	);
}

async function runAutonomyReconcile(notify: boolean): Promise<void> {
	await props.host.runAutonomyReconcile(notify);
}

async function installAutonomyService(): Promise<void> {
	await props.host.installAutonomyService();
}

function formatFutureAge(timestampEpochMs: number): string {
	const seconds = Math.max(0, Math.ceil((timestampEpochMs - Date.now()) / 1000));
	if (seconds < 60) {
		return `in ${seconds}s`;
	}
	const minutes = Math.ceil(seconds / 60);
	if (minutes < 60) {
		return `in ${minutes}m`;
	}
	const hours = Math.ceil(minutes / 60);
	if (hours < 48) {
		return `in ${hours}h`;
	}
	return `in ${Math.ceil(hours / 24)}d`;
}

async function configureMissionSmoke(): Promise<void> {
	await props.host.configureMissionSmoke();
}

async function runMissionSmoke(): Promise<void> {
	await props.host.runMissionSmoke();
}

async function copyWorkerArtifact(run: JarvisWorkerRunRecord): Promise<void> {
	await props.host.copyWorkerRunArtifact(run.id);
}

async function remediateWorkerRun(run: JarvisWorkerRunRecord): Promise<void> {
	await props.host.markWorkerRun(run.id, "remediated", `Remediated from Jarvis Control: ${run.job_name}.`);
}

async function runProviderDriftSmoke(): Promise<void> {
	await props.host.runWorkerDriftSmoke("code-svc", "openclaw");
}

async function scheduleProviderDriftSmoke(): Promise<void> {
	await props.host.scheduleWorkerDriftSmoke("code-svc", "openclaw", 6 * 60 * 60);
}

async function previewWorkerRetention(): Promise<void> {
	await props.host.pruneWorkerRuns(30, false, true);
}
</script>

<template>
	<div class="cp-mission-chain">
		<section class="cp-mission-command">
			<div>
				<p class="cp-panel__eyebrow">Operational Doctrine</p>
				<h3 class="cp-mission-command__title">Mission chain</h3>
				<p class="cp-mission-command__copy">
					Turn unstructured work into governed agent operations: sense, triage, decide, task, execute, authorize, verify, and learn.
				</p>
			</div>
			<div class="cp-mission-command__metrics">
				<div v-for="metric in commandPost" :key="metric.label" class="cp-mission-metric">
					<span class="cp-mission-metric__label">{{ metric.label }}</span>
					<span class="cp-mission-metric__value">
						<span>{{ metric.value }}</span>
						<StatusBadge :label="metric.tone" :tone="metric.tone" compact />
					</span>
				</div>
			</div>
		</section>

		<section class="cp-mission-stage-grid">
			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">OR</div>
					<div class="cp-mission-stage__identity">
						<h4>Operator requests</h4>
						<p>Durable prompts for admin privileges, app-server approvals, and human decisions.</p>
					</div>
					<StatusBadge :label="`${pendingOperatorRequests.length} pending`" :tone="pendingOperatorRequests.length ? 'warning' : 'live'" compact />
				</div>
				<div v-if="pendingOperatorRequests.length" class="cp-mission-list">
					<div v-for="request in pendingOperatorRequests.slice(0, 5)" :key="request.id" class="cp-mission-row">
						<div>
							<div class="cp-mission-row__title">{{ request.title }}</div>
							<div class="cp-mission-row__meta">{{ request.reason }}</div>
							<div class="cp-chip-row">
								<span class="cp-chip">{{ request.kind }}</span>
								<span class="cp-chip">{{ request.severity }}</span>
								<span v-if="request.namespace" class="cp-chip">{{ request.namespace }}</span>
								<span v-if="request.command" class="cp-chip" :title="request.command">sudo command</span>
							</div>
						</div>
						<div class="cp-control-strip cp-control-strip--right">
							<button type="button" class="cp-mini-button cp-mini-button--primary" title="Approve or respond" @click="resolveOperatorRequest(request, 'approved')">✓</button>
							<button type="button" class="cp-mini-button" title="Deny request" @click="resolveOperatorRequest(request, 'denied')">×</button>
						</div>
					</div>
				</div>
				<div v-else class="cp-empty-state">No pending operator requests.</div>
			</article>

			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">AP</div>
					<div class="cp-mission-stage__identity">
						<h4>Autonomy queue</h4>
						<p>Controller recommendations and operator gates.</p>
					</div>
					<StatusBadge :label="`${pendingProposals.length} proposals`" :tone="pendingProposals.length ? 'warning' : 'live'" compact />
				</div>
				<div v-if="pendingProposals.length" class="cp-mission-list">
					<div v-for="proposal in pendingProposals.slice(0, 4)" :key="proposal.id" class="cp-mission-row">
						<div>
							<div class="cp-mission-row__title">{{ proposal.title }}</div>
							<div class="cp-mission-row__meta">{{ proposal.action }}</div>
							<div class="cp-chip-row">
								<span v-if="proposal.mission_id" class="cp-chip">{{ proposal.mission_id }}</span>
								<span v-if="proposal.risk" class="cp-chip">risk {{ proposal.risk }}</span>
							</div>
						</div>
						<div class="cp-control-strip cp-control-strip--right">
							<button type="button" class="cp-mini-button cp-mini-button--primary" title="Approve proposal" @click="decideProposal(proposal, 'approved')">✓</button>
							<button type="button" class="cp-mini-button" title="Reject proposal" @click="decideProposal(proposal, 'rejected')">×</button>
						</div>
					</div>
				</div>
				<div v-else class="cp-empty-state">No pending proposals. Agents can continue inside current policy.</div>
			</article>

			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">RC</div>
					<div class="cp-mission-stage__identity">
						<h4>Autonomy reconciler</h4>
						<p>Retries safe work, surfaces blockers, and can page the operator with persistent desktop notifications.</p>
					</div>
					<StatusBadge
						:label="autonomyReport?.status ?? 'not run'"
						:tone="reconcileBlockers.length ? 'warning' : autonomyReport ? 'live' : 'idle'"
						compact
					/>
				</div>
				<div class="cp-control-strip">
					<button type="button" class="cp-mini-button cp-mini-button--primary" title="Run autonomy reconcile" @click="runAutonomyReconcile(false)">⟳</button>
					<button type="button" class="cp-mini-button" title="Run and send persistent desktop notifications for pending operator requests" @click="runAutonomyReconcile(true)">!</button>
					<button type="button" class="cp-mini-button" title="Install and start the user-systemd autonomy timer" @click="installAutonomyService()">⏱</button>
				</div>
				<div v-if="autonomyReport" class="cp-mission-scoregrid">
					<div class="cp-mission-score">
						<div class="cp-mission-row__title">Safe actions</div>
						<div class="cp-mission-row__meta">{{ reconcileSafeActions.length }} planned or completed</div>
						<div class="cp-chip-row">
							<span v-for="action in reconcileSafeActions.slice(0, 3)" :key="`${action.kind}-${action.summary}`" class="cp-chip">{{ action.kind }} · {{ action.status }}</span>
						</div>
					</div>
					<div class="cp-mission-score">
						<div class="cp-mission-row__title">Decision blockers</div>
						<div class="cp-mission-row__meta">{{ reconcileBlockers.length }} need operator judgment</div>
						<div class="cp-chip-row">
							<span v-for="action in reconcileBlockers.slice(0, 3)" :key="`${action.kind}-${action.summary}`" class="cp-chip">{{ action.kind }}</span>
						</div>
					</div>
					<div class="cp-mission-score">
						<div class="cp-mission-row__title">Autonomy timer</div>
						<div class="cp-mission-row__meta">
							{{ autonomyServiceStatus?.timer_active ?? 'unknown' }} · {{ autonomyServiceStatus?.timer_enabled ?? 'not installed' }}
						</div>
						<div class="cp-chip-row">
							<span class="cp-chip">{{ autonomyTimerActive ? "running" : "manual" }}</span>
							<span class="cp-chip">linger {{ autonomyServiceStatus?.linger ?? "unknown" }}</span>
						</div>
					</div>
				</div>
				<div v-else class="cp-empty-state">Reconciler status will load on refresh and can be run from here.</div>
			</article>

			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">SM</div>
					<div class="cp-mission-stage__identity">
						<h4>Recurring smoke</h4>
						<p>Two-node mission drill run by the autonomy timer to prove cross-node orchestration stays healthy.</p>
					</div>
					<StatusBadge :label="missionSmokeLabel" :tone="missionSmokeTone" compact />
				</div>
				<div class="cp-control-strip">
					<button type="button" class="cp-mini-button cp-mini-button--primary" title="Schedule recurring two-node smoke using the first two cluster nodes" @click="configureMissionSmoke()">⏱</button>
					<button type="button" class="cp-mini-button" title="Run the recurring smoke now" @click="runMissionSmoke()">▶</button>
				</div>
				<div v-if="missionSmokeConfigured && missionSmokeConfig" class="cp-mission-scoregrid">
					<div class="cp-mission-score">
						<div class="cp-mission-row__title">Nodes</div>
						<div class="cp-mission-row__meta">{{ missionSmokeConfig.first_node }} <-> {{ missionSmokeConfig.second_node }}</div>
						<div class="cp-chip-row">
							<span class="cp-chip">{{ missionSmokeConfig.execute ? "execute" : "dry-run" }}</span>
							<span class="cp-chip">every {{ Math.round(missionSmokeConfig.interval_seconds / 3600) || 1 }}h</span>
						</div>
					</div>
					<div class="cp-mission-score">
						<div class="cp-mission-row__title">Last run</div>
						<div class="cp-mission-row__meta">
							{{ missionSmokeState?.last_status ?? "not run" }}
							<span v-if="missionSmokeState?.last_mission_id"> · {{ missionSmokeState.last_mission_id }}</span>
						</div>
						<div class="cp-chip-row">
							<span class="cp-chip">{{ missionSmokeState?.run_count ?? 0 }} runs</span>
							<span v-if="missionSmokeState?.last_run_epoch_ms" class="cp-chip">{{ relativeAge(missionSmokeState.last_run_epoch_ms) }}</span>
						</div>
					</div>
					<div class="cp-mission-score">
						<div class="cp-mission-row__title">Next run</div>
						<div class="cp-mission-row__meta">
							{{ missionSmokeStatus?.due ? "due now" : missionSmokeStatus?.next_run_epoch_ms ? formatFutureAge(missionSmokeStatus.next_run_epoch_ms) : "waiting" }}
						</div>
						<div class="cp-chip-row">
							<span v-if="missionSmokeState?.last_error" class="cp-chip">error: {{ missionSmokeState.last_error }}</span>
							<span v-else class="cp-chip">autonomy timer</span>
						</div>
					</div>
				</div>
				<div v-else class="cp-empty-state">Schedule a recurring smoke once both cluster nodes are visible.</div>
				<div v-if="smokeReports.length" class="cp-chip-row">
					<span v-for="report in smokeReports.slice(0, 3)" :key="report.id" class="cp-chip" :title="report.command">
						{{ report.mission_id }} · {{ report.status }}
					</span>
				</div>
			</article>

			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">NX</div>
					<div class="cp-mission-stage__identity">
						<h4>Next actions</h4>
						<p>Read-only controller plan from `jarvisctl mission plan`.</p>
					</div>
					<StatusBadge :label="`${plans.length} plans`" tone="info" compact />
				</div>
				<div v-if="latestPlans.length" class="cp-mission-list">
					<div v-for="plan in latestPlans" :key="plan.mission_id" class="cp-mission-row">
						<div>
							<div class="cp-mission-row__title">{{ plan.title }}</div>
							<div class="cp-mission-row__meta">{{ plan.actions[0]?.summary ?? plan.next_stage }}</div>
						</div>
						<div class="cp-chip-row cp-chip-row--right">
							<span class="cp-chip">{{ plan.next_stage }}</span>
							<span class="cp-chip">{{ plan.autonomy_level }}</span>
							<span class="cp-chip">risk {{ plan.risk }}</span>
						</div>
					</div>
				</div>
				<div v-else class="cp-empty-state">No mission plans yet. Create a mission from a template or bind one in Deploy.</div>
			</article>

			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">SC</div>
					<div class="cp-mission-stage__identity">
						<h4>Lane scorecards</h4>
						<p>Autonomy expands only where evidence supports it.</p>
					</div>
					<StatusBadge :label="`${scorecards.length} lanes`" tone="info" compact />
				</div>
				<div class="cp-mission-scoregrid">
					<div v-for="scorecard in visibleScorecards" :key="scorecard.lane" class="cp-mission-score">
						<div class="cp-mission-row__title">{{ scorecard.lane }}</div>
						<div class="cp-mission-row__meta">{{ scorecard.readiness }} · {{ scorecard.confidence }}%</div>
						<div class="cp-mission-meter"><span :style="{ width: `${scorecard.confidence}%` }" /></div>
						<div class="cp-chip-row">
							<span v-for="gap in scorecard.gaps.slice(0, 2)" :key="gap" class="cp-chip">{{ gap }}</span>
						</div>
					</div>
				</div>
			</article>

			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">WR</div>
					<div class="cp-mission-stage__identity">
						<h4>Worker runs</h4>
						<p>Recent bounded offload records across local and remote nodes.</p>
					</div>
					<div class="cp-control-plane-card__badges">
						<button type="button" class="cp-mini-button" title="Run provider drift smoke through openclaw/code-svc" @click="runProviderDriftSmoke()">Δ</button>
						<button type="button" class="cp-mini-button" title="Schedule provider drift smoke every 6 hours" @click="scheduleProviderDriftSmoke()">⏱</button>
						<button type="button" class="cp-mini-button" title="Preview retention and redaction policy" @click="previewWorkerRetention()">⌁</button>
						<StatusBadge :label="`${workerRuns.length} runs`" tone="info" compact />
					</div>
				</div>
				<div v-if="visibleWorkerRuns.length" class="cp-mission-scoregrid">
					<div v-for="run in visibleWorkerRuns" :key="run.id" class="cp-mission-score">
						<div class="cp-mission-row__title">{{ run.job_name }}</div>
						<div class="cp-mission-row__meta">
							{{ run.namespace }}/{{ run.service_name }} · {{ run.worker ?? "worker" }} · {{ run.node ?? "local" }}
						</div>
						<div class="cp-chip-row">
							<span class="cp-chip">{{ run.phase }}</span>
							<span class="cp-chip">{{ run.execution_mode }}</span>
							<span class="cp-chip">{{ run.validation_state ?? "unvalidated" }}</span>
							<span v-if="run.remediation_status" class="cp-chip">{{ run.remediation_status }}</span>
						</div>
						<div v-if="run.response_preview" class="cp-mission-row__meta">{{ run.response_preview }}</div>
						<div v-if="run.error" class="cp-mission-row__meta cp-mission-row__meta--danger">{{ run.error }}</div>
						<div class="cp-chip-row">
							<button type="button" class="cp-mini-button" title="Copy worker artifact" @click="copyWorkerArtifact(run)">⧉</button>
							<button
								type="button"
								class="cp-mini-button"
								title="Mark worker run remediated"
								:disabled="run.remediation_status === 'remediated'"
								@click="remediateWorkerRun(run)"
							>
								✓
							</button>
						</div>
					</div>
				</div>
				<div v-else class="cp-empty-state">No worker run records yet. Use a service-backed worker offload to create the first record.</div>
			</article>

			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">CR</div>
					<div class="cp-mission-stage__identity">
						<h4>Capability registry</h4>
						<p>Operational lanes with validators, artifact contracts, confidence, and remaining gaps.</p>
					</div>
					<StatusBadge :label="`${capabilities.length} capabilities`" tone="info" compact />
				</div>
				<div class="cp-mission-scoregrid">
					<div v-for="capability in visibleCapabilities" :key="capability.id" class="cp-mission-score">
						<div class="cp-mission-row__title">{{ capability.title }}</div>
						<div class="cp-mission-row__meta">{{ capability.lane }} · {{ capability.status }} · {{ capability.confidence }}%</div>
						<div class="cp-mission-meter"><span :style="{ width: `${capability.confidence}%` }" /></div>
						<div class="cp-chip-row">
							<span class="cp-chip">{{ capability.schedulable ? "schedulable" : "manual" }}</span>
							<span class="cp-chip">{{ capability.validators.length }} validators</span>
							<span class="cp-chip">{{ capability.artifact_contracts.length }} contracts</span>
						</div>
						<div v-if="capability.gaps.length" class="cp-mission-row__meta">{{ capability.gaps[0] }}</div>
					</div>
				</div>
			</article>

			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">TM</div>
					<div class="cp-mission-stage__identity">
						<h4>Mission templates</h4>
						<p>Repeatable operating models for autonomous work.</p>
					</div>
					<StatusBadge :label="`${templates.length} templates`" tone="info" compact />
				</div>
				<div class="cp-chip-row">
					<span v-for="template in visibleTemplates" :key="template.id" class="cp-chip" :title="template.objective">
						{{ template.id }} · {{ template.priority }}
					</span>
				</div>
			</article>

			<article class="cp-mission-stage cp-mission-stage--wide">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">PG</div>
					<div class="cp-mission-stage__identity">
						<h4>Policy gates</h4>
						<p>Autonomous action boundaries before agents escalate.</p>
					</div>
					<StatusBadge :label="`${policy.length} rules`" tone="info" compact />
				</div>
				<div v-if="visiblePolicy.length" class="cp-mission-list">
					<div v-for="rule in visiblePolicy" :key="rule.id" class="cp-mission-row">
						<div>
							<div class="cp-mission-row__title">{{ rule.action_class }}</div>
							<div class="cp-mission-row__meta">{{ rule.rationale }}</div>
						</div>
						<div class="cp-chip-row cp-chip-row--right">
							<span class="cp-chip">{{ rule.decision }}</span>
						</div>
					</div>
				</div>
				<div v-else class="cp-empty-state">No autonomy policy loaded.</div>
			</article>

			<article v-if="missions.length" class="cp-mission-stage cp-mission-stage--ledger">
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">ML</div>
					<div class="cp-mission-stage__identity">
						<h4>Mission ledger</h4>
						<p>Current decision and evidence objects.</p>
					</div>
					<StatusBadge :label="`${missions.length} tracked`" tone="info" compact />
				</div>
				<div class="cp-mission-stage__evidence">
					<span v-for="mission in missions.slice(0, 6)" :key="mission.id" class="cp-chip" :title="mission.objective ?? mission.id">
						{{ mission.title }} · {{ mission.status }}
					</span>
				</div>
			</article>
			<article
				v-for="(stage, index) in stages"
				:key="stage.id"
				class="cp-mission-stage"
			>
				<div class="cp-mission-stage__head">
					<div class="cp-mission-stage__index">{{ String(index + 1).padStart(2, "0") }}</div>
					<div class="cp-mission-stage__identity">
						<h4>{{ stage.label }}</h4>
						<p>{{ stage.doctrine }}</p>
					</div>
					<StatusBadge :label="stage.status" :tone="stage.tone" compact />
				</div>
				<div class="cp-mission-stage__metric">{{ stage.metric }}</div>
				<p class="cp-mission-stage__detail">{{ stage.detail }}</p>
				<div class="cp-mission-stage__evidence">
					<span v-for="item in stage.evidence.filter(Boolean)" :key="item" class="cp-chip">
						{{ item }}
					</span>
				</div>
				<div v-if="stage.id === 'authorize' && pendingServerRequests.length" class="cp-mission-authorize-list">
					<div
						v-for="item in pendingServerRequests.slice(0, 3)"
						:key="`${item.session.namespace}:${item.request.id}`"
						class="cp-mission-authorize-row"
					>
						<div class="cp-mission-authorize-row__copy">
							<div class="cp-mission-row__title">{{ serverRequestTitle(item.request) }}</div>
							<div class="cp-mission-row__meta">
								{{ item.session.namespace }} · {{ item.request.id }}
							</div>
						</div>
						<div class="cp-mission-authorize-row__actions">
							<button
								type="button"
								class="cp-mini-button cp-mini-button--primary"
								title="Reopen the response prompt for this pending request"
								@click="promptServerRequest(item)"
							>
								↵
							</button>
							<button
								v-if="canRunSudoBridge(item)"
								type="button"
								class="cp-mini-button cp-mini-button--primary"
								title="Prompt here and run the privileged command on the request node"
								@click="runServerRequestSudo(item)"
							>
								⚿
							</button>
							<button
								v-for="decision in serverRequestDecisions(item.request)"
								:key="decision.key"
								type="button"
								:class="[
									'cp-mini-button',
									decision.tone === 'danger' ? 'cp-button--danger' : '',
								]"
								:title="decision.label"
								@click="sendServerRequestDecision(item, decision)"
							>
								{{ decision.tone === 'danger' ? '×' : '✓' }}
							</button>
							<button
								type="button"
								class="cp-mini-button cp-button--danger"
								title="Deny this pending request"
								@click="denyServerRequest(item)"
							>
								!
							</button>
						</div>
					</div>
				</div>
			</article>
		</section>
	</div>
</template>
