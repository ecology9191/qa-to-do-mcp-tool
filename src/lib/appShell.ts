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
