// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBeadsQaSessionFromParent, type BeadsIssue } from './beadsQa';
import type { QaToDoMcpConfig } from './mcpConfig';
import { createQaToDoMcpServer } from './mcpServer';
import { QaStorageRepository } from './qaStorage';

interface RegisteredTool {
  readonly name: string;
  readonly config: { readonly description?: string; readonly inputSchema?: unknown };
  readonly handler: (input: Record<string, unknown>) => Promise<{ readonly content: readonly [{ readonly text: string }] }>;
}

const registeredTools = vi.hoisted((): RegisteredTool[] => []);

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(name: string, config: RegisteredTool['config'], handler: RegisteredTool['handler']): void {
      registeredTools.push({ name, config, handler });
    }

    async connect(): Promise<void> {}
  }
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {}
}));

describe('QA To Do MCP server', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    registeredTools.length = 0;
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('registers qa_failed_items_list against local QA To Do storage', async () => {
    const config = await createTemporaryMcpConfig(temporaryDirectories);
    const repository = new QaStorageRepository(config.databasePath, config.storageRoot);
    const payload = createBeadsQaSessionFromParent('parent-1', issues, repo, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const [failedItem, filedItem] = payload.items;

    repository.failItem(sessionId, failedItem.id, '2026-05-12T09:01:00.000Z');
    saveActualBehavior(repository, sessionId, failedItem, 'The import panel stays empty.');
    repository.failItem(sessionId, filedItem.id, '2026-05-12T09:02:00.000Z');
    repository.markFailureFiled(sessionId, filedItem.id, 'bug-1', '2026-05-12T09:03:00.000Z');
    repository.close();

    createQaToDoMcpServer(configEnv(config));
    const tool = registeredTool('qa_failed_items_list');

    expect(tool.config.description).toContain('failed means user-provided failure evidence exists');
    expect(tool.config.description).toContain('failed-filed means a tracker issue has already been recorded');
    const response = JSON.parse((await tool.handler({})).content[0].text);

    expect(response).toMatchObject({
      schemaVersion: 1,
      kind: 'qa-failed-items.list',
      includeFiled: false,
      statusLegend: {
        failed: 'User-provided failure evidence exists, but no tracker issue has been confirmed filed.'
      },
      items: [
        {
          schemaVersion: 1,
          kind: 'qa-failed-item.row',
          sessionId,
          itemId: failedItem.id,
          repo: { name: 'sample-repo', path: '/repos/sample-repo' },
          parentIssue: { id: 'parent-1', title: 'Parent feature' },
          sourceIssue: { id: 'child-closed' },
          actualBehavior: 'The import panel stays empty.',
          screenshotCount: 0,
          status: 'failed'
        }
      ]
    });
  });

  it('registers qa_failed_item_get with saved app-storage screenshot references', async () => {
    const config = await createTemporaryMcpConfig(temporaryDirectories);
    const sourceDir = join(config.storageRoot, 'source');
    mkdirSync(sourceDir, { recursive: true });
    const sourcePath = join(sourceDir, 'failure.png');
    writeFileSync(sourcePath, 'png-bytes');
    const repository = new QaStorageRepository(config.databasePath, config.storageRoot);
    const payload = createBeadsQaSessionFromParent('parent-1', issues, repo, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const item = payload.items[0];

    repository.failItem(sessionId, item.id, '2026-05-12T09:01:00.000Z');
    saveActualBehavior(repository, sessionId, item, 'The import panel stays empty after refresh.');
    repository.attachFailureScreenshot(sessionId, item.id, {
      sourcePath,
      originalName: 'failure.png',
      mimeType: 'image/png'
    }, '2026-05-12T09:02:00.000Z');
    repository.close();

    createQaToDoMcpServer(configEnv(config));
    const tool = registeredTool('qa_failed_item_get');

    expect(tool.config.description).toContain('saved actual behavior');
    const response = JSON.parse((await tool.handler({ sessionId, itemId: item.id })).content[0].text);

    expect(response).toMatchObject({
      schemaVersion: 1,
      kind: 'qa-failed-item.detail',
      sessionId,
      itemId: item.id,
      status: 'failed',
      tracker: 'beads',
      actualBehavior: 'The import panel stays empty after refresh.',
      failureContext: {
        repo: { name: 'sample-repo', path: '/repos/sample-repo' },
        parentIssue: { id: 'parent-1', title: 'Parent feature' },
        item: {
          id: item.id,
          steps: item.steps,
          expectedResult: item.expectedResult,
          fingerprint: item.fingerprint,
          sourceIssueId: 'child-closed',
          sourceEvidence: item.sourceEvidence
        },
        actualBehavior: 'The import panel stays empty after refresh.',
        screenshots: [
          expect.objectContaining({
            name: 'failure.png',
            mimeType: 'image/png',
            sizeBytes: 9,
            localReference: expect.stringContaining('app-storage://screenshots/')
          })
        ]
      },
      screenshots: [
        expect.objectContaining({
          originalName: 'failure.png',
          localReference: expect.stringContaining('app-storage://screenshots/'),
          localPath: expect.stringContaining(join('screenshots', sessionId, item.id))
        })
      ],
      draftIssue: expect.objectContaining({
        kind: 'beads-failure-issue-draft',
        issueType: 'bug',
        labels: ['needs-triage', 'bug'],
        discoveredFromIssueId: 'child-closed',
        dedupeFingerprint: `qa-failure:/repos/sample-repo:parent-1:${item.fingerprint}`
      })
    });
    expect(response.draftIssue.copyableIssueText).toContain('QA-Failure-Fingerprint');
    expect(response.draftIssue.copyableIssueText).toContain('app-storage://screenshots/');
    expect(JSON.stringify(response)).not.toContain('png-bytes');
  });

  it('registers qa_failed_item_mark_filed against local QA To Do storage', async () => {
    const config = await createTemporaryMcpConfig(temporaryDirectories);
    const repository = new QaStorageRepository(config.databasePath, config.storageRoot);
    const payload = createBeadsQaSessionFromParent('parent-1', issues, repo, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const item = payload.items[0];

    repository.failItem(sessionId, item.id, '2026-05-12T09:01:00.000Z');
    saveActualBehavior(repository, sessionId, item, 'The import panel stays empty after refresh.');
    repository.close();

    createQaToDoMcpServer(configEnv(config));
    const tool = registeredTool('qa_failed_item_mark_filed');

    expect(tool.config.description).toContain('This never creates tracker issues');
    const response = JSON.parse((await tool.handler({ sessionId, itemId: item.id, filedIssueId: 'bug-2' })).content[0].text);
    const storedRepository = new QaStorageRepository(config.databasePath, config.storageRoot);
    const stored = storedRepository.getFailedQaItem(sessionId, item.id);
    storedRepository.close();

    expect(response).toEqual({
      schemaVersion: 1,
      kind: 'qa-failed-item.mark-filed',
      sessionId,
      itemId: item.id,
      status: 'failed-filed',
      filedIssueId: 'bug-2'
    });
    expect(stored.item.status).toBe('failed-filed');
    expect(stored.item.history).toContainEqual(expect.objectContaining({ action: 'failed-filed', detail: 'bug-2' }));
  });
});

async function createTemporaryMcpConfig(temporaryDirectories: string[]): Promise<QaToDoMcpConfig> {
  const root = await mkdtemp(join(tmpdir(), 'qa-to-do-mcp-server-'));
  temporaryDirectories.push(root);
  return {
    inboxDir: join(root, 'inbox'),
    processedDir: join(root, 'processed'),
    quarantineDir: join(root, 'quarantine'),
    databasePath: join(root, 'qa-to-do.sqlite'),
    storageRoot: join(root, 'evidence')
  };
}

function registeredTool(name: string): RegisteredTool {
  const tool = registeredTools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Expected ${name} to be registered.`);
  }
  return tool;
}

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

function configEnv(config: QaToDoMcpConfig): NodeJS.ProcessEnv {
  return {
    QA_TO_DO_INBOX_DIR: config.inboxDir,
    QA_TO_DO_PROCESSED_DIR: config.processedDir,
    QA_TO_DO_QUARANTINE_DIR: config.quarantineDir,
    QA_TO_DO_DB_PATH: config.databasePath,
    QA_TO_DO_STORAGE_ROOT: config.storageRoot
  };
}

const repo = {
  name: 'sample-repo',
  path: '/repos/sample-repo'
};

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
    dependencies: [{ issue_id: 'child-closed', depends_on_id: 'parent-1', type: 'parent-child' }]
  },
  {
    id: 'child-filed',
    title: 'Export QA sessions',
    status: 'closed',
    dependencies: [{ issue_id: 'child-filed', depends_on_id: 'parent-1', type: 'parent-child' }]
  }
];
