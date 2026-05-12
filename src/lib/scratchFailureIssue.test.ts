// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { confirmScratchFailureIssueDraft, draftScratchFailureIssue } from './scratchFailureIssue';

describe('.scratch failure issue flow', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('writes confirmed failures using structured .scratch markdown and preserves screenshot references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scratch-failure-'));
    temporaryDirectories.push(root);
    const scratchDir = join(root, '.scratch');
    await mkdir(scratchDir, { recursive: true });

    const draft = draftScratchFailureIssue(failureContext());

    expect(draft.title).toBe('Bug: Verify login redirect');
    expect(draft.dedupeFingerprint).toBe('qa-failure:/repos/sample-repo:parent-1:qa-item-fingerprint-1');
    expect(draft.copyableIssueText).toContain('app-storage://screenshots/session-1/item-1/callback.png');

    const result = await confirmScratchFailureIssueDraft(draft, scratchDir, {
      createdAt: '2026-05-12T10:00:00.000Z'
    });

    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('Expected created result');
    expect(result.issueId).toBe('qa-failure-parent-1-qa-item-fingerprint-1');

    const markdown = await readFile(result.issuePath, 'utf8');
    expect(markdown).toContain('---\nid: qa-failure-parent-1-qa-item-fingerprint-1\n');
    expect(markdown).toContain('type: bug\n');
    expect(markdown).toContain('status: open\n');
    expect(markdown).toContain('parent: child-1\n');
    expect(markdown).toContain('labels: needs-triage, bug\n');
    expect(markdown).toContain('qaFailureFingerprint: qa-failure:/repos/sample-repo:parent-1:qa-item-fingerprint-1\n');
    expect(markdown).toContain('## Actual behavior\n\nThe login flow stays on the callback screen.');
    expect(markdown).toContain('- callback.png (image/png, 1234 bytes): app-storage://screenshots/session-1/item-1/callback.png');
  });
});

function failureContext() {
  return {
    repo: { name: 'sample-repo', path: '/repos/sample-repo' },
    parentIssue: { id: 'parent-1', title: 'Parent feature' },
    item: {
      id: 'item-1',
      title: 'Verify login redirect',
      steps: ['Open the app', 'Complete the login flow'],
      expectedResult: 'The dashboard opens after login.',
      fingerprint: 'qa-item-fingerprint-1',
      sourceIssueId: 'child-1',
      sourceEvidence: [{ label: 'Acceptance notes', value: 'Users can log in.' }]
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
