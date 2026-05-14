export type HealthState = 'ready' | 'needs-setup' | 'unknown';

export interface ConfigHealthItem {
  readonly id: 'mcp' | 'inbox' | 'tracker';
  readonly label: string;
  readonly state: HealthState;
  readonly summary: string;
}

export interface QaSessionSummary {
  id: string;
  title: string;
  repoName: string;
  parentIssueId: string;
  parentIssueTitle: string;
  tracker: 'beads' | 'scratch';
  warnings: string[];
  itemCount: number;
  archivedAt?: string;
  deletedAt?: string;
  items?: QaChecklistItem[];
}

export type QaChecklistStatus = 'pending' | 'passed' | 'failed' | 'failed-filed' | 'skipped';

export type QaChecklistHistoryAction =
  | 'manual-added'
  | 'passed'
  | 'unpassed'
  | 'failed'
  | 'failed-filed'
  | 'skipped'
  | 'edited'
  | 'soft-deleted'
  | 'restored';

export interface QaChecklistItem {
  id: string;
  title: string;
  originalTitle: string;
  steps: string[];
  originalSteps: string[];
  expectedResult: string;
  originalExpectedResult: string;
  sourceIssueId: string;
  sourceType?: 'generated' | 'manual';
  confidence: 'normal' | 'low';
  warnings: string[];
  sourceEvidence: SourceEvidence[];
  status: QaChecklistStatus;
  skipReason?: string;
  note?: string;
  deletedAt?: string;
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

export const emptyStateCommand = '/to-qa <parent or cumulative issue>';

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
        summary: 'This active session came from source work under the selected parent or cumulative issue.'
      }
    ]
  };
}
