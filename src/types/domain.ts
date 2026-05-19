export interface JarvisRuntimeFeedEntry {
	id: string;
	kind: string;
	title: string;
	timestamp_epoch_ms: number;
	actor?: string | null;
	detail?: string | null;
	status?: string | null;
}

export interface JarvisRuntimeServerRequest {
	id: string;
	method: string;
	status: string;
	created_at_epoch_ms: number;
	resolved_at_epoch_ms?: number | null;
	detail?: string | null;
	params?: unknown;
	response?: unknown;
	error?: string | null;
}

export interface JarvisRuntimeSubagentAction {
	id: string;
	kind: string;
	title: string;
	timestamp_epoch_ms: number;
	detail?: string | null;
	status?: string | null;
}

export interface JarvisRuntimeSubagentMetadata {
	thread_id: string;
	tool: string;
	status: string;
	updated_at_epoch_ms: number;
	parent_thread_id?: string | null;
	model?: string | null;
	reasoning_effort?: string | null;
	prompt_preview?: string | null;
	latest_message?: string | null;
	recent_actions?: JarvisRuntimeSubagentAction[] | null;
}

export interface JarvisActivitySection {
	kind: string;
	label: string;
	summary: string | null;
	lines: string[];
}

export interface JarvisAgentMetadata {
	name: string;
	pid: number;
	running: boolean;
}

export interface JarvisRuntimeContext {
	workload?: string | null;
	task_id?: string | null;
	task_title?: string | null;
	task_note?: string | null;
	launch_mode?: string | null;
	codex_session_id?: string | null;
	prompt_file?: string | null;
	record_file?: string | null;
	transcript_path?: string | null;
	event_log_path?: string | null;
	thread_id?: string | null;
	thread_status?: string | null;
	turn_id?: string | null;
	turn_status?: string | null;
	live_message?: string | null;
	last_activity?: string | null;
	last_error?: string | null;
	control_namespace?: string | null;
	deployment?: string | null;
	labels?: Record<string, string> | null;
	config_maps?: string[] | null;
	secrets?: string[] | null;
	volumes?: string[] | null;
	recent_events?: JarvisRuntimeFeedEntry[] | null;
	server_requests?: JarvisRuntimeServerRequest[] | null;
	subagents?: JarvisRuntimeSubagentMetadata[] | null;
}

export interface JarvisSessionMetadata {
	namespace: string;
	backend: string;
	created_at_epoch_ms: number;
	working_directory?: string | null;
	shell_command: string;
	context?: JarvisRuntimeContext | null;
	agents: JarvisAgentMetadata[];
}

export interface JarvisWorkerMetadata {
	kind: string;
	namespace: string;
	name: string;
	summaryStatus: string;
	summaryDetail?: string | null;
	provider: string;
	model: string;
	role: string;
	endpoint?: string | null;
	locality?: string | null;
	capabilities?: string[] | null;
	classes?: string[] | null;
	pool?: string | null;
	outputMode?: string | null;
	maxConcurrent?: number | null;
	activeRuns?: number | null;
	pendingRuns?: number | null;
	availableSlots?: number | null;
	admission?: string | null;
	admissionCode?: string | null;
	admissionReason?: string | null;
	estimatedMemoryMiB?: number | null;
	estimatedGpuMemoryMiB?: number | null;
	machineMemoryAvailableMiB?: number | null;
	machineGpuMemoryAvailableMiB?: number | null;
	loaded: boolean;
	systemPrompt?: string | null;
	temperature?: number | null;
	numCtx?: number | null;
	numPredict?: number | null;
}

export interface JarvisWorkerOffloadRequest {
	controlNamespace: string;
	serviceName: string;
	prompt: string;
	intent?: string | null;
	jobName?: string | null;
	outputPath?: string | null;
}

export interface JarvisWorkerOffloadResult {
	job_name: string;
	namespace: string;
	service_name: string;
	phase: string;
	selected_class?: string | null;
	fallback_class: boolean;
	worker?: string | null;
	worker_namespace?: string | null;
	worker_provider?: string | null;
	worker_model?: string | null;
	worker_locality?: string | null;
	validation_state?: string | null;
	validation_message?: string | null;
	artifact_path?: string | null;
	output_path?: string | null;
	response?: string | null;
}

