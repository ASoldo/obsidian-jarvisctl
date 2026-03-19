import type {
	JarvisActivitySection,
	JarvisDashboardViewState,
	JarvisSessionMetadata,
} from "../types/domain";

export interface JarvisDashboardHost {
	state: JarvisDashboardViewState;
	selectNamespace(namespace: string): void;
	refresh(): Promise<void>;
	openDashboard(): Promise<void>;
	attach(session: JarvisSessionMetadata): Promise<void>;
	continueTicket(session: JarvisSessionMetadata): Promise<void>;
	freshTicket(session: JarvisSessionMetadata): Promise<void>;
	openTicket(session: JarvisSessionMetadata): Promise<void>;
	openTranscript(session: JarvisSessionMetadata): Promise<void>;
	tellAgent(session: JarvisSessionMetadata, agentName?: string): Promise<void>;
	copyAttach(session: JarvisSessionMetadata): Promise<void>;
	closeNamespace(session: JarvisSessionMetadata): Promise<void>;
	execAgent(session: JarvisSessionMetadata, agentName: string): Promise<void>;
	interruptAgent(session: JarvisSessionMetadata, agentName: string): Promise<void>;
	copyExec(session: JarvisSessionMetadata, agentName: string): Promise<void>;
	readActivitySections(session: JarvisSessionMetadata, limit?: number): JarvisActivitySection[];
}
