import {
	App,
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const VIEW_TYPE_JARVISCTL_CONTROL = "jarvisctl-control-observer";
const LEGACY_VIEW_TYPES = ["jarvisctl-control", "jarvisctl-control-live"];
const TERMINAL_VIEW_TYPE = "terminal:terminal";
const BUILD_STAMP = "2026-03-19-namespace-top-stats";

interface JarvisRuntimeFeedEntry {
	id: string;
	kind: string;
	title: string;
	timestamp_epoch_ms: number;
	actor?: string | null;
	detail?: string | null;
	status?: string | null;
}

interface JarvisRuntimeSubagentMetadata {
	thread_id: string;
	tool: string;
	status: string;
	updated_at_epoch_ms: number;
	parent_thread_id?: string | null;
	model?: string | null;
	reasoning_effort?: string | null;
	prompt_preview?: string | null;
	latest_message?: string | null;
}

interface JarvisActivitySection {
	kind: string;
	label: string;
	summary: string | null;
	lines: string[];
}

interface JarvisAgentMetadata {
	name: string;
	pid: number;
	running: boolean;
}

interface JarvisSessionMetadata {
	namespace: string;
	backend: string;
	created_at_epoch_ms: number;
	working_directory?: string | null;
	shell_command: string;
	context?: JarvisRuntimeContext | null;
	agents: JarvisAgentMetadata[];
}

interface JarvisRuntimeContext {
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
	recent_events?: JarvisRuntimeFeedEntry[] | null;
	subagents?: JarvisRuntimeSubagentMetadata[] | null;
}

interface TerminalProfile {
	args?: string[];
	executable?: string;
	followTheme?: boolean;
	name?: string;
	platforms?: Record<string, boolean>;
	pythonExecutable?: string;
	restoreHistory?: boolean;
	rightClickAction?: string;
	successExitCodes?: string[];
	terminalOptions?: {
		documentOverride: string | null;
	};
	type?: string;
	useWin32Conhost?: boolean;
}

interface TerminalPluginData {
	defaultProfile?: string;
	profiles?: Record<string, TerminalProfile>;
}

interface JarvisCtlControlSettings {
	jarvisctlPath: string;
	refreshIntervalMs: number;
	shellExecutable: string;
}

interface JarvisTellRequest {
	message: string;
}

interface JarvisCodexLaunchRequest {
	message: string;
	imagePaths: string[];
}

function defaultJarvisCtlPath(): string {
	if (process.env.HOME) {
		return join(process.env.HOME, ".local", "bin", "jarvisctl");
	}
	return "jarvisctl";
}

const DEFAULT_SETTINGS: JarvisCtlControlSettings = {
	jarvisctlPath: defaultJarvisCtlPath(),
	refreshIntervalMs: 2500,
	shellExecutable: "/usr/bin/zsh",
};

export default class JarvisCtlControlPlugin extends Plugin {
	settings: JarvisCtlControlSettings = DEFAULT_SETTINGS;
	private lastExecPath: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.writeDebugSnapshot({ event: "plugin-onload" });

		this.registerView(
			VIEW_TYPE_JARVISCTL_CONTROL,
			(leaf) => new JarvisCtlControlView(leaf, this),
		);
		await this.detachStaleLeaves();
		window.setTimeout(() => {
			void this.activateView();
		}, 0);

		this.addRibbonIcon("cpu", "Open Jarvis Control", async () => {
			await this.activateView();
		});

		this.addCommand({
			id: "open-jarvisctl-control",
			name: "Open Jarvis Control",
			callback: async () => {
				await this.activateView();
			},
		});

		this.addCommand({
			id: "open-jarvisctl-dashboard-terminal",
			name: "Open jarvisctl dashboard in Terminal tab",
			callback: async () => {
				await this.openTerminalCommand(
					[this.getTerminalJarvisCtlPath()],
					"JarvisCtl Dashboard",
					this.getVaultBasePath(),
				);
			},
		});

		this.addCommand({
			id: "continue-current-ticket-in-codex",
			name: "Continue current ticket in Codex",
			callback: async () => {
				await this.launchCodexForActiveNote(false);
			},
		});

		this.addCommand({
			id: "start-fresh-current-ticket-in-codex",
			name: "Start fresh Codex session for current ticket",
			callback: async () => {
				await this.launchCodexForActiveNote(true);
			},
		});

		this.addSettingTab(new JarvisCtlControlSettingTab(this.app, this));
	}

	async onunload(): Promise<void> {
		await this.detachStaleLeaves();
		await this.app.workspace.detachLeavesOfType(VIEW_TYPE_JARVISCTL_CONTROL);
	}

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		this.settings = {
			...DEFAULT_SETTINGS,
			...(loaded ?? {}),
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE_JARVISCTL_CONTROL)
			.forEach((leaf) => {
				const view = leaf.view;
				if (view instanceof JarvisCtlControlView) {
					void view.handleSettingsChanged();
				}
			});
	}

	async activateView(): Promise<void> {
		await this.detachStaleLeaves();
		const leaf = this.app.workspace.getLeaf("tab");

		await leaf.setViewState({
			type: VIEW_TYPE_JARVISCTL_CONTROL,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	private isSideLeaf(leaf: WorkspaceLeaf): boolean {
		const workspace = this.app.workspace as unknown as {
			leftSplit?: unknown;
			rightSplit?: unknown;
		};
		const root = "getRoot" in leaf && typeof leaf.getRoot === "function" ? leaf.getRoot() : null;
		return root === workspace.leftSplit || root === workspace.rightSplit;
	}

	private async detachStaleLeaves(): Promise<void> {
		await this.app.workspace.detachLeavesOfType(VIEW_TYPE_JARVISCTL_CONTROL);
		for (const legacyType of LEGACY_VIEW_TYPES) {
			await this.app.workspace.detachLeavesOfType(legacyType);
		}
	}

	async fetchSessions(): Promise<JarvisSessionMetadata[]> {
		const { stdout } = await this.execJarvisCtl(["list", "--json"]);
		const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
		if (!Array.isArray(parsed)) {
			throw new Error("jarvisctl list --json did not return an array");
		}
		return parsed as JarvisSessionMetadata[];
	}

	async runJarvisCtl(args: string[]): Promise<void> {
		await this.execJarvisCtl(args);
	}

	async promptAndTell(namespace: string, agent: string): Promise<void> {
		const request = await promptForTell(this.app, namespace, agent);
		if (!request) {
			return;
		}
		const message = request.message.trim();
		if (!message) {
			new Notice("Nothing was sent because the message was empty.");
			return;
		}

		await this.runJarvisCtl([
			"tell",
			"--namespace",
			namespace,
			"--agent",
			agent,
			"--text",
			message,
		]);
		new Notice(`Sent message to ${namespace}:${agent}`);
	}

	async launchCodexForActiveNote(fresh: boolean): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") {
			new Notice("Open a Markdown ticket note first.");
			return;
		}

		await this.launchCodexForNotePath(join(this.getVaultBasePath(), file.path), file.basename, fresh);
	}

	async launchCodexForTaskNote(taskNotePath: string, fresh: boolean): Promise<void> {
		await this.launchCodexForNotePath(
			taskNotePath,
			basename(taskNotePath, ".md"),
			fresh,
		);
	}

	private async launchCodexForNotePath(
		taskNotePath: string,
		noteLabel: string,
		fresh: boolean,
	): Promise<void> {
		const request = await promptForCodexLaunch(this.app, noteLabel, fresh);
		if (!request) {
			return;
		}

		const args = [
			"codex",
			"--task-note",
			taskNotePath,
		];
		if (fresh) {
			args.push("--fresh");
		}

		const message = request.message.trim();
		if (message) {
			args.push("--message", message);
		}

		for (const image of this.resolveImagePaths(taskNotePath, request.imagePaths)) {
			args.push("--image", image);
		}

		await this.openTerminalCommand(
			[this.getTerminalJarvisCtlPath(), ...args],
			`${fresh ? "Fresh" : "Continue"} Codex ${noteLabel}`,
			this.getVaultBasePath(),
		);
	}

	async openTranscript(transcriptPath: string, namespace: string): Promise<void> {
		await this.openTerminalCommand(
			[
				this.settings.shellExecutable.trim() || "/usr/bin/zsh",
				"--login",
				"-lc",
				`if command -v less >/dev/null 2>&1; then less -R +G ${shellQuote(transcriptPath)}; else tail -n 200 ${shellQuote(transcriptPath)}; fi`,
			],
			`Transcript ${namespace}`,
			dirname(transcriptPath),
		);
	}

	async openTaskNote(taskNotePath: string): Promise<void> {
		const file = this.resolveVaultFile(taskNotePath);
		if (!file) {
			new Notice(`Task note is outside the current vault: ${taskNotePath}`);
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.openFile(file, { active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	async openNamespaceAttach(session: JarvisSessionMetadata): Promise<void> {
		const jarvisctlPath = this.getTerminalJarvisCtlPath();
		await this.openTerminalCommand(
			[jarvisctlPath, "attach", "--namespace", session.namespace],
			`Attach ${session.namespace}`,
			session.working_directory ?? this.getVaultBasePath(),
		);
	}

	async openAgentExec(session: JarvisSessionMetadata, agent: JarvisAgentMetadata): Promise<void> {
		const jarvisctlPath = this.getTerminalJarvisCtlPath();
		await this.openTerminalCommand(
			[
				jarvisctlPath,
				"exec",
				"--namespace",
				session.namespace,
				"--agent",
				agent.name,
			],
			`Exec ${session.namespace}:${agent.name}`,
			session.working_directory ?? this.getVaultBasePath(),
		);
	}

	async openTerminalCommand(
		commandParts: string[],
		title: string,
		cwd: string,
	): Promise<void> {
		if (!(this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.terminal) {
			new Notice("Obsidian Terminal plugin is not enabled.");
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		if ("setPinned" in leaf && typeof leaf.setPinned === "function") {
			leaf.setPinned(true);
		}

		const shellExecutable =
			this.settings.shellExecutable.trim() ||
			this.getBaseIntegratedTerminalProfile().executable ||
			"/usr/bin/zsh";
		const shellCommand = commandParts.map(shellQuote).join(" ");
		const resumeShell = `${shellQuote(shellExecutable)} --login`;
		const wrappedCommand = `${shellCommand}; status=$?; echo; echo "[jarvisctl] ${escapeForDoubleQuotes(title)} exited with status $status"; exec ${resumeShell}`;

		const profile = this.buildCommandProfile(shellExecutable, wrappedCommand, title);
		await leaf.setViewState({
			type: TERMINAL_VIEW_TYPE,
			active: true,
			state: {
				[TERMINAL_VIEW_TYPE]: {
					cwd,
					focus: true,
					profile,
					serial: null,
				},
			},
		});
		this.app.workspace.revealLeaf(leaf);
	}

	private async execJarvisCtl(args: string[]): Promise<{ stdout: string; stderr: string }> {
		let lastError: unknown;
		for (const candidate of this.getJarvisCtlCandidates()) {
			try {
				this.lastExecPath = candidate;
				const { stdout, stderr } = await execFileAsync(candidate, args);
				return { stdout, stderr };
			} catch (error) {
				if (isMissingExecutable(error)) {
					lastError = error;
					continue;
				}
				throw error;
			}
		}
		throw lastError ?? new Error("jarvisctl executable could not be resolved");
	}

	getTerminalJarvisCtlPath(): string {
		for (const candidate of this.getJarvisCtlCandidates()) {
			if (candidate.includes("/") && existsSync(candidate)) {
				return candidate;
			}
		}
		return this.getJarvisCtlCandidates()[0];
	}

	private getJarvisCtlCandidates(): string[] {
		const configuredPath = this.settings.jarvisctlPath.trim() || DEFAULT_SETTINGS.jarvisctlPath;
		const candidates: string[] = [];
		if (!configuredPath.includes("/") && process.env.HOME) {
			candidates.push(join(process.env.HOME, ".local", "bin", configuredPath));
		}
		candidates.push(configuredPath);
		return [...new Set(candidates)];
	}

	getBuildStamp(): string {
		return BUILD_STAMP;
	}

	getLastExecPath(): string | null {
		return this.lastExecPath;
	}

	writeDebugSnapshot(snapshot: Record<string, unknown>): void {
		try {
			const pluginDir = join(
				this.getVaultBasePath(),
				this.app.vault.configDir,
				"plugins",
				this.manifest.id,
			);
			mkdirSync(pluginDir, { recursive: true });
			writeFileSync(
				join(pluginDir, "debug.json"),
				JSON.stringify(
					{
						build: BUILD_STAMP,
						settings_path: this.settings.jarvisctlPath,
						candidate_paths: this.getJarvisCtlCandidates(),
						last_exec_path: this.lastExecPath,
						updated_at: new Date().toISOString(),
						...snapshot,
					},
					null,
					2,
				),
				"utf8",
			);
		} catch (error) {
			console.warn("JarvisCtl Control could not write debug snapshot", error);
		}
	}

	getBaseIntegratedTerminalProfile(): TerminalProfile {
		const fallback: TerminalProfile = {
			args: ["--login"],
			executable: this.settings.shellExecutable || "/usr/bin/zsh",
			followTheme: true,
			name: "Zsh (login)",
			platforms: { linux: true },
			pythonExecutable: "python3",
			restoreHistory: true,
			rightClickAction: "copyPaste",
			successExitCodes: ["0", "SIGINT", "SIGTERM"],
			terminalOptions: { documentOverride: null },
			type: "integrated",
			useWin32Conhost: true,
		};

		try {
			const basePath = this.getVaultBasePath();
			const raw = readFileSync(
				join(basePath, this.app.vault.configDir, "plugins", "terminal", "data.json"),
				"utf8",
			);
			const parsed = JSON.parse(raw) as TerminalPluginData;
			const defaultProfileId = parsed.defaultProfile;
			const defaultProfile = defaultProfileId ? parsed.profiles?.[defaultProfileId] : undefined;
			if (defaultProfile?.type === "integrated") {
				return { ...fallback, ...defaultProfile };
			}
			const firstIntegrated = Object.values(parsed.profiles ?? {}).find(
				(profile) => profile.type === "integrated",
			);
			if (firstIntegrated) {
				return { ...fallback, ...firstIntegrated };
			}
		} catch (error) {
			console.warn("JarvisCtl Control could not load Terminal plugin data", error);
		}

		return fallback;
	}

	buildCommandProfile(
		shellExecutable: string,
		wrappedCommand: string,
		title: string,
	): TerminalProfile {
		const base = this.getBaseIntegratedTerminalProfile();
		return {
			...base,
			type: "integrated",
			name: title,
			executable: shellExecutable,
			args: ["--login", "-lc", wrappedCommand],
			restoreHistory: false,
			followTheme: true,
		};
	}

	getVaultBasePath(): string {
		const adapter = this.app.vault.adapter as unknown as {
			getBasePath?: () => string;
		};
		if (typeof adapter.getBasePath === "function") {
			return adapter.getBasePath();
		}
		throw new Error("Vault base path is unavailable on this adapter");
	}

	private resolveImagePaths(taskNotePath: string, rawPaths: string[]): string[] {
		const basePath = this.getVaultBasePath();
		const noteDir = dirname(taskNotePath);

		return rawPaths.map((rawPath) => {
			const trimmed = rawPath.trim();
			if (!trimmed) {
				throw new Error("Image path cannot be empty.");
			}

			const resolved = isAbsolute(trimmed)
				? trimmed
				: existsSync(join(noteDir, trimmed))
					? join(noteDir, trimmed)
					: join(basePath, trimmed);

			if (!existsSync(resolved)) {
				throw new Error(`Image not found: ${trimmed}`);
			}
			return resolved;
		});
	}

	private resolveVaultFile(absolutePath: string): TFile | null {
		const basePath = this.getVaultBasePath();
		const relativePath = relative(basePath, absolutePath);
		if (relativePath.startsWith("..")) {
			return null;
		}
		const normalized = relativePath.replaceAll("\\", "/");
		const file = this.app.vault.getAbstractFileByPath(normalized);
		return file instanceof TFile ? file : null;
	}
}

class JarvisCtlControlView extends ItemView {
	private readonly plugin: JarvisCtlControlPlugin;
	private sessions: JarvisSessionMetadata[] = [];
	private selectedNamespace: string | null = null;
	private refreshHandle: number | null = null;
	private lastRefreshLabel = "never";
	private statusMessage = "Idle";
	private errorMessage: string | null = null;
	private actionInFlight = false;
	private scrollState: Record<string, number> = {};

	constructor(leaf: WorkspaceLeaf, plugin: JarvisCtlControlPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = true;
		this.addAction("refresh-cw", "Refresh namespaces", () => {
			void this.refreshSessions();
		});
		this.addAction("layout-dashboard", "Open jarvisctl dashboard", () => {
			void this.plugin.openTerminalCommand(
				[this.plugin.getTerminalJarvisCtlPath()],
				"JarvisCtl Dashboard",
				this.plugin.getVaultBasePath(),
			);
		});
		this.addAction("terminal-square", "Attach selected namespace", () => {
			const session = this.getSelectedSession();
			if (!session) {
				new Notice("Select a namespace first.");
				return;
			}
			void this.plugin.openNamespaceAttach(session);
		});
		this.addAction("file-text", "Open selected ticket", () => {
			const taskNote = this.getSelectedSession()?.context?.task_note;
			if (!taskNote) {
				new Notice("Selected namespace does not expose a ticket note.");
				return;
			}
			void this.plugin.openTaskNote(taskNote);
		});
	}

	getViewType(): string {
		return VIEW_TYPE_JARVISCTL_CONTROL;
	}

	getDisplayText(): string {
		return "Jarvis Control";
	}

	getIcon(): string {
		return "cpu";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("jarvisctl-control-view");
		this.statusMessage = "Opening runtime surface";
		this.errorMessage = null;
		this.safeRender("view-open");
		void this.refreshSessions();
		this.startPolling();
	}

	async onClose(): Promise<void> {
		this.stopPolling();
		this.contentEl.empty();
		this.contentEl.removeClass("jarvisctl-control-view");
	}

	async handleSettingsChanged(): Promise<void> {
		this.stopPolling();
		this.startPolling();
		await this.refreshSessions();
	}

	private startPolling(): void {
		this.refreshHandle = window.setInterval(() => {
			void this.refreshSessions(false);
		}, this.plugin.settings.refreshIntervalMs);
	}

	private stopPolling(): void {
		if (this.refreshHandle !== null) {
			window.clearInterval(this.refreshHandle);
			this.refreshHandle = null;
		}
	}

	private async refreshSessions(noticeOnError = true): Promise<void> {
		try {
			this.sessions = await this.plugin.fetchSessions();
			if (
				this.selectedNamespace === null ||
				!this.sessions.some((session) => session.namespace === this.selectedNamespace)
			) {
				this.selectedNamespace = this.sessions[0]?.namespace ?? null;
			}
			this.lastRefreshLabel = new Date().toLocaleTimeString();
			this.statusMessage = "Live data";
			this.errorMessage = null;
			this.safeRender("refresh-success");
		} catch (error) {
			console.error(error);
			this.errorMessage = formatError(error);
			this.statusMessage = "Refresh failed";
			this.safeRender("refresh-error");
			if (noticeOnError) {
				new Notice(`JarvisCtl Control refresh failed: ${formatError(error)}`);
			}
		}
	}

	private safeRender(event: string): void {
		try {
			this.render();
			this.plugin.writeDebugSnapshot({
				event,
				render_status: "ok",
				sessions_count: this.sessions.length,
				session_names: this.sessions.map((session) => session.namespace),
				selected_namespace: this.selectedNamespace,
				error_message: this.errorMessage,
			});
		} catch (error) {
			console.error(error);
			this.errorMessage = formatError(error);
			const container = this.contentEl;
			container.empty();
			container.addClass("jarvisctl-control-view");
			const shell = container.createDiv({ cls: "jarvisctl-shell" });
			this.renderTopBar(shell);
			this.renderErrorBanner(shell, `Render failed: ${this.errorMessage}`);
			this.renderStatusLine(shell);
			this.plugin.writeDebugSnapshot({
				event,
				render_status: "failed",
				sessions_count: this.sessions.length,
				session_names: this.sessions.map((session) => session.namespace),
				selected_namespace: this.selectedNamespace,
				error_message: this.errorMessage,
			});
		}
	}

	private render(): void {
		const container = this.contentEl;
		this.scrollState = this.captureScrollState();
		container.empty();
		container.addClass("jarvisctl-control-view");

		const shell = container.createDiv({ cls: "jarvisctl-shell" });
		this.renderTopBar(shell);
		if (this.errorMessage) {
			this.renderErrorBanner(shell, this.errorMessage);
		}
		this.renderBody(shell);
		this.renderStatusLine(shell);
		this.restoreScrollState();
	}

	private captureScrollState(): Record<string, number> {
		const selectors: Record<string, string | null> = {
			root: null,
			rail: ".jarvisctl-namespace-table",
			detail: ".jarvisctl-panel-body-detail",
			feed: ".jarvisctl-feed-list",
			activity: ".jarvisctl-activity-list",
		};
		const state: Record<string, number> = {};
		for (const [key, selector] of Object.entries(selectors)) {
			const element =
				selector === null
					? this.contentEl
					: (this.contentEl.querySelector(selector) as HTMLElement | null);
			if (element) {
				state[key] = element.scrollTop;
			}
		}
		return state;
	}

	private restoreScrollState(): void {
		const state = { ...this.scrollState };
		window.requestAnimationFrame(() => {
			const selectors: Record<string, string | null> = {
				root: null,
				rail: ".jarvisctl-namespace-table",
				detail: ".jarvisctl-panel-body-detail",
				feed: ".jarvisctl-feed-list",
				activity: ".jarvisctl-activity-list",
			};
			for (const [key, selector] of Object.entries(selectors)) {
				const top = state[key];
				if (typeof top !== "number") {
					continue;
				}
				const element =
					selector === null
						? this.contentEl
						: (this.contentEl.querySelector(selector) as HTMLElement | null);
				if (element) {
					element.scrollTop = top;
				}
			}
		});
	}

	private renderTopBar(parent: HTMLElement): void {
		const topBar = parent.createDiv({ cls: "jarvisctl-topbar" });
		const title = topBar.createDiv({ cls: "jarvisctl-title" });
		title.createDiv({ cls: "jarvisctl-kicker", text: "Operator Surface" });
		title.createEl("h2", { text: "Jarvis Control" });
		title.createEl("p", {
			cls: "jarvisctl-subtitle",
			text: `Build ${this.plugin.getBuildStamp()} · Headless Codex runtime control inside Obsidian.`,
		});

		const metrics = topBar.createDiv({ cls: "jarvisctl-metrics" });
		const agentCount = this.sessions.reduce(
			(total, session) => total + session.agents.length,
			0,
		);
		const subagentCount = this.sessions.reduce(
			(total, session) => total + this.countSubagents(session),
			0,
		);
		const selectedSession = this.getSelectedSession();

		this.renderMetric(metrics, "Namespaces", `${this.sessions.length}`);
		this.renderMetric(metrics, "Live Agents", `${agentCount}`);
		this.renderMetric(metrics, "Subagents", `${subagentCount}`);
		this.renderMetric(metrics, "Focus", selectedSession?.namespace ?? "none");
	}

	private renderMetric(parent: HTMLElement, label: string, value: string): void {
		const metric = parent.createDiv({ cls: "jarvisctl-metric" });
		metric.createSpan({ cls: "jarvisctl-metric-label", text: label });
		metric.createDiv({ cls: "jarvisctl-metric-value", text: value });
	}

	private renderErrorBanner(parent: HTMLElement, message: string): void {
		const banner = parent.createDiv({ cls: "jarvisctl-error-banner" });
		banner.createDiv({ cls: "jarvisctl-error-title", text: "Runtime refresh failed" });
		banner.createDiv({ cls: "jarvisctl-error-message", text: message });
		banner.createDiv({
			cls: "jarvisctl-error-hint",
			text: `Binary: ${this.plugin.getTerminalJarvisCtlPath()}`,
		});
	}

	private renderBody(parent: HTMLElement): void {
		const layout = parent.createDiv({ cls: "jarvisctl-layout" });
		this.renderNamespacePanel(layout);
		this.renderDetailsPanel(layout);
	}

	private renderNamespacePanel(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "jarvisctl-panel jarvisctl-panel-rail" });
		const header = panel.createDiv({ cls: "jarvisctl-panel-header" });
		header.createDiv({ cls: "jarvisctl-panel-title", text: "Namespaces" });
		const headerMeta = header.createDiv({ cls: "jarvisctl-panel-meta" });
		headerMeta.createSpan({
			cls: "jarvisctl-chip",
			text: `${this.sessions.length} active`,
		});

		const body = panel.createDiv({ cls: "jarvisctl-panel-body jarvisctl-panel-body-rail" });
		if (this.sessions.length === 0) {
			const empty = body.createDiv({ cls: "jarvisctl-empty" });
			empty.createEl("h3", { text: "No active namespaces" });
			empty.createEl("p", {
				text: "Start a namespace with jarvisctl run or move work into Ready for Codex to populate this surface.",
			});
			return;
		}

		const list = body.createDiv({ cls: "jarvisctl-namespace-table" });

		for (const session of this.sessions) {
			const isSelected = this.selectedNamespace === session.namespace;
			const context = this.getRuntimeContext(session);
			const card = list.createDiv({
				cls: isSelected
					? "jarvisctl-namespace-row is-selected"
					: "jarvisctl-namespace-row",
			});
			card.addEventListener("click", () => {
				this.selectedNamespace = session.namespace;
				this.render();
			});

			const heading = card.createDiv({ cls: "jarvisctl-namespace-heading" });
			heading.createDiv({ cls: "jarvisctl-namespace-name", text: session.namespace });
			if (context?.task_title) {
				heading.createDiv({
					cls: "jarvisctl-namespace-task",
					text: context.task_title,
				});
			}

			const aside = card.createDiv({ cls: "jarvisctl-namespace-aside" });
			this.renderNamespaceStat(aside, "Agents", `${session.agents.length}`);
			const stateStat = aside.createDiv({ cls: "jarvisctl-namespace-stat is-state" });
			stateStat.createDiv({ cls: "jarvisctl-namespace-stat-label", text: "State" });
			stateStat.createSpan({
				cls: this.namespaceStateClass(session),
				text: this.namespaceStateLabel(session),
			});
			this.renderNamespaceStat(aside, "Age", relativeAge(session.created_at_epoch_ms));

			const flow = card.createDiv({ cls: "jarvisctl-namespace-flow" });
			const contractStep = flow.createDiv({ cls: "jarvisctl-namespace-step is-contract" });
			contractStep.createDiv({ cls: "jarvisctl-namespace-step-rail" });
			const contractCard = contractStep.createDiv({ cls: "jarvisctl-namespace-step-card" });
			contractCard.createDiv({ cls: "jarvisctl-namespace-step-label", text: "Execution Contract" });
			contractCard.createDiv({
				cls: "jarvisctl-namespace-step-value",
				text:
					context?.task_title ??
					context?.task_note?.split("/").pop() ??
					"No linked ticket or task",
			});
			if (context?.task_note) {
				const contractMeta = contractCard.createDiv({ cls: "jarvisctl-namespace-step-meta" });
				contractMeta.createSpan({
					cls: "jarvisctl-namespace-token is-note",
					text: basename(context.task_note),
				});
			}

			const runtimeStep = flow.createDiv({ cls: "jarvisctl-namespace-step is-runtime" });
			runtimeStep.createDiv({ cls: "jarvisctl-namespace-step-rail" });
			const runtimeCard = runtimeStep.createDiv({ cls: "jarvisctl-namespace-step-card" });
			runtimeCard.createDiv({ cls: "jarvisctl-namespace-step-label", text: "Runtime" });
			const runtimeTokens = runtimeCard.createDiv({ cls: "jarvisctl-namespace-step-meta" });
			for (const token of this.describeSessionTokens(session)) {
				runtimeTokens.createSpan({ cls: "jarvisctl-namespace-token", text: token });
			}
			const runtimeValue = context?.live_message ?? context?.last_activity ?? this.describeSession(session);
			runtimeCard.createDiv({
				cls: "jarvisctl-namespace-step-value is-secondary",
				text: runtimeValue,
			});
		}
	}

	private renderNamespaceStat(parent: HTMLElement, label: string, value: string): void {
		const stat = parent.createDiv({ cls: "jarvisctl-namespace-stat" });
		stat.createDiv({ cls: "jarvisctl-namespace-stat-label", text: label });
		stat.createDiv({ cls: "jarvisctl-namespace-stat-value", text: value });
	}

	private renderDetailsPanel(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "jarvisctl-panel jarvisctl-panel-main" });
		const header = panel.createDiv({ cls: "jarvisctl-panel-header" });
		const session = this.getSelectedSession();
		header.createDiv({
			cls: "jarvisctl-panel-title",
			text: session?.namespace ?? "Namespace Detail",
		});
		if (session) {
			const headerMeta = header.createDiv({ cls: "jarvisctl-panel-meta" });
			headerMeta.createSpan({ cls: "jarvisctl-chip", text: session.backend });
			if (this.looksLikeCodexSession(session)) {
				headerMeta.createSpan({ cls: "jarvisctl-chip", text: "codex" });
			}
			headerMeta.createSpan({
				cls:
					this.countRunningAgents(session) > 0
						? "jarvisctl-chip is-live"
						: "jarvisctl-chip is-idle",
				text: `${this.countRunningAgents(session)}/${session.agents.length} live`,
			});
		}

		const body = panel.createDiv({ cls: "jarvisctl-panel-body jarvisctl-panel-body-detail" });
		if (!session) {
			const empty = body.createDiv({ cls: "jarvisctl-empty" });
			empty.createEl("h3", { text: "Nothing selected" });
			empty.createEl("p", { text: "Select a namespace to inspect agents and operator actions." });
			return;
		}

		const actions = body.createDiv({ cls: "jarvisctl-toolbar" });
		this.makeButton(actions, "Attach", async () => {
			await this.withAction(`Opening attach for ${session.namespace}`, async () => {
				await this.plugin.openNamespaceAttach(session);
			});
		}, "-primary");
		const context = this.getRuntimeContext(session);
		if (context?.task_note && this.isCodexSession(session)) {
			this.makeButton(actions, "Continue", async () => {
				await this.withAction(`Continuing ${session.namespace}`, async () => {
					await this.plugin.launchCodexForTaskNote(context.task_note ?? "", false);
				});
			});
			this.makeButton(actions, "Fresh", async () => {
				await this.withAction(`Starting fresh ${session.namespace}`, async () => {
					await this.plugin.launchCodexForTaskNote(context.task_note ?? "", true);
				});
			});
			this.makeButton(actions, "Open ticket", async () => {
				await this.plugin.openTaskNote(context.task_note ?? "");
			});
		}
		if (context?.transcript_path) {
			this.makeButton(actions, "Transcript", async () => {
				await this.withAction(`Opening transcript for ${session.namespace}`, async () => {
					await this.plugin.openTranscript(context.transcript_path ?? "", session.namespace);
				});
			});
		}
		this.makeButton(actions, "Tell agent0", async () => {
			await this.plugin.promptAndTell(session.namespace, "agent0");
		});
		this.makeButton(actions, "Copy attach", async () => {
			await navigator.clipboard.writeText(
				`${this.plugin.getTerminalJarvisCtlPath()} attach --namespace ${session.namespace}`,
			);
			new Notice(`Copied attach command for ${session.namespace}`);
		});
		this.makeButton(actions, "Close namespace", async () => {
			await this.withAction(`Closing ${session.namespace}`, async () => {
				await this.plugin.runJarvisCtl(["delete", "--namespace", session.namespace]);
				await this.refreshSessions(false);
			});
		}, "-danger");

		this.renderSessionSnapshot(body, session);

		const runtimeWorkbench = body.createDiv({ cls: "jarvisctl-runtime-workbench" });
		const runtimeUpper = runtimeWorkbench.createDiv({ cls: "jarvisctl-runtime-upper" });
		this.renderRuntimeFeed(runtimeUpper, session);
		this.renderObservedActivity(runtimeUpper, session);

		const runtimeLower = runtimeWorkbench.createDiv({ cls: "jarvisctl-runtime-lower" });
		this.renderSubagentTree(runtimeLower, session);
		this.renderAgentSection(runtimeLower, session);
	}

	private renderRuntimeFeed(parent: HTMLElement, session: JarvisSessionMetadata): void {
		const context = this.getRuntimeContext(session);
		const events = (context?.recent_events ?? []).slice(-12);
		const section = parent.createDiv({ cls: "jarvisctl-runtime-section" });
		const header = section.createDiv({ cls: "jarvisctl-section-header" });
		header.createDiv({ cls: "jarvisctl-panel-title", text: "Runtime Feed" });
		const meta = header.createDiv({ cls: "jarvisctl-panel-meta" });
		meta.createSpan({ cls: "jarvisctl-chip", text: `${events.length} events` });
		if (context?.turn_status) {
			meta.createSpan({ cls: "jarvisctl-chip", text: `turn ${context.turn_status}` });
		}

		const body = section.createDiv({ cls: "jarvisctl-section-body jarvisctl-section-body-tight" });
		if (events.length === 0) {
			const empty = body.createDiv({ cls: "jarvisctl-empty -compact" });
			empty.createEl("h3", { text: "No runtime events yet" });
			empty.createEl("p", {
				text: "As Codex starts emitting thread, turn, command, and subagent activity, it will appear here.",
			});
			return;
		}

		const feed = body.createDiv({ cls: "jarvisctl-feed-list" });
		for (const event of events) {
			const card = feed.createDiv({
				cls: `jarvisctl-feed-card is-${event.kind} ${event.status ? `has-${event.status}` : ""}`.trim(),
			});
			const cardHead = card.createDiv({ cls: "jarvisctl-feed-head" });
			const chips = cardHead.createDiv({ cls: "jarvisctl-feed-chips" });
			chips.createSpan({ cls: "jarvisctl-chip", text: event.kind });
			if (event.status) {
				chips.createSpan({
					cls: feedStatusClass(event.status),
					text: event.status,
				});
			}
			if (event.actor) {
				chips.createSpan({ cls: "jarvisctl-chip", text: event.actor });
			}
			cardHead.createDiv({
				cls: "jarvisctl-feed-time",
				text: new Date(event.timestamp_epoch_ms).toLocaleTimeString(),
			});
			card.createDiv({ cls: "jarvisctl-feed-title", text: event.title });
			if (event.detail) {
				card.createEl("p", { cls: "jarvisctl-feed-detail", text: event.detail });
			}
		}
	}

	private renderObservedActivity(parent: HTMLElement, session: JarvisSessionMetadata): void {
		const context = this.getRuntimeContext(session);
		const section = parent.createDiv({ cls: "jarvisctl-runtime-section" });
		const header = section.createDiv({ cls: "jarvisctl-section-header" });
		header.createDiv({ cls: "jarvisctl-panel-title", text: "Observed Activity" });
		const meta = header.createDiv({ cls: "jarvisctl-panel-meta" });
		const blocks = context?.event_log_path ? this.readActivitySections(context.event_log_path, 10) : [];
		meta.createSpan({ cls: "jarvisctl-chip", text: `${blocks.length} sections` });
		if (context?.event_log_path) {
			meta.createSpan({ cls: "jarvisctl-chip", text: "event log" });
		}

		const body = section.createDiv({ cls: "jarvisctl-section-body" });
		if (!context?.event_log_path) {
			const empty = body.createDiv({ cls: "jarvisctl-empty -compact" });
			empty.createEl("h3", { text: "No live console yet" });
			empty.createEl("p", {
				text: "This namespace has no exported event log path, so live tail view is unavailable.",
			});
			return;
		}
		if (blocks.length === 0) {
			const empty = body.createDiv({ cls: "jarvisctl-empty -compact" });
			empty.createEl("h3", { text: "Waiting for activity" });
			empty.createEl("p", {
				text: "The event log exists, but no grouped activity has been written yet.",
			});
			return;
		}

		const activity = body.createDiv({ cls: "jarvisctl-activity-list" });
		for (const block of blocks) {
			const card = activity.createDiv({
				cls: `jarvisctl-activity-block is-${block.kind}`,
			});
			const head = card.createDiv({ cls: "jarvisctl-activity-head" });
			head.createSpan({
				cls: "jarvisctl-chip",
				text: block.label,
			});
			if (block.summary) {
				head.createDiv({
					cls: "jarvisctl-activity-summary",
					text: block.summary,
				});
			}
			if (block.lines.length > 0) {
				const blockBody = card.createDiv({ cls: "jarvisctl-activity-body" });
				for (const line of block.lines) {
					blockBody.createDiv({
						cls: consoleLineClass(line),
						text: line,
					});
				}
			}
		}
	}

	private renderSubagentTree(parent: HTMLElement, session: JarvisSessionMetadata): void {
		const context = this.getRuntimeContext(session);
		const subagents = (context?.subagents ?? []).slice().sort((left, right) =>
			left.updated_at_epoch_ms - right.updated_at_epoch_ms,
		);
		const section = parent.createDiv({ cls: "jarvisctl-runtime-section" });
		const header = section.createDiv({ cls: "jarvisctl-section-header" });
		header.createDiv({ cls: "jarvisctl-panel-title", text: "Subagent Branches" });
		const meta = header.createDiv({ cls: "jarvisctl-panel-meta" });
		meta.createSpan({ cls: "jarvisctl-chip", text: `${subagents.length} tracked` });

		const body = section.createDiv({ cls: "jarvisctl-section-body" });
		if (subagents.length === 0) {
			const empty = body.createDiv({ cls: "jarvisctl-empty -compact" });
			empty.createEl("h3", { text: "No subagents yet" });
			empty.createEl("p", {
				text: "Spawned Codex collaborators will appear here with their thread ids, status, and latest note.",
			});
			return;
		}

		const tree = body.createDiv({ cls: "jarvisctl-subagent-tree" });
		const root = tree.createDiv({ cls: "jarvisctl-subagent-root" });
		root.createDiv({ cls: "jarvisctl-card-title", text: "Main thread" });
		const rootMeta = root.createDiv({ cls: "jarvisctl-agent-meta" });
		rootMeta.createSpan({ text: shortThreadId(context?.thread_id ?? "main") });
		if (context?.thread_status) {
			rootMeta.createSpan({ text: context.thread_status });
		}

		const childMap = new Map<string, JarvisRuntimeSubagentMetadata[]>();
		for (const subagent of subagents) {
			const parentId = subagent.parent_thread_id ?? context?.thread_id ?? "__root__";
			const bucket = childMap.get(parentId) ?? [];
			bucket.push(subagent);
			childMap.set(parentId, bucket);
		}

		const rootThreadId = context?.thread_id ?? "__root__";
		const roots = childMap.get(rootThreadId) ?? childMap.get("__root__") ?? subagents;
		const rendered = new Set<string>();
		for (const subagent of roots) {
			this.renderSubagentNode(tree, subagent, childMap, rendered, 0);
		}
		for (const subagent of subagents) {
			if (!rendered.has(subagent.thread_id)) {
				this.renderSubagentNode(tree, subagent, childMap, rendered, 0);
			}
		}
	}

	private renderSubagentNode(
		parent: HTMLElement,
		subagent: JarvisRuntimeSubagentMetadata,
		childMap: Map<string, JarvisRuntimeSubagentMetadata[]>,
		rendered: Set<string>,
		depth: number,
	): void {
		if (rendered.has(subagent.thread_id)) {
			return;
		}
		rendered.add(subagent.thread_id);

		const node = parent.createDiv({ cls: "jarvisctl-subagent-node" });
		node.style.setProperty("--jarvis-depth", `${depth}`);
		const top = node.createDiv({ cls: "jarvisctl-subagent-top" });
		const summary = top.createDiv({ cls: "jarvisctl-subagent-summary" });
		summary.createDiv({
			cls: "jarvisctl-card-title",
			text: `agent ${shortThreadId(subagent.thread_id)}`,
		});
		const meta = summary.createDiv({ cls: "jarvisctl-agent-meta" });
		meta.createSpan({ text: subagent.tool });
		if (subagent.model) {
			meta.createSpan({ text: subagent.model });
		}
		if (subagent.reasoning_effort) {
			meta.createSpan({ text: subagent.reasoning_effort });
		}

		const status = top.createDiv({ cls: "jarvisctl-feed-chips" });
		status.createSpan({
			cls: feedStatusClass(subagent.status),
			text: subagent.status,
		});
		status.createSpan({
			cls: "jarvisctl-chip",
			text: new Date(subagent.updated_at_epoch_ms).toLocaleTimeString(),
		});

		if (subagent.prompt_preview) {
			node.createEl("p", {
				cls: "jarvisctl-subagent-detail",
				text: subagent.prompt_preview,
			});
		}
		if (subagent.latest_message) {
			node.createDiv({
				cls: "jarvisctl-subagent-message",
				text: subagent.latest_message,
			});
		}

		const children = childMap.get(subagent.thread_id) ?? [];
		for (const child of children) {
			this.renderSubagentNode(parent, child, childMap, rendered, depth + 1);
		}
	}

	private renderAgentSection(parent: HTMLElement, session: JarvisSessionMetadata): void {
		const section = parent.createDiv({ cls: "jarvisctl-runtime-section" });
		const header = section.createDiv({ cls: "jarvisctl-section-header" });
		header.createDiv({ cls: "jarvisctl-panel-title", text: "Agents" });
		const meta = header.createDiv({ cls: "jarvisctl-panel-meta" });
		meta.createSpan({ cls: "jarvisctl-chip", text: `${session.agents.length} total` });

		const agentList = section.createDiv({ cls: "jarvisctl-agent-list" });
		for (const agent of session.agents) {
			const row = agentList.createDiv({ cls: "jarvisctl-agent-row" });
			const left = row.createDiv();
			left.createDiv({ cls: "jarvisctl-card-title", text: agent.name });
			const metaRow = left.createDiv({ cls: "jarvisctl-agent-meta" });
			metaRow.createSpan({ text: `PID ${agent.pid}` });
			metaRow.createSpan({ text: agent.running ? "running" : "idle" });

			const rowActions = row.createDiv({ cls: "jarvisctl-agent-actions" });
			this.makeButton(rowActions, "Tell", async () => {
				await this.plugin.promptAndTell(session.namespace, agent.name);
			});
			this.makeButton(rowActions, "Exec", async () => {
				await this.withAction(`Opening ${session.namespace}:${agent.name}`, async () => {
					await this.plugin.openAgentExec(session, agent);
				});
			}, "-primary");
			this.makeButton(rowActions, "Interrupt", async () => {
				await this.withAction(`Interrupting ${session.namespace}:${agent.name}`, async () => {
					await this.plugin.runJarvisCtl([
						"interrupt",
						"--namespace",
						session.namespace,
						"--agent",
						agent.name,
					]);
					await this.refreshSessions(false);
				});
			});
			this.makeButton(rowActions, "Copy exec", async () => {
				await navigator.clipboard.writeText(
					`${this.plugin.getTerminalJarvisCtlPath()} exec --namespace ${session.namespace} --agent ${agent.name}`,
				);
				new Notice(`Copied exec command for ${agent.name}`);
			});
		}
	}

	private renderSessionSnapshot(parent: HTMLElement, session: JarvisSessionMetadata): void {
		const context = this.getRuntimeContext(session);
		const section = parent.createDiv({ cls: "jarvisctl-runtime-section" });
		const header = section.createDiv({ cls: "jarvisctl-section-header" });
		header.createDiv({ cls: "jarvisctl-panel-title", text: "Session Snapshot" });
		const meta = header.createDiv({ cls: "jarvisctl-panel-meta" });
		meta.createSpan({ cls: "jarvisctl-chip", text: session.backend });
		if (context?.launch_mode) {
			meta.createSpan({ cls: "jarvisctl-chip", text: context.launch_mode });
		}
		if (context?.thread_status) {
			meta.createSpan({ cls: feedStatusClass(context.thread_status), text: context.thread_status });
		}

		const body = section.createDiv({ cls: "jarvisctl-section-body" });
		const grid = body.createDiv({ cls: "jarvisctl-snapshot-grid" });
		const addFact = (label: string, value: string | null | undefined, modifier = ""): void => {
			if (!value) {
				return;
			}
			const fact = grid.createDiv({
				cls: modifier ? `jarvisctl-snapshot-item ${modifier}` : "jarvisctl-snapshot-item",
			});
			fact.createSpan({ cls: "jarvisctl-detail-box-label", text: label });
			const valueEl = fact.createDiv({ cls: "jarvisctl-detail-box-value", text: value });
			valueEl.setAttr("title", value);
		};

		addFact("Task", context?.task_title, "-hero");
		addFact("Codex Session", context?.codex_session_id);
		addFact("Thread", context?.thread_status, "-metric");
		addFact("Turn", context?.turn_status, "-metric");
		addFact("Launch Mode", context?.launch_mode, "-metric");
		addFact("Backend", session.backend, "-metric");
		addFact("Created", new Date(session.created_at_epoch_ms).toLocaleString(), "-metric");
		addFact("Last Activity", context?.last_activity, "-story");
		addFact("Live Message", context?.live_message, "-story");
		addFact("Last Error", context?.last_error, "-story is-error");
		addFact("Ticket Note", context?.task_note, "-path");
		addFact("Transcript", context?.transcript_path, "-path");
		addFact("Event Log", context?.event_log_path, "-path");
		addFact("Working Dir", session.working_directory ?? "n/a", "-path");
		addFact("Command", session.shell_command, "-path");
	}

	private renderStatusLine(parent: HTMLElement): void {
		const status = parent.createDiv({ cls: "jarvisctl-statusline" });
		status.createSpan({ text: `Status: ${this.statusMessage}` });
		status.createSpan({ text: `Last refresh: ${this.lastRefreshLabel}` });
	}

	private makeButton(
		parent: HTMLElement,
		label: string,
		handler: () => Promise<void>,
		modifier = "",
	): HTMLButtonElement {
		const button = parent.createEl("button", {
			cls: modifier ? `jarvisctl-button ${modifier}` : "jarvisctl-button",
			text: label,
		});
		button.disabled = this.actionInFlight;
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			void handler();
		});
		return button;
	}

	private async withAction(status: string, callback: () => Promise<void>): Promise<void> {
		this.actionInFlight = true;
		this.statusMessage = status;
		this.safeRender("action-start");
		try {
			await callback();
			this.statusMessage = "Action completed";
			new Notice(status);
		} catch (error) {
			console.error(error);
			this.statusMessage = "Action failed";
			new Notice(`JarvisCtl Control action failed: ${formatError(error)}`);
		} finally {
			this.actionInFlight = false;
			this.safeRender("action-finish");
		}
	}

	private getSelectedSession(): JarvisSessionMetadata | undefined {
		return this.sessions.find((session) => session.namespace === this.selectedNamespace);
	}

	private countRunningAgents(session: JarvisSessionMetadata): number {
		return session.agents.filter((agent) => agent.running).length;
	}

	private readLogTail(path: string, maxLines: number): string[] {
		try {
			if (!existsSync(path)) {
				return [];
			}
			const raw = readFileSync(path, "utf8");
			return raw
				.replaceAll("\r", "")
				.split("\n")
				.map((line) => line.trimEnd())
				.filter((line, index, lines) => line.length > 0 || index === lines.length - 1)
				.slice(-maxLines);
		} catch (error) {
			console.warn("JarvisCtl Control could not read event log", error);
			return [`[error] ${formatError(error)}`];
		}
	}

	private readActivitySections(path: string, maxSections: number): JarvisActivitySection[] {
		const lines = this.readLogTail(path, 120);
		if (lines.length === 0) {
			return [];
		}

		const sections: JarvisActivitySection[] = [];
		let current: JarvisActivitySection | null = null;

		for (const rawLine of lines) {
			const line = rawLine.trimEnd();
			const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
			if (match) {
				if (current) {
					sections.push(current);
				}
				const [, rawTag, remainder] = match;
				current = {
					kind: activityKind(rawTag),
					label: activityLabel(rawTag),
					summary: remainder.trim() || null,
					lines: [],
				};
				continue;
			}

			if (!current) {
				current = {
					kind: "output",
					label: "Output",
					summary: null,
					lines: [],
				};
			}
			if (line.length > 0) {
				current.lines.push(line);
			}
		}

		if (current) {
			sections.push(current);
		}

		return sections
			.filter((section) => section.summary !== null || section.lines.length > 0)
			.slice(-maxSections);
	}

	private countSubagents(session: JarvisSessionMetadata): number {
		return this.getRuntimeContext(session)?.subagents?.length ?? 0;
	}

	private getRuntimeContext(session: JarvisSessionMetadata): JarvisRuntimeContext | null {
		return session.context ?? null;
	}

	private describeSession(session: JarvisSessionMetadata): string {
		const context = this.getRuntimeContext(session);
		if (context?.workload) {
			return this.describeSessionTokens(session).join(" · ");
		}
		return this.looksLikeCodexSession(session)
			? "codex"
			: session.backend;
	}

	private describeSessionTokens(session: JarvisSessionMetadata): string[] {
		const context = this.getRuntimeContext(session);
		return [
			context?.workload ?? null,
			context?.launch_mode ?? null,
			context?.thread_status ?? null,
			this.countSubagents(session) ? `${this.countSubagents(session)} subagents` : null,
			this.looksLikeCodexSession(session) && !context?.workload ? "codex" : null,
			!context?.workload ? session.backend : null,
		].filter((part): part is string => Boolean(part));
	}

	private namespaceStateLabel(session: JarvisSessionMetadata): string {
		const context = this.getRuntimeContext(session);
		const running = this.countRunningAgents(session);
		return context?.thread_status === "running" && context?.turn_status
			? `turn ${context.turn_status}`
			: context?.thread_status
				? context.thread_status
				: context?.turn_status
					? context.turn_status
					: running > 0
						? `${running}/${session.agents.length} live`
						: "idle";
	}

	private namespaceStateClass(session: JarvisSessionMetadata): string {
		const context = this.getRuntimeContext(session);
		if (context?.last_error) {
			return "jarvisctl-chip is-error";
		}
		return this.countRunningAgents(session) > 0
			? "jarvisctl-chip is-live"
			: "jarvisctl-chip is-idle";
	}

	private isCodexSession(session: JarvisSessionMetadata): boolean {
		return this.getRuntimeContext(session)?.workload === "codex" || this.looksLikeCodexSession(session);
	}

	private looksLikeCodexSession(session: JarvisSessionMetadata): boolean {
		return /\bcodex\b/i.test(session.shell_command);
	}
}