export interface JarvisStatusCondition {
	type: string;
	status: string;
	reason: string;
	message: string;
	last_transition_epoch_ms: number;
}

export interface JarvisStatusEvent {
	type: string;
	reason: string;
	message: string;
	epoch_ms: number;
	related?: string | null;
}

export interface JarvisAccessPolicyStatus {
	allowed_namespaces: string[];
	workload_selector: Record<string, string>;
}

export interface JarvisResourceSummary {
	kind: string;
	namespace?: string | null;
	name: string;
	status: string;
	detail?: string | null;
}

export interface JarvisEnvBindingStatus {
	name: string;
	optional: boolean;
	prefix?: string | null;
}

export interface JarvisVolumeBindingStatus {
	name: string;
	optional: boolean;
	paths: string[];
}

export interface JarvisReplicaSetStatus {
	deployment_name: string;
	revision: number;
	template_hash: string;
	replicas: number;
	ready_replicas: number;
	config_maps: JarvisEnvBindingStatus[];
	secrets: JarvisEnvBindingStatus[];
	volumes: JarvisVolumeBindingStatus[];
	sessions: string[];
	active: boolean;
}

export interface JarvisDeploymentStatus {
	replicas: number;
	ready_replicas: number;
	updated_replicas: number;
	unavailable_replicas: number;
	paused: boolean;
	progressing: boolean;
	available: boolean;
	failed: boolean;
	strategy: string;
	progress_deadline_seconds: number;
	current_revision?: number | null;
	current_replica_set?: string | null;
	config_maps: JarvisEnvBindingStatus[];
	secrets: JarvisEnvBindingStatus[];
	volumes: JarvisVolumeBindingStatus[];
	replica_sets: JarvisReplicaSetStatus[];
	sessions: string[];
	conditions: JarvisStatusCondition[];
	events: JarvisStatusEvent[];
}

export interface JarvisJobRunDetail {
	name: string;
	execution_id: string;
	backend: string;
	phase: string;
	service_name?: string | null;
	intent?: string | null;
	selected_class?: string | null;
	fallback_class: boolean;
	worker?: string | null;
	worker_namespace?: string | null;
	worker_locality?: string | null;
	worker_provider?: string | null;
	worker_model?: string | null;
	worker_pool?: string | null;
	worker_classes: string[];
	admission_state?: string | null;
	admission_code?: string | null;
	reason?: string | null;
	created_at_epoch_ms: number;
	completed_at_epoch_ms?: number | null;
	artifact_path?: string | null;
	output_path?: string | null;
	error?: string | null;
	validation_state?: string | null;
	validation_message?: string | null;
	events: JarvisStatusEvent[];
}

export interface JarvisJobStatus {
	completions: number;
	pending: number;
	active: number;
	succeeded: number;
	failed: number;
	runs: string[];
	run_details: JarvisJobRunDetail[];
	conditions: JarvisStatusCondition[];
	events: JarvisStatusEvent[];
}

export interface JarvisCronJobHistoryEntry {
	job_name: string;
	phase: string;
	scheduled_at_epoch_ms?: number | null;
	last_transition_epoch_ms?: number | null;
	pending: number;
	active: number;
	succeeded: number;
	failed: number;
	worker_backed: boolean;
	workers: string[];
}

export interface JarvisCronJobStatus {
	schedule: string;
	active_jobs: string[];
	last_schedule_epoch_ms?: number | null;
	successful_jobs: number;
	failed_jobs: number;
	history: JarvisCronJobHistoryEntry[];
	conditions: JarvisStatusCondition[];
	events: JarvisStatusEvent[];
}

export interface JarvisApplicationSyncHistoryEntry {
	revision: string;
	synced_at_epoch_ms: number;
	rendered_resources: number;
	source_path: string;
}

