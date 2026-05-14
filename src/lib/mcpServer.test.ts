// @vitest-environment node
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
  it('registers qa_failed_items_list against local QA To Do storage', async () => {
    registeredTools.length = 0;
    const config = await createTemporaryMcpConfig();
    const repository = new QaStorageRepository(config.databasePath, config.storageRoot);
    const payload = createBeadsQaSessionFromParent('parent-1', issues, repo, '2026-05-12T09:00:00.000Z');
    const sessionId = repository.importSession(payload, '2026-05-12T09:00:01.000Z');
    const [failedItem, filedItem] = payload.items;

    repository.failItem(sessionId, failedItem.id, '2026-05-12T09:01:00.000Z');
    repository.editItem(sessionId, failedItem.id, {
      title: failedItem.title,
      steps: failedItem.steps,
      expectedResult: failedItem.expectedResult,
      note: 'The import panel stays empty.'
    }, '2026-05-12T09:01:30.000Z');
    repository.failItem(sessionId, filedItem.id, '2026-05-12T09:02:00.000Z');
    repository.markFailureFiled(sessionId, filedItem.id, 'bug-1', '2026-05-12T09:03:00.000Z');
    repository.close();

    createQaToDoMcpServer(configEnv(config));
    const tool = registeredTools.find((candidate) => candidate.name === 'qa_failed_items_list');

    expect(tool?.config.description).toContain('failed means user-provided failure evidence exists');
    expect(tool?.config.description).toContain('failed-filed means a tracker issue has already been recorded');
    const response = JSON.parse((await tool!.handler({})).content[0].text);

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
});

async function createTemporaryMcpConfig(): Promise<QaToDoMcpConfig> {
  const root = await mkdtemp(join(tmpdir(), 'qa-to-do-mcp-server-'));
  return {
    inboxDir: join(root, 'inbox'),
    processedDir: join(root, 'processed'),
    quarantineDir: join(root, 'quarantine'),
    databasePath: join(root, 'qa-to-do.sqlite'),
    storageRoot: join(root, 'evidence')
  };
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
