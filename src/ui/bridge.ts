import type {
	JarvisActivitySection,
	JarvisAutonomyReconcileReport,
	JarvisDashboardViewState,
	JarvisBootstrapRequest,
	JarvisFanoutRequest,
	JarvisMissionRecord,
	JarvisMissionTemplate,
	JarvisOperatorRequestRecord,
	JarvisProposalRecord,
	JarvisRuntimeServerRequest,
	JarvisSessionMetadata,
	JarvisStartSessionRequest,
	JarvisVisitRequest,
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
	toolbarMountEl: HTMLElement | null;
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
	respondServerRequest(
		session: JarvisSessionMetadata,
		request: JarvisRuntimeServerRequest,
		responseJson: string | null,
		error: string | null,
	): Promise<void>;
	promptServerRequestResponse(
		session: JarvisSessionMetadata,
		request: JarvisRuntimeServerRequest,
	): Promise<string | null>;
	pickVaultAttachment(session: JarvisSessionMetadata): Promise<string | null>;
	pickExternalAttachment(session: JarvisSessionMetadata, file: File): Promise<string | null>;
	pasteClipboardAttachment(session: JarvisSessionMetadata): Promise<string | null>;
	copyAttach(session: JarvisSessionMetadata): Promise<void>;
	closeNamespace(session: JarvisSessionMetadata): Promise<void>;
	execAgent(session: JarvisSessionMetadata, agentName: string): Promise<void>;
	interruptAgent(session: JarvisSessionMetadata, agentName: string): Promise<void>;
	copyExec(session: JarvisSessionMetadata, agentName: string): Promise<void>;
	runClusterVisit(request: JarvisVisitRequest): Promise<void>;
	startClusterSession(request: JarvisStartSessionRequest): Promise<void>;
	runClusterFanout(request: JarvisFanoutRequest): Promise<void>;
	bootstrapClusterNode(request: JarvisBootstrapRequest): Promise<void>;
	createMissionFromTemplate(template: JarvisMissionTemplate, title?: string): Promise<JarvisMissionRecord>;
	decideProposal(proposal: JarvisProposalRecord, status: "approved" | "rejected", decision: string): Promise<void>;
	resolveOperatorRequest(
		request: JarvisOperatorRequestRecord,
		status: "approved" | "denied",
		responseJson: string | null,
		error: string | null,
		decision: string,
	): Promise<void>;
	promptOperatorRequestResponse(request: JarvisOperatorRequestRecord): Promise<string | null>;
	syncNodeAuth(node: string): Promise<void>;
	cordonNode(node: string): Promise<void>;
	uncordonNode(node: string): Promise<void>;
	reconcileNodes(): Promise<void>;
	runAutonomyReconcile(notify: boolean): Promise<JarvisAutonomyReconcileReport>;
	rotateCapsuleKey(): Promise<void>;
	dispatchOnce(): Promise<void>;
	runWorkerOffload(
		session: JarvisSessionMetadata,
		request: JarvisWorkerOffloadRequest,
	): Promise<JarvisWorkerOffloadResult>;
	readActivitySections(session: JarvisSessionMetadata, limit?: number): JarvisActivitySection[];
}
