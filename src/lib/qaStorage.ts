import { DatabaseSync } from 'node:sqlite';
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
  readonly fingerprint: string;
  readonly confidence: 'normal' | 'low';
  readonly warnings: readonly string[];
  readonly sourceEvidence: readonly SourceEvidence[];
  readonly status: QaItemStatus;
  readonly skipReason?: string;
  readonly note?: string;
  readonly history: readonly QaItemHistoryEvent[];
}

export type QaItemStatus = 'pending' | 'passed' | 'failed' | 'skipped';

export interface QaItemHistoryEvent {
  readonly action: 'passed' | 'unpassed' | 'failed' | 'skipped' | 'edited';
  readonly createdAt: string;
  readonly detail?: string;
}

export interface QaItemEdit {
  readonly title: string;
  readonly steps: readonly string[];
  readonly expectedResult: string;
  readonly note?: string;
}

export class QaStorageRepository {
  readonly #database: DatabaseSync;

  constructor(databasePath = ':memory:') {
    this.#database = new DatabaseSync(databasePath);
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
        archived_at TEXT
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
        confidence TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        source_evidence_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        skip_reason TEXT,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS qa_item_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL REFERENCES qa_items(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  importSession(payload: QaSessionPayload, importedAt = new Date().toISOString()): string {
    const sessionId = createSessionId(payload);
    const insertSession = this.#database.prepare(`
      INSERT OR REPLACE INTO qa_sessions (
        id, title, tracker, repo_name, repo_path, parent_issue_id, parent_issue_title, parent_issue_status,
        generated_at, imported_at, warnings_json, source_evidence_json, raw_payload_json, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `);
    const insertItem = this.#database.prepare(`
      INSERT OR IGNORE INTO qa_items (
        id, session_id, title, original_title, steps_json, original_steps_json, expected_result, original_expected_result,
        fingerprint, source_issue_id, confidence, warnings_json, source_evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  togglePassItem(sessionId: string, itemId: string, createdAt = new Date().toISOString()): void {
    const status = this.#getItemStatus(sessionId, itemId);
    const nextStatus: QaItemStatus = status === 'passed' ? 'pending' : 'passed';
    const action: QaItemHistoryEvent['action'] = status === 'passed' ? 'unpassed' : 'passed';

    this.#database.exec('BEGIN');
    try {
      this.#database
        .prepare(`UPDATE qa_items SET status = ?, skip_reason = NULL WHERE session_id = ? AND id = ?`)
        .run(nextStatus, sessionId, itemId);
      this.#recordHistory(sessionId, itemId, action, undefined, createdAt);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  failItem(sessionId: string, itemId: string, createdAt = new Date().toISOString()): void {
    this.#ensureItemExists(sessionId, itemId);
    this.#database.exec('BEGIN');
    try {
      this.#database
        .prepare(`UPDATE qa_items SET status = ?, skip_reason = NULL WHERE session_id = ? AND id = ?`)
        .run('failed', sessionId, itemId);
      this.#recordHistory(sessionId, itemId, 'failed', undefined, createdAt);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  skipItem(sessionId: string, itemId: string, reason: string, createdAt = new Date().toISOString()): void {
    const normalizedReason = reason.trim();
    if (normalizedReason.length === 0) {
      throw new Error('Skip reason is required.');
    }

    this.#ensureItemExists(sessionId, itemId);
    this.#database.exec('BEGIN');
    try {
      this.#database
        .prepare(`UPDATE qa_items SET status = ?, skip_reason = ? WHERE session_id = ? AND id = ?`)
        .run('skipped', normalizedReason, sessionId, itemId);
      this.#recordHistory(sessionId, itemId, 'skipped', normalizedReason, createdAt);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  editItem(sessionId: string, itemId: string, edit: QaItemEdit, createdAt = new Date().toISOString()): void {
    if (edit.title.trim().length === 0 || edit.expectedResult.trim().length === 0 || edit.steps.length === 0) {
      throw new Error('Edited QA items require title, steps, and expected result.');
    }
    if (edit.steps.some((step) => step.trim().length === 0)) {
      throw new Error('Edited QA item steps cannot be blank.');
    }

    this.#ensureItemExists(sessionId, itemId);
    this.#database.exec('BEGIN');
    try {
      this.#database
        .prepare(`UPDATE qa_items SET title = ?, steps_json = ?, expected_result = ?, note = ? WHERE session_id = ? AND id = ?`)
        .run(
          edit.title.trim(),
          JSON.stringify(edit.steps.map((step) => step.trim())),
          edit.expectedResult.trim(),
          edit.note?.trim() || null,
          sessionId,
          itemId
        );
      this.#recordHistory(sessionId, itemId, 'edited', edit.note?.trim() || 'Generated text edited', createdAt);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  getMostRecentActiveSession(): ActiveQaSession | undefined {
    const session = this.#database
      .prepare(
        `SELECT * FROM qa_sessions WHERE archived_at IS NULL ORDER BY imported_at DESC, generated_at DESC LIMIT 1`
      )
      .get() as unknown as SessionRow | undefined;

    if (!session) {
      return undefined;
    }

    const itemRows = this.#database
      .prepare(`SELECT * FROM qa_items WHERE session_id = ? ORDER BY rowid ASC`)
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
      warnings: parseJson<string[]>(session.warnings_json),
      sourceEvidence: parseJson<SourceEvidence[]>(session.source_evidence_json),
      items: itemRows.map((item) => toActiveItem(item, this.#getItemHistory(session.id, item.id)))
    };
  }

  #getItemStatus(sessionId: string, itemId: string): QaItemStatus {
    return this.#ensureItemExists(sessionId, itemId).status;
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

  #recordHistory(
    sessionId: string,
    itemId: string,
    action: QaItemHistoryEvent['action'],
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

  close(): void {
    this.#database.close();
  }
}

function toActiveItem(item: ItemRow, history: readonly QaItemHistoryEvent[]): ActiveQaItem {
  return {
    id: item.id,
    title: item.title,
    originalTitle: item.original_title,
    steps: parseJson<string[]>(item.steps_json),
    originalSteps: parseJson<string[]>(item.original_steps_json),
    expectedResult: item.expected_result,
    originalExpectedResult: item.original_expected_result,
    sourceIssueId: item.source_issue_id,
    fingerprint: item.fingerprint,
    confidence: item.confidence === 'low' ? 'low' : 'normal',
    warnings: parseJson<string[]>(item.warnings_json),
    sourceEvidence: parseJson<SourceEvidence[]>(item.source_evidence_json),
    status: toQaItemStatus(item.status),
    ...(item.skip_reason ? { skipReason: item.skip_reason } : {}),
    ...(item.note ? { note: item.note } : {}),
    history
  };
}

function toQaItemStatus(value: string): QaItemStatus {
  if (value === 'passed' || value === 'failed' || value === 'skipped') {
    return value;
  }
  return 'pending';
}

function toHistoryAction(value: string): QaItemHistoryEvent['action'] {
  if (value === 'passed' || value === 'unpassed' || value === 'failed' || value === 'skipped' || value === 'edited') {
    return value;
  }
  throw new Error(`Unknown QA item history action: ${value}`);
}

function createSessionId(payload: QaSessionPayload): string {
  const source = `${payload.source.repo.path}:${payload.source.parentIssue.id}:${payload.generatedAt}`;
  return `session-${Buffer.from(source).toString('base64url').slice(0, 32)}`;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

interface SessionRow {
  readonly id: string;
  readonly title: string;
  readonly repo_name: string;
  readonly repo_path: string;
  readonly parent_issue_id: string;
  readonly parent_issue_title: string;
  readonly generated_at: string;
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
