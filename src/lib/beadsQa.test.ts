import { describe, expect, it } from 'vitest';
import { createBeadsQaSessionFromParent, NoCompletedSourceWorkError, type BeadsIssue } from './beadsQa';

describe('Beads QA session generation', () => {
  it('creates QA items only from closed child work and warns about incomplete children', () => {
    const payload = createBeadsQaSessionFromParent('parent-1', fixtureIssues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');

    expect(payload.title).toBe('sample-repo parent-1 QA');
    expect(payload.source.tracker).toBe('beads');
    expect(payload.source.parentIssue).toMatchObject({ id: 'parent-1', title: 'Parent feature' });
    expect(payload.source.sourceIssues.map((issue) => issue.id)).toEqual(['child-closed', 'child-completed']);
    expect(payload.items.map((item) => item.sourceIssueId)).toEqual(['child-closed', 'child-completed']);
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].expectedResult).toContain('The dashboard shows the imported QA session');
    expect(payload.items[0].sourceEvidence).toContainEqual({ label: 'Priority', value: '1' });
    expect(payload.warnings).toContain('1 incomplete child issue(s) were excluded from QA: child-open (open)');
  });

  it('marks inferred QA checks as low confidence without blocking session creation', () => {
    const payload = createBeadsQaSessionFromParent('parent-1', [fixtureIssues[0], fixtureIssues[2]], {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');

    expect(payload.items[0]).toMatchObject({ sourceIssueId: 'child-completed', confidence: 'low' });
    expect(payload.warnings[0]).toContain('no explicit acceptance criteria');
  });

  it('fails clearly instead of creating unrelated QA when the parent has no completed child work', () => {
    expect(() =>
      createBeadsQaSessionFromParent('parent-1', [fixtureIssues[0], fixtureIssues[3]], {
        name: 'sample-repo',
        path: '/repos/sample-repo'
      })
    ).toThrow(NoCompletedSourceWorkError);
  });
});

const fixtureIssues: BeadsIssue[] = [
  {
    id: 'parent-1',
    title: 'Parent feature',
    status: 'open'
  },
  {
    id: 'child-closed',
    title: 'Import QA sessions',
    status: 'closed',
    priority: 1,
    closed_at: '2026-05-12T08:00:00.000Z',
    close_reason: 'Completed by RALPH',
    description: `## What to build

Import MCP inbox JSON.

## Acceptance criteria

- The dashboard shows the imported QA session with repo context.
- The imported item keeps source evidence.
`,
    dependencies: [{ issue_id: 'child-closed', depends_on_id: 'parent-1', type: 'parent-child' }]
  },
  {
    id: 'child-completed',
    title: 'Show warning metadata',
    status: 'completed',
    dependencies: [{ issue_id: 'child-completed', depends_on_id: 'parent-1', type: 'parent-child' }]
  },
  {
    id: 'child-open',
    title: 'Future checklist execution',
    status: 'open',
    dependencies: [{ issue_id: 'child-open', depends_on_id: 'parent-1', type: 'parent-child' }]
  }
];
