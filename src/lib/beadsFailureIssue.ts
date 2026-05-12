import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export interface BeadsFailureIssueContext {
  readonly repo: {
    readonly name: string;
    readonly path: string;
  };
  readonly parentIssue: {
    readonly id: string;
    readonly title: string;
  };
  readonly item: {
    readonly id: string;
    readonly title: string;
    readonly steps: readonly string[];
    readonly expectedResult: string;
    readonly fingerprint: string;
    readonly sourceIssueId?: string;
    readonly sourceEvidence: readonly SourceEvidence[];
  };
  readonly actualBehavior: string;
  readonly screenshots: readonly FailureScreenshotReference[];
}

export interface SourceEvidence {
  readonly label: string;
  readonly value: string;
}

export interface FailureScreenshotReference {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly localReference: string;
}

export interface BeadsFailureIssueDraft {
  readonly title: string;
  readonly description: string;
  readonly issueType: 'bug';
  readonly labels: readonly ['needs-triage', 'bug'];
  readonly dedupeFingerprint: string;
  readonly discoveredFromIssueId: string;
  readonly copyableIssueText: string;
}

export interface BeadsFailureIssueMutation {
  readonly title: string;
  readonly description: string;
  readonly issueType: 'bug';
  readonly labels: readonly ['needs-triage', 'bug'];
  readonly dedupeFingerprint: string;
}

export interface ExistingBeadsFailureIssue {
  readonly id: string;
  readonly status: string;
}

export interface BeadsFailureIssueTracker {
  findIssueByFingerprint(fingerprint: string): Promise<ExistingBeadsFailureIssue | undefined>;
  createIssue(issue: BeadsFailureIssueMutation): Promise<{ readonly id: string }>;
  updateIssue(issueId: string, issue: BeadsFailureIssueMutation): Promise<void>;
  linkIssue(issueId: string, targetIssueId: string, relationType: 'discovered-from'): Promise<void>;
}

export type ConfirmBeadsFailureIssueResult =
  | {
      readonly status: 'created' | 'updated';
      readonly issueId: string;
      readonly discoveredFromIssueId: string;
    }
  | {
      readonly status: 'failed';
      readonly errorMessage: string;
      readonly draftPath: string;
      readonly recoveryGuidance: string;
      readonly copyableIssueText: string;
    };

export interface ConfirmBeadsFailureIssueOptions {
  readonly failedDraftsDir?: string;
  readonly attemptedAt?: string;
}

const failureLabels = ['needs-triage', 'bug'] as const;
const execFileAsync = promisify(execFile);

export class BdCliFailureIssueTracker implements BeadsFailureIssueTracker {
  constructor(
    private readonly repoPath: string,
    private readonly bdBinary = 'bd'
  ) {}

  async findIssueByFingerprint(fingerprint: string): Promise<ExistingBeadsFailureIssue | undefined> {
    const { stdout } = await execFileAsync(this.bdBinary, [
      '--directory',
      this.repoPath,
      'list',
      '--all',
      '--limit',
      '0',
      '--json'
    ]);
    const issues = JSON.parse(stdout || '[]') as unknown;

    if (!Array.isArray(issues)) {
      return undefined;
    }

    const match = issues.find((issue) => issueMatchesFingerprint(issue, fingerprint));
    if (!isRecord(match) || typeof match.id !== 'string') {
      return undefined;
    }

    return { id: match.id, status: typeof match.status === 'string' ? match.status : 'unknown' };
  }

