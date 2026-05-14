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

  it('uses completed discovered-from issues when the requested issue has no parent-child children', () => {
    const payload = createBeadsQaSessionFromParent('cumulative-parent', cumulativeDiscoveredFromIssues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');

    expect(payload.source.parentIssue).toMatchObject({ id: 'cumulative-parent', title: 'Older cumulative feature' });
    expect(payload.source.sourceIssues.map((issue) => issue.id)).toEqual(['discovered-done']);
    expect(payload.items.map((item) => item.sourceIssueId)).toEqual(['discovered-done']);
    expect(payload.items[0].fingerprint).toBe('beads:/repos/sample-repo:cumulative-parent:discovered-done');
    expect(payload.source.sessionEvidence).toContainEqual({
      label: 'Cumulative fallback',
      value:
        'No parent-child children found for cumulative-parent; source work came from older Sandcastle cumulative Beads.'
    });
    expect(payload.warnings).toContain(
      'No parent-child children found for cumulative-parent; used cumulative Sandcastle fallback source work.'
    );
    expect(payload.warnings).toContain(
      '1 incomplete discovered-from issue(s) were excluded from QA: discovered-open (open)'
    );
  });

  it('uses completed legacy children when the parent Beads issue is missing', () => {
    const payload = createBeadsQaSessionFromParent('legacy-parent', legacyMissingParentIssues, {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');

    expect(payload.source.parentIssue).toMatchObject({
      id: 'legacy-parent',
      title: 'Legacy Beads source legacy-parent',
      status: 'missing'
    });
    expect(payload.source.sourceIssues.map((issue) => issue.id)).toEqual(['legacy-child-1', 'legacy-child-2']);
    expect(payload.items.map((item) => item.sourceIssueId)).toEqual(['legacy-child-1', 'legacy-child-2']);
    expect(payload.warnings).toContain(
      'Parent issue legacy-parent was not found; used legacy child issue(s) that still reference it.'
    );
  });

  it('uses the completed requested issue itself when no related issues exist', () => {
    const payload = createBeadsQaSessionFromParent('standalone-done', [standaloneCompletedIssue], {
      name: 'sample-repo',
      path: '/repos/sample-repo'
    }, '2026-05-12T09:00:00.000Z');

    expect(payload.source.parentIssue).toMatchObject({ id: 'standalone-done', title: 'Standalone cumulative feature' });
    expect(payload.source.sourceIssues.map((issue) => issue.id)).toEqual(['standalone-done']);
    expect(payload.items.map((item) => item.sourceIssueId)).toEqual(['standalone-done']);
    expect(payload.items[0].fingerprint).toBe('beads:/repos/sample-repo:standalone-done:standalone-done');
    expect(payload.source.sessionEvidence).toContainEqual({
      label: 'Cumulative fallback',
      value: 'No parent-child children found for standalone-done; source work came from older Sandcastle cumulative Beads.'
    });
    expect(payload.warnings).toContain(
      'No parent-child children found for standalone-done; used cumulative Sandcastle fallback source work.'
    );
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

const cumulativeDiscoveredFromIssues: BeadsIssue[] = [
  {
    id: 'cumulative-parent',
    title: 'Older cumulative feature',
    status: 'open'
  },
  {
    id: 'discovered-done',
    title: 'Implement cumulative behavior',
    status: 'done',
    dependencies: [{ issue_id: 'discovered-done', depends_on_id: 'cumulative-parent', type: 'discovered-from' }]
  },
  {
    id: 'discovered-open',
    title: 'Document cumulative behavior',
    status: 'open',
    dependencies: [{ issue_id: 'discovered-open', depends_on_id: 'cumulative-parent', type: 'discovered-from' }]
  }
];

const legacyMissingParentIssues: BeadsIssue[] = [
  {
    id: 'legacy-child-1',
    title: 'Import legacy session data',
    status: 'closed',
    dependencies: [{ issue_id: 'legacy-child-1', depends_on_id: 'legacy-parent', type: 'parent-child' }]
  },
  {
    id: 'legacy-child-2',
    title: 'Render legacy checklist rows',
    status: 'done',
    dependencies: [{ issue_id: 'legacy-child-2', depends_on_id: 'legacy-parent', type: 'parent-child' }]
  },
  {
    id: 'legacy-child-open',
    title: 'Document legacy checklist rows',
    status: 'open',
    dependencies: [{ issue_id: 'legacy-child-open', depends_on_id: 'legacy-parent', type: 'parent-child' }]
  }
];

const standaloneCompletedIssue: BeadsIssue = {
  id: 'standalone-done',
  title: 'Standalone cumulative feature',
  status: 'closed'
};