class JarvisCtlControlSettingTab extends PluginSettingTab {
	private readonly plugin: JarvisCtlControlPlugin;

	constructor(app: App, plugin: JarvisCtlControlPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "JarvisCtl Control" });

		new Setting(containerEl)
			.setName("jarvisctl path")
			.setDesc("Executable used for list, interrupt, delete, attach, and exec actions.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.jarvisctlPath)
					.setValue(this.plugin.settings.jarvisctlPath)
					.onChange(async (value) => {
						this.plugin.settings.jarvisctlPath = value.trim() || DEFAULT_SETTINGS.jarvisctlPath;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Refresh interval")
			.setDesc("Polling interval in milliseconds for the live control surface.")
			.addText((text) =>
				text
					.setPlaceholder("2500")
					.setValue(String(this.plugin.settings.refreshIntervalMs))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						this.plugin.settings.refreshIntervalMs = Number.isFinite(parsed)
							? Math.max(parsed, 500)
							: DEFAULT_SETTINGS.refreshIntervalMs;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Shell executable")
			.setDesc("Shell used when opening attach and exec sessions in Obsidian Terminal tabs.")
			.addText((text) =>
				text
					.setPlaceholder("/usr/bin/zsh")
					.setValue(this.plugin.settings.shellExecutable)
					.onChange(async (value) => {
						this.plugin.settings.shellExecutable = value.trim() || "/usr/bin/zsh";
						await this.plugin.saveSettings();
					}),
			);
	}
}

class JarvisTextModal extends Modal {
	private readonly titleText: string;
	private readonly description: string;
	private readonly submitLabel: string;
	private readonly resolveResult: (result: JarvisTellRequest | null) => void;
	private resolved = false;

	constructor(
		app: App,
		titleText: string,
		description: string,
		submitLabel: string,
		resolveResult: (result: JarvisTellRequest | null) => void,
	) {
		super(app);
		this.titleText = titleText;
		this.description = description;
		this.submitLabel = submitLabel;
		this.resolveResult = resolveResult;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.titleText });
		contentEl.createEl("p", {
			cls: "jarvisctl-modal-copy",
			text: this.description,
		});

		contentEl.createEl("label", {
			cls: "jarvisctl-modal-label",
			text: "Message",
		});
		const messageEl = contentEl.createEl("textarea", {
			cls: "jarvisctl-modal-textarea",
		});
		messageEl.placeholder = "Add feedback, a correction, or a high-priority note for the running agent.";

		const actions = contentEl.createDiv({ cls: "jarvisctl-modal-actions" });
		const cancel = actions.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.finish(null));

		const submit = actions.createEl("button", {
			text: this.submitLabel,
			cls: "mod-cta",
		});
		submit.addEventListener("click", () => {
			this.finish({ message: messageEl.value });
		});

		window.setTimeout(() => messageEl.focus(), 0);
	}

	onClose(): void {
		if (!this.resolved) {
			this.resolveResult(null);
		}
	}

	private finish(result: JarvisTellRequest | null): void {
		if (this.resolved) {
			return;
		}
		this.resolved = true;
		this.resolveResult(result);
		this.close();
	}
}

