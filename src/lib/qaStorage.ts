import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, join } from 'node:path';
import type { QaSessionPayload, SourceEvidence } from './qaSession';

export interface ActiveQaSession {
  readonly id: string;
  readonly title: string;
  readonly repoName: string;
  readonly repoPath: string;
  readonly parentIssueId: string;
  readonly parentIssueTitle: string;
  readonly tracker: 'beads';
  readonly generatedAt: string;
  readonly archivedAt?: string;
  readonly warnings: readonly string[];
  readonly sourceEvidence: readonly SourceEvidence[];
  readonly items: readonly ActiveQaItem[];
}

export interface ActiveQaItem {
  readonly id: string;
  readonly title: string;
  readonly originalTitle: string;
  readonly steps: readonly string[];
  readonly originalSteps: readonly string[];
  readonly expectedResult: string;
  readonly originalExpectedResult: string;
  readonly sourceIssueId: string;
  readonly sourceType: 'generated' | 'manual';
  readonly fingerprint: string;
  readonly confidence: 'normal' | 'low';
  readonly warnings: readonly string[];
  readonly sourceEvidence: readonly SourceEvidence[];
  readonly status: QaItemStatus;
  readonly skipReason?: string;
  readonly note?: string;
  readonly screenshots: readonly FailureScreenshot[];
  readonly history: readonly QaItemHistoryEvent[];
}

export type QaItemStatus = 'pending' | 'passed' | 'failed' | 'failed-filed' | 'skipped';

type QaItemHistoryAction =
  | 'manual-added'
  | 'passed'
  | 'unpassed'
  | 'failed'
  | 'failed-filed'
  | 'skipped'
  | 'edited'
  | 'soft-deleted'
  | 'restored';

export interface QaItemHistoryEvent {
  readonly action: QaItemHistoryAction;
  readonly createdAt: string;
  readonly detail?: string;
}

export interface QaItemEdit {
  readonly title: string;
  readonly steps: readonly string[];
  readonly expectedResult: string;
  readonly note?: string;
}

export interface ManualQaItemInput {
  readonly title: string;
  readonly steps: readonly string[];
  readonly expectedResult: string;
  readonly note?: string;
}

export interface FailureScreenshotInput {
  readonly sourcePath: string;
  readonly originalName?: string;
  readonly mimeType: string;
}

export interface FailureScreenshot {
  readonly id: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly localPath: string;
  readonly localReference: string;
  readonly capturedAt: string;
}

interface ScreenshotStorageLocation {
  readonly targetDirectory: string;
  readonly localPath: string;
  readonly localReference: string;
}

const manualItemSourceIssueId = 'manual';
const manualItemHistoryDetail = 'Manual QA item added';

export class QaStorageRepository {
  readonly #database: DatabaseSync;
  readonly #storageRoot: string;

