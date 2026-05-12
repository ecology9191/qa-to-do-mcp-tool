import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createBeadsQaSessionFromParent, type BeadsIssue } from './beadsQa';
import { importQaSessionInboxEntries, type InboxImportResult } from './inboxImporter';
import { writeQaSessionInboxEntry } from './mcpInbox';
import type { ActiveQaSession, QaStorageRepository, QaTracker } from './qaStorage';
import { createScratchQaSessionFromParent, readScratchIssues } from './scratchQa';

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

export interface ToQaScratchOptions {
  readonly parentIssueId: string;
  readonly repoPath: string;
  readonly repoName?: string;
  readonly scratchDir?: string;
  readonly inboxDir: string;
  readonly processedDir: string;
  readonly quarantineDir: string;
  readonly repository: QaStorageRepository;
  readonly generatedAt?: string;
  readonly correlationId?: string;
}

export type ToQaScratchResult = ToQaBeadsResult;

export interface TrackerChoiceRequest {
  readonly repoPath: string;
  readonly detectedTrackers: readonly QaTracker[];
}

export interface ToQaOptions extends Omit<ToQaBeadsOptions, 'beadsIssuesPath'> {
  readonly beadsIssuesPath?: string;
  readonly scratchDir?: string;
  readonly chooseTracker?: (request: TrackerChoiceRequest) => QaTracker | Promise<QaTracker>;
}

export type ToQaResult = ToQaBeadsResult;

export class TrackerChoiceRequiredError extends Error {
  constructor(repoPath: string, detectedTrackers: readonly QaTracker[]) {
    super(
      `Multiple supported trackers were detected in ${repoPath}: ${detectedTrackers.join(', ')}. Choose which tracker /to-qa should use for this repo.`
    );
    this.name = 'TrackerChoiceRequiredError';
  }
}

export class NoSupportedTrackerDetectedError extends Error {
  constructor(repoPath: string) {
    super(`No supported tracker was detected in ${repoPath}. Expected Beads .beads/issues.jsonl or structured .scratch markdown.`);
    this.name = 'NoSupportedTrackerDetectedError';
  }
}

export async function runToQaForParent(options: ToQaOptions): Promise<ToQaResult> {
  const detectedTrackers = await detectSupportedTrackers(options);
  const tracker = await chooseRepoTracker(options, detectedTrackers);

  if (tracker === 'scratch') {
    return runToQaForScratchParent(options);
  }

  return runToQaForBeadsParent(options);
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

export async function runToQaForScratchParent(options: ToQaScratchOptions): Promise<ToQaScratchResult> {
  const issues = await readScratchIssues(options.scratchDir ?? join(options.repoPath, '.scratch'));
  const payload = createScratchQaSessionFromParent(
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

async function detectSupportedTrackers(options: ToQaOptions): Promise<QaTracker[]> {
  const detectedTrackers: QaTracker[] = [];
  if (await pathExists(options.beadsIssuesPath ?? join(options.repoPath, '.beads', 'issues.jsonl'))) {
    detectedTrackers.push('beads');
  }
  if (await pathExists(options.scratchDir ?? join(options.repoPath, '.scratch'))) {
    detectedTrackers.push('scratch');
  }
  return detectedTrackers;
}

async function chooseRepoTracker(options: ToQaOptions, detectedTrackers: readonly QaTracker[]): Promise<QaTracker> {
  if (detectedTrackers.length === 0) {
    throw new NoSupportedTrackerDetectedError(options.repoPath);
  }

  const rememberedTracker = options.repository.getRepoTrackerPreference(options.repoPath);
  if (rememberedTracker && detectedTrackers.includes(rememberedTracker)) {
    return rememberedTracker;
  }

  if (detectedTrackers.length === 1) {
    const tracker = detectedTrackers[0];
    options.repository.setRepoTrackerPreference(options.repoPath, tracker);
    return tracker;
  }

  if (!options.chooseTracker) {
    throw new TrackerChoiceRequiredError(options.repoPath, detectedTrackers);
  }

  const tracker = await options.chooseTracker({ repoPath: options.repoPath, detectedTrackers });
  if (!detectedTrackers.includes(tracker)) {
    throw new Error(`Selected tracker ${tracker} was not detected in ${options.repoPath}.`);
  }
  options.repository.setRepoTrackerPreference(options.repoPath, tracker);
  return tracker;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
