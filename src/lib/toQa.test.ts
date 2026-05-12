// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QaStorageRepository } from './qaStorage';
import { runToQaForParent, TrackerChoiceRequiredError } from './toQa';

describe('/to-qa tracker selection', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('asks once when Beads and .scratch are both detected, then remembers the repo tracker choice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'to-qa-trackers-'));
    temporaryDirectories.push(root);
    const repoPath = join(root, 'sample-repo');
    await writeBeadsIssues(repoPath);
    await writeScratchIssues(repoPath);
    const repository = new QaStorageRepository();
    const chooseTracker = vi.fn(() => 'scratch' as const);

    const firstResult = await runToQaForParent({
      parentIssueId: 'parent-1',
      repoPath,
      repoName: 'sample-repo',
      inboxDir: join(root, 'inbox'),
      processedDir: join(root, 'processed'),
      quarantineDir: join(root, 'quarantine'),
      repository,
      generatedAt: '2026-05-12T09:00:00.000Z',
      correlationId: 'correlation-1',
      chooseTracker
    });
    const secondResult = await runToQaForParent({
      parentIssueId: 'parent-1',
      repoPath,
      repoName: 'sample-repo',
      inboxDir: join(root, 'inbox'),
      processedDir: join(root, 'processed'),
      quarantineDir: join(root, 'quarantine'),
      repository,
      generatedAt: '2026-05-12T09:01:00.000Z',
      correlationId: 'correlation-2',
      chooseTracker
    });
    repository.close();

    expect(chooseTracker).toHaveBeenCalledTimes(1);
    expect(chooseTracker).toHaveBeenCalledWith({ repoPath, detectedTrackers: ['beads', 'scratch'] });
    expect(firstResult.activeSession.tracker).toBe('scratch');
    expect(secondResult.activeSession.tracker).toBe('scratch');
  });

  it('fails with selection guidance instead of guessing when no chooser is available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'to-qa-trackers-'));
    temporaryDirectories.push(root);
    const repoPath = join(root, 'sample-repo');
    await writeBeadsIssues(repoPath);
    await writeScratchIssues(repoPath);
    const repository = new QaStorageRepository();

    await expect(
      runToQaForParent({
        parentIssueId: 'parent-1',
        repoPath,
        repoName: 'sample-repo',
        inboxDir: join(root, 'inbox'),
        processedDir: join(root, 'processed'),
        quarantineDir: join(root, 'quarantine'),
        repository
      })
    ).rejects.toThrow(TrackerChoiceRequiredError);
    repository.close();
  });

  it('allows the remembered tracker choice to change without deleting existing QA sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'to-qa-trackers-'));
    temporaryDirectories.push(root);
    const repoPath = join(root, 'sample-repo');
    await writeBeadsIssues(repoPath);
    await writeScratchIssues(repoPath);
    const repository = new QaStorageRepository();

    const firstResult = await runToQaForParent({
      parentIssueId: 'parent-1',
      repoPath,
      repoName: 'sample-repo',
      inboxDir: join(root, 'inbox'),
      processedDir: join(root, 'processed'),
      quarantineDir: join(root, 'quarantine'),
      repository,
      generatedAt: '2026-05-12T09:00:00.000Z',
      correlationId: 'correlation-1',
      chooseTracker: () => 'scratch'
    });

    repository.setRepoTrackerPreference(repoPath, 'beads');

    const secondResult = await runToQaForParent({
      parentIssueId: 'parent-1',
      repoPath,
      repoName: 'sample-repo',
      inboxDir: join(root, 'inbox'),
      processedDir: join(root, 'processed'),
      quarantineDir: join(root, 'quarantine'),
      repository,
      generatedAt: '2026-05-12T09:01:00.000Z',
      correlationId: 'correlation-2'
    });
    const activeSession = repository.getMostRecentActiveSession();
    repository.close();

    expect(firstResult.activeSession.tracker).toBe('scratch');
    expect(secondResult.activeSession.tracker).toBe('beads');
    expect(activeSession?.tracker).toBe('beads');
    expect(firstResult.activeSession.id).toBeDefined();
  });
});

async function writeBeadsIssues(repoPath: string): Promise<void> {
  const beadsDir = join(repoPath, '.beads');
  await mkdir(beadsDir, { recursive: true });
  const issues = [
    { id: 'parent-1', title: 'Parent feature', status: 'open' },
    {
      id: 'child-closed',
      title: 'Import QA sessions',
      status: 'closed',
      description: '## Acceptance criteria\n\n- The dashboard shows the imported QA session with repo context.\n',
      dependencies: [{ issue_id: 'child-closed', depends_on_id: 'parent-1', type: 'parent-child' }]
    }
  ];
  await writeFile(join(beadsDir, 'issues.jsonl'), `${issues.map((issue) => JSON.stringify(issue)).join('\n')}\n`);
}

async function writeScratchIssues(repoPath: string): Promise<void> {
  const scratchDir = join(repoPath, '.scratch');
  await mkdir(scratchDir, { recursive: true });
  await writeFile(join(scratchDir, 'parent-1.md'), scratchIssue('parent-1', 'Parent feature', 'open'));
  await writeFile(
    join(scratchDir, 'child-closed.md'),
    scratchIssue('child-closed', 'Import QA sessions', 'closed', 'parent-1')
  );
}

function scratchIssue(id: string, title: string, status: string, parent?: string): string {
  const parentLine = parent ? `parent: ${parent}\n` : '';
  return `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\n${parentLine}---\n\n## Acceptance notes\n\n- The dashboard shows the imported QA session with repo context.\n`;
}
