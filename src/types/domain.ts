export interface JarvisRuntimeFeedEntry {
	id: string;
	kind: string;
	title: string;
	timestamp_epoch_ms: number;
	actor?: string | null;
	detail?: string | null;
	status?: string | null;
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

export interface JarvisDashboardViewState {
	sessions: JarvisSessionMetadata[];
	selectedNamespace: string | null;
	statusMessage: string;
	lastRefreshLabel: string;
	errorMessage: string | null;
	buildStamp: string;
}
