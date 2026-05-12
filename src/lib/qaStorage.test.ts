// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBeadsQaSessionFromParent, type BeadsIssue } from './beadsQa';
import { QaStorageRepository } from './qaStorage';

describe('QA checklist storage', () => {
  it('preserves generated text and source evidence while recording reversible state history', () => {
    const repository = new QaStorageRepository();
    const payload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const itemId = payload.items[0].id;

    repository.togglePassItem(sessionId, itemId, '2026-05-12T09:01:00.000Z');
    repository.togglePassItem(sessionId, itemId, '2026-05-12T09:02:00.000Z');
    repository.skipItem(sessionId, itemId, 'Covered by smoke test', '2026-05-12T09:03:00.000Z');
    repository.editItem(sessionId, itemId, {
      title: 'Verify imported QA session details',
      steps: ['Open the imported session', 'Expand the generated QA item'],
      expectedResult: 'The details preserve provenance.',
      note: 'Clarified wording during QA.'
    }, '2026-05-12T09:04:00.000Z');

    const activeSession = repository.getMostRecentActiveSession();
    repository.close();

    expect(activeSession?.items[0]).toMatchObject({
      title: 'Verify imported QA session details',
      originalTitle: 'Verify Import QA sessions',
      status: 'skipped',
      skipReason: 'Covered by smoke test',
      note: 'Clarified wording during QA.'
    });
    expect(activeSession?.items[0].sourceEvidence).toEqual(payload.items[0].sourceEvidence);
    expect(activeSession?.items[0].history.map((event) => event.action)).toEqual(['passed', 'unpassed', 'skipped', 'edited']);
  });

  it('copies failed item screenshots into app storage with local references', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'qa-evidence-'));
    const sourceDir = join(storageRoot, 'source');
    mkdirSync(sourceDir);
    const sourcePath = join(sourceDir, 'failure.png');
    writeFileSync(sourcePath, 'png-bytes');
    const repository = new QaStorageRepository(':memory:', storageRoot);
    const payload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const itemId = payload.items[0].id;

    expect(() => repository.attachFailureScreenshot(sessionId, itemId, {
      sourcePath,
      originalName: 'failure.png',
      mimeType: 'image/png'
    }, '2026-05-12T09:05:00.000Z')).toThrow('Screenshots can only be attached to failed QA items.');

    repository.failItem(sessionId, itemId, '2026-05-12T09:04:00.000Z');
    repository.attachFailureScreenshot(sessionId, itemId, {
      sourcePath,
      originalName: 'failure.png',
      mimeType: 'image/png'
    }, '2026-05-12T09:05:00.000Z');

    const activeSession = repository.getMostRecentActiveSession();
    repository.close();

    expect(activeSession?.items[0].screenshots).toEqual([
      expect.objectContaining({
        originalName: 'failure.png',
        mimeType: 'image/png',
        sizeBytes: 9,
        capturedAt: '2026-05-12T09:05:00.000Z'
      })
    ]);
    expect(activeSession?.items[0].screenshots?.[0]?.localPath).toContain(join('screenshots', sessionId, itemId));
  });

  it('persists manual items and soft delete restore without losing evidence or history', () => {
    const repository = new QaStorageRepository();
    const payload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');

    const manualItemId = repository.addManualItem(sessionId, {
      title: 'Verify keyboard shortcut help',
      steps: ['Open the active QA session', 'Read the shortcut preview'],
      expectedResult: 'The shortcut preview lists keyboard controls.',
      note: 'Added during human QA.'
    }, '2026-05-12T09:06:00.000Z');

    repository.failItem(sessionId, manualItemId, '2026-05-12T09:07:00.000Z');
    repository.editItem(sessionId, manualItemId, {
      title: 'Verify keyboard shortcut help remains visible',
      steps: ['Open the active QA session'],
      expectedResult: 'The shortcut preview remains visible.',
      note: 'Failure notes stay attached.'
    }, '2026-05-12T09:08:00.000Z');
    repository.softDeleteItem(sessionId, manualItemId, '2026-05-12T09:09:00.000Z');

    expect(repository.getMostRecentActiveSession()?.items.map((item) => item.id)).not.toContain(manualItemId);

    repository.restoreItem(sessionId, manualItemId, '2026-05-12T09:10:00.000Z');
    repository.softDeleteSession(sessionId, '2026-05-12T09:11:00.000Z');

    expect(repository.getMostRecentActiveSession()).toBeUndefined();

    repository.restoreSession(sessionId);

    const activeSession = repository.getMostRecentActiveSession();
    repository.close();

    expect(activeSession?.items.find((item) => item.id === manualItemId)).toMatchObject({
      sourceType: 'manual',
      sourceIssueId: 'manual',
      title: 'Verify keyboard shortcut help remains visible',
      originalTitle: 'Verify keyboard shortcut help',
      status: 'failed',
      note: 'Failure notes stay attached.'
    });
    expect(activeSession?.items.find((item) => item.id === manualItemId)?.history.map((event) => event.action)).toEqual([
      'manual-added',
      'failed',
      'edited',
      'soft-deleted',
      'restored'
    ]);
  });

  it('archives only fully resolved sessions while preserving searchable evidence', () => {
    const repository = new QaStorageRepository();
    const payload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const generatedItemId = payload.items[0].id;
    const manualItemId = repository.addManualItem(sessionId, {
      title: 'Verify archive search keeps reviewer evidence',
      steps: ['Open archived sessions', 'Search for the reviewer note'],
      expectedResult: 'The archived QA item remains visible.',
      note: 'archive-search-note'
    }, '2026-05-12T09:06:00.000Z');

    repository.failItem(sessionId, generatedItemId, '2026-05-12T09:07:00.000Z');
    repository.skipItem(sessionId, manualItemId, 'Not applicable to this repo', '2026-05-12T09:08:00.000Z');

    expect(() => repository.archiveSession(sessionId, '2026-05-12T09:09:00.000Z')).toThrow(
      'QA sessions can only be archived after every item is passed, failed-filed, or skipped with a reason.'
    );

    repository.markFailureFiled(sessionId, generatedItemId, 'bug-1', '2026-05-12T09:10:00.000Z');
    repository.archiveSession(sessionId, '2026-05-12T09:11:00.000Z');

    expect(repository.getMostRecentActiveSession()).toBeUndefined();
    const archivedSessions = repository.searchArchivedSessions('archive-search-note');
    repository.close();

    expect(archivedSessions).toHaveLength(1);
    expect(archivedSessions[0]).toMatchObject({ id: sessionId, archivedAt: '2026-05-12T09:11:00.000Z' });
    expect(archivedSessions[0]?.items.map((item) => item.status)).toEqual(['failed-filed', 'skipped']);
    expect(archivedSessions[0]?.items[0].history.map((event) => event.action)).toContain('failed-filed');
  });

  it('merges rerun items into an active parent session without resetting existing item state', () => {
    const repository = new QaStorageRepository();
    const initialPayload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');
    const rerunPayload = createBeadsQaSessionFromParent('parent-1', [...issues, secondClosedIssue], {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:30:00.000Z');
    const sessionId = repository.importSession(initialPayload, '2026-05-12T09:00:01.000Z');

    repository.togglePassItem(sessionId, initialPayload.items[0].id, '2026-05-12T09:01:00.000Z');
    const rerunSessionId = repository.importSession(rerunPayload, '2026-05-12T09:30:01.000Z');

    const activeSession = repository.getMostRecentActiveSession();
    repository.close();

    expect(rerunSessionId).toBe(sessionId);
    expect(activeSession?.generatedAt).toBe('2026-05-12T09:30:00.000Z');
    expect(activeSession?.items).toHaveLength(2);
    expect(activeSession?.items.find((item) => item.fingerprint === initialPayload.items[0].fingerprint)).toMatchObject({
      status: 'passed',
      history: [expect.objectContaining({ action: 'passed' })]
    });
    expect(activeSession?.items.find((item) => item.sourceIssueId === 'child-closed-2')).toMatchObject({ status: 'pending' });
  });

  it('creates a new version when rerunning an archived parent without mutating archived history', () => {
    const repository = new QaStorageRepository();
    const payload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');
    const rerunPayload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T10:00:00.000Z');
    const archivedSessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');

    repository.togglePassItem(archivedSessionId, payload.items[0].id, '2026-05-12T09:01:00.000Z');
    repository.archiveSession(archivedSessionId, '2026-05-12T09:02:00.000Z');
    const newSessionId = repository.importSession(rerunPayload, '2026-05-12T10:00:01.000Z');

    const activeSession = repository.getMostRecentActiveSession();
    const archivedSessions = repository.searchArchivedSessions();
    repository.close();

    expect(newSessionId).not.toBe(archivedSessionId);
    expect(archivedSessions).toHaveLength(1);
    expect(archivedSessions[0]).toMatchObject({ id: archivedSessionId, archivedAt: '2026-05-12T09:02:00.000Z' });
    expect(archivedSessions[0]?.items).toHaveLength(1);
    expect(archivedSessions[0]?.items[0]).toMatchObject({ status: 'passed' });
    expect(activeSession).toMatchObject({ id: newSessionId, generatedAt: '2026-05-12T10:00:00.000Z' });
    expect(activeSession?.items[0]).toMatchObject({ fingerprint: payload.items[0].fingerprint, status: 'pending' });
  });

  it('exports and imports the schema without losing sessions, item evidence, history, archive state, or metadata', () => {
    const repository = new QaStorageRepository();
    const payload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');

    repository.skipItem(sessionId, payload.items[0].id, 'Covered by release smoke test', '2026-05-12T09:01:00.000Z');
    repository.archiveSession(sessionId, '2026-05-12T09:02:00.000Z');

    const exportedData = repository.exportData('2026-05-12T09:03:00.000Z');
    const restoredRepository = new QaStorageRepository();
    restoredRepository.importData(exportedData);
    const restoredArchivedSessions = restoredRepository.searchArchivedSessions('release smoke');

    repository.close();
    restoredRepository.close();

    expect(exportedData).toMatchObject({ schemaVersion: 1, exportedAt: '2026-05-12T09:03:00.000Z' });
    expect(exportedData.sessions[0]).toMatchObject({
      id: sessionId,
      rawPayload: {
        title: payload.title,
        source: {
          repo: payload.source.repo,
          parentIssue: payload.source.parentIssue
        }
      },
      importedAt: '2026-05-12T09:00:01.000Z',
      archivedAt: '2026-05-12T09:02:00.000Z'
    });
    expect(restoredArchivedSessions).toHaveLength(1);
    expect(restoredArchivedSessions[0]).toMatchObject({ id: sessionId, archivedAt: '2026-05-12T09:02:00.000Z' });
    expect(restoredArchivedSessions[0]?.sourceEvidence).toEqual(payload.source.sessionEvidence);
    expect(restoredArchivedSessions[0]?.items[0]).toMatchObject({
      fingerprint: payload.items[0].fingerprint,
      sourceEvidence: payload.items[0].sourceEvidence,
      status: 'skipped',
      skipReason: 'Covered by release smoke test',
      history: [expect.objectContaining({ action: 'skipped', detail: 'Covered by release smoke test' })]
    });
  });
});

const issues: BeadsIssue[] = [
  {
    id: 'parent-1',
    title: 'Parent feature',
    status: 'open'
  },
  {
    id: 'child-closed',
    title: 'Import QA sessions',
    status: 'closed',
    closed_at: '2026-05-12T08:00:00.000Z',
    description: `## Acceptance criteria

- The dashboard shows the imported QA session with repo context.
`,
    dependencies: [{ issue_id: 'child-closed', depends_on_id: 'parent-1', type: 'parent-child' }]
  }
];

const secondClosedIssue: BeadsIssue = {
  id: 'child-closed-2',
  title: 'Export QA sessions',
  status: 'closed',
  closed_at: '2026-05-12T09:20:00.000Z',
  description: `## Acceptance criteria

- The backup command restores archived QA sessions with item history.
`,
  dependencies: [{ issue_id: 'child-closed-2', depends_on_id: 'parent-1', type: 'parent-child' }]
};
