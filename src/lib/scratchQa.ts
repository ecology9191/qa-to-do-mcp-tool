import { readFile } from 'node:fs/promises';
import { qaSessionSchemaVersion, type QaSessionPayload, type SourceEvidence } from './qaSession';
import type { RepoContext } from './beadsQa';
import { listScratchMarkdownFiles, sanitizeScratchPathSegment } from './scratchFiles';

export interface ScratchIssue {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly parent?: string;
  readonly acceptanceNotes?: readonly string[];
  readonly filePath?: string;
}

export class ScratchSetupGuidanceError extends Error {
  constructor(filePath: string) {
    super(
      `Use structured .scratch issue markdown for ${filePath}: add YAML frontmatter with id, title, status, optional parent, then a ## Acceptance notes or ## Acceptance criteria heading with bullet points for completed child work.`
    );
    this.name = 'ScratchSetupGuidanceError';
  }
}

export class NoCompletedScratchSourceWorkError extends Error {
  constructor(parentIssueId: string) {
    super(`Parent issue ${parentIssueId} has no closed or completed .scratch child work to convert into QA.`);
    this.name = 'NoCompletedScratchSourceWorkError';
  }
}

export async function readScratchIssues(scratchDir: string): Promise<ScratchIssue[]> {
  const markdownFiles = (await listScratchMarkdownFiles(scratchDir)).sort();
  const issues: ScratchIssue[] = [];

  for (const filePath of markdownFiles) {
    issues.push(parseScratchIssueMarkdown(filePath, await readFile(filePath, 'utf8')));
  }

  return issues;
}

export function createScratchQaSessionFromParent(
  parentIssueId: string,
  issues: readonly ScratchIssue[],
  repo: RepoContext,
  generatedAt = new Date().toISOString()
): QaSessionPayload {
  const parent = issues.find((issue) => issue.id === parentIssueId);
  if (!parent) {
    throw new Error(`Parent issue ${parentIssueId} was not found.`);
  }

  const children = issues.filter((issue) => issue.parent === parentIssueId);
  const completedChildren = children.filter((issue) => isCompletedStatus(issue.status));
  const incompleteChildren = children.filter((issue) => !isCompletedStatus(issue.status));

  if (completedChildren.length === 0) {
    throw new NoCompletedScratchSourceWorkError(parentIssueId);
  }

  const completedChildWork = completedChildren.map((issue) => ({
    issue,
    acceptanceNotes: issue.acceptanceNotes ?? []
  }));
  const incompleteWarning = createIncompleteChildrenWarning(incompleteChildren);

  const items = completedChildWork.map(({ issue: child, acceptanceNotes }) => {
    const hasAcceptanceNotes = acceptanceNotes.length > 0;
    const lowConfidenceWarnings = !hasAcceptanceNotes
      ? [`${child.id} has no explicit acceptance notes; QA check was inferred from the issue title.`]
      : [];
    const behavior = acceptanceNotes[0] ?? child.title;
    const expectedResult = hasAcceptanceNotes
      ? acceptanceNotes.join(' ')
      : `The completed behavior for ${child.title} is visible and usable by a human reviewer.`;

    return {
      id: `scratch-${sanitizeScratchPathSegment(child.id)}`,
      title: `Verify ${child.title}`,
      steps: [
        `Open the application area affected by .scratch issue ${child.id}.`,
        `Exercise the completed behavior: ${behavior}`,
        `Compare the visible result with the structured .scratch source evidence before marking the item passed.`
      ],
      expectedResult,
      fingerprint: `scratch:${repo.path}:${parentIssueId}:${child.id}`,
      sourceIssueId: child.id,
      sourceEvidence: createSourceEvidence(child, acceptanceNotes),
      confidence: hasAcceptanceNotes ? 'normal' : 'low',
      warnings: lowConfidenceWarnings
    } as const;
  });

  const lowConfidenceWarnings = items.flatMap((item) => item.warnings);

  return {
    schemaVersion: qaSessionSchemaVersion,
    title: `${repo.name} ${parent.id} QA`,
    generatedAt,
    source: {
      tracker: 'scratch',
      repo,
      parentIssue: {
        id: parent.id,
        title: parent.title,
        status: parent.status
      },
      sourceIssues: completedChildWork.map(({ issue: child, acceptanceNotes }) => ({
        id: child.id,
        title: child.title,
        status: child.status,
        evidence: createSourceEvidence(child, acceptanceNotes)
      })),
      sessionEvidence: [
        { label: 'Parent issue', value: `${parent.id}: ${parent.title}` },
        { label: 'Completed .scratch children', value: completedChildren.map((child) => child.id).join(', ') }
      ]
    },
    warnings: [...incompleteWarning, ...lowConfidenceWarnings],
    items
  };
}

function parseScratchIssueMarkdown(filePath: string, markdown: string): ScratchIssue {
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatterMatch) {
    throw new ScratchSetupGuidanceError(filePath);
  }

  const frontmatter = parseFrontmatter(frontmatterMatch[1]);
  const id = frontmatter.id?.trim();
  const title = frontmatter.title?.trim();
  const status = frontmatter.status?.trim();
  if (!id || !title || !status) {
    throw new ScratchSetupGuidanceError(filePath);
  }

  return {
    id,
    title,
    status,
    ...(frontmatter.parent?.trim() ? { parent: frontmatter.parent.trim() } : {}),
    acceptanceNotes: extractAcceptanceNotes(markdown.slice(frontmatterMatch[0].length)),
    filePath
  };
}

function parseFrontmatter(frontmatter: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (match) {
      values[match[1]] = stripQuotes(match[2].trim());
    }
  }
  return values;
}

function stripQuotes(value: string): string {
  const quote = value[0];
  return (quote === '"' || quote === "'") && value[value.length - 1] === quote ? value.slice(1, -1) : value;
}

function extractAcceptanceNotes(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s+(Acceptance notes|Acceptance criteria)/i.test(line.trim()));
  if (headingIndex === -1) {
    return [];
  }

  const notes: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();
    if (/^##\s+/.test(trimmed)) break;
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (bullet) {
      notes.push(bullet[1].trim());
    }
  }
  return notes;
}

function isCompletedStatus(status: string): boolean {
  return ['closed', 'completed', 'done'].includes(status.toLowerCase());
}

function createIncompleteChildrenWarning(incompleteChildren: readonly ScratchIssue[]): string[] {
  if (incompleteChildren.length === 0) {
    return [];
  }

  const issueSummaries = incompleteChildren.map((issue) => `${issue.id} (${issue.status})`).join(', ');
  return [`${incompleteChildren.length} incomplete child issue(s) were excluded from QA: ${issueSummaries}`];
}

function createSourceEvidence(issue: ScratchIssue, acceptanceNotes: readonly string[]): SourceEvidence[] {
  const evidence: SourceEvidence[] = [
    { label: 'Source issue', value: `${issue.id}: ${issue.title}` },
    { label: 'Status', value: issue.status }
  ];

  if (issue.filePath) {
    evidence.push({ label: '.scratch file', value: issue.filePath });
  }

  if (acceptanceNotes.length > 0) {
    evidence.push({ label: 'Acceptance notes', value: acceptanceNotes.join(' ') });
  }

  return evidence;
}
