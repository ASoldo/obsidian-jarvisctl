import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const VIEW_TYPE_JARVISCTL_CONTROL = "jarvisctl-control-live";
const LEGACY_VIEW_TYPES = ["jarvisctl-control"];
const TERMINAL_VIEW_TYPE = "terminal:terminal";
const BUILD_STAMP = "2026-03-18-render-fix";

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
	agents: JarvisAgentMetadata[];
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

	constructor(leaf: WorkspaceLeaf, plugin: JarvisCtlControlPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = true;
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
		container.empty();
		container.addClass("jarvisctl-control-view");

		const shell = container.createDiv({ cls: "jarvisctl-shell" });
		this.renderTopBar(shell);
		if (this.errorMessage) {
			this.renderErrorBanner(shell, this.errorMessage);
		}
		this.renderBody(shell);
		this.renderStatusLine(shell);
	}

	private renderTopBar(parent: HTMLElement): void {
		const topBar = parent.createDiv({ cls: "jarvisctl-topbar" });
		const title = topBar.createDiv({ cls: "jarvisctl-title" });
		title.createDiv({ cls: "jarvisctl-kicker", text: "Operator Surface" });
		title.createEl("h2", { text: "Jarvis Control" });
		title.createEl("p", {
			cls: "jarvisctl-subtitle",
			text: `Build ${this.plugin.getBuildStamp()} · Namespaces, agents, and live attach actions inside Obsidian.`,
		});

		const metrics = topBar.createDiv({ cls: "jarvisctl-metrics" });
		const liveNamespaces = this.sessions.filter((session) =>
			session.agents.some((agent) => agent.running),
		).length;
		const agentCount = this.sessions.reduce(
			(total, session) => total + session.agents.length,
			0,
		);
		const selectedSession = this.getSelectedSession();

		this.renderMetric(metrics, "Namespaces", `${this.sessions.length}`);
		this.renderMetric(metrics, "Live Agents", `${agentCount}`);
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
		const panel = parent.createDiv({ cls: "jarvisctl-panel" });
		const header = panel.createDiv({ cls: "jarvisctl-panel-header" });
		header.createDiv({ cls: "jarvisctl-panel-title", text: "Namespaces" });
		const headerActions = header.createDiv({ cls: "jarvisctl-actions" });
		this.makeButton(headerActions, "Refresh", async () => {
			await this.refreshSessions();
		}, "-primary");
		this.makeButton(headerActions, "Dashboard", async () => {
			await this.plugin.openTerminalCommand(
				[this.plugin.getTerminalJarvisCtlPath()],
				"JarvisCtl Dashboard",
				this.plugin.getVaultBasePath(),
			);
		});

		const body = panel.createDiv({ cls: "jarvisctl-panel-body" });
		if (this.sessions.length === 0) {
			const empty = body.createDiv({ cls: "jarvisctl-empty" });
			empty.createEl("h3", { text: "No active namespaces" });
			empty.createEl("p", {
				text: "When a board-owned Codex run is active, it will appear here with attach and exec actions.",
			});
			const list = empty.createEl("ul");
			list.createEl("li", { text: "Use the project or dispatch board to move work into Ready for Codex." });
			list.createEl("li", { text: "Use the Dashboard button to open bare jarvisctl in a Terminal tab." });
			return;
		}

		const list = body.createDiv({ cls: "jarvisctl-namespace-list" });
		for (const session of this.sessions) {
			const isSelected = this.selectedNamespace === session.namespace;
			const card = list.createDiv({
				cls: isSelected ? "jarvisctl-card is-selected" : "jarvisctl-card",
			});
			card.addEventListener("click", () => {
				this.selectedNamespace = session.namespace;
				this.render();
			});

			const topLine = card.createDiv({ cls: "jarvisctl-card-topline" });
			topLine.createDiv({ cls: "jarvisctl-card-title", text: session.namespace });
			const running = session.agents.some((agent) => agent.running);
			topLine.createSpan({
				cls: running ? "jarvisctl-chip is-live" : "jarvisctl-chip is-idle",
				text: running ? "Live" : "Idle",
			});

			const details = card.createDiv({ cls: "jarvisctl-detail-grid" });
			this.renderDetailBox(details, "Agents", `${session.agents.length}`);
			this.renderDetailBox(details, "Backend", session.backend);
			this.renderDetailBox(details, "Working Dir", session.working_directory ?? "n/a");
			this.renderDetailBox(details, "Age", relativeAge(session.created_at_epoch_ms));
		}
	}

	private renderDetailsPanel(parent: HTMLElement): void {
		const panel = parent.createDiv({ cls: "jarvisctl-panel" });
		const header = panel.createDiv({ cls: "jarvisctl-panel-header" });
		header.createDiv({
			cls: "jarvisctl-panel-title",
			text: this.getSelectedSession()?.namespace ?? "Namespace Detail",
		});

		const body = panel.createDiv({ cls: "jarvisctl-panel-body" });
		const session = this.getSelectedSession();
		if (!session) {
			const empty = body.createDiv({ cls: "jarvisctl-empty" });
			empty.createEl("h3", { text: "Nothing selected" });
			empty.createEl("p", { text: "Select a namespace to inspect agents and operator actions." });
			return;
		}

		const actions = body.createDiv({ cls: "jarvisctl-actions" });
		this.makeButton(actions, "Attach", async () => {
			await this.withAction(`Opening attach for ${session.namespace}`, async () => {
				await this.plugin.openNamespaceAttach(session);
			});
		}, "-primary");
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

		const detailGrid = body.createDiv({ cls: "jarvisctl-detail-grid" });
		this.renderDetailBox(detailGrid, "Working Dir", session.working_directory ?? "n/a");
		this.renderDetailBox(detailGrid, "Command", session.shell_command);
		this.renderDetailBox(detailGrid, "Backend", session.backend);
		this.renderDetailBox(detailGrid, "Created", new Date(session.created_at_epoch_ms).toLocaleString());

		const agentList = body.createDiv({ cls: "jarvisctl-agent-list" });
		for (const agent of session.agents) {
			const row = agentList.createDiv({ cls: "jarvisctl-agent-row" });
			const left = row.createDiv();
			left.createDiv({ cls: "jarvisctl-card-title", text: agent.name });
			const meta = left.createDiv({ cls: "jarvisctl-agent-meta" });
			meta.createSpan({ text: `PID ${agent.pid}` });
			meta.createSpan({ text: agent.running ? "running" : "idle" });

			const rowActions = row.createDiv({ cls: "jarvisctl-agent-actions" });
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

	private renderDetailBox(parent: HTMLElement, label: string, value: string): void {
		const box = parent.createDiv({ cls: "jarvisctl-detail-box" });
		box.createSpan({ cls: "jarvisctl-detail-box-label", text: label });
		box.createDiv({ cls: "jarvisctl-detail-box-value", text: value });
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
