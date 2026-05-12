import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createBeadsQaSessionFromParent, type BeadsIssue } from './beadsQa';
import { importQaSessionInboxEntries, type InboxImportResult } from './inboxImporter';
import { writeQaSessionInboxEntry } from './mcpInbox';
import type { ActiveQaSession, QaStorageRepository } from './qaStorage';

export interface ToQaBeadsOptions {
  readonly parentIssueId: string;
  readonly repoPath: string;
  readonly repoName?: string;
  readonly beadsIssuesPath?: string;
  readonly inboxDir: string;
  readonly processedDir: string;
  readonly quarantineDir: string;
  readonly repository: QaStorageRepository;
  readonly generatedAt?: string;
  readonly correlationId?: string;
}

export interface ToQaBeadsResult {
  readonly inboxEntryPath: string;
  readonly importResult: InboxImportResult;
  readonly activeSession: ActiveQaSession;
}

export async function runToQaForBeadsParent(options: ToQaBeadsOptions): Promise<ToQaBeadsResult> {
  const issues = await readBeadsIssues(options.beadsIssuesPath ?? join(options.repoPath, '.beads', 'issues.jsonl'));
  const payload = createBeadsQaSessionFromParent(
    options.parentIssueId,
    issues,
    {
      name: options.repoName ?? basename(options.repoPath),
      path: options.repoPath
    },
    options.generatedAt
  );
  const inboxEntryPath = await writeQaSessionInboxEntry(options.inboxDir, payload, {
    correlationId: options.correlationId
  });
  const importResult = await importQaSessionInboxEntries(
    [inboxEntryPath],
    options.repository,
    options.processedDir,
    options.quarantineDir
  );
  const activeSession = options.repository.getMostRecentActiveSession();

  if (!activeSession) {
    throw new Error('QA session inbox entry imported, but no active session was found in storage.');
  }

  return { inboxEntryPath, importResult, activeSession };
}

async function readBeadsIssues(path: string): Promise<BeadsIssue[]> {
  const jsonl = await readFile(path, 'utf8');
  return jsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BeadsIssue);
}