  constructor(databasePath = ':memory:', storageRoot = '.qa-to-do') {
    this.#database = new DatabaseSync(databasePath);
    this.#storageRoot = storageRoot;
    this.#database.exec('PRAGMA foreign_keys = ON');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS qa_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        tracker TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        parent_issue_id TEXT NOT NULL,
        parent_issue_title TEXT NOT NULL,
        parent_issue_status TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        source_evidence_json TEXT NOT NULL,
        raw_payload_json TEXT NOT NULL,
        archived_at TEXT,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS qa_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        original_title TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        original_steps_json TEXT NOT NULL,
        expected_result TEXT NOT NULL,
        original_expected_result TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        source_issue_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'generated',
        confidence TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        source_evidence_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        skip_reason TEXT,
        note TEXT,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS qa_item_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL REFERENCES qa_items(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS qa_item_screenshots (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES qa_items(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        local_path TEXT NOT NULL,
        local_reference TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
    `);
    this.#ensureColumn('qa_sessions', 'deleted_at', 'TEXT');
    this.#ensureColumn('qa_items', 'source_type', `TEXT NOT NULL DEFAULT 'generated'`);
    this.#ensureColumn('qa_items', 'deleted_at', 'TEXT');
  }

  importSession(payload: QaSessionPayload, importedAt = new Date().toISOString()): string {
    const sessionId = createSessionId(payload);
    const insertSession = this.#database.prepare(`
      INSERT OR REPLACE INTO qa_sessions (
        id, title, tracker, repo_name, repo_path, parent_issue_id, parent_issue_title, parent_issue_status,
        generated_at, imported_at, warnings_json, source_evidence_json, raw_payload_json, archived_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `);
    const insertItem = this.#database.prepare(`
      INSERT OR IGNORE INTO qa_items (
        id, session_id, title, original_title, steps_json, original_steps_json, expected_result, original_expected_result,
        fingerprint, source_issue_id, source_type, confidence, warnings_json, source_evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.#database.exec('BEGIN');
    try {
      insertSession.run(
        sessionId,
        payload.title,
        payload.source.tracker,
        payload.source.repo.name,
        payload.source.repo.path,
        payload.source.parentIssue.id,
        payload.source.parentIssue.title,
        payload.source.parentIssue.status,
        payload.generatedAt,
        importedAt,
        JSON.stringify(payload.warnings),
        JSON.stringify(payload.source.sessionEvidence),
        JSON.stringify(payload)
      );

      for (const item of payload.items) {
        insertItem.run(
          item.id,
          sessionId,
          item.title,
          item.title,
          JSON.stringify(item.steps),
          JSON.stringify(item.steps),
          item.expectedResult,
          item.expectedResult,
          item.fingerprint,
          item.sourceIssueId,
          'generated',
          item.confidence,
          JSON.stringify(item.warnings),
          JSON.stringify(item.sourceEvidence)
        );
      }
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
    return sessionId;
  }

  addManualItem(sessionId: string, item: ManualQaItemInput, createdAt = new Date().toISOString()): string {
    const title = item.title.trim();
    const steps = item.steps.map((step) => step.trim()).filter(Boolean);
    const expectedResult = item.expectedResult.trim();
    const note = item.note?.trim();

    if (title.length === 0 || expectedResult.length === 0 || steps.length === 0) {
      throw new Error('Manual QA items require title, steps, and expected result.');
    }

    this.#ensureSessionExists(sessionId);
    const itemId = createManualItemId(sessionId, title, createdAt);
    const sourceEvidence: SourceEvidence[] = [{ label: 'Manual QA item', value: 'Added by reviewer during QA session.' }];

    this.#runInTransaction(() => {
      this.#database
        .prepare(`
          INSERT INTO qa_items (
            id, session_id, title, original_title, steps_json, original_steps_json, expected_result, original_expected_result,
            fingerprint, source_issue_id, source_type, confidence, warnings_json, source_evidence_json, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          itemId,
          sessionId,
          title,
          title,
          JSON.stringify(steps),
          JSON.stringify(steps),
          expectedResult,
          expectedResult,
          `manual:${itemId}`,
          manualItemSourceIssueId,
          'manual',
          'normal',
          JSON.stringify([]),
          JSON.stringify(sourceEvidence),
          note || null
        );
      this.#recordHistory(sessionId, itemId, 'manual-added', note || manualItemHistoryDetail, createdAt);
    });

    return itemId;
  }

  togglePassItem(sessionId: string, itemId: string, createdAt = new Date().toISOString()): void {
    const status = this.#ensureItemExists(sessionId, itemId).status;
    const nextStatus: QaItemStatus = status === 'passed' ? 'pending' : 'passed';
    const action: QaItemHistoryAction = status === 'passed' ? 'unpassed' : 'passed';

    this.#runInTransaction(() => {
      this.#database
        .prepare(`UPDATE qa_items SET status = ?, skip_reason = NULL WHERE session_id = ? AND id = ?`)
        .run(nextStatus, sessionId, itemId);
      this.#recordHistory(sessionId, itemId, action, undefined, createdAt);
    });
  }

  failItem(sessionId: string, itemId: string, createdAt = new Date().toISOString()): void {
    this.#ensureItemExists(sessionId, itemId);
    this.#runInTransaction(() => {
      this.#database
        .prepare(`UPDATE qa_items SET status = ?, skip_reason = NULL WHERE session_id = ? AND id = ?`)
        .run('failed', sessionId, itemId);
      this.#recordHistory(sessionId, itemId, 'failed', undefined, createdAt);
    });
  }

  skipItem(sessionId: string, itemId: string, reason: string, createdAt = new Date().toISOString()): void {
    const normalizedReason = reason.trim();
    if (normalizedReason.length === 0) {
      throw new Error('Skip reason is required.');
    }

    this.#ensureItemExists(sessionId, itemId);
    this.#runInTransaction(() => {
      this.#database
        .prepare(`UPDATE qa_items SET status = ?, skip_reason = ? WHERE session_id = ? AND id = ?`)
        .run('skipped', normalizedReason, sessionId, itemId);
      this.#recordHistory(sessionId, itemId, 'skipped', normalizedReason, createdAt);
    });
  }

  markFailureFiled(sessionId: string, itemId: string, trackerIssueId: string, createdAt = new Date().toISOString()): void {
    const issueId = trackerIssueId.trim();
    if (issueId.length === 0) {
      throw new Error('Filed failure issue id is required.');
    }

    const item = this.#ensureItemExists(sessionId, itemId);
    if (item.status !== 'failed') {
      throw new Error('Only failed QA items can be marked failed-filed.');
    }

    this.#runInTransaction(() => {
      this.#database
        .prepare(`UPDATE qa_items SET status = ?, note = COALESCE(note, ?) WHERE session_id = ? AND id = ?`)
        .run('failed-filed', `Filed as ${issueId}`, sessionId, itemId);
      this.#recordHistory(sessionId, itemId, 'failed-filed', issueId, createdAt);
    });
  }

  editItem(sessionId: string, itemId: string, edit: QaItemEdit, createdAt = new Date().toISOString()): void {
    const title = edit.title.trim();
    const steps = edit.steps.map((step) => step.trim());
    const expectedResult = edit.expectedResult.trim();
    const note = edit.note?.trim();

    if (title.length === 0 || expectedResult.length === 0 || steps.length === 0) {
      throw new Error('Edited QA items require title, steps, and expected result.');
    }
    if (steps.some((step) => step.length === 0)) {
      throw new Error('Edited QA item steps cannot be blank.');
    }

    this.#ensureItemExists(sessionId, itemId);
    this.#runInTransaction(() => {
      this.#database
        .prepare(`UPDATE qa_items SET title = ?, steps_json = ?, expected_result = ?, note = ? WHERE session_id = ? AND id = ?`)
        .run(title, JSON.stringify(steps), expectedResult, note || null, sessionId, itemId);
      this.#recordHistory(sessionId, itemId, 'edited', note || 'Generated text edited', createdAt);
    });
  }

  attachFailureScreenshot(
    sessionId: string,
    itemId: string,
    screenshot: FailureScreenshotInput,
    capturedAt = new Date().toISOString()
  ): FailureScreenshot {
    const item = this.#ensureItemExists(sessionId, itemId);
    if (item.status !== 'failed') {
      throw new Error('Screenshots can only be attached to failed QA items.');
    }
    if (!screenshot.mimeType.startsWith('image/')) {
      throw new Error('Failure screenshots must be image files.');
    }

    const originalName = normalizedScreenshotName(screenshot);
    const screenshotId = createScreenshotId(sessionId, itemId, capturedAt, originalName);
    const storageLocation = createScreenshotStorageLocation(this.#storageRoot, sessionId, itemId, capturedAt, originalName);

    mkdirSync(storageLocation.targetDirectory, { recursive: true });
    copyFileSync(screenshot.sourcePath, storageLocation.localPath);
    const sizeBytes = statSync(storageLocation.localPath).size;

    this.#database
      .prepare(`
        INSERT INTO qa_item_screenshots (
          id, item_id, session_id, original_name, mime_type, size_bytes, local_path, local_reference, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        screenshotId,
        itemId,
        sessionId,
        originalName,
        screenshot.mimeType,
        sizeBytes,
        storageLocation.localPath,
        storageLocation.localReference,
        capturedAt
      );

    return {
      id: screenshotId,
      originalName,
      mimeType: screenshot.mimeType,
      sizeBytes,
      localPath: storageLocation.localPath,
      localReference: storageLocation.localReference,
      capturedAt
    };
  }

  softDeleteItem(sessionId: string, itemId: string, deletedAt = new Date().toISOString()): void {
    this.#ensureItemExists(sessionId, itemId);
    this.#runInTransaction(() => {
      this.#database
        .prepare(`UPDATE qa_items SET deleted_at = ? WHERE session_id = ? AND id = ?`)
        .run(deletedAt, sessionId, itemId);
      this.#recordHistory(sessionId, itemId, 'soft-deleted', undefined, deletedAt);
    });
  }

  restoreItem(sessionId: string, itemId: string, restoredAt = new Date().toISOString()): void {
    this.#ensureItemExists(sessionId, itemId);
    this.#runInTransaction(() => {
      this.#database
        .prepare(`UPDATE qa_items SET deleted_at = NULL WHERE session_id = ? AND id = ?`)
        .run(sessionId, itemId);
      this.#recordHistory(sessionId, itemId, 'restored', undefined, restoredAt);
    });
  }

  softDeleteSession(sessionId: string, deletedAt = new Date().toISOString()): void {
    this.#ensureSessionExists(sessionId);
    this.#database.prepare(`UPDATE qa_sessions SET deleted_at = ? WHERE id = ?`).run(deletedAt, sessionId);
  }

  restoreSession(sessionId: string): void {
    this.#ensureSessionExists(sessionId);
    this.#database.prepare(`UPDATE qa_sessions SET deleted_at = NULL WHERE id = ?`).run(sessionId);
  }

  archiveSession(sessionId: string, archivedAt = new Date().toISOString()): void {
    this.#ensureSessionExists(sessionId);
    if (!this.#isArchiveEligible(sessionId)) {
      throw new Error('QA sessions can only be archived after every item is passed, failed-filed, or skipped with a reason.');
    }

    this.#database.prepare(`UPDATE qa_sessions SET archived_at = ? WHERE id = ?`).run(archivedAt, sessionId);
  }

  searchArchivedSessions(query = ''): ActiveQaSession[] {
    const rows = this.#database
      .prepare(`SELECT * FROM qa_sessions WHERE archived_at IS NOT NULL AND deleted_at IS NULL ORDER BY archived_at DESC, imported_at DESC`)
      .all() as unknown as SessionRow[];
    const normalizedQuery = query.trim().toLowerCase();
    const sessions = rows.map((session) => this.#toActiveSession(session));

    if (normalizedQuery.length === 0) {
      return sessions;
    }

    return sessions.filter((session) => archivedSessionMatches(session, normalizedQuery));
  }

  #runInTransaction(action: () => void): void {
    this.#database.exec('BEGIN');
    try {
      action();
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  getMostRecentActiveSession(): ActiveQaSession | undefined {
    const session = this.#database
      .prepare(
        `SELECT * FROM qa_sessions WHERE archived_at IS NULL AND deleted_at IS NULL ORDER BY imported_at DESC, generated_at DESC LIMIT 1`
      )
      .get() as unknown as SessionRow | undefined;

    if (!session) {
      return undefined;
    }

    return this.#toActiveSession(session);
  }

  #toActiveSession(session: SessionRow): ActiveQaSession {
    const itemRows = this.#database
      .prepare(`SELECT * FROM qa_items WHERE session_id = ? AND deleted_at IS NULL ORDER BY rowid ASC`)
      .all(session.id) as unknown as ItemRow[];

    return {
      id: session.id,
      title: session.title,
      repoName: session.repo_name,
      repoPath: session.repo_path,
      parentIssueId: session.parent_issue_id,
      parentIssueTitle: session.parent_issue_title,
      tracker: 'beads',
      generatedAt: session.generated_at,
      ...(session.archived_at ? { archivedAt: session.archived_at } : {}),
      warnings: parseJson<string[]>(session.warnings_json),
      sourceEvidence: parseJson<SourceEvidence[]>(session.source_evidence_json),
      items: itemRows.map((item) =>
        toActiveItem(item, this.#getItemHistory(session.id, item.id), this.#getItemScreenshots(session.id, item.id))
      )
    };
  }

  #isArchiveEligible(sessionId: string): boolean {
    const items = this.#database
      .prepare(`SELECT status, skip_reason FROM qa_items WHERE session_id = ? AND deleted_at IS NULL`)
      .all(sessionId) as unknown as Array<{ readonly status: string; readonly skip_reason: string | null }>;

    return items.length > 0 && items.every(isTerminalForArchive);
  }

  #ensureItemExists(sessionId: string, itemId: string): { readonly status: QaItemStatus } {
    const row = this.#database
      .prepare(`SELECT status FROM qa_items WHERE session_id = ? AND id = ?`)
      .get(sessionId, itemId) as unknown as { readonly status: string } | undefined;

    if (!row) {
      throw new Error(`QA item ${itemId} was not found in session ${sessionId}.`);
    }

    return { status: toQaItemStatus(row.status) };
  }

  #ensureSessionExists(sessionId: string): void {
    const row = this.#database
      .prepare(`SELECT id FROM qa_sessions WHERE id = ?`)
      .get(sessionId) as unknown as { readonly id: string } | undefined;
    if (!row) {
      throw new Error(`QA session ${sessionId} was not found.`);
    }
  }

  #ensureColumn(tableName: string, columnName: string, definition: string): void {
    const rows = this.#database.prepare(`PRAGMA table_info(${tableName})`).all() as unknown as Array<{ readonly name: string }>;
    if (rows.some((row) => row.name === columnName)) return;
    this.#database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  #recordHistory(
    sessionId: string,
    itemId: string,
    action: QaItemHistoryAction,
    detail: string | undefined,
    createdAt: string
  ): void {
    this.#database
      .prepare(`INSERT INTO qa_item_history (item_id, session_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(itemId, sessionId, action, detail ?? null, createdAt);
  }

  #getItemHistory(sessionId: string, itemId: string): QaItemHistoryEvent[] {
    const rows = this.#database
      .prepare(`SELECT action, detail, created_at FROM qa_item_history WHERE session_id = ? AND item_id = ? ORDER BY id ASC`)
      .all(sessionId, itemId) as unknown as HistoryRow[];

    return rows.map((row) => ({
      action: toHistoryAction(row.action),
      createdAt: row.created_at,
      ...(row.detail ? { detail: row.detail } : {})
    }));
  }

  #getItemScreenshots(sessionId: string, itemId: string): FailureScreenshot[] {
    const rows = this.#database
      .prepare(`SELECT * FROM qa_item_screenshots WHERE session_id = ? AND item_id = ? ORDER BY captured_at ASC`)
      .all(sessionId, itemId) as unknown as ScreenshotRow[];

    return rows.map(toFailureScreenshot);
  }

  close(): void {
    this.#database.close();
  }
}

function toActiveItem(
  item: ItemRow,
  history: readonly QaItemHistoryEvent[],
  screenshots: readonly FailureScreenshot[]
): ActiveQaItem {
  return {
    id: item.id,
    title: item.title,
    originalTitle: item.original_title,
    steps: parseJson<string[]>(item.steps_json),
    originalSteps: parseJson<string[]>(item.original_steps_json),
    expectedResult: item.expected_result,
    originalExpectedResult: item.original_expected_result,
    sourceIssueId: item.source_issue_id,
    sourceType: item.source_type === 'manual' ? 'manual' : 'generated',
    fingerprint: item.fingerprint,
    confidence: item.confidence === 'low' ? 'low' : 'normal',
    warnings: parseJson<string[]>(item.warnings_json),
    sourceEvidence: parseJson<SourceEvidence[]>(item.source_evidence_json),
    status: toQaItemStatus(item.status),
    ...(item.skip_reason ? { skipReason: item.skip_reason } : {}),
    ...(item.note ? { note: item.note } : {}),
    screenshots,
    history
  };
}

function toQaItemStatus(value: string): QaItemStatus {
  if (value === 'passed' || value === 'failed' || value === 'failed-filed' || value === 'skipped') {
    return value;
  }
  return 'pending';
}

function toHistoryAction(value: string): QaItemHistoryAction {
  switch (value) {
    case 'manual-added':
    case 'passed':
    case 'unpassed':
    case 'failed':
    case 'failed-filed':
    case 'skipped':
    case 'edited':
    case 'soft-deleted':
    case 'restored':
      return value;
    default:
      throw new Error(`Unknown QA item history action: ${value}`);
  }
}

function isTerminalForArchive(item: { readonly status: string; readonly skip_reason: string | null }): boolean {
  return (
    item.status === 'passed' ||
    item.status === 'failed-filed' ||
    (item.status === 'skipped' && typeof item.skip_reason === 'string' && item.skip_reason.trim().length > 0)
  );
}

function archivedSessionMatches(session: ActiveQaSession, query: string): boolean {
  const searchable = [
    session.title,
    session.repoName,
    session.repoPath,
    session.parentIssueId,
    session.parentIssueTitle,
    ...session.warnings,
    ...session.sourceEvidence.map((evidence) => `${evidence.label} ${evidence.value}`),
    ...session.items.flatMap((item) => [
      item.title,
      item.originalTitle,
      item.expectedResult,
      item.originalExpectedResult,
      item.sourceIssueId,
      item.note ?? '',
      item.skipReason ?? '',
      ...item.steps,
      ...item.originalSteps,
      ...item.warnings,
      ...item.sourceEvidence.map((evidence) => `${evidence.label} ${evidence.value}`),
      ...item.history.map((event) => `${event.action} ${event.detail ?? ''}`),
      ...item.screenshots.map((screenshot) => `${screenshot.originalName} ${screenshot.localReference}`)
    ])
  ];

  return searchable.join(' ').toLowerCase().includes(query);
}

function createSessionId(payload: QaSessionPayload): string {
  const source = `${payload.source.repo.path}:${payload.source.parentIssue.id}:${payload.generatedAt}`;
  return `session-${Buffer.from(source).toString('base64url').slice(0, 32)}`;
}

function createManualItemId(sessionId: string, title: string, createdAt: string): string {
  return `manual-${Buffer.from(`${sessionId}:${title}:${createdAt}`).toString('base64url').slice(0, 32)}`;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizedScreenshotName(screenshot: FailureScreenshotInput): string {
  return screenshot.originalName?.trim() || basename(screenshot.sourcePath);
}

function createScreenshotId(sessionId: string, itemId: string, capturedAt: string, originalName: string): string {
  return `screenshot-${Buffer.from(`${sessionId}:${itemId}:${capturedAt}:${originalName}`).toString('base64url').slice(0, 32)}`;
}

function createScreenshotStorageLocation(
  storageRoot: string,
  sessionId: string,
  itemId: string,
  capturedAt: string,
  originalName: string
): ScreenshotStorageLocation {
  const relativeDirectory = join('screenshots', sanitizePathSegment(sessionId), sanitizePathSegment(itemId));
  const targetName = `${sanitizePathSegment(capturedAt)}-${sanitizePathSegment(originalName)}`;

  return {
    targetDirectory: join(storageRoot, relativeDirectory),
    localPath: join(storageRoot, relativeDirectory, targetName),
    localReference: `app-storage://${join(relativeDirectory, targetName)}`
  };
}

function toFailureScreenshot(row: ScreenshotRow): FailureScreenshot {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    localPath: row.local_path,
    localReference: row.local_reference,
    capturedAt: row.captured_at
  };
}

function sanitizePathSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
  return normalized.length > 0 ? normalized : 'unnamed';
}

interface SessionRow {
  readonly id: string;
  readonly title: string;
  readonly repo_name: string;
  readonly repo_path: string;
  readonly parent_issue_id: string;
  readonly parent_issue_title: string;
  readonly generated_at: string;
  readonly archived_at: string | null;
  readonly warnings_json: string;
  readonly source_evidence_json: string;
}

interface ItemRow {
  readonly id: string;
  readonly title: string;
  readonly original_title: string;
  readonly steps_json: string;
  readonly original_steps_json: string;
  readonly expected_result: string;
  readonly original_expected_result: string;
  readonly source_issue_id: string;
  readonly source_type: string;
  readonly fingerprint: string;
  readonly confidence: string;
  readonly warnings_json: string;
  readonly source_evidence_json: string;
  readonly status: string;
  readonly skip_reason: string | null;
  readonly note: string | null;
}

interface HistoryRow {
  readonly action: string;
  readonly detail: string | null;
  readonly created_at: string;
}

interface ScreenshotRow {
  readonly id: string;
  readonly original_name: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly local_path: string;
  readonly local_reference: string;
  readonly captured_at: string;
}
