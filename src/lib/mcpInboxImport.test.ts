// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createBeadsQaSessionFromParent, type BeadsIssue } from './beadsQa';
import { importQaSessionInboxEntries } from './inboxImporter';
import { writeQaSessionInboxEntry } from './mcpInbox';
import { QaStorageRepository } from './qaStorage';
import { validateQaSessionPayload, QaSessionValidationError } from './qaSession';
import { runToQaForBeadsParent, runToQaForScratchParent } from './toQa';

describe('MCP inbox import', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('imports validated MCP inbox JSON into SQLite as the most recent active session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-to-do-'));
    temporaryDirectories.push(root);
    const inboxDir = join(root, 'inbox');
    const processedDir = join(root, 'processed');
    const quarantineDir = join(root, 'quarantine');
    const repository = new QaStorageRepository();

    const payload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');
    const entryPath = await writeQaSessionInboxEntry(inboxDir, payload, {
      correlationId: 'correlation-1',
      createdAt: '2026-05-12T09:00:01.000Z'
    });

    const result = await importQaSessionInboxEntries([entryPath], repository, processedDir, quarantineDir);
    const activeSession = repository.getMostRecentActiveSession();
    repository.close();

    expect(result.quarantinedEntries).toEqual([]);
    expect(result.importedSessionIds).toHaveLength(1);
    expect(activeSession).toMatchObject({
      title: 'sample-repo parent-1 QA',
      repoName: 'sample-repo',
      repoPath: '/repos/sample-repo',
      parentIssueId: 'parent-1',
      parentIssueTitle: 'Parent feature',
      tracker: 'beads'
    });
    expect(activeSession?.warnings).toContain('1 incomplete child issue(s) were excluded from QA: child-open (open)');
    expect(activeSession?.sourceEvidence).toContainEqual({ label: 'Completed Beads children', value: 'child-closed' });
    expect(activeSession?.items[0]).toMatchObject({
      title: 'Verify Import QA sessions',
      sourceIssueId: 'child-closed',
      confidence: 'normal'
    });
    expect(activeSession?.items[0].sourceEvidence).toContainEqual({
      label: 'Acceptance criteria',
      value: 'The dashboard shows the imported QA session with repo context.'
    });
  });

  it('runs the /to-qa Beads parent flow from issues JSONL through inbox import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-to-do-'));
    temporaryDirectories.push(root);
    const repoPath = join(root, 'sample-repo');
    const beadsDir = join(repoPath, '.beads');
    await mkdir(beadsDir, { recursive: true });
    await writeFile(join(beadsDir, 'issues.jsonl'), `${issues.map((issue) => JSON.stringify(issue)).join('\n')}\n`);
    const repository = new QaStorageRepository();

    const result = await runToQaForBeadsParent({
      parentIssueId: 'parent-1',
      repoPath,
      repoName: 'sample-repo',
      inboxDir: join(root, 'inbox'),
      processedDir: join(root, 'processed'),
      quarantineDir: join(root, 'quarantine'),
      repository,
      generatedAt: '2026-05-12T09:00:00.000Z',
      correlationId: 'correlation-1'
    });
    repository.close();

    expect(result.importResult.quarantinedEntries).toEqual([]);
    expect(result.activeSession.title).toBe('sample-repo parent-1 QA');
    expect(result.activeSession.items).toHaveLength(1);
    expect(result.activeSession.warnings).toContain('1 incomplete child issue(s) were excluded from QA: child-open (open)');
  });

  it('runs the /to-qa structured .scratch parent flow through inbox import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-to-do-'));
    temporaryDirectories.push(root);
    const repoPath = join(root, 'sample-repo');
    const scratchDir = join(repoPath, '.scratch');
    await mkdir(scratchDir, { recursive: true });
    await writeFile(join(scratchDir, 'parent-1.md'), scratchIssue({ id: 'parent-1', title: 'Parent feature', status: 'open' }));
    await writeFile(
      join(scratchDir, 'child-closed.md'),
      scratchIssue({
        id: 'child-closed',
        title: 'Import QA sessions',
        status: 'closed',
        parent: 'parent-1',
        acceptanceNotes: ['The dashboard shows the imported QA session with repo context.']
      })
    );
    const repository = new QaStorageRepository();

    const result = await runToQaForScratchParent({
      parentIssueId: 'parent-1',
      repoPath,
      repoName: 'sample-repo',
      inboxDir: join(root, 'inbox'),
      processedDir: join(root, 'processed'),
      quarantineDir: join(root, 'quarantine'),
      repository,
      generatedAt: '2026-05-12T09:00:00.000Z',
      correlationId: 'correlation-1'
    });
    repository.close();

    expect(result.importResult.quarantinedEntries).toEqual([]);
    expect(result.activeSession).toMatchObject({
      title: 'sample-repo parent-1 QA',
      tracker: 'scratch',
      parentIssueId: 'parent-1'
    });
    expect(result.activeSession.items[0]).toMatchObject({ sourceIssueId: 'child-closed', confidence: 'normal' });
  });

  it('rejects invalid MCP payloads before inbox write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-to-do-'));
    temporaryDirectories.push(root);
    const payload = createBeadsQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    });
    const invalidPayload = {
      ...payload,
      items: [
        {
          ...payload.items[0],
          title: 'Review implementation',
          expectedResult: 'Works as expected'
        }
      ]
    };

    expect(() => validateQaSessionPayload(invalidPayload)).toThrow(QaSessionValidationError);
    await expect(writeQaSessionInboxEntry(join(root, 'inbox'), invalidPayload as never)).rejects.toThrow(
      QaSessionValidationError
    );
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
  },
  {
    id: 'child-open',
    title: 'Future checklist execution',
    status: 'open',
    dependencies: [{ issue_id: 'child-open', depends_on_id: 'parent-1', type: 'parent-child' }]
  }
];

interface ScratchIssueFixture {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly parent?: string;
  readonly acceptanceNotes?: readonly string[];
}

function scratchIssue(issue: ScratchIssueFixture): string {
  const parent = issue.parent ? `parent: ${issue.parent}\n` : '';
  const acceptanceNotes = issue.acceptanceNotes?.length
    ? `\n## Acceptance notes\n\n${issue.acceptanceNotes.map((note) => `- ${note}`).join('\n')}\n`
    : '';

  return `---\nid: ${issue.id}\ntitle: ${issue.title}\nstatus: ${issue.status}\n${parent}---\n\n## Summary\n\n${issue.title}\n${acceptanceNotes}`;
}
