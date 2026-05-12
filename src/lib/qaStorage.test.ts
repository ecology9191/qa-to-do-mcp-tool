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