export interface JarvisApplicationStatus {
	source_path: string;
	repo_url?: string | null;
	source_type: string;
	source_root?: string | null;
	target_revision: string;
	source_revision: string;
	source_dirty: boolean;
	resolved_revision: string;
	last_applied_revision?: string | null;
	sync_status: string;
	health_status: string;
	destination_namespace?: string | null;
	rendered_resources: number;
	last_sync_epoch_ms?: number | null;
	history: JarvisApplicationSyncHistoryEntry[];
	conditions: JarvisStatusCondition[];
	events: JarvisStatusEvent[];
}

export interface JarvisServiceStatus {
	target_kind: string;
	endpoints: string[];
	strategy: string;
	class_name?: string | null;
	allowed_intents: string[];
	access_policy: JarvisAccessPolicyStatus;
}

export interface JarvisNetworkPolicyStatus {
	selected_sessions: string[];
	policy_types: string[];
}

export interface JarvisResourcePolicyStatus {
	entries?: number | null;
	keys?: string[] | null;
	paths?: string[] | null;
	access_policy: JarvisAccessPolicyStatus;
}

export interface JarvisControlPlaneResource<TStatus> {
	summary: JarvisResourceSummary;
	status: TStatus;
}

export interface JarvisControlPlaneState {
	namespace: string;
	fetched_at_epoch_ms: number;
	resources: JarvisResourceSummary[];
	deployments: JarvisControlPlaneResource<JarvisDeploymentStatus>[];
	jobs: JarvisControlPlaneResource<JarvisJobStatus>[];
	cron_jobs: JarvisControlPlaneResource<JarvisCronJobStatus>[];
	applications: JarvisControlPlaneResource<JarvisApplicationStatus>[];
	services: JarvisControlPlaneResource<JarvisServiceStatus>[];
	network_policies: JarvisControlPlaneResource<JarvisNetworkPolicyStatus>[];
	config_maps: JarvisControlPlaneResource<JarvisResourcePolicyStatus>[];
	secrets: JarvisControlPlaneResource<JarvisResourcePolicyStatus>[];
	volumes: JarvisControlPlaneResource<JarvisResourcePolicyStatus>[];
}

export interface JarvisClusterNode {
	kind?: string;
	name: string;
	status?: string;
	detail?: string;
}

export interface JarvisNodeDoctorCheck {
	node: string;
	target?: string;
	available: boolean;
	schedulable?: boolean;
	codex_auth_present?: boolean;
	stale_auth_leases?: number | string;
	stale_visit_artifacts?: number | string;
	facts?: Record<string, string>;
	issues?: string[];
	error?: string | null;
}

export interface JarvisNodeLinkCheck {
	from: string;
	to: string;
	reachable?: boolean;
	ok?: boolean;
	exit_status?: number;
	detail?: string;
	error?: string | null;
}

export interface JarvisVisitIndexEntry {
	namespace: string;
	node: string;
	from_node?: string | null;
	status?: string | null;
	cleanup_status?: string | null;
	failure_class?: string | null;
	retryable?: boolean | null;
	started_at_epoch_ms?: number | null;
	finished_at_epoch_ms?: number | null;
}

export interface JarvisClusterIndexState {
	sessions: JarvisSessionMetadata[];
	visits: JarvisVisitIndexEntry[];
}

export interface JarvisAuthAuditEvent {
	timestamp?: string;
	action?: string;
	event?: string;
	node?: string;
	namespace?: string;
	path?: string;
	status?: string;
}

export interface JarvisOrchestrationPolicy {
	retries?: number;
	timeout_seconds?: number;
	cleanup_retention_days?: number;
	remote_index_timeout_seconds?: number;
}

export interface JarvisGpgStatus {
	ok: boolean;
	detail: string;
}

export interface JarvisClusterState {
	nodes: JarvisClusterNode[];
	doctor: JarvisNodeDoctorCheck[];
	links: JarvisNodeLinkCheck[];
	index: JarvisClusterIndexState;
	audit: JarvisAuthAuditEvent[];
	policy: JarvisOrchestrationPolicy | null;
	gpg: JarvisGpgStatus;
}

