import { fireEvent, render, screen } from '@testing-library/svelte';
import App from './App.svelte';
import { createShellStateFromActiveSession } from './lib/appShell';

describe('App shell', () => {
  it('shows the empty QA session workflow before any sessions exist', () => {
    render(App);

    expect(screen.getByRole('heading', { name: 'QA To Do' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create one from your repo agent' })).toBeInTheDocument();
    expect(screen.getAllByText('/to-qa <parent issue>', { selector: 'code' })).toHaveLength(2);
    expect(screen.getByText(/write a validated MCP inbox message/i)).toBeInTheDocument();
  });

  it('shows read-only health indicators without asking for secrets', () => {
    render(App);

    expect(screen.getByRole('heading', { name: 'Prerequisites' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'MCP registration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inbox writability' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tracker readiness' })).toBeInTheDocument();
    expect(screen.getByText(/No app-managed secrets/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key|token|password|secret/i)).not.toBeInTheDocument();
  });

  it('shows the most recent active session with repo and parent context', () => {
    render(App, {
      props: {
        initialState: createShellStateFromActiveSession({
          id: 'session-1',
          title: 'sample-repo parent-1 QA',
          repoName: 'sample-repo',
          parentIssueId: 'parent-1',
          parentIssueTitle: 'Parent feature',
          tracker: 'beads',
          warnings: ['1 incomplete child issue(s) were excluded from QA: child-open (open)'],
          itemCount: 2
        })
      }
    });

    expect(screen.getByRole('heading', { name: 'sample-repo parent-1 QA' })).toBeInTheDocument();
    expect(screen.getByText('sample-repo')).toBeInTheDocument();
    expect(screen.getByText('parent-1')).toBeInTheDocument();
    expect(screen.getByText(/2 QA items/i)).toBeInTheDocument();
    expect(screen.getByText(/child-open \(open\)/i)).toBeInTheDocument();
  });

  it('shows a compact QA checklist with expandable provenance and editable generated text', async () => {
    render(App, { props: { initialState: createChecklistState() } });

    expect(screen.getByRole('button', { name: /mark Verify login redirect passed/i })).toBeInTheDocument();
    expect(screen.getAllByText('child-1').length).toBeGreaterThan(0);
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /j\/k Navigate/i })).toBeInTheDocument();

    await fireEvent.keyDown(window, { key: 'Enter' });

    expect(screen.getByText('Steps')).toBeInTheDocument();
    expect(screen.getByText('Open the app')).toBeInTheDocument();
    expect(screen.getByText('Expected result')).toBeInTheDocument();
    expect(screen.getByText('Evidence')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /edit Verify login redirect/i }));
    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Verify login redirect after import' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));

    expect(screen.getByText('Verify login redirect after import')).toBeInTheDocument();
    expect(screen.getByText(/Original generated text/i)).toBeInTheDocument();
    expect(screen.getByText('Verify login redirect')).toBeInTheDocument();
  });

  it('supports keyboard pass, navigation, search suppression, skip reason, and history inspection', async () => {
    render(App, { props: { initialState: createChecklistState() } });

    await fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('passed')).toBeInTheDocument();

    await fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getAllByText('pending')).toHaveLength(2);

    await fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByRole('row', { name: /child-2 Verify audit export pending/i })).toHaveClass('is-selected');

    await fireEvent.click(screen.getByLabelText('Search checklist'));
    await fireEvent.input(screen.getByLabelText('Search checklist'), { target: { value: 'redirect' } });
    await fireEvent.keyDown(screen.getByLabelText('Search checklist'), { key: 'f' });
    expect(screen.queryByText('failed')).not.toBeInTheDocument();
    expect(screen.getByText('Verify login redirect')).toBeInTheDocument();
    expect(screen.queryByText('Verify audit export')).not.toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText('Search checklist'), { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: /skip Verify login redirect/i }));
    await fireEvent.input(screen.getByLabelText('Skip reason'), { target: { value: 'Covered by release smoke test' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save skip' }));

    expect(screen.getByText('skipped')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /history Verify login redirect/i }));
    expect(screen.getByText(/Skipped: Covered by release smoke test/i)).toBeInTheDocument();
  });
});

function createChecklistState() {
  return createShellStateFromActiveSession({
    id: 'session-1',
    title: 'sample-repo parent-1 QA',
    repoName: 'sample-repo',
    parentIssueId: 'parent-1',
    parentIssueTitle: 'Parent feature',
    tracker: 'beads',
    warnings: [],
    itemCount: 2,
    items: [
      {
        id: 'item-1',
        title: 'Verify login redirect',
        originalTitle: 'Verify login redirect',
        steps: ['Open the app', 'Complete the login flow'],
        originalSteps: ['Open the app', 'Complete the login flow'],
        expectedResult: 'The dashboard opens after login.',
        originalExpectedResult: 'The dashboard opens after login.',
        sourceIssueId: 'child-1',
        confidence: 'low',
        warnings: ['Generated from weak criteria'],
        sourceEvidence: [{ label: 'Acceptance criteria', value: 'Users can log in.' }],
        status: 'pending',
        history: []
      },
      {
        id: 'item-2',
        title: 'Verify audit export',
        originalTitle: 'Verify audit export',
        steps: ['Export audit log'],
        originalSteps: ['Export audit log'],
        expectedResult: 'A CSV file downloads.',
        originalExpectedResult: 'A CSV file downloads.',
        sourceIssueId: 'child-2',
        confidence: 'normal',
        warnings: [],
        sourceEvidence: [{ label: 'Acceptance criteria', value: 'Audit export downloads.' }],
        status: 'pending',
        history: []
      }
    ]
  });
}