class JarvisCodexLaunchModal extends Modal {
	private readonly titleText: string;
	private readonly description: string;
	private readonly resolveResult: (result: JarvisCodexLaunchRequest | null) => void;
	private resolved = false;

	constructor(
		app: App,
		titleText: string,
		description: string,
		resolveResult: (result: JarvisCodexLaunchRequest | null) => void,
	) {
		super(app);
		this.titleText = titleText;
		this.description = description;
		this.resolveResult = resolveResult;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.titleText });
		contentEl.createEl("p", {
			cls: "jarvisctl-modal-copy",
			text: this.description,
		});

		contentEl.createEl("label", {
			cls: "jarvisctl-modal-label",
			text: "Operator message",
		});
		const messageEl = contentEl.createEl("textarea", {
			cls: "jarvisctl-modal-textarea",
		});
		messageEl.placeholder =
			"Optional follow-up or review feedback. Leave blank to launch from the ticket note alone.";

		contentEl.createEl("label", {
			cls: "jarvisctl-modal-label",
			text: "Image paths",
		});
		const imagesEl = contentEl.createEl("textarea", {
			cls: "jarvisctl-modal-textarea",
		});
		imagesEl.placeholder =
			"Optional image paths, one per line. Relative paths resolve from the note folder first, then the vault root.";

		const actions = contentEl.createDiv({ cls: "jarvisctl-modal-actions" });
		const cancel = actions.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.finish(null));

		const submit = actions.createEl("button", {
			text: "Launch",
			cls: "mod-cta",
		});
		submit.addEventListener("click", () => {
			const imagePaths = imagesEl.value
				.split(/\r?\n|,/)
				.map((value) => value.trim())
				.filter((value) => value.length > 0);
			this.finish({
				message: messageEl.value,
				imagePaths,
			});
		});

		window.setTimeout(() => messageEl.focus(), 0);
	}

	onClose(): void {
		if (!this.resolved) {
			this.resolveResult(null);
		}
	}

	private finish(result: JarvisCodexLaunchRequest | null): void {
		if (this.resolved) {
			return;
		}
		this.resolved = true;
		this.resolveResult(result);
		this.close();
	}
}

