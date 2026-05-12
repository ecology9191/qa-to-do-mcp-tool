// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmBeadsFailureIssueDraft,
  draftBeadsFailureIssue,
  type BeadsFailureIssueTracker
} from './beadsFailureIssue';

describe('Beads failure issue flow', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('drafts a reviewable failure issue without mutating Beads', () => {
    const draft = draftBeadsFailureIssue(failureContext());

    expect(draft.title).toBe('Bug: Verify login redirect');
    expect(draft.issueType).toBe('bug');
    expect(draft.labels).toEqual(['needs-triage', 'bug']);
    expect(draft.discoveredFromIssueId).toBe('child-1');
    expect(draft.dedupeFingerprint).toBe('qa-failure:/repos/sample-repo:parent-1:qa-item-fingerprint-1');
    expect(draft.description).toContain('Actual behavior');
    expect(draft.description).toContain('The login flow stays on the callback screen.');
    expect(draft.description).toContain('app-storage://screenshots/session-1/item-1/callback.png');
    expect(draft.copyableIssueText).toContain('Labels: needs-triage, bug');
    expect(draft.copyableIssueText).toContain('discovered-from: child-1');
  });

  it('requires explicit confirmation before creating or updating a deduped Beads bug', async () => {
    const tracker = createTracker({ existingIssueId: 'bug-7' });
    const draft = draftBeadsFailureIssue(failureContext({ sourceIssueId: null }));

    const result = await confirmBeadsFailureIssueDraft(draft, tracker);

    expect(result).toEqual({ status: 'updated', issueId: 'bug-7', discoveredFromIssueId: 'parent-1' });
    expect(tracker.createIssue).not.toHaveBeenCalled();
    expect(tracker.updateIssue).toHaveBeenCalledWith('bug-7', expect.objectContaining({ dedupeFingerprint: draft.dedupeFingerprint }));
    expect(tracker.linkIssue).toHaveBeenCalledWith('bug-7', 'parent-1', 'discovered-from');
  });

  it('creates a labeled Beads bug when no dedupe match exists', async () => {
    const tracker = createTracker();
    const draft = draftBeadsFailureIssue(failureContext());

    const result = await confirmBeadsFailureIssueDraft(draft, tracker);

    expect(result).toEqual({ status: 'created', issueId: 'bug-1', discoveredFromIssueId: 'child-1' });
    expect(tracker.createIssue).toHaveBeenCalledWith({
      title: 'Bug: Verify login redirect',
      description: draft.description,
      issueType: 'bug',
      labels: ['needs-triage', 'bug'],
      dedupeFingerprint: draft.dedupeFingerprint
    });
    expect(tracker.linkIssue).toHaveBeenCalledWith('bug-1', 'child-1', 'discovered-from');
  });

  it('preserves the failed draft locally with recovery guidance when Beads mutation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-failure-draft-'));
    temporaryDirectories.push(root);
    const tracker = createTracker({ createError: new Error('bd create failed: lock busy') });
    const draft = draftBeadsFailureIssue(failureContext());

    const result = await confirmBeadsFailureIssueDraft(draft, tracker, {
      failedDraftsDir: root,
      attemptedAt: '2026-05-12T10:00:00.000Z'
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('Expected failed result');
    expect(result.errorMessage).toBe('bd create failed: lock busy');
    expect(result.recoveryGuidance).toContain('Retry confirmation after Beads is available');
    expect(result.recoveryGuidance).toContain('copy the preserved issue text');
    expect(result.copyableIssueText).toBe(draft.copyableIssueText);

    const preserved = JSON.parse(await readFile(result.draftPath, 'utf8')) as { readonly draft: { readonly title: string } };
    expect(preserved.draft.title).toBe('Bug: Verify login redirect');
  });
});

function createTracker(options: { readonly existingIssueId?: string; readonly createError?: Error } = {}): BeadsFailureIssueTracker {
  return {
    findIssueByFingerprint: vi.fn(async () =>
      options.existingIssueId ? { id: options.existingIssueId, status: 'open' } : undefined
    ),
    createIssue: vi.fn(async () => {
      if (options.createError) throw options.createError;
      return { id: 'bug-1' };
    }),
    updateIssue: vi.fn(async () => undefined),
    linkIssue: vi.fn(async () => undefined)
  };
}

function failureContext(overrides: { readonly sourceIssueId?: string | null } = {}) {
  const sourceIssueId = overrides.sourceIssueId === undefined ? 'child-1' : overrides.sourceIssueId;
  return {
    repo: { name: 'sample-repo', path: '/repos/sample-repo' },
    parentIssue: { id: 'parent-1', title: 'Parent feature' },
    item: {
      id: 'item-1',
      title: 'Verify login redirect',
      steps: ['Open the app', 'Complete the login flow'],
      expectedResult: 'The dashboard opens after login.',
      fingerprint: 'qa-item-fingerprint-1',
      ...(sourceIssueId === null ? {} : { sourceIssueId }),
      sourceEvidence: [{ label: 'Acceptance criteria', value: 'Users can log in.' }]
    },
    actualBehavior: 'The login flow stays on the callback screen.',
    screenshots: [
      {
        name: 'callback.png',
        mimeType: 'image/png',
        sizeBytes: 1234,
        localReference: 'app-storage://screenshots/session-1/item-1/callback.png'
      }
    ]
  };
}
