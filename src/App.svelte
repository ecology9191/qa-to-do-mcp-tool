<script lang="ts">
  import { createInitialShellState, emptyStateCommand, type AppShellState, type HealthState } from './lib/appShell';

  interface AppProps {
    readonly initialState?: AppShellState;
  }

  let { initialState = createInitialShellState() }: AppProps = $props();
  const state = $derived(initialState);
  const healthLabels: Record<HealthState, string> = {
    ready: 'Ready',
    'needs-setup': 'Needs setup',
    unknown: 'Not checked'
  };
</script>

<svelte:head>
  <title>QA To Do</title>
</svelte:head>

<main class="shell" aria-labelledby="app-title">
  <header class="hero">
    <p class="eyebrow">Sandcastle / RALPH</p>
    <h1 id="app-title">QA To Do</h1>
    <p class="lede">A local-first checklist for human QA after agent-generated software work.</p>
  </header>

  {#if state.sessions.length === 0}
    <section class="empty-state" aria-labelledby="empty-title">
      <div>
        <p class="section-kicker">No QA sessions yet</p>
        <h2 id="empty-title">Create one from your repo agent</h2>
        <p>
          Run <code>{emptyStateCommand}</code> from an agent-enabled repository after RALPH completes work.
          The agent will inspect the parent issue, write a validated MCP inbox message, and the app will import the session locally.
        </p>
      </div>
      <div class="command-card" aria-label="Session creation command">
        <span>Primary workflow</span>
        <code>{emptyStateCommand}</code>
      </div>
    </section>
  {:else}
    <section class="active-session" aria-labelledby="active-session-title">
      <div>
        <p class="section-kicker">Most recent active session</p>
        <h2 id="active-session-title">{state.sessions[0].title}</h2>
        <p>
          Imported from <strong>{state.sessions[0].repoName}</strong> via {state.sessions[0].tracker}, parent
          <code>{state.sessions[0].parentIssueId}</code>: {state.sessions[0].parentIssueTitle}.
        </p>
      </div>
      <div class="active-session__meta" aria-label="Active session metadata">
        <span>{state.sessions[0].itemCount} QA item{state.sessions[0].itemCount === 1 ? '' : 's'}</span>
        {#if state.sessions[0].warnings.length > 0}
          <span>{state.sessions[0].warnings.length} warning{state.sessions[0].warnings.length === 1 ? '' : 's'}</span>
        {/if}
      </div>
      {#if state.sessions[0].warnings.length > 0}
        <ul class="warning-list" aria-label="Session warnings">
          {#each state.sessions[0].warnings as warning}
            <li>{warning}</li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <section class="health" aria-labelledby="health-title">
    <div class="section-heading">
      <p class="section-kicker">Read-only setup health</p>
      <h2 id="health-title">Prerequisites</h2>
    </div>

    <div class="health-grid">
      {#each state.configHealth as item (item.id)}
        <article class="health-card" aria-labelledby={`${item.id}-label`}>
          <div class="health-card__topline">
            <h3 id={`${item.id}-label`}>{item.label}</h3>
            <span class={`status status--${item.state}`}>{healthLabels[item.state]}</span>
          </div>
          <p>{item.summary}</p>
        </article>
      {/each}
    </div>
  </section>
</main>
