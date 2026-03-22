import type {
	JarvisActivitySection,
	JarvisDashboardViewState,
	JarvisSessionMetadata,
	JarvisWorkerOffloadRequest,
	JarvisWorkerOffloadResult,
} from "../types/domain";

export type JarvisOperatorMode = "auto" | "steer" | "queue";

export interface JarvisOperatorMessageRequest {
	targetId: string;
	targetKind: "agent" | "subagent";
	targetLabel?: string;
	mode: JarvisOperatorMode;
	message: string;
	attachmentPath?: string;
}

export interface JarvisDashboardHost {
	state: JarvisDashboardViewState;
	selectNamespace(namespace: string): void;
	selectControlNamespace(namespace: string | null): void;
	refresh(): Promise<void>;
	openDashboard(): Promise<void>;
	attach(session: JarvisSessionMetadata): Promise<void>;
	continueTicket(session: JarvisSessionMetadata): Promise<void>;
	freshTicket(session: JarvisSessionMetadata): Promise<void>;
	openTicket(session: JarvisSessionMetadata): Promise<void>;
	openTranscript(session: JarvisSessionMetadata): Promise<void>;
	tellAgent(session: JarvisSessionMetadata, agentName?: string): Promise<void>;
	sendOperatorMessage(
		session: JarvisSessionMetadata,
		request: JarvisOperatorMessageRequest,
	): Promise<void>;
	pickVaultAttachment(session: JarvisSessionMetadata): Promise<string | null>;
	pickExternalAttachment(session: JarvisSessionMetadata, file: File): Promise<string | null>;
	pasteClipboardAttachment(session: JarvisSessionMetadata): Promise<string | null>;
	copyAttach(session: JarvisSessionMetadata): Promise<void>;
	closeNamespace(session: JarvisSessionMetadata): Promise<void>;
	execAgent(session: JarvisSessionMetadata, agentName: string): Promise<void>;
	interruptAgent(session: JarvisSessionMetadata, agentName: string): Promise<void>;
	copyExec(session: JarvisSessionMetadata, agentName: string): Promise<void>;
	runWorkerOffload(
		session: JarvisSessionMetadata,
		request: JarvisWorkerOffloadRequest,
	): Promise<JarvisWorkerOffloadResult>;
	readActivitySections(session: JarvisSessionMetadata, limit?: number): JarvisActivitySection[];
}
