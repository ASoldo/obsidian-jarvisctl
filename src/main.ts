import {
	App,
	FuzzySuggestModal,
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
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { createApp, reactive, type App as VueApplication } from "vue";

import ControlPlaneApp from "./ui/App.vue";
import type {
	JarvisDashboardHost,
	JarvisOperatorMessageRequest,
	JarvisOperatorMode,
} from "./ui/bridge";
import type {
	JarvisActivitySection,
	JarvisAgentMetadata,
	JarvisControlPlaneResource,
	JarvisControlPlaneState,
	JarvisDashboardViewState,
	JarvisDeploymentStatus,
	JarvisApplicationStatus,
	JarvisCronJobStatus,
	JarvisJobStatus,
	JarvisNetworkPolicyStatus,
	JarvisResourcePolicyStatus,
	JarvisResourceSummary,
	JarvisSessionMetadata,
	JarvisServiceStatus,
	JarvisWorkerMetadata,
	JarvisWorkerOffloadRequest,
	JarvisWorkerOffloadResult,
} from "./types/domain";

const execFileAsync = promisify(execFile);

const VIEW_TYPE_JARVISCTL_CONTROL = "jarvisctl-control-observer";
const LEGACY_VIEW_TYPES = ["jarvisctl-control", "jarvisctl-control-live"];
const TERMINAL_VIEW_TYPE = "terminal:terminal";
const BUILD_STAMP = "2026-03-22-openclaw-runtime-offload-surface";

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

interface JarvisTellRequest extends Omit<JarvisOperatorMessageRequest, "targetId" | "targetKind"> {}

interface JarvisCodexLaunchRequest {
	message: string;
	imagePaths: string[];
}

interface JarvisTellCapabilities {
	supportsMode: boolean;
	supportsNoEnter: boolean;
}

interface JarvisWorkerListEntry {
	kind?: string;
	namespace?: string;
	name?: string;
	status?: string;
	detail?: string;
}

interface JarvisWorkerDescribeOutput {
	manifest?: {
		metadata?: {
			name?: string;
			namespace?: string;
		};
		spec?: {
			model?: string;
			provider?: string;
			role?: string;
			outputMode?: string;
			systemPrompt?: string;
			temperature?: number;
			numCtx?: number;
			numPredict?: number;
		};
	};
	status?: {
		endpoint?: string;
		loaded?: boolean;
		locality?: string;
		model?: string;
		output_mode?: string;
		provider?: string;
		role?: string;
		capabilities?: string[];
		classes?: string[];
		pool?: string | null;
		max_concurrent?: number;
		active_runs?: number;
		pending_runs?: number;
		available_slots?: number;
		admission?: string;
		admission_code?: string;
		admission_reason?: string;
		estimated_memory_mib?: number | null;
		estimated_gpu_memory_mib?: number | null;
		machine_memory_available_mib?: number | null;
		machine_gpu_memory_available_mib?: number | null;
	};
}

interface JarvisResourceSummaryOutput {
	kind?: string;
	namespace?: string | null;
	name?: string;
	status?: string;
	detail?: string;
}

interface JarvisDescribeEnvelope<TStatus> {
	status?: TStatus;
}

interface CachedWorkerDetail {
	worker: JarvisWorkerMetadata;
	fetchedAtEpochMs: number;
}

interface CachedSessionList {
	sessions: JarvisSessionMetadata[];
	fetchedAtEpochMs: number;
}

interface CachedWorkerList {
	workers: JarvisWorkerMetadata[];
	fetchedAtEpochMs: number;
}

interface CachedControlPlaneState {
	state: JarvisControlPlaneState;
	fetchedAtEpochMs: number;
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
	private tellCapabilitiesCacheKey: string | null = null;
	private tellCapabilitiesCache: JarvisTellCapabilities | null = null;
	private sessionListCache: CachedSessionList | null = null;
	private sessionListPromise: Promise<JarvisSessionMetadata[]> | null = null;
	private workerListCache: CachedWorkerList | null = null;
	private workerListPromise: Promise<JarvisWorkerMetadata[]> | null = null;
	private workerDetailCache = new Map<string, CachedWorkerDetail>();
	private controlPlaneCache = new Map<string, CachedControlPlaneState>();
	private controlPlanePromises = new Map<string, Promise<JarvisControlPlaneState>>();
	private workersUnsupportedUntilEpochMs = 0;

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
		if (this.sessionListCache && Date.now() - this.sessionListCache.fetchedAtEpochMs < 5_000) {
			return this.sessionListCache.sessions;
		}
		if (this.sessionListPromise) {
			return this.sessionListPromise;
		}
		this.sessionListPromise = (async () => {
			const { stdout } = await this.execJarvisCtl(["list", "--json"]);
			const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
			if (!Array.isArray(parsed)) {
				throw new Error("jarvisctl list --json did not return an array");
			}
			const sessions = parsed as JarvisSessionMetadata[];
			this.sessionListCache = {
				sessions,
				fetchedAtEpochMs: Date.now(),
			};
			return sessions;
		})().finally(() => {
			this.sessionListPromise = null;
		});
		return this.sessionListPromise;
	}

	async fetchWorkers(): Promise<JarvisWorkerMetadata[]> {
		if (this.workerListCache && Date.now() - this.workerListCache.fetchedAtEpochMs < 8_000) {
			return this.workerListCache.workers;
		}
		if (Date.now() < this.workersUnsupportedUntilEpochMs) {
			return [];
		}
		if (this.workerListPromise) {
			return this.workerListPromise;
		}

		this.workerListPromise = (async () => {
			let stdout: string;
			try {
				({ stdout } = await this.execJarvisCtl(["get", "workers", "--output", "json"]));
			} catch (error) {
				if (isUnsupportedWorkersCommand(error)) {
					this.workersUnsupportedUntilEpochMs = Date.now() + 15_000;
					return [];
				}
				throw error;
			}

			const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
			if (!Array.isArray(parsed)) {
				throw new Error("jarvisctl get workers --output json did not return an array");
			}

			const summaries = parsed
				.map((entry) => normalizeWorkerListEntry(entry))
				.filter((entry): entry is JarvisWorkerListEntry => entry !== null);
			const seenKeys = new Set<string>();

			const workers = await Promise.all(
				summaries.map(async (summary) => {
					const key = workerCacheKey(summary.namespace ?? "default", summary.name ?? "worker");
					seenKeys.add(key);
					const cached = this.workerDetailCache.get(key);
					if (cached && Date.now() - cached.fetchedAtEpochMs < 30_000) {
						return withWorkerSummary(cached.worker, summary);
					}

					try {
						const detail = await this.fetchWorkerDetail(summary);
						this.workerDetailCache.set(key, {
							worker: detail,
							fetchedAtEpochMs: Date.now(),
						});
						return detail;
					} catch (error) {
						if (cached) {
							console.warn("JarvisCtl Control could not refresh worker detail, using cache", error);
							return withWorkerSummary(cached.worker, summary);
						}
						return buildWorkerMetadata(summary);
					}
				}),
			);

			for (const key of [...this.workerDetailCache.keys()]) {
				if (!seenKeys.has(key)) {
					this.workerDetailCache.delete(key);
				}
			}

			const sortedWorkers = workers.sort(
				(left, right) =>
					left.namespace.localeCompare(right.namespace) || left.name.localeCompare(right.name),
			);
			this.workerListCache = {
				workers: sortedWorkers,
				fetchedAtEpochMs: Date.now(),
			};
			return sortedWorkers;
		})().finally(() => {
			this.workerListPromise = null;
		});
		return this.workerListPromise;
	}

	async fetchControlPlane(controlNamespace: string): Promise<JarvisControlPlaneState> {
		const namespace = controlNamespace.trim() || "default";
		const cached = this.controlPlaneCache.get(namespace);
		if (cached && Date.now() - cached.fetchedAtEpochMs < 5_000) {
			return cached.state;
		}
		const inFlight = this.controlPlanePromises.get(namespace);
		if (inFlight) {
			return inFlight;
		}

		const promise = (async () => {
			const { stdout } = await this.execJarvisCtl(["get", "all", "-n", namespace, "--output", "json"]);
			const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
			if (!Array.isArray(parsed)) {
				throw new Error("jarvisctl get all --output json did not return an array");
			}

			const resources = parsed
				.map((entry) => normalizeResourceSummary(entry))
				.filter((entry): entry is JarvisResourceSummary => entry !== null);
			const filterByKind = (kind: string): JarvisResourceSummary[] =>
				resources.filter((resource) => resource.kind === kind);

			const [
				deployments,
				jobs,
				cronJobs,
				applications,
				services,
				networkPolicies,
				configMaps,
				secrets,
				volumes,
			] = await Promise.all([
				this.fetchControlPlaneResourceDetails<JarvisDeploymentStatus>("deployment", filterByKind("Deployment"), namespace),
				this.fetchControlPlaneResourceDetails<JarvisJobStatus>("job", filterByKind("Job"), namespace),
				this.fetchControlPlaneResourceDetails<JarvisCronJobStatus>("cronjob", filterByKind("CronJob"), namespace),
				this.fetchControlPlaneResourceDetails<JarvisApplicationStatus>("application", filterByKind("Application"), namespace),
				this.fetchControlPlaneResourceDetails<JarvisServiceStatus>("service", filterByKind("Service"), namespace),
				this.fetchControlPlaneResourceDetails<JarvisNetworkPolicyStatus>("networkpolicy", filterByKind("NetworkPolicy"), namespace),
				this.fetchControlPlaneResourceDetails<JarvisResourcePolicyStatus>("configmap", filterByKind("ConfigMap"), namespace),
				this.fetchControlPlaneResourceDetails<JarvisResourcePolicyStatus>("secret", filterByKind("Secret"), namespace),
				this.fetchControlPlaneResourceDetails<JarvisResourcePolicyStatus>("volume", filterByKind("Volume"), namespace),
			]);

			const state: JarvisControlPlaneState = {
				namespace,
				fetched_at_epoch_ms: Date.now(),
				resources,
				deployments,
				jobs,
				cron_jobs: cronJobs,
				applications,
				services,
				network_policies: networkPolicies,
				config_maps: configMaps,
				secrets,
				volumes,
			};
			this.controlPlaneCache.set(namespace, {
				state,
				fetchedAtEpochMs: Date.now(),
			});
			return state;
		})().finally(() => {
			this.controlPlanePromises.delete(namespace);
		});
		this.controlPlanePromises.set(namespace, promise);
		return promise;
	}

	async runJarvisCtl(args: string[]): Promise<void> {
		await this.execJarvisCtl(args);
		this.invalidateRuntimeCaches();
	}

	async promptAndTell(namespace: string, agent: string): Promise<void> {
		const request = await promptForTell(this.app, namespace, agent);
		if (!request) {
			return;
		}
		const session =
			(await this.fetchSessions()).find((entry) => entry.namespace === namespace) ??
			({
				namespace,
				backend: "native",
				created_at_epoch_ms: Date.now(),
				shell_command: "",
				agents: [{ name: agent, pid: 0, running: false }],
			} satisfies JarvisSessionMetadata);

		await this.sendOperatorMessage(
			session,
			{
				targetId: agent,
				targetKind: "agent",
				targetLabel: agent,
				mode: request.mode,
				message: request.message,
				attachmentPath: request.attachmentPath,
			},
		);
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

	async sendOperatorMessage(
		session: JarvisSessionMetadata,
		request: JarvisOperatorMessageRequest,
	): Promise<void> {
		const payload = this.buildOperatorPayload(session, request);
		if (!payload) {
			new Notice("Nothing was sent because the message and attachment are empty.");
			return;
		}

		const actualAgent =
			request.targetKind === "agent" ? request.targetId : session.agents[0]?.name ?? "agent0";
		const capabilities = await this.getTellCapabilities();
		const args = [
			"tell",
			"--namespace",
			session.namespace,
			"--agent",
			actualAgent,
			"--text",
			payload,
		];

		let fellBackToDefaultMode = false;
		if (capabilities.supportsMode) {
			args.push("--mode", request.mode);
		} else if (request.mode === "queue" && capabilities.supportsNoEnter && session.backend !== "codex-app") {
			args.push("--no-enter");
		} else if (request.mode !== "auto") {
			fellBackToDefaultMode = true;
		}

		await this.runJarvisCtl(args);
		this.invalidateRuntimeCaches();

		const targetLabel = request.targetLabel ?? request.targetId;
		if (fellBackToDefaultMode) {
			new Notice(`Sent message to ${session.namespace}:${targetLabel} with default tell behavior.`);
			return;
		}

		new Notice(
			request.targetKind === "subagent"
				? `Relayed message to ${targetLabel} in ${session.namespace}`
				: `Sent message to ${session.namespace}:${targetLabel}`,
		);
	}

	async runWorkerOffload(
		session: JarvisSessionMetadata,
		request: JarvisWorkerOffloadRequest,
	): Promise<JarvisWorkerOffloadResult> {
		const controlNamespace =
			request.controlNamespace.trim() ||
			session.context?.control_namespace?.trim() ||
			"default";
		const serviceName = request.serviceName.trim();
		const prompt = request.prompt.trim();
		if (!serviceName) {
			throw new Error("Worker offload requires a service name.");
		}
		if (!prompt) {
			throw new Error("Worker offload requires a prompt.");
		}
		const outputPath =
			request.outputPath?.trim() ||
			join(
				"/tmp",
				`${slugifyForCli(session.namespace)}-${slugifyForCli(serviceName)}-${Date.now()}.json`,
			);
		const jobName =
			request.jobName?.trim() ||
			`${slugifyForCli(session.namespace)}-${slugifyForCli(serviceName)}-${Date.now()
				.toString()
				.slice(-6)}`;

		const args = [
			"worker",
			"offload",
			"--service",
			serviceName,
			"-n",
			controlNamespace,
			"--via-runtime-namespace",
			session.namespace,
			"--output",
			"json",
			"--output-path",
			outputPath,
			"--job-name",
			jobName,
		];

		const intent = request.intent?.trim();
		if (intent) {
			args.push("--intent", intent);
		}

		args.push("--prompt", prompt);

		try {
			const { stdout } = await this.execJarvisCtl(args);
			const parsed = JSON.parse(stdout.trim() || "{}") as JarvisWorkerOffloadResult;
			this.invalidateRuntimeCaches();
			return parsed;
		} catch (error) {
			const recovered = await this.recoverWorkerOffloadResult(controlNamespace, jobName, outputPath);
			if (recovered) {
				this.invalidateRuntimeCaches();
				return recovered;
			}
			throw appendCommandFailureDetail(error);
		}
	}

	async pickVaultAttachmentPath(): Promise<string | null> {
		const files = this.app.vault
			.getFiles()
			.filter((file) => !file.path.startsWith(".obsidian/"))
			.sort((left, right) => left.path.localeCompare(right.path));
		if (files.length === 0) {
			new Notice("No vault files are available for attachment.");
			return null;
		}
		return await new Promise<string | null>((resolve) => {
			new JarvisVaultFilePickerModal(this.app, files, resolve).open();
		});
	}

	async stageExternalAttachment(file: File): Promise<string | null> {
		const nativePath = (file as unknown as { path?: string }).path;
		if (nativePath && existsSync(nativePath)) {
			return this.toUserFacingAttachmentPath(nativePath);
		}

		const targetPath = this.createStagedAttachmentPath(file.name || `upload-${Date.now()}`);
		const bytes = Buffer.from(await file.arrayBuffer());
		writeFileSync(targetPath, bytes);
		return this.toUserFacingAttachmentPath(targetPath);
	}

	async stageClipboardAttachment(): Promise<string | null> {
		const clipboardText = (await navigator.clipboard.readText().catch(() => "")).trim();
		if (clipboardText.length > 0) {
			try {
				const resolvedPath = this.resolveClipboardPath(clipboardText);
				if (resolvedPath) {
					return this.toUserFacingAttachmentPath(resolvedPath);
				}
			} catch (error) {
				console.warn("JarvisCtl Control could not resolve clipboard path", error);
			}

			const textPath = this.createStagedAttachmentPath(`clipboard-${Date.now()}.txt`);
			writeFileSync(textPath, clipboardText, "utf8");
			return this.toUserFacingAttachmentPath(textPath);
		}

		if (typeof navigator.clipboard.read !== "function") {
			new Notice("Clipboard attachment import is unavailable in this environment.");
			return null;
		}

		const items = await navigator.clipboard.read();
		for (const item of items) {
			const preferredType =
				item.types.find((type) => type.startsWith("image/")) ??
				item.types.find((type) => type === "text/plain") ??
				item.types[0];
			if (!preferredType) {
				continue;
			}
			const blob = await item.getType(preferredType);
			if (preferredType === "text/plain") {
				const text = (await blob.text()).trim();
				if (text.length === 0) {
					continue;
				}
				const textPath = this.createStagedAttachmentPath(`clipboard-${Date.now()}.txt`);
				writeFileSync(textPath, text, "utf8");
				return this.toUserFacingAttachmentPath(textPath);
			}

			const extension = extensionForMimeType(preferredType);
			const binaryPath = this.createStagedAttachmentPath(`clipboard-${Date.now()}${extension}`);
			writeFileSync(binaryPath, Buffer.from(await blob.arrayBuffer()));
			return this.toUserFacingAttachmentPath(binaryPath);
		}

		new Notice("Clipboard does not contain a usable file, image, or text payload.");
		return null;
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

	private invalidateRuntimeCaches(): void {
		this.sessionListCache = null;
		this.sessionListPromise = null;
		this.workerListCache = null;
		this.workerListPromise = null;
		this.workerDetailCache.clear();
		this.controlPlaneCache.clear();
		this.controlPlanePromises.clear();
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

	private async getTellCapabilities(): Promise<JarvisTellCapabilities> {
		const cacheKey = this.getJarvisCtlCandidates().join("|");
		if (this.tellCapabilitiesCacheKey === cacheKey && this.tellCapabilitiesCache) {
			return this.tellCapabilitiesCache;
		}

		const { stdout } = await this.execJarvisCtl(["tell", "--help"]);
		const capabilities = {
			supportsMode: stdout.includes("--mode"),
			supportsNoEnter: stdout.includes("--no-enter"),
		};
		this.tellCapabilitiesCacheKey = cacheKey;
		this.tellCapabilitiesCache = capabilities;
		return capabilities;
	}

	getBuildStamp(): string {
		return BUILD_STAMP;
	}

	private async fetchWorkerDetail(summary: JarvisWorkerListEntry): Promise<JarvisWorkerMetadata> {
		const workerName = summary.name?.trim();
		const namespace = summary.namespace?.trim() || "default";
		if (!workerName) {
			return buildWorkerMetadata(summary);
		}

		const { stdout } = await this.execJarvisCtl([
			"describe",
			"worker",
			workerName,
			"-n",
			namespace,
			"--output",
			"json",
		]);
		const parsed = JSON.parse(stdout.trim() || "{}") as JarvisWorkerDescribeOutput;
		return buildWorkerMetadata(summary, parsed);
	}

	private async fetchControlPlaneResourceDetails<TStatus>(
		resourceArg: string,
		summaries: JarvisResourceSummary[],
		namespace: string,
	): Promise<JarvisControlPlaneResource<TStatus>[]> {
		const resources = await Promise.all(
			summaries.map(async (summary) => {
				try {
					const { stdout } = await this.execJarvisCtl([
						"describe",
						resourceArg,
						summary.name,
						"-n",
						namespace,
						"--output",
						"json",
					]);
					const parsed = JSON.parse(stdout.trim() || "{}") as JarvisDescribeEnvelope<TStatus>;
					return {
						summary,
						status: parsed.status as TStatus,
					} satisfies JarvisControlPlaneResource<TStatus>;
				} catch (error) {
					console.warn(`JarvisCtl Control could not describe ${resourceArg} ${namespace}/${summary.name}`, error);
					return null;
				}
			}),
		);
		return resources.filter(
			(resource): resource is JarvisControlPlaneResource<TStatus> => resource !== null,
		);
	}

	private async recoverWorkerOffloadResult(
		namespace: string,
		jobName: string,
		outputPath: string,
	): Promise<JarvisWorkerOffloadResult | null> {
		const deadlineEpochMs = Date.now() + 10_000;
		while (Date.now() < deadlineEpochMs) {
			try {
				const { stdout } = await this.execJarvisCtl([
					"describe",
					"job",
					jobName,
					"-n",
					namespace,
					"--output",
					"json",
				]);
				const parsed = JSON.parse(stdout.trim() || "{}") as JarvisDescribeEnvelope<JarvisJobStatus>;
				const status = parsed.status;
				if (!status) {
					return null;
				}
				const run = status.run_details[0];
				if (!run) {
					if (status.pending > 0 || status.active > 0 || status.succeeded > 0) {
						return {
							job_name: jobName,
							namespace,
							service_name: "unknown",
							phase: status.succeeded > 0 ? "succeeded" : status.active > 0 ? "active" : "pending",
							fallback_class: false,
							output_path: outputPath,
							response: readWorkerOffloadOutput(outputPath),
						};
					}
					return null;
				}
				if (
					run.phase === "succeeded" ||
					run.phase === "active" ||
					run.phase === "pending" ||
					status.succeeded > 0 ||
					status.active > 0 ||
					status.pending > 0
				) {
					return {
						job_name: jobName,
						namespace,
						service_name: run.service_name ?? "unknown",
						phase:
							run.phase ||
							(status.succeeded > 0 ? "succeeded" : status.active > 0 ? "active" : "pending"),
						selected_class: run.selected_class ?? null,
						fallback_class: run.fallback_class,
						worker: run.worker ?? null,
						worker_namespace: run.worker_namespace ?? null,
						worker_provider: run.worker_provider ?? null,
						worker_model: run.worker_model ?? null,
						worker_locality: run.worker_locality ?? null,
						validation_state: run.validation_state ?? null,
						validation_message: run.validation_message ?? null,
						artifact_path: run.artifact_path ?? null,
						output_path: run.output_path ?? outputPath,
						response: readWorkerOffloadOutput(run.output_path ?? outputPath),
					};
				}
			} catch (error) {
				if (!isDescribeMissingError(error)) {
					console.warn(`JarvisCtl Control could not recover offload job ${namespace}/${jobName}`, error);
				}
			}
			await delay(400);
		}
		return null;
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

	private buildOperatorPayload(
		session: JarvisSessionMetadata,
		request: JarvisOperatorMessageRequest,
	): string | null {
		const message = request.message.trim();
		const parts: string[] = [];

		if (request.targetKind === "subagent") {
			parts.push(
				`Relay this operator message to ${request.targetLabel ?? request.targetId} (${request.targetId}) and continue the active branch with that context.`,
			);
		}

		if (message) {
			parts.push(message);
		}

		const attachmentPath = request.attachmentPath?.trim();
		if (attachmentPath) {
			const resolvedPath = this.resolveOperatorAttachmentPath(session, attachmentPath);
			const attachmentBody = this.readOperatorAttachmentBody(resolvedPath);
			parts.push(
				[
					`Attached file: ${resolvedPath}`,
					"Use the excerpt below as inline operator context.",
					"```text",
					attachmentBody,
					"```",
				].join("\n"),
			);
		}

		const payload = parts.filter((part) => part.trim().length > 0).join("\n\n").trim();
		return payload.length > 0 ? payload : null;
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

	private resolveOperatorAttachmentPath(session: JarvisSessionMetadata, rawPath: string): string {
		const trimmed = rawPath.trim();
		if (!trimmed) {
			throw new Error("Attachment path cannot be empty.");
		}

		if (isAbsolute(trimmed) && existsSync(trimmed)) {
			return trimmed;
		}

		const candidates = [
			session.working_directory ? join(session.working_directory, trimmed) : null,
			join(this.getVaultBasePath(), trimmed),
		].filter((value): value is string => Boolean(value));

		const resolved = candidates.find((candidate) => existsSync(candidate));
		if (!resolved) {
			throw new Error(`Attachment not found: ${trimmed}`);
		}
		return resolved;
	}

	private readOperatorAttachmentBody(path: string): string {
		const raw = readFileSync(path, "utf8").replaceAll("\r", "");
		const lines = raw.split("\n");
		const truncatedLines = lines.slice(0, 220);
		let body = truncatedLines.join("\n");
		let truncated = lines.length > truncatedLines.length;
		if (body.length > 14000) {
			body = body.slice(0, 14000);
			truncated = true;
		}
		if (truncated) {
			body = `${body}\n[attachment truncated for dashboard send]`;
		}
		return body;
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

	private resolveClipboardPath(rawValue: string): string | null {
		const trimmed = rawValue.trim();
		if (!trimmed) {
			return null;
		}
		if (isAbsolute(trimmed) && existsSync(trimmed)) {
			return trimmed;
		}

		const vaultCandidate = join(this.getVaultBasePath(), trimmed);
		if (existsSync(vaultCandidate)) {
			return vaultCandidate;
		}

		return null;
	}

	private createStagedAttachmentPath(fileName: string): string {
		const attachmentsDir = join(
			this.getVaultBasePath(),
			this.app.vault.configDir,
			"plugins",
			this.manifest.id,
			"attachments",
		);
		mkdirSync(attachmentsDir, { recursive: true });
		const extension = extname(fileName) || ".txt";
		const stem = basename(fileName, extension).replace(/[^a-zA-Z0-9._-]+/g, "-") || "attachment";
		return join(attachmentsDir, `${stem}-${Date.now()}${extension}`);
	}

	private toUserFacingAttachmentPath(absolutePath: string): string {
		const vaultBase = this.getVaultBasePath();
		const relativePath = relative(vaultBase, absolutePath);
		if (!relativePath.startsWith("..")) {
			return relativePath.replaceAll("\\", "/");
		}
		return absolutePath;
	}
}

class JarvisVaultFilePickerModal extends FuzzySuggestModal<TFile> {
	private readonly files: TFile[];
	private readonly onChoose: (path: string | null) => void;
	private resolved = false;

	constructor(app: App, files: TFile[], onChoose: (path: string | null) => void) {
		super(app);
		this.files = files;
		this.onChoose = onChoose;
		this.setPlaceholder("Pick a vault file to attach");
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.resolved = true;
		this.onChoose(file.path);
	}

	onClose(): void {
		super.onClose();
		if (!this.resolved) {
			this.onChoose(null);
		}
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
		workers: [],
		controlPlane: null,
		selectedNamespace: null,
		selectedControlNamespace: null,
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
				this.state.selectedControlNamespace = null;
			},
			selectControlNamespace: (namespace: string | null) => {
				this.state.selectedControlNamespace = namespace?.trim() || null;
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
			sendOperatorMessage: async (session, request) => {
				await this.runAction(`Sending context into ${session.namespace}`, async () => {
					await this.plugin.sendOperatorMessage(session, request);
				}, true);
			},
			pickVaultAttachment: async () => {
				return await this.plugin.pickVaultAttachmentPath();
			},
			pickExternalAttachment: async (_session, file) => {
				return await this.plugin.stageExternalAttachment(file);
			},
			pasteClipboardAttachment: async () => {
				return await this.plugin.stageClipboardAttachment();
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
			runWorkerOffload: async (session, request) => {
				this.actionInFlight = true;
				this.state.statusMessage = `Offloading ${request.serviceName} via ${session.namespace}`;
				try {
					const result = await this.plugin.runWorkerOffload(session, request);
					await this.refreshSessions(false);
					this.state.statusMessage = `Offload completed via ${result.worker ?? result.service_name}`;
					new Notice(
						`Offload completed via ${result.worker ?? result.service_name}${result.worker_model ? ` · ${result.worker_model}` : ""}`,
					);
					return result;
				} catch (error) {
					console.error(error);
					this.state.statusMessage = "Offload failed";
					new Notice(`JarvisCtl Control offload failed: ${formatError(error)}`);
					throw error;
				} finally {
					this.actionInFlight = false;
				}
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
			const [sessions, workers] = await Promise.all([
				this.plugin.fetchSessions(),
				this.plugin.fetchWorkers(),
			]);
			this.state.sessions = sessions;
			this.state.workers = workers;
			if (
				!this.state.selectedNamespace ||
				!sessions.some((session) => session.namespace === this.state.selectedNamespace)
			) {
				this.state.selectedNamespace = sessions[0]?.namespace ?? null;
			}
			const availableControlNamespaces = new Set<string>(
				[
					...workers.map((worker) => worker.namespace?.trim()),
					...sessions.map((session) => session.context?.control_namespace?.trim()),
				].filter((value): value is string => Boolean(value)),
			);
			if (
				this.state.selectedControlNamespace &&
				!availableControlNamespaces.has(this.state.selectedControlNamespace)
			) {
				this.state.selectedControlNamespace = null;
			}
			const selectedSession =
				sessions.find((session) => session.namespace === this.state.selectedNamespace) ?? null;
			const controlNamespace =
				this.state.selectedControlNamespace?.trim() ||
				selectedSession?.context?.control_namespace?.trim() ||
				workers[0]?.namespace?.trim() ||
				null;
			this.state.controlPlane = controlNamespace
				? await this.plugin.fetchControlPlane(controlNamespace)
				: null;
			this.state.lastRefreshLabel = new Date().toLocaleTimeString();
			this.state.statusMessage = "Live data";
			this.state.errorMessage = null;
			this.plugin.writeDebugSnapshot({
				event: "refresh-success",
				sessions_count: sessions.length,
				session_names: sessions.map((session) => session.namespace),
				workers_count: workers.length,
				worker_names: workers.map((worker) => `${worker.namespace}/${worker.name}`),
				selected_namespace: this.state.selectedNamespace,
				control_namespace: controlNamespace ?? null,
				control_plane_resources: this.state.controlPlane?.resources.length ?? 0,
			});
		} catch (error) {
			console.error(error);
			this.state.errorMessage = formatError(error);
			this.state.statusMessage = "Refresh failed";
			this.plugin.writeDebugSnapshot({
				event: "refresh-error",
				sessions_count: this.state.sessions.length,
				session_names: this.state.sessions.map((session) => session.namespace),
				workers_count: this.state.workers.length,
				worker_names: this.state.workers.map((worker) => `${worker.namespace}/${worker.name}`),
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

		contentEl.createEl("label", {
			cls: "jarvisctl-modal-label",
			text: "Mode",
		});
		const modeEl = contentEl.createEl("select", {
			cls: "jarvisctl-modal-select",
		});
		for (const [value, label] of [
			["auto", "Auto"],
			["steer", "Steer now"],
			["queue", "Queue next"],
		] as const) {
			const option = modeEl.createEl("option", { text: label });
			option.value = value;
		}

		contentEl.createEl("label", {
			cls: "jarvisctl-modal-label",
			text: "Attachment path",
		});
		const attachmentEl = contentEl.createEl("input", {
			cls: "jarvisctl-modal-input",
			type: "text",
		});
		attachmentEl.placeholder =
			"Optional file path. Relative paths resolve from the session working directory first.";

		const actions = contentEl.createDiv({ cls: "jarvisctl-modal-actions" });
		const cancel = actions.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.finish(null));

		const submit = actions.createEl("button", {
			text: this.submitLabel,
			cls: "mod-cta",
		});
		submit.addEventListener("click", () => {
			this.finish({
				message: messageEl.value,
				mode: modeEl.value as JarvisOperatorMode,
				attachmentPath: attachmentEl.value,
			});
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

function errorText(error: unknown): string {
	if (!error || typeof error !== "object") {
		return String(error);
	}
	const parts = [
		"message" in error ? String(error.message ?? "") : "",
		"stderr" in error ? String(error.stderr ?? "") : "",
		"stdout" in error ? String(error.stdout ?? "") : "",
	];
	return parts.filter(Boolean).join("\n");
}

function appendCommandFailureDetail(error: unknown): Error {
	const base = formatError(error);
	const detail = errorText(error)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.find((line) => line !== base);
	return new Error(detail ? `${base}\n${detail}` : base);
}

function isDescribeMissingError(error: unknown): boolean {
	const text = errorText(error).toLowerCase();
	return text.includes("not found") || text.includes("no such file") || text.includes("missing");
}

function readWorkerOffloadOutput(path: string | null | undefined): string | null {
	if (!path) {
		return null;
	}
	try {
		if (!existsSync(path)) {
			return null;
		}
		return readFileSync(path, "utf8");
	} catch (error) {
		console.warn(`JarvisCtl Control could not read offload output ${path}`, error);
		return null;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isUnsupportedWorkersCommand(error: unknown): boolean {
	const text = errorText(error).toLowerCase();
	return (
		text.includes("invalid value 'workers'") ||
		text.includes("invalid value 'worker'") ||
		text.includes("unrecognized subcommand 'worker'") ||
		text.includes("unrecognized subcommand 'workers'")
	);
}

function normalizeWorkerListEntry(value: unknown): JarvisWorkerListEntry | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const candidate = value as Record<string, unknown>;
	const namespace = String(candidate.namespace ?? "").trim();
	const name = String(candidate.name ?? "").trim();
	if (!namespace || !name) {
		return null;
	}
	return {
		kind: String(candidate.kind ?? "Worker"),
		namespace,
		name,
		status: String(candidate.status ?? "").trim(),
		detail: String(candidate.detail ?? "").trim(),
	};
}

function workerCacheKey(namespace: string, name: string): string {
	return `${namespace}/${name}`;
}

function normalizeResourceSummary(value: unknown): JarvisResourceSummary | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const candidate = value as Record<string, unknown>;
	const kind = String(candidate.kind ?? "").trim();
	const name = String(candidate.name ?? "").trim();
	if (!kind || !name) {
		return null;
	}
	const namespace = String(candidate.namespace ?? "").trim();
	return {
		kind,
		namespace: namespace || null,
		name,
		status: String(candidate.status ?? "").trim(),
		detail: String(candidate.detail ?? "").trim() || null,
	};
}

function inferWorkerSummaryFields(status: string | undefined): { model: string; role: string } {
	const normalized = (status ?? "").trim();
	const match = normalized.match(/^(.*?)(?:\s*\(([^)]+)\))?$/);
	return {
		model: match?.[1]?.trim() || "unknown",
		role: match?.[2]?.trim() || "worker",
	};
}

function buildWorkerMetadata(
	summary: JarvisWorkerListEntry,
	describe?: JarvisWorkerDescribeOutput,
): JarvisWorkerMetadata {
	const inferred = inferWorkerSummaryFields(summary.status);
	const spec = describe?.manifest?.spec;
	const status = describe?.status;
	return {
		kind: summary.kind ?? "Worker",
		namespace: summary.namespace ?? "default",
		name: summary.name ?? "worker",
		summaryStatus: summary.status?.trim() || "unknown",
		summaryDetail: summary.detail?.trim() || null,
		provider: status?.provider ?? spec?.provider ?? "unknown",
		model: status?.model ?? spec?.model ?? inferred.model,
		role: status?.role ?? spec?.role ?? inferred.role,
		endpoint: status?.endpoint ?? null,
		locality: status?.locality ?? null,
		capabilities: status?.capabilities ?? [],
		classes: status?.classes ?? [],
		pool: status?.pool ?? null,
		outputMode: status?.output_mode ?? spec?.outputMode ?? null,
		maxConcurrent: status?.max_concurrent ?? null,
		activeRuns: status?.active_runs ?? null,
		pendingRuns: status?.pending_runs ?? null,
		availableSlots: status?.available_slots ?? null,
		admission: status?.admission ?? null,
		admissionCode: status?.admission_code ?? null,
		admissionReason: status?.admission_reason ?? null,
		estimatedMemoryMiB: status?.estimated_memory_mib ?? null,
		estimatedGpuMemoryMiB: status?.estimated_gpu_memory_mib ?? null,
		machineMemoryAvailableMiB: status?.machine_memory_available_mib ?? null,
		machineGpuMemoryAvailableMiB: status?.machine_gpu_memory_available_mib ?? null,
		loaded: Boolean(status?.loaded),
		systemPrompt: spec?.systemPrompt ?? null,
		temperature: spec?.temperature ?? null,
		numCtx: spec?.numCtx ?? null,
		numPredict: spec?.numPredict ?? null,
	};
}

function withWorkerSummary(
	worker: JarvisWorkerMetadata,
	summary: JarvisWorkerListEntry,
): JarvisWorkerMetadata {
	return {
		...worker,
		summaryStatus: summary.status?.trim() || worker.summaryStatus,
		summaryDetail: summary.detail?.trim() || worker.summaryDetail || null,
	};
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

function extensionForMimeType(mimeType: string): string {
	switch (mimeType) {
		case "image/png":
			return ".png";
		case "image/jpeg":
			return ".jpg";
		case "image/webp":
			return ".webp";
		case "image/gif":
			return ".gif";
		case "text/markdown":
			return ".md";
		case "application/json":
			return ".json";
		default:
			return ".bin";
	}
}

function slugifyForCli(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}
