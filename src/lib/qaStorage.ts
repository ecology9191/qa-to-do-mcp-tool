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
  readonly sourceIssueId: string;
  readonly fingerprint: string;
  readonly confidence: 'normal' | 'low';
  readonly warnings: readonly string[];
  readonly sourceEvidence: readonly SourceEvidence[];
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
        steps_json TEXT NOT NULL,
        expected_result TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        source_issue_id TEXT NOT NULL,
        confidence TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        source_evidence_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
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
        id, session_id, title, steps_json, expected_result, fingerprint, source_issue_id, confidence, warnings_json, source_evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          JSON.stringify(item.steps),
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
      items: itemRows.map(toActiveItem)
    };
  }

  close(): void {
    this.#database.close();
  }
}

function toActiveItem(item: ItemRow): ActiveQaItem {
  return {
    id: item.id,
    title: item.title,
    sourceIssueId: item.source_issue_id,
    fingerprint: item.fingerprint,
    confidence: item.confidence === 'low' ? 'low' : 'normal',
    warnings: parseJson<string[]>(item.warnings_json),
    sourceEvidence: parseJson<SourceEvidence[]>(item.source_evidence_json)
  };
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
  readonly source_issue_id: string;
  readonly fingerprint: string;
  readonly confidence: string;
  readonly warnings_json: string;
  readonly source_evidence_json: string;
}
