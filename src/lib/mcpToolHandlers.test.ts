// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBeadsQaSessionFromParent, type BeadsIssue } from './beadsQa';
import type { QaToDoMcpConfig } from './mcpConfig';
import { createQaSessionFromPayload, handleQaToDoMcpToolCall, qaToDoMcpToolDefinitions } from './mcpToolHandlers';
import { QaStorageRepository } from './qaStorage';
import { createScratchQaSessionFromParent, type ScratchIssue } from './scratchQa';

describe('QA To Do MCP session handlers', () => {
  it('creates a validated QA session through inbox import', async () => {
    const config = await createTemporaryMcpConfig();
    const payload = createBeadsQaSessionFromParent('parent-1', qaSessionIssues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');

    const result = await createQaSessionFromPayload({
      payload,
      correlationId: 'test-correlation',
      createdAt: '2026-05-12T09:00:01.000Z'
    }, config);

    expect(result.importedSessionIds).toHaveLength(1);
    expect(result.quarantinedEntries).toEqual([]);
    expect(result.inboxEntryPath).toContain(config.inboxDir);
    expect(result.activeSession).toMatchObject({
      title: 'sample-repo parent-1 QA',
      tracker: 'beads',
      repoPath: '/repos/sample-repo',
      parentIssueId: 'parent-1',
      itemCount: 1
    });
  });

  it('rejects invalid payloads before writing inbox entries', async () => {
    const config = await createTemporaryMcpConfig();

    await expect(createQaSessionFromPayload({
      payload: {
        schemaVersion: 1,
        title: 'Invalid',
        generatedAt: '2026-05-12T09:00:00.000Z',
        source: {},
        warnings: [],
        items: []
      }
    }, config)).rejects.toThrow('Invalid QA session payload');
  });
});

describe('QA To Do MCP failed QA tools', () => {
  it('lists failed QA items by default and includes filed failures only when requested', () => {
    const repository = new QaStorageRepository();
    const payload = createBeadsQaSessionFromParent('parent-1', beadsIssues, repo, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const [failedItem, filedItem] = payload.items;

    repository.failItem(sessionId, failedItem.id, '2026-05-12T09:01:00.000Z');
    saveActualBehavior(repository, sessionId, failedItem, 'The import panel stays empty.');
    repository.failItem(sessionId, filedItem.id, '2026-05-12T09:02:00.000Z');
    saveActualBehavior(repository, sessionId, filedItem, 'The export panel crashes.');
    repository.markFailureFiled(sessionId, filedItem.id, 'bug-1', '2026-05-12T09:03:00.000Z');

    const defaultResult = handleQaToDoMcpToolCall(repository, 'qa_failed_items_list', {});
    const includeFiledResult = handleQaToDoMcpToolCall(repository, 'qa_failed_items_list', { includeFiled: true });
    repository.close();

    expect(defaultResult).toMatchObject({
      schemaVersion: 1,
      kind: 'qa-failed-items.list',
      includeFiled: false,
      statusLegend: {
        failed: 'User-provided failure evidence exists, but no tracker issue has been confirmed filed.',
        'failed-filed': 'A tracker issue has already been recorded for the saved failure; avoid duplicate filing unless auditing or recovering.'
      }
    });
    expect(defaultResult.items).toEqual([
      expect.objectContaining({
        schemaVersion: 1,
        kind: 'qa-failed-item.row',
        sessionId,
        itemId: failedItem.id,
        status: 'failed',
        tracker: 'beads',
        repo: { name: 'sample-repo', path: '/repos/sample-repo' },
        parentIssue: { id: 'parent-1', title: 'Parent feature' },
        sourceIssue: { id: 'child-closed' },
        actualBehavior: 'The import panel stays empty.',
        screenshotCount: 0
      })
    ]);
    expect(includeFiledResult.items.map((item) => item.status)).toEqual(['failed', 'failed-filed']);
  });

  it('extracts failed Beads evidence with screenshots and a deterministic draft issue', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'qa-mcp-evidence-'));
    const sourceDir = join(storageRoot, 'source');
    mkdirSync(sourceDir);
    const sourcePath = join(sourceDir, 'callback.png');
    writeFileSync(sourcePath, 'png-bytes');
    const repository = new QaStorageRepository(':memory:', storageRoot);
    const payload = createBeadsQaSessionFromParent('parent-1', beadsIssues.slice(0, 2), repo, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const item = payload.items[0];

    repository.failItem(sessionId, item.id, '2026-05-12T09:01:00.000Z');
    saveActualBehavior(repository, sessionId, item, 'The login flow stays on the callback screen.');
    repository.attachFailureScreenshot(sessionId, item.id, {
      sourcePath,
      originalName: 'callback.png',
      mimeType: 'image/png'
    }, '2026-05-12T09:02:00.000Z');

    const result = handleQaToDoMcpToolCall(repository, 'qa_failed_item_get', { sessionId, itemId: item.id });
    repository.close();

    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: 'qa-failed-item.detail',
      sessionId,
      itemId: item.id,
      status: 'failed',
      tracker: 'beads',
      actualBehavior: 'The login flow stays on the callback screen.',
      failureContext: {
        repo,
        parentIssue: { id: 'parent-1', title: 'Parent feature' },
        item: {
          id: item.id,
          title: item.title,
          steps: item.steps,
          expectedResult: item.expectedResult,
          fingerprint: item.fingerprint,
          sourceIssueId: 'child-closed',
          sourceEvidence: item.sourceEvidence
        },
        actualBehavior: 'The login flow stays on the callback screen.',
        screenshots: [
          expect.objectContaining({
            name: 'callback.png',
            mimeType: 'image/png',
            sizeBytes: 9,
            localReference: expect.stringContaining('app-storage://')
          })
        ]
      },
      draftIssue: expect.objectContaining({
        kind: 'beads-failure-issue-draft',
        issueType: 'bug',
        labels: ['needs-triage', 'bug'],
        discoveredFromIssueId: 'child-closed',
        dedupeFingerprint: `qa-failure:/repos/sample-repo:parent-1:${item.fingerprint}`
      })
    });
    expect(result.screenshots[0]).toMatchObject({
      originalName: 'callback.png',
      localPath: expect.stringContaining(join('screenshots', sessionId, item.id)),
      localReference: expect.stringContaining('callback.png')
    });
    expect(result).not.toHaveProperty('screenshotBytes');
    expect(JSON.stringify(result)).not.toContain('png-bytes');
    expect(result.draftIssue?.copyableIssueText).toContain('QA-Failure-Fingerprint');
  });

  it('rejects missing or non-failed Beads item identifiers for evidence extraction', () => {
    const repository = new QaStorageRepository();
    const payload = createBeadsQaSessionFromParent('parent-1', beadsIssues.slice(0, 2), repo, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const item = payload.items[0];

    expect(() => handleQaToDoMcpToolCall(repository, 'qa_failed_item_get', { itemId: item.id })).toThrow('sessionId is required.');
    expect(() => handleQaToDoMcpToolCall(repository, 'qa_failed_item_get', { sessionId })).toThrow('itemId is required.');
    expect(() => handleQaToDoMcpToolCall(repository, 'qa_failed_item_get', { sessionId, itemId: item.id })).toThrow(
      `QA item ${item.id} in session ${sessionId} is not failed or failed-filed.`
    );

    repository.close();
  });

  it('extracts .scratch failures through the same failure context with a structured markdown draft', () => {
    const repository = new QaStorageRepository();
    const payload = createScratchQaSessionFromParent('scratch-parent', scratchIssues, repo, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const item = payload.items[0];

    repository.failItem(sessionId, item.id, '2026-05-12T09:01:00.000Z');
    saveActualBehavior(repository, sessionId, item, 'The scratch workflow shows stale content.');

    const result = handleQaToDoMcpToolCall(repository, 'qa_failed_item_get', { sessionId, itemId: item.id });
    repository.close();

    expect(result.failureContext.actualBehavior).toBe('The scratch workflow shows stale content.');
    expect(result.draftIssue).toMatchObject({
      kind: 'scratch-failure-issue-draft',
      labels: ['needs-triage', 'bug'],
      discoveredFromIssueId: 'scratch-child'
    });
    expect(result.draftIssue?.copyableIssueText).toContain('type: bug');
    expect(result.draftIssue?.copyableIssueText).toContain('qaFailureFingerprint: qa-failure:/repos/sample-repo:scratch-parent:');
  });

  it('marks only failed items as filed and records the tracker issue id in history', () => {
    const repository = new QaStorageRepository();
    const payload = createBeadsQaSessionFromParent('parent-1', beadsIssues, repo, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const [failedItem, pendingItem, passedItem, skippedItem, alreadyFiledItem] = payload.items;

    expect(() => handleQaToDoMcpToolCall(repository, 'qa_failed_item_mark_filed', {
      itemId: failedItem.id,
      filedIssueId: 'bug-2'
    })).toThrow('sessionId is required.');
    expect(() => handleQaToDoMcpToolCall(repository, 'qa_failed_item_mark_filed', {
      sessionId,
      filedIssueId: 'bug-2'
    })).toThrow('itemId is required.');
    expect(() => handleQaToDoMcpToolCall(repository, 'qa_failed_item_mark_filed', {
      sessionId,
      itemId: failedItem.id,
      filedIssueId: '   '
    })).toThrow('filedIssueId is required.');
    repository.togglePassItem(sessionId, passedItem.id, '2026-05-12T09:01:00.000Z');
    repository.skipItem(sessionId, skippedItem.id, 'Not applicable in this repo.', '2026-05-12T09:01:00.000Z');
    repository.failItem(sessionId, alreadyFiledItem.id, '2026-05-12T09:01:00.000Z');
    repository.markFailureFiled(sessionId, alreadyFiledItem.id, 'bug-1', '2026-05-12T09:01:30.000Z');

    for (const item of [pendingItem, passedItem, skippedItem, alreadyFiledItem]) {
      expect(() => handleQaToDoMcpToolCall(repository, 'qa_failed_item_mark_filed', {
        sessionId,
        itemId: item.id,
        filedIssueId: 'bug-2'
      })).toThrow('Only failed QA items can be marked failed-filed.');
    }

    repository.failItem(sessionId, failedItem.id, '2026-05-12T09:01:00.000Z');
    saveActualBehavior(repository, sessionId, failedItem, 'The import panel stays empty.');
    const result = handleQaToDoMcpToolCall(repository, 'qa_failed_item_mark_filed', {
      sessionId,
      itemId: failedItem.id,
      filedIssueId: 'bug-2'
    }, { now: '2026-05-12T09:02:00.000Z' });
    const stored = repository.getFailedQaItem(sessionId, failedItem.id);
    repository.close();

    expect(result).toEqual({
      schemaVersion: 1,
      kind: 'qa-failed-item.mark-filed',
      sessionId,
      itemId: failedItem.id,
      status: 'failed-filed',
      filedIssueId: 'bug-2'
    });
    expect(stored.item.status).toBe('failed-filed');
    expect(stored.item.history).toContainEqual({ action: 'failed-filed', detail: 'bug-2', createdAt: '2026-05-12T09:02:00.000Z' });
  });

  it('publishes tool and parameter descriptions that explain failed status semantics', () => {
    expect(qaToDoMcpToolDefinitions.map((tool) => tool.name)).toEqual([
      'qa_failed_items_list',
      'qa_failed_item_get',
      'qa_failed_item_mark_filed'
    ]);
    expect(qaToDoMcpToolDefinitions[0].description).toContain('failed means user-provided failure evidence exists');
    expect(qaToDoMcpToolDefinitions[0].description).toContain('failed-filed means a tracker issue has already been recorded');
    expect(qaToDoMcpToolDefinitions[0].inputSchema.properties.includeFiled.description).toContain('duplicate filing');
  });
});

function saveActualBehavior(
  repository: QaStorageRepository,
  sessionId: string,
  item: { readonly id: string; readonly title: string; readonly steps: readonly string[]; readonly expectedResult: string },
  actualBehavior: string
): void {
  repository.editItem(sessionId, item.id, {
    title: item.title,
    steps: item.steps,
    expectedResult: item.expectedResult,
    note: actualBehavior
  }, '2026-05-12T09:01:30.000Z');
}

async function createTemporaryMcpConfig(): Promise<QaToDoMcpConfig> {
  const root = await mkdtemp(join(tmpdir(), 'qa-to-do-mcp-'));
  return {
    inboxDir: join(root, 'inbox'),
    processedDir: join(root, 'processed'),
    quarantineDir: join(root, 'quarantine'),
    databasePath: join(root, 'qa-to-do.sqlite'),
    storageRoot: join(root, 'evidence')
  };
}

const repo = {
  name: 'sample-repo',
  path: '/repos/sample-repo'
};

const beadsIssues: BeadsIssue[] = [
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
  },
  {
    id: 'child-closed-2',
    title: 'Export QA sessions',
    status: 'closed',
    closed_at: '2026-05-12T08:10:00.000Z',
    description: `## Acceptance criteria

- The backup command restores archived QA sessions.
`,
    dependencies: [{ issue_id: 'child-closed-2', depends_on_id: 'parent-1', type: 'parent-child' }]
  },
  {
    id: 'child-closed-3',
    title: 'Archive QA sessions',
    status: 'closed',
    closed_at: '2026-05-12T08:20:00.000Z',
    description: `## Acceptance criteria

- The archive command hides completed QA sessions.
`,
    dependencies: [{ issue_id: 'child-closed-3', depends_on_id: 'parent-1', type: 'parent-child' }]
  },
  {
    id: 'child-closed-4',
    title: 'Restore QA sessions',
    status: 'closed',
    closed_at: '2026-05-12T08:30:00.000Z',
    description: `## Acceptance criteria

- The restore command brings back archived QA sessions.
`,
    dependencies: [{ issue_id: 'child-closed-4', depends_on_id: 'parent-1', type: 'parent-child' }]
  },
  {
    id: 'child-closed-5',
    title: 'Delete QA sessions',
    status: 'closed',
    closed_at: '2026-05-12T08:40:00.000Z',
    description: `## Acceptance criteria

- The delete command soft-deletes QA sessions.
`,
    dependencies: [{ issue_id: 'child-closed-5', depends_on_id: 'parent-1', type: 'parent-child' }]
  }
];

const scratchIssues: ScratchIssue[] = [
  {
    id: 'scratch-parent',
    title: 'Scratch parent feature',
    status: 'open',
    acceptanceNotes: ['Parent scope.']
  },
  {
    id: 'scratch-child',
    title: 'Render scratch workflow',
    status: 'closed',
    parent: 'scratch-parent',
    acceptanceNotes: ['The scratch workflow renders current content.'],
    filePath: '/repos/sample-repo/.scratch/scratch-child.md'
  }
];

const qaSessionIssues: BeadsIssue[] = [
  {
    id: 'parent-1',
    title: 'QA parent',
    status: 'closed',
    priority: 1,
    description: 'Parent issue',
    dependencies: []
  },
  {
    id: 'child-1',
    title: 'Import QA sessions',
    status: 'closed',
    priority: 1,
    description: '## Acceptance criteria\n- Imported sessions appear in the active checklist.',
    dependencies: [{ issue_id: 'child-1', depends_on_id: 'parent-1', type: 'parent-child' }]
  }
];