export interface JarvisTicketSummary {
	path: string;
	absolute_path: string;
	title: string;
	status?: string;
	owner?: string;
	priority?: string;
	project?: string;
	repo_path?: string;
	codex_driver?: string;
	codex_model?: string;
	codex_sandbox_mode?: string;
	codex_approval_policy?: string;
	codex_reasoning_effort?: string;
	codex_finish_mode?: string;
	codex_completion_status?: string;
	codex_completion_column?: string;
	autostart?: boolean;
	created?: string;
	updated?: string;
	tags: string[];
}

export interface JarvisMissionRecord {
	id: string;
	title: string;
	objective?: string | null;
	status: string;
	priority?: string | null;
	owner?: string | null;
	labels?: Record<string, string> | null;
	tickets?: string[] | null;
	namespaces?: string[] | null;
	nodes?: string[] | null;
	visits?: string[] | null;
	approvals?: string[] | null;
	evidence?: string[] | null;
	outcome?: string | null;
	created_at_epoch_ms: number;
	updated_at_epoch_ms: number;
}

export interface JarvisMissionTemplate {
	id: string;
	title: string;
	objective: string;
	priority: string;
	labels: Record<string, string>;
	stages: string[];
	evidence: string[];
}

export interface JarvisMissionPlanAction {
	kind: string;
	stage: string;
	summary: string;
	command?: string | null;
	requires_proposal: boolean;
}

export interface JarvisMissionPlan {
	mission_id: string;
	title: string;
	status: string;
	next_stage: string;
	autonomy_level: string;
	pending_proposals: number;
	risk: string;
	actions: JarvisMissionPlanAction[];
}

export interface JarvisAutonomyPolicyRule {
	id: string;
	action_class: string;
	decision: string;
	rationale: string;
}

export interface JarvisWorkerLaneScorecard {
	lane: string;
	readiness: string;
	confidence: number;
	evidence: string[];
	gaps: string[];
}

export interface JarvisProposalRecord {
	id: string;
	title: string;
	mission_id?: string | null;
	status: string;
	action: string;
	rationale: string;
	risk?: string | null;
	proposed_by?: string | null;
	evidence?: string[] | null;
	decision?: string | null;
	decided_by?: string | null;
	created_at_epoch_ms: number;
	updated_at_epoch_ms: number;
}

export interface JarvisVisitRequest {
	namespace: string;
	node: string;
	text: string;
	timeoutSeconds: string;
}

export interface JarvisStartSessionRequest {
	namespace: string;
	node: string;
	role?: string;
	labels?: string;
	retries?: string;
	taskNote: string;
	resumeSessionId?: string;
	workingDirectory?: string;
	startupDelayMs?: string;
	command?: string;
	title?: string;
	repoPath?: string;
	project?: string;
	status?: string;
	priority?: string;
	model?: string;
	reasoningEffort?: string;
	sandboxMode?: string;
	finishMode?: string;
	missionId?: string;
	missionTemplate?: string;
	tags?: string[];
	message: string;
}

export interface JarvisFanoutRequest {
	nodes: string;
	role?: string;
	labels?: string;
	text: string;
	timeoutSeconds: string;
	sandbox?: string;
	model?: string;
	reasoningEffort?: string;
	ephemeral?: boolean;
	maxConcurrency?: string;
}

export interface JarvisBootstrapRequest {
	name: string;
	host: string;
	user: string;
	workspaceRoot: string;
}

export interface JarvisDashboardViewState {
	sessions: JarvisSessionMetadata[];
	workers: JarvisWorkerMetadata[];
	controlPlane: JarvisControlPlaneState | null;
	cluster: JarvisClusterState;
	tickets: JarvisTicketSummary[];
	missions: JarvisMissionRecord[];
	missionTemplates: JarvisMissionTemplate[];
	missionPlans: JarvisMissionPlan[];
	autonomyPolicy: JarvisAutonomyPolicyRule[];
	laneScorecards: JarvisWorkerLaneScorecard[];
	proposals: JarvisProposalRecord[];
	selectedNamespace: string | null;
	selectedControlNamespace: string | null;
	statusMessage: string;
	lastRefreshLabel: string;
	errorMessage: string | null;
	buildStamp: string;
}
