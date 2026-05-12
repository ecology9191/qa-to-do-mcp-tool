export type HealthState = 'ready' | 'needs-setup' | 'unknown';

export interface ConfigHealthItem {
  readonly id: 'mcp' | 'inbox' | 'tracker';
  readonly label: string;
  readonly state: HealthState;
  readonly summary: string;
}

export interface QaSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly repoName: string;
  readonly parentIssueId: string;
  readonly parentIssueTitle: string;
  readonly tracker: 'beads';
  readonly warnings: readonly string[];
  readonly itemCount: number;
  readonly items?: readonly QaChecklistItem[];
}

export type QaChecklistStatus = 'pending' | 'passed' | 'failed' | 'skipped';

export type QaChecklistHistoryAction = 'passed' | 'unpassed' | 'failed' | 'skipped' | 'edited';

export interface QaChecklistItem {
  id: string;
  title: string;
  originalTitle: string;
  steps: string[];
  originalSteps: string[];
  expectedResult: string;
  originalExpectedResult: string;
  sourceIssueId: string;
  confidence: 'normal' | 'low';
  warnings: string[];
  sourceEvidence: SourceEvidence[];
  status: QaChecklistStatus;
  skipReason?: string;
  note?: string;
  failureEvidence?: FailureEvidence;
  history: QaChecklistHistoryEvent[];
}

export interface FailureEvidence {
  actualBehavior: string;
  screenshots: FailureScreenshot[];
}

export interface FailureScreenshot {
  name: string;
  mimeType: string;
  sizeBytes: number;
  localReference: string;
}

export interface QaChecklistHistoryEvent {
  action: QaChecklistHistoryAction;
  createdAt: string;
  detail?: string;
}

export interface SourceEvidence {
  readonly label: string;
  readonly value: string;
}

export interface AppShellState {
  readonly sessions: readonly QaSessionSummary[];
  readonly configHealth: readonly ConfigHealthItem[];
}

export const emptyStateCommand = '/to-qa <parent issue>';

export function createInitialShellState(): AppShellState {
  return {
    sessions: [],
    configHealth: [
      {
        id: 'mcp',
        label: 'MCP registration',
        state: 'unknown',
        summary: 'No app-managed secrets. Provider MCP setup will be checked by the installer.'
      },
      {
        id: 'inbox',
        label: 'Inbox writability',
        state: 'unknown',
        summary: 'Validated MCP messages will land in the local inbox when setup is applied.'
      },
      {
        id: 'tracker',
        label: 'Tracker readiness',
        state: 'unknown',
        summary: 'Beads or structured .scratch detection happens from the invoking repo.'
      }
    ]
  };
}

export function createShellStateFromActiveSession(session: QaSessionSummary): AppShellState {
  return {
    ...createInitialShellState(),
    sessions: [session],
    configHealth: [
      {
        id: 'mcp',
        label: 'MCP registration',
        state: 'ready',
        summary: 'A validated MCP inbox message has been received for this local app.'
      },
      {
        id: 'inbox',
        label: 'Inbox writability',
        state: 'ready',
        summary: 'The latest QA session was imported from the write-only MCP inbox.'
      },
      {
        id: 'tracker',
        label: 'Tracker readiness',
        state: 'ready',
        summary: 'This active session came from Beads child work under the selected parent issue.'
      }
    ]
  };
}
