import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FailureScreenshotReference, SourceEvidence } from './beadsFailureIssue';

export interface ScratchFailureIssueContext {
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

export interface ScratchFailureIssueDraft {
  readonly id: string;
  readonly title: string;
  readonly markdown: string;
  readonly labels: readonly ['needs-triage', 'bug'];
  readonly dedupeFingerprint: string;
  readonly discoveredFromIssueId: string;
  readonly copyableIssueText: string;
}

export type ConfirmScratchFailureIssueResult =
  | {
      readonly status: 'created' | 'updated';
      readonly issueId: string;
      readonly issuePath: string;
      readonly discoveredFromIssueId: string;
    }
  | {
      readonly status: 'failed';
      readonly errorMessage: string;
      readonly recoveryGuidance: string;
      readonly copyableIssueText: string;
    };

export interface ConfirmScratchFailureIssueOptions {
  readonly createdAt?: string;
}

const failureLabels = ['needs-triage', 'bug'] as const;

export function draftScratchFailureIssue(context: ScratchFailureIssueContext): ScratchFailureIssueDraft {
  const actualBehavior = context.actualBehavior.trim();
  if (actualBehavior.length === 0) {
    throw new Error('Actual behavior is required before drafting a failure issue.');
  }

  const discoveredFromIssueId = context.item.sourceIssueId?.trim() || context.parentIssue.id;
  const dedupeFingerprint = `qa-failure:${context.repo.path}:${context.parentIssue.id}:${context.item.fingerprint}`;
  const id = `qa-failure-${sanitizePathSegment(context.parentIssue.id)}-${sanitizePathSegment(context.item.fingerprint)}`;
  const title = `Bug: ${context.item.title}`;
  const markdown = createFailureMarkdown(context, id, title, actualBehavior, dedupeFingerprint, discoveredFromIssueId);

  return {
    id,
    title,
    markdown,
    labels: failureLabels,
    dedupeFingerprint,
    discoveredFromIssueId,
    copyableIssueText: markdown
  };
}

export async function confirmScratchFailureIssueDraft(
  draft: ScratchFailureIssueDraft,
  scratchDir: string,
  _options: ConfirmScratchFailureIssueOptions = {}
): Promise<ConfirmScratchFailureIssueResult> {
  try {
    await mkdir(scratchDir, { recursive: true });
    const existingPath = await findIssueByFingerprint(scratchDir, draft.dedupeFingerprint);
    const issuePath = existingPath ?? join(scratchDir, `${draft.id}.md`);
    await writeFile(issuePath, `${draft.markdown.trimEnd()}\n`);

    return {
      status: existingPath ? 'updated' : 'created',
      issueId: draft.id,
      issuePath,
      discoveredFromIssueId: draft.discoveredFromIssueId
    };
  } catch (error) {
    return {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      recoveryGuidance: `Writing the structured .scratch failure issue failed. Retry confirmation after .scratch is writable, or copy the returned markdown into ${scratchDir}/${draft.id}.md.`,
      copyableIssueText: draft.copyableIssueText
    };
  }
}

function createFailureMarkdown(
  context: ScratchFailureIssueContext,
  id: string,
  title: string,
  actualBehavior: string,
  dedupeFingerprint: string,
  discoveredFromIssueId: string
): string {
  const steps = formatMarkdownList(context.item.steps, (step) => step);
  const sourceEvidence = formatMarkdownList(
    context.item.sourceEvidence,
    (evidence) => `${evidence.label}: ${evidence.value}`
  );
  const screenshots = formatScreenshotReferences(context.screenshots);

  return `---
id: ${id}
title: ${title}
type: bug
status: open
parent: ${discoveredFromIssueId}
labels: ${failureLabels.join(', ')}
qaFailureFingerprint: ${dedupeFingerprint}
---

## QA failure

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

function formatScreenshotReferences(screenshots: readonly FailureScreenshotReference[]): string {
  if (screenshots.length === 0) {
    return '- None attached';
  }

  return formatMarkdownList(
    screenshots,
    (screenshot) => `${screenshot.name} (${screenshot.mimeType}, ${screenshot.sizeBytes} bytes): ${screenshot.localReference}`
  );
}

function formatMarkdownList<T>(items: readonly T[], formatItem: (item: T) => string): string {
  return items.map((item) => `- ${formatItem(item)}`).join('\n');
}

async function findIssueByFingerprint(scratchDir: string, fingerprint: string): Promise<string | undefined> {
  const markdownFiles = await listMarkdownFiles(scratchDir);
  for (const filePath of markdownFiles) {
    const markdown = await readFile(filePath, 'utf8');
    if (markdown.includes(`qaFailureFingerprint: ${fingerprint}`) || markdown.includes(`QA-Failure-Fingerprint: ${fingerprint}`)) {
      return filePath;
    }
  }
  return undefined;
}

async function listMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(path);
      if (entry.isFile() && entry.name.endsWith('.md')) return [path];
      return [];
    })
  );
  return files.flat();
}

function sanitizePathSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized : 'issue';
}