  async createIssue(issue: BeadsFailureIssueMutation): Promise<{ readonly id: string }> {
    const output = await this.#withBodyFile(issue.description, (bodyFile) =>
      execFileAsync(this.bdBinary, [
        '--directory',
        this.repoPath,
        'create',
        issue.title,
        '--type',
        issue.issueType,
        '--labels',
        issue.labels.join(','),
        '--metadata',
        JSON.stringify({ qaFailureFingerprint: issue.dedupeFingerprint }),
        '--body-file',
        bodyFile,
        '--silent'
      ])
    );
    const id = output.stdout.trim();
    if (id.length === 0) {
      throw new Error('bd create did not return an issue id.');
    }
    return { id };
  }

  async updateIssue(issueId: string, issue: BeadsFailureIssueMutation): Promise<void> {
    await this.#withBodyFile(issue.description, (bodyFile) =>
      execFileAsync(this.bdBinary, [
        '--directory',
        this.repoPath,
        'update',
        issueId,
        '--title',
        issue.title,
        '--type',
        issue.issueType,
        '--set-labels',
        issue.labels.join(','),
        '--set-metadata',
        `qaFailureFingerprint=${issue.dedupeFingerprint}`,
        '--body-file',
        bodyFile
      ])
    );
  }

  async linkIssue(issueId: string, targetIssueId: string, relationType: 'discovered-from'): Promise<void> {
    await execFileAsync(this.bdBinary, [
      '--directory',
      this.repoPath,
      'dep',
      'add',
      issueId,
      targetIssueId,
      '--type',
      relationType
    ]);
  }

  async #withBodyFile<T>(description: string, action: (bodyFile: string) => Promise<T>): Promise<T> {
    const directory = await mkdtemp(join(tmpdir(), 'qa-failure-body-'));
    const bodyFile = join(directory, 'body.md');
    try {
      await writeFile(bodyFile, `${description}\n`);
      return await action(bodyFile);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function draftBeadsFailureIssue(context: BeadsFailureIssueContext): BeadsFailureIssueDraft {
  const actualBehavior = context.actualBehavior.trim();
  if (actualBehavior.length === 0) {
    throw new Error('Actual behavior is required before drafting a failure issue.');
  }

  const discoveredFromIssueId = context.item.sourceIssueId?.trim() || context.parentIssue.id;
  const dedupeFingerprint = `qa-failure:${context.repo.path}:${context.parentIssue.id}:${context.item.fingerprint}`;
  const title = `Bug: ${context.item.title}`;
  const description = createFailureDescription(context, actualBehavior, dedupeFingerprint, discoveredFromIssueId);
  const copyableIssueText = createCopyableIssueText(title, description, discoveredFromIssueId);

  return {
    title,
    description,
    issueType: 'bug',
    labels: failureLabels,
    dedupeFingerprint,
    discoveredFromIssueId,
    copyableIssueText
  };
}

export async function confirmBeadsFailureIssueDraft(
  draft: BeadsFailureIssueDraft,
  tracker: BeadsFailureIssueTracker,
  options: ConfirmBeadsFailureIssueOptions = {}
): Promise<ConfirmBeadsFailureIssueResult> {
  try {
    const existingIssue = await tracker.findIssueByFingerprint(draft.dedupeFingerprint);
    const mutation = toMutation(draft);

    if (existingIssue) {
      await tracker.updateIssue(existingIssue.id, mutation);
      await tracker.linkIssue(existingIssue.id, draft.discoveredFromIssueId, 'discovered-from');
      return { status: 'updated', issueId: existingIssue.id, discoveredFromIssueId: draft.discoveredFromIssueId };
    }

    const createdIssue = await tracker.createIssue(mutation);
    await tracker.linkIssue(createdIssue.id, draft.discoveredFromIssueId, 'discovered-from');
    return { status: 'created', issueId: createdIssue.id, discoveredFromIssueId: draft.discoveredFromIssueId };
  } catch (error) {
    const attemptedAt = options.attemptedAt ?? new Date().toISOString();
    const draftPath = await preserveFailedDraft(options.failedDraftsDir ?? '.qa-to-do/failed-drafts', draft, attemptedAt, error);

    return {
      status: 'failed',
      errorMessage: errorMessage(error),
      draftPath,
      recoveryGuidance: `Beads mutation failed. Retry confirmation after Beads is available, or copy the preserved issue text from ${draftPath} and file it manually with labels needs-triage and bug plus discovered-from: ${draft.discoveredFromIssueId}.`,
      copyableIssueText: draft.copyableIssueText
    };
  }
}

function createFailureDescription(
  context: BeadsFailureIssueContext,
  actualBehavior: string,
  dedupeFingerprint: string,
  discoveredFromIssueId: string
): string {
  const steps = context.item.steps.map((step) => `- ${step}`).join('\n');
  const sourceEvidence = context.item.sourceEvidence.map((evidence) => `- ${evidence.label}: ${evidence.value}`).join('\n');
  const screenshots =
    context.screenshots.length > 0
      ? context.screenshots
          .map((screenshot) => `- ${screenshot.name} (${screenshot.mimeType}, ${screenshot.sizeBytes} bytes): ${screenshot.localReference}`)
          .join('\n')
      : '- None attached';

  return `## QA failure

Repository: ${context.repo.name} (${context.repo.path})
Parent issue: ${context.parentIssue.id}: ${context.parentIssue.title}
Discovered from: ${discoveredFromIssueId}
QA item: ${context.item.id}: ${context.item.title}

## Steps

${steps}

## Expected result

${context.item.expectedResult}

## Actual behavior

${actualBehavior}

## Source evidence

${sourceEvidence}

## Screenshots

${screenshots}

QA-Failure-Fingerprint: ${dedupeFingerprint}`;
}

function createCopyableIssueText(title: string, description: string, discoveredFromIssueId: string): string {
  return `Title: ${title}
Type: bug
Labels: ${failureLabels.join(', ')}
Relation: discovered-from: ${discoveredFromIssueId}

${description}`;
}

function toMutation(draft: BeadsFailureIssueDraft): BeadsFailureIssueMutation {
  return {
    title: draft.title,
    description: draft.description,
    issueType: draft.issueType,
    labels: draft.labels,
    dedupeFingerprint: draft.dedupeFingerprint
  };
}

async function preserveFailedDraft(
  failedDraftsDir: string,
  draft: BeadsFailureIssueDraft,
  attemptedAt: string,
  error: unknown
): Promise<string> {
  await mkdir(failedDraftsDir, { recursive: true });
  const draftPath = join(failedDraftsDir, `${sanitizePathSegment(attemptedAt)}-${sanitizePathSegment(draft.dedupeFingerprint)}.json`);
  await writeFile(
    draftPath,
    `${JSON.stringify({ attemptedAt, errorMessage: errorMessage(error), draft }, null, 2)}\n`,
    { flag: 'wx' }
  );
  return draftPath;
}

function sanitizePathSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
  return normalized.length > 0 ? normalized : 'unnamed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function issueMatchesFingerprint(issue: unknown, fingerprint: string): boolean {
  if (!isRecord(issue)) {
    return false;
  }

  if (typeof issue.description === 'string' && issue.description.includes(`QA-Failure-Fingerprint: ${fingerprint}`)) {
    return true;
  }

  return isRecord(issue.metadata) && issue.metadata.qaFailureFingerprint === fingerprint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
