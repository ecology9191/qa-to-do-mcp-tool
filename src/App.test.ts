import { render, screen } from '@testing-library/svelte';
import App from './App.svelte';

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
});
