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
import { createApp, reactive, type App as VueApplication } from "vue";

import ControlPlaneApp from "./ui/App.vue";
import type { JarvisDashboardHost } from "./ui/bridge";
import type {
	JarvisActivitySection,
	JarvisAgentMetadata,
	JarvisDashboardViewState,
	JarvisSessionMetadata,
} from "./types/domain";

const execFileAsync = promisify(execFile);

const VIEW_TYPE_JARVISCTL_CONTROL = "jarvisctl-control-observer";
const LEGACY_VIEW_TYPES = ["jarvisctl-control", "jarvisctl-control-live"];
const TERMINAL_VIEW_TYPE = "terminal:terminal";
const BUILD_STAMP = "2026-03-19-vue-control-plane-main-workflow";

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
		await this.launchCodexForNotePath(taskNotePath, basename(taskNotePath, ".md"), fresh);
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

		const args = ["codex", "--task-note", taskNotePath];
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
		await this.openTerminalCommand(
			[this.getTerminalJarvisCtlPath(), "attach", "--namespace", session.namespace],
			`Attach ${session.namespace}`,
			session.working_directory ?? this.getVaultBasePath(),
		);
	}

	async openAgentExec(session: JarvisSessionMetadata, agent: JarvisAgentMetadata): Promise<void> {
		await this.openTerminalCommand(
			[
				this.getTerminalJarvisCtlPath(),
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

	async openTerminalCommand(commandParts: string[], title: string, cwd: string): Promise<void> {
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
			const raw = readFileSync(
				join(this.getVaultBasePath(), this.app.vault.configDir, "plugins", "terminal", "data.json"),
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

	buildCommandProfile(shellExecutable: string, wrappedCommand: string, title: string): TerminalProfile {
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
		const adapter = this.app.vault.adapter as unknown as { getBasePath?: () => string };
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
	private refreshHandle: number | null = null;
	private actionInFlight = false;
	private vueApp: VueApplication<Element> | null = null;
	private mountEl: HTMLElement | null = null;
	private readonly state = reactive<JarvisDashboardViewState>({
		sessions: [],
		selectedNamespace: null,
		statusMessage: "Idle",
		lastRefreshLabel: "never",
		errorMessage: null,
		buildStamp: BUILD_STAMP,
	});
	private readonly host: JarvisDashboardHost;

	constructor(leaf: WorkspaceLeaf, plugin: JarvisCtlControlPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = true;
		this.host = this.createHost();

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
		this.mountEl = this.contentEl.createDiv({ cls: "jarvisctl-vue-root" });
		this.vueApp = createApp(ControlPlaneApp, { host: this.host });
		this.vueApp.mount(this.mountEl);
		this.state.statusMessage = "Opening runtime surface";
		this.plugin.writeDebugSnapshot({ event: "view-open" });
		void this.refreshSessions();
		this.startPolling();
	}

	async onClose(): Promise<void> {
		this.stopPolling();
		this.vueApp?.unmount();
		this.vueApp = null;
		this.mountEl = null;
		this.contentEl.empty();
		this.contentEl.removeClass("jarvisctl-control-view");
	}

	async handleSettingsChanged(): Promise<void> {
		this.stopPolling();
		this.startPolling();
		await this.refreshSessions();
	}

	private createHost(): JarvisDashboardHost {
		return {
			state: this.state,
			selectNamespace: (namespace: string) => {
				this.state.selectedNamespace = namespace;
			},
			refresh: async () => {
				await this.refreshSessions();
			},
			openDashboard: async () => {
				await this.plugin.openTerminalCommand(
					[this.plugin.getTerminalJarvisCtlPath()],
					"JarvisCtl Dashboard",
					this.plugin.getVaultBasePath(),
				);
			},
			attach: async (session) => {
				await this.runAction(`Opening attach for ${session.namespace}`, async () => {
					await this.plugin.openNamespaceAttach(session);
				});
			},
			continueTicket: async (session) => {
				if (!session.context?.task_note) {
					new Notice("This namespace does not expose a ticket note.");
					return;
				}
				await this.runAction(`Continuing ${session.namespace}`, async () => {
					await this.plugin.launchCodexForTaskNote(session.context?.task_note ?? "", false);
				});
			},
			freshTicket: async (session) => {
				if (!session.context?.task_note) {
					new Notice("This namespace does not expose a ticket note.");
					return;
				}
				await this.runAction(`Starting fresh ${session.namespace}`, async () => {
					await this.plugin.launchCodexForTaskNote(session.context?.task_note ?? "", true);
				});
			},
			openTicket: async (session) => {
				if (!session.context?.task_note) {
					new Notice("This namespace does not expose a ticket note.");
					return;
				}
				await this.plugin.openTaskNote(session.context.task_note);
			},
			openTranscript: async (session) => {
				if (!session.context?.transcript_path) {
					new Notice("This namespace does not expose a transcript.");
					return;
				}
				await this.runAction(`Opening transcript for ${session.namespace}`, async () => {
					await this.plugin.openTranscript(session.context?.transcript_path ?? "", session.namespace);
				});
			},
			tellAgent: async (session, agentName) => {
				await this.plugin.promptAndTell(session.namespace, agentName ?? session.agents[0]?.name ?? "agent0");
				await this.refreshSessions(false);
			},
			copyAttach: async (session) => {
				await navigator.clipboard.writeText(
					`${this.plugin.getTerminalJarvisCtlPath()} attach --namespace ${session.namespace}`,
				);
				new Notice(`Copied attach command for ${session.namespace}`);
			},
			closeNamespace: async (session) => {
				await this.runAction(`Closing ${session.namespace}`, async () => {
					await this.plugin.runJarvisCtl(["delete", "--namespace", session.namespace]);
				}, true);
			},
			execAgent: async (session, agentName) => {
				const agent = session.agents.find((entry) => entry.name === agentName);
				if (!agent) {
					new Notice(`Agent ${agentName} is not present in ${session.namespace}.`);
					return;
				}
				await this.runAction(`Opening ${session.namespace}:${agent.name}`, async () => {
					await this.plugin.openAgentExec(session, agent);
				});
			},
			interruptAgent: async (session, agentName) => {
				await this.runAction(`Interrupting ${session.namespace}:${agentName}`, async () => {
					await this.plugin.runJarvisCtl([
						"interrupt",
						"--namespace",
						session.namespace,
						"--agent",
						agentName,
					]);
				}, true);
			},
			copyExec: async (session, agentName) => {
				await navigator.clipboard.writeText(
					`${this.plugin.getTerminalJarvisCtlPath()} exec --namespace ${session.namespace} --agent ${agentName}`,
				);
				new Notice(`Copied exec command for ${agentName}`);
			},
			readActivitySections: (session, limit = 10) => {
				if (!session.context?.event_log_path) {
					return [];
				}
				return this.readActivitySectionsFromPath(session.context.event_log_path, limit);
			},
		};
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
			const sessions = await this.plugin.fetchSessions();
			this.state.sessions = sessions;
			if (
				!this.state.selectedNamespace ||
				!sessions.some((session) => session.namespace === this.state.selectedNamespace)
			) {
				this.state.selectedNamespace = sessions[0]?.namespace ?? null;
			}
			this.state.lastRefreshLabel = new Date().toLocaleTimeString();
			this.state.statusMessage = "Live data";
			this.state.errorMessage = null;
			this.plugin.writeDebugSnapshot({
				event: "refresh-success",
				sessions_count: sessions.length,
				session_names: sessions.map((session) => session.namespace),
				selected_namespace: this.state.selectedNamespace,
			});
		} catch (error) {
			console.error(error);
			this.state.errorMessage = formatError(error);
			this.state.statusMessage = "Refresh failed";
			this.plugin.writeDebugSnapshot({
				event: "refresh-error",
				sessions_count: this.state.sessions.length,
				session_names: this.state.sessions.map((session) => session.namespace),
				selected_namespace: this.state.selectedNamespace,
				error_message: this.state.errorMessage,
			});
			if (noticeOnError) {
				new Notice(`JarvisCtl Control refresh failed: ${formatError(error)}`);
			}
		}
	}

	private async runAction(
		status: string,
		callback: () => Promise<void>,
		refreshAfter = false,
	): Promise<void> {
		this.actionInFlight = true;
		this.state.statusMessage = status;
		try {
			await callback();
			if (refreshAfter) {
				await this.refreshSessions(false);
			}
			this.state.statusMessage = "Action completed";
		} catch (error) {
			console.error(error);
			this.state.statusMessage = "Action failed";
			new Notice(`JarvisCtl Control action failed: ${formatError(error)}`);
		} finally {
			this.actionInFlight = false;
		}
	}

	private getSelectedSession(): JarvisSessionMetadata | undefined {
		return this.state.sessions.find((session) => session.namespace === this.state.selectedNamespace);
	}

	private readLogTail(path: string, maxLines: number): string[] {
		try {
			if (!existsSync(path)) {
				return [];
			}
			return readFileSync(path, "utf8")
				.replaceAll("\r", "")
				.split("\n")
				.map((line) => line.trimEnd())
				.filter((line) => line.length > 0)
				.slice(-maxLines);
		} catch (error) {
			console.warn("JarvisCtl Control could not read event log", error);
			return [`[error] ${formatError(error)}`];
		}
	}

	private readActivitySectionsFromPath(path: string, maxSections: number): JarvisActivitySection[] {
		const lines = this.readLogTail(path, 160);
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

function promptForTell(app: App, namespace: string, agent: string): Promise<JarvisTellRequest | null> {
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

function isMissingExecutable(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const code = "code" in error ? String(error.code) : "";
	return code === "ENOENT";
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function escapeForDoubleQuotes(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function activityKind(tag: string): string {
	const value = tag.toLowerCase();
	if (["assistant", "operator", "command", "thread", "turn", "subagent", "session"].includes(value)) {
		return value;
	}
	if (value.includes("error")) {
		return "error";
	}
	return "output";
}

function activityLabel(tag: string): string {
	switch (tag.toLowerCase()) {
		case "assistant":
			return "Assistant";
		case "operator":
			return "Operator";
		case "command":
			return "Command";
		case "thread":
			return "Thread";
		case "turn":
			return "Turn";
		case "subagent":
			return "Subagent";
		case "session":
			return "Session";
		default:
			return tag;
	}
}
