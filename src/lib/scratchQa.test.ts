// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createScratchQaSessionFromParent,
  readScratchIssues,
  ScratchSetupGuidanceError,
  type ScratchIssue
} from './scratchQa';

describe('.scratch QA session generation', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('creates QA items from structured .scratch child issue markdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scratch-qa-'));
    temporaryDirectories.push(root);
    const scratchDir = join(root, '.scratch');
    await mkdir(scratchDir, { recursive: true });
    await writeFile(join(scratchDir, 'parent-1.md'), structuredIssue({ id: 'parent-1', title: 'Parent feature', status: 'open' }));
    await writeFile(
      join(scratchDir, 'child-closed.md'),
      structuredIssue({
        id: 'child-closed',
        title: 'Import QA sessions',
        status: 'closed',
        parent: 'parent-1',
        acceptanceNotes: ['The dashboard shows the imported QA session with repo context.']
      })
    );
    await writeFile(
      join(scratchDir, 'child-open.md'),
      structuredIssue({ id: 'child-open', title: 'Future checklist execution', status: 'open', parent: 'parent-1' })
    );

    const issues = await readScratchIssues(scratchDir);
    const payload = createScratchQaSessionFromParent('parent-1', issues, {
      name: 'sample-repo',
      path: root
    }, '2026-05-12T09:00:00.000Z');

    expect(payload.title).toBe('sample-repo parent-1 QA');
    expect(payload.source.tracker).toBe('scratch');
    expect(payload.source.sourceIssues.map((issue) => issue.id)).toEqual(['child-closed']);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      id: 'scratch-child-closed',
      sourceIssueId: 'child-closed',
      expectedResult: 'The dashboard shows the imported QA session with repo context.'
    });
    expect(payload.items[0].fingerprint).toBe(`scratch:${root}:parent-1:child-closed`);
    expect(payload.source.sessionEvidence).toContainEqual({ label: 'Completed .scratch children', value: 'child-closed' });
    expect(payload.warnings).toContain('1 incomplete child issue(s) were excluded from QA: child-open (open)');
  });

  it('rejects freeform .scratch markdown with setup guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scratch-qa-'));
    temporaryDirectories.push(root);
    const scratchDir = join(root, '.scratch');
    await mkdir(scratchDir, { recursive: true });
    await writeFile(join(scratchDir, 'freeform.md'), '# Fix the login bug\n\nMake it work.\n');

    await expect(readScratchIssues(scratchDir)).rejects.toThrow(ScratchSetupGuidanceError);
    await expect(readScratchIssues(scratchDir)).rejects.toThrow('Use structured .scratch issue markdown');
  });
});

function structuredIssue(issue: ScratchIssue): string {
  const parent = issue.parent ? `parent: ${issue.parent}\n` : '';
  const acceptanceNotes = issue.acceptanceNotes?.length
    ? `\n## Acceptance notes\n\n${issue.acceptanceNotes.map((note) => `- ${note}`).join('\n')}\n`
    : '';

  return `---\nid: ${issue.id}\ntitle: ${issue.title}\nstatus: ${issue.status}\n${parent}---\n\n## Summary\n\n${issue.title}\n${acceptanceNotes}`;
}