function promptForTell(
	app: App,
	namespace: string,
	agent: string,
): Promise<JarvisTellRequest | null> {
	return new Promise((resolve) => {
		new JarvisTextModal(
			app,
			`Tell ${namespace}:${agent}`,
			"Send a direct message into the running agent session. This is useful for mid-run corrections or urgent context changes.",
			"Send",
			resolve,
		).open();
	});
}

function promptForCodexLaunch(
	app: App,
	noteName: string,
	fresh: boolean,
): Promise<JarvisCodexLaunchRequest | null> {
	return new Promise((resolve) => {
		new JarvisCodexLaunchModal(
			app,
			fresh ? `Fresh Codex for ${noteName}` : `Continue Codex for ${noteName}`,
			fresh
				? "Launch a new Codex conversation for the current ticket. Optional message and images will be attached to the initial prompt."
				: "Reuse the latest Codex session for the current ticket when one exists. Optional message and images will be attached to the resumed prompt.",
			resolve,
		).open();
	});
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeForDoubleQuotes(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function isMissingExecutable(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const errorWithCode = error as Error & { code?: string };
	return errorWithCode.code === "ENOENT";
}

function feedStatusClass(status: string): string {
	switch (status) {
		case "inProgress":
		case "completed":
		case "running":
			return "jarvisctl-chip is-live";
		case "failed":
		case "errored":
		case "shutdown":
			return "jarvisctl-chip is-error";
		default:
			return "jarvisctl-chip is-idle";
	}
}

function shortThreadId(threadId: string): string {
	const [head] = threadId.split("-");
	return head || threadId;
}

function consoleLineClass(line: string): string {
	const normalized = line.trim();
	if (normalized.startsWith("[error]") || normalized.startsWith("[stderr]")) {
		return "jarvisctl-console-line is-error";
	}
	if (normalized.startsWith("[assistant]")) {
		return "jarvisctl-console-line is-assistant";
	}
	if (normalized.startsWith("[command")) {
		return "jarvisctl-console-line is-command";
	}
	if (normalized.startsWith("[operator]")) {
		return "jarvisctl-console-line is-operator";
	}
	if (normalized.startsWith("[session]") || normalized.startsWith("[thread]") || normalized.startsWith("[turn]")) {
		return "jarvisctl-console-line is-system";
	}
	return "jarvisctl-console-line";
}

function activityKind(tag: string): string {
	const normalized = tag.toLowerCase();
	if (normalized.startsWith("command")) {
		return "command";
	}
	if (normalized.startsWith("assistant")) {
		return "assistant";
	}
	if (normalized.startsWith("operator")) {
		return "operator";
	}
	if (normalized.startsWith("thread") || normalized.startsWith("turn") || normalized.startsWith("session")) {
		return "system";
	}
	if (normalized.startsWith("error") || normalized.startsWith("stderr")) {
		return "error";
	}
	return "output";
}

function activityLabel(tag: string): string {
	const normalized = tag.toLowerCase();
	if (normalized === "command completed") {
		return "Command";
	}
	if (normalized === "assistant") {
		return "Assistant";
	}
	if (normalized === "operator") {
		return "Operator";
	}
	if (normalized === "thread") {
		return "Thread";
	}
	if (normalized === "turn") {
		return "Turn";
	}
	if (normalized === "session") {
		return "Session";
	}
	if (normalized === "error" || normalized === "stderr") {
		return "Error";
	}
	return tag;
}

function relativeAge(epochMs: number): string {
	const diffSeconds = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
	if (diffSeconds < 60) {
		return `${diffSeconds}s`;
	}
	const diffMinutes = Math.floor(diffSeconds / 60);
	if (diffMinutes < 60) {
		return `${diffMinutes}m`;
	}
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) {
		return `${diffHours}h`;
	}
	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays}d`;
}
