<script lang="ts">
  import { createInitialShellState, emptyStateCommand, type ConfigHealthItem } from './lib/appShell';

  const state = createInitialShellState();

  function healthLabel(item: ConfigHealthItem): string {
    switch (item.state) {
      case 'ready':
        return 'Ready';
      case 'needs-setup':
        return 'Needs setup';
      case 'unknown':
        return 'Not checked';
    }
  }
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
  {/if}

  <section class="health" aria-labelledby="health-title">
    <div class="section-heading">
      <p class="section-kicker">Read-only setup health</p>
      <h2 id="health-title">Prerequisites</h2>
    </div>

    <div class="health-grid">
      {#each state.configHealth as item}
        <article class="health-card" aria-labelledby={`${item.id}-label`}>
          <div class="health-card__topline">
            <h3 id={`${item.id}-label`}>{item.label}</h3>
            <span class={`status status--${item.state}`}>{healthLabel(item)}</span>
          </div>
          <p>{item.summary}</p>
        </article>
      {/each}
    </div>
  </section>
</main>
