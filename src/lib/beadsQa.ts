import { qaSessionSchemaVersion, type QaSessionPayload, type SourceEvidence } from './qaSession';

export interface BeadsIssue {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly status: string;
  readonly priority?: number;
  readonly updated_at?: string;
  readonly closed_at?: string;
  readonly close_reason?: string;
  readonly dependencies?: readonly BeadsDependency[];
}

export interface BeadsDependency {
  readonly issue_id: string;
  readonly depends_on_id: string;
  readonly type: string;
}

export interface RepoContext {
  readonly name: string;
  readonly path: string;
}

export class NoCompletedSourceWorkError extends Error {
  constructor(parentIssueId: string) {
    super(`Parent issue ${parentIssueId} has no closed or completed Beads child work to convert into QA.`);
    this.name = 'NoCompletedSourceWorkError';
  }
}

export function createBeadsQaSessionFromParent(
  parentIssueId: string,
  issues: readonly BeadsIssue[],
  repo: RepoContext,
  generatedAt = new Date().toISOString()
): QaSessionPayload {
  const parent = issues.find((issue) => issue.id === parentIssueId);
  if (!parent) {
    throw new Error(`Parent issue ${parentIssueId} was not found.`);
  }

  const children = issues.filter((issue) =>
    issue.dependencies?.some(
      (dependency) => dependency.type === 'parent-child' && dependency.depends_on_id === parentIssueId
    )
  );
  const completedChildren = children.filter((issue) => isCompletedStatus(issue.status));
  const incompleteChildren = children.filter((issue) => !isCompletedStatus(issue.status));

  if (completedChildren.length === 0) {
    throw new NoCompletedSourceWorkError(parentIssueId);
  }

  const incompleteWarning =
    incompleteChildren.length > 0
      ? [
          `${incompleteChildren.length} incomplete child issue(s) were excluded from QA: ${incompleteChildren
            .map((issue) => `${issue.id} (${issue.status})`)
            .join(', ')}`
        ]
      : [];

  const items = completedChildren.map((child) => {
    const acceptanceCriteria = extractAcceptanceCriteria(child.description ?? '');
    const lowConfidenceWarnings =
      acceptanceCriteria.length === 0
        ? [`${child.id} has no explicit acceptance criteria; QA check was inferred from the issue title.`]
        : [];
    const behavior = acceptanceCriteria[0] ?? child.title;

    return {
      id: `beads-${child.id}`,
      title: `Verify ${child.title}`,
      steps: [
        `Open the application area affected by Beads issue ${child.id}.`,
        `Exercise the completed behavior: ${behavior}`,
        `Compare the visible result with the source issue evidence before marking the item passed.`
      ],
      expectedResult: acceptanceCriteria.length > 0 ? acceptanceCriteria.join(' ') : `The completed behavior for ${child.title} is visible and usable by a human reviewer.`,
      fingerprint: `beads:${repo.path}:${parentIssueId}:${child.id}`,
      sourceIssueId: child.id,
      sourceEvidence: createSourceEvidence(child),
      confidence: acceptanceCriteria.length > 0 ? 'normal' : 'low',
      warnings: lowConfidenceWarnings
    } as const;
  });

  const lowConfidenceWarnings = items.flatMap((item) => item.warnings);

  return {
    schemaVersion: qaSessionSchemaVersion,
    title: `${repo.name} ${parent.id} QA`,
    generatedAt,
    source: {
      tracker: 'beads',
      repo,
      parentIssue: {
        id: parent.id,
        title: parent.title,
        status: parent.status
      },
      sourceIssues: completedChildren.map((child) => ({
        id: child.id,
        title: child.title,
        status: child.status,
        priority: child.priority,
        closedAt: child.closed_at,
        evidence: createSourceEvidence(child)
      })),
      sessionEvidence: [
        { label: 'Parent issue', value: `${parent.id}: ${parent.title}` },
        { label: 'Completed Beads children', value: completedChildren.map((child) => child.id).join(', ') }
      ]
    },
    warnings: [...incompleteWarning, ...lowConfidenceWarnings],
    items
  };
}

function isCompletedStatus(status: string): boolean {
  return ['closed', 'completed', 'done'].includes(status.toLowerCase());
}

function createSourceEvidence(issue: BeadsIssue): SourceEvidence[] {
  const evidence: SourceEvidence[] = [
    { label: 'Source issue', value: `${issue.id}: ${issue.title}` },
    { label: 'Status', value: issue.status }
  ];

  if (typeof issue.priority === 'number') {
    evidence.push({ label: 'Priority', value: String(issue.priority) });
  }

  if (issue.close_reason) {
    evidence.push({ label: 'Close reason', value: issue.close_reason });
  }

  const acceptanceCriteria = extractAcceptanceCriteria(issue.description ?? '');
  if (acceptanceCriteria.length > 0) {
    evidence.push({ label: 'Acceptance criteria', value: acceptanceCriteria.join(' ') });
  }

  return evidence;
}

function extractAcceptanceCriteria(description: string): string[] {
  const lines = description.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s+Acceptance criteria/i.test(line.trim()));

  if (headingIndex === -1) {
    return [];
  }

  const criteria: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed)) {
      break;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (bullet) {
      criteria.push(bullet[1].trim());
    }
  }

  return criteria;
}
