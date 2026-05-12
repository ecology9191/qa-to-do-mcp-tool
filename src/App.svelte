<script lang="ts">
  import {
    createInitialShellState,
    emptyStateCommand,
    type AppShellState,
    type FailureScreenshot,
    type HealthState,
    type QaChecklistHistoryAction,
    type QaChecklistHistoryEvent,
    type QaChecklistItem,
    type QaChecklistStatus
  } from './lib/appShell';

  interface AppProps {
    readonly initialState?: AppShellState;
  }

  interface InteractionSettings {
    passChimeMuted: boolean;
    passChimeVolume: number;
  }

  type ChecklistFilterStatus = 'all' | QaChecklistStatus;
  type BrowserAudioContextConstructor = new () => AudioContext;

  const interactionSettingsKey = 'qa-to-do.interaction-settings';
  const defaultInteractionSettings: InteractionSettings = {
    passChimeMuted: false,
    passChimeVolume: 0.35
  };

  let { initialState = createInitialShellState() }: AppProps = $props();
  let shellState: AppShellState = $state(createInitialShellState());
  let interactionSettings: InteractionSettings = $state(readInteractionSettings());
  const activeSession = $derived(shellState.sessions[0]);
  let selectedIndex = $state(0);
  let expandedItemId: string | undefined = $state();
  let editingItemId: string | undefined = $state();
  let skipItemId: string | undefined = $state();
  let historyItemId: string | undefined = $state();
  let searchQuery = $state('');
  let statusFilter: ChecklistFilterStatus = $state('all');
  let sourceFilter = $state('all');
  let editTitle = $state('');
  let editSteps = $state('');
  let editExpectedResult = $state('');
  let editNote = $state('');
  let skipReason = $state('');
  let failureComposerItemId: string | undefined = $state();
  let failureActualBehavior = $state('');
  let failureScreenshots: FailureScreenshot[] = $state([]);
  const passChimeVolumePercent = $derived(Math.round(interactionSettings.passChimeVolume * 100));
  const healthLabels: Record<HealthState, string> = {
    ready: 'Ready',
    'needs-setup': 'Needs setup',
    unknown: 'Not checked'
  };
  const sourceIssueOptions = $derived([...new Set((activeSession?.items ?? []).map((item) => item.sourceIssueId))]);
  const filteredItems = $derived((activeSession?.items ?? []).filter(matchesFilters));

  $effect.pre(() => {
    shellState = initialState;
  });

  function matchesFilters(item: QaChecklistItem): boolean {
    const query = searchQuery.trim().toLowerCase();
    const searchable = [
      item.title,
      item.sourceIssueId,
      item.expectedResult,
      ...item.steps,
      ...item.sourceEvidence.map((evidence) => `${evidence.label} ${evidence.value}`),
      activeSession?.repoName ?? '',
      activeSession?.title ?? ''
    ]
      .join(' ')
      .toLowerCase();

    return (
      (query.length === 0 || searchable.includes(query)) &&
      (statusFilter === 'all' || item.status === statusFilter) &&
      (sourceFilter === 'all' || item.sourceIssueId === sourceFilter)
    );
  }

  function selectedItem(): QaChecklistItem | undefined {
    return filteredItems[Math.min(selectedIndex, Math.max(filteredItems.length - 1, 0))];
  }

  function moveSelection(delta: number): void {
    if (filteredItems.length === 0) return;
    selectedIndex = Math.max(0, Math.min(filteredItems.length - 1, selectedIndex + delta));
  }

  function togglePass(item: QaChecklistItem): void {
    if (item.status === 'passed') {
      item.status = 'pending';
      recordHistory(item, 'unpassed');
      return;
    }
    item.status = 'passed';
    item.skipReason = undefined;
    recordHistory(item, 'passed');
    playPassChime(interactionSettings);
  }

  function failItem(item: QaChecklistItem): void {
    item.status = 'failed';
    item.skipReason = undefined;
    openFailureComposer(item);
    recordHistory(item, 'failed');
  }

  function openFailureComposer(item: QaChecklistItem): void {
    failureComposerItemId = item.id;
    failureActualBehavior = item.failureEvidence?.actualBehavior ?? '';
    failureScreenshots = [...(item.failureEvidence?.screenshots ?? [])];
    expandedItemId = item.id;
  }

  function attachScreenshotFiles(files: FileList | null): void {
    if (!files || files.length === 0) return;

    const screenshots = Array.from(files)
      .filter(isImageFile)
      .map(toPendingFailureScreenshot);

    if (screenshots.length === 0) return;
    failureScreenshots = [...failureScreenshots, ...screenshots];
  }

  function isImageFile(file: File): boolean {
    return file.type.startsWith('image/');
  }

  function toPendingFailureScreenshot(file: File): FailureScreenshot {
    return {
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      localReference: `pending-local-copy:${file.name}`
    };
  }

  function handleFailurePaste(event: ClipboardEvent): void {
    if (failureComposerItemId === undefined) return;
    attachScreenshotFiles(event.clipboardData?.files ?? null);
  }

  function saveFailureEvidence(item: QaChecklistItem): void {
    const actualBehavior = failureActualBehavior.trim();
    if (actualBehavior.length === 0 || item.status !== 'failed') return;
    item.failureEvidence = {
      actualBehavior,
      screenshots: failureScreenshots
    };
    item.note = actualBehavior;
    recordHistory(item, 'failed', actualBehavior);
    resetFailureComposer();
  }

  function resetFailureComposer(): void {
    failureComposerItemId = undefined;
    failureActualBehavior = '';
    failureScreenshots = [];
  }

  function startSkip(item: QaChecklistItem): void {
    skipItemId = item.id;
    skipReason = item.skipReason ?? '';
    expandedItemId = item.id;
  }

  function saveSkip(item: QaChecklistItem): void {
    const reason = skipReason.trim();
    if (reason.length === 0) return;
    item.status = 'skipped';
    item.skipReason = reason;
    recordHistory(item, 'skipped', reason);
    skipItemId = undefined;
    skipReason = '';
  }

  function startEdit(item: QaChecklistItem): void {
    editingItemId = item.id;
    expandedItemId = item.id;
    editTitle = item.title;
    editSteps = item.steps.join('\n');
    editExpectedResult = item.expectedResult;
    editNote = item.note ?? '';
  }

  function saveEdit(item: QaChecklistItem): void {
    const steps = editSteps
      .split('\n')
      .map((step: string) => step.trim())
      .filter(Boolean);
    if (editTitle.trim().length === 0 || editExpectedResult.trim().length === 0 || steps.length === 0) return;

    item.title = editTitle.trim();
    item.steps = steps;
    item.expectedResult = editExpectedResult.trim();
    item.note = editNote.trim() || undefined;
    recordHistory(item, 'edited', item.note ?? 'Generated text edited');
    editingItemId = undefined;
  }

  function toggleExpanded(item: QaChecklistItem): void {
    expandedItemId = expandedItemId === item.id ? undefined : item.id;
  }

  function toggleHistory(item: QaChecklistItem): void {
    historyItemId = historyItemId === item.id ? undefined : item.id;
    expandedItemId = item.id;
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target) || event.defaultPrevented || !activeSession?.items?.length) return;

    const item = selectedItem();
    if (!item) return;

    switch (event.key) {
      case 'j':
        event.preventDefault();
        moveSelection(1);
        break;
      case 'k':
        event.preventDefault();
        moveSelection(-1);
        break;
      case ' ':
        event.preventDefault();
        togglePass(item);
        break;
      case 'f':
        event.preventDefault();
        failItem(item);
        break;
      case 's':
        event.preventDefault();
        startSkip(item);
        break;
      case 'e':
        event.preventDefault();
        startEdit(item);
        break;
      case '/':
        event.preventDefault();
        document.getElementById('checklist-search')?.focus();
        break;
      case 'Enter':
        event.preventDefault();
        toggleExpanded(item);
        break;
      case 'a':
        event.preventDefault();
        expandedItemId = undefined;
        break;
    }
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  }

  function recordHistory(item: QaChecklistItem, action: QaChecklistHistoryAction, detail?: string): void {
    item.history = [...item.history, historyEvent(action, detail)];
  }

  function historyEvent(action: QaChecklistHistoryAction, detail?: string): QaChecklistHistoryEvent {
    return { action, createdAt: new Date().toISOString(), ...(detail ? { detail } : {}) };
  }

  function formatHistory(event: QaChecklistHistoryEvent): string {
    const label = `${event.action.charAt(0).toUpperCase()}${event.action.slice(1)}`;
    return event.detail ? `${label}: ${event.detail}` : label;
  }

  function updatePassChimeMuted(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    interactionSettings.passChimeMuted = input.checked;
    persistInteractionSettings(interactionSettings);
  }

  function updatePassChimeVolume(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const volume = Number(input.value) / 100;
    interactionSettings.passChimeVolume = clampVolume(volume);
    persistInteractionSettings(interactionSettings);
  }

  function readInteractionSettings(): InteractionSettings {
    if (typeof localStorage === 'undefined') return { ...defaultInteractionSettings };

    const stored = localStorage.getItem(interactionSettingsKey);
    if (!stored) return { ...defaultInteractionSettings };

    try {
      return normalizeInteractionSettings(JSON.parse(stored));
    } catch {
      return { ...defaultInteractionSettings };
    }
  }

  function normalizeInteractionSettings(value: unknown): InteractionSettings {
    if (!value || typeof value !== 'object') return { ...defaultInteractionSettings };

    const settings = value as Record<string, unknown>;
    return {
      passChimeMuted: settings.passChimeMuted === true,
      passChimeVolume: clampVolume(settings.passChimeVolume)
    };
  }

  function persistInteractionSettings(settings: InteractionSettings): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(interactionSettingsKey, JSON.stringify(settings));
  }

  function playPassChime(settings: InteractionSettings): void {
    if (settings.passChimeMuted || settings.passChimeVolume <= 0) return;
    const audioGlobal = globalThis as typeof globalThis & {
      AudioContext?: BrowserAudioContextConstructor;
      webkitAudioContext?: BrowserAudioContextConstructor;
    };
    const AudioContextCtor = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      const context = new AudioContextCtor();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(settings.passChimeVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.18);
    } catch {
      // Audio feedback is optional; item state should not depend on browser audio support.
    }
  }

  function clampVolume(value: unknown): number {
    const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : defaultInteractionSettings.passChimeVolume;
    return Math.max(0, Math.min(1, numericValue));
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<svelte:head>
  <title>QA To Do</title>
</svelte:head>

<main class="shell" aria-labelledby="app-title">
  <header class="hero">
    <p class="eyebrow">Sandcastle / RALPH</p>
    <h1 id="app-title">QA To Do</h1>
    <p class="lede">A local-first checklist for human QA after agent-generated software work.</p>
  </header>

  {#if shellState.sessions.length === 0}
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
  {:else if activeSession}
    <section class="active-session" aria-labelledby="active-session-title">
      <div>
        <p class="section-kicker">Most recent active session</p>
        <h2 id="active-session-title">{activeSession.title}</h2>
        <p>
          Imported from <strong>{activeSession.repoName}</strong> via {activeSession.tracker}, parent
          <code>{activeSession.parentIssueId}</code>: {activeSession.parentIssueTitle}.
        </p>
      </div>
      <div class="active-session__meta" aria-label="Active session metadata">
        <span>{activeSession.itemCount} QA item{activeSession.itemCount === 1 ? '' : 's'}</span>
        {#if activeSession.warnings.length > 0}
          <span>{activeSession.warnings.length} warning{activeSession.warnings.length === 1 ? '' : 's'}</span>
        {/if}
      </div>
      {#if activeSession.warnings.length > 0}
        <ul class="warning-list" aria-label="Session warnings">
          {#each activeSession.warnings as warning}
            <li>{warning}</li>
          {/each}
        </ul>
      {/if}
      {#if activeSession.items && activeSession.items.length > 0}
        <div class="shortcut-preview" aria-label="Keyboard shortcuts">
          <button type="button">j/k Navigate</button>
          <button type="button">Space Pass/unpass</button>
          <button type="button">f Fail</button>
          <button type="button">s Skip</button>
          <button type="button">e Edit</button>
          <button type="button">/ Search</button>
          <button type="button">Enter Expand</button>
          <button type="button">a Archive</button>
        </div>

        <section class="interaction-settings" aria-labelledby="interaction-settings-title">
          <div>
            <p class="section-kicker">Interaction settings</p>
            <h3 id="interaction-settings-title">Pass chime</h3>
            <p>Generated in the browser with Web Audio. No sound files are bundled.</p>
          </div>
          <label class="mute-control">
            <input
              type="checkbox"
              checked={interactionSettings.passChimeMuted}
              onchange={updatePassChimeMuted}
              aria-label="Mute pass chime"
            />
            Mute
          </label>
          <label>
            Volume
            <input
              type="range"
              min="0"
              max="100"
              value={passChimeVolumePercent}
              oninput={updatePassChimeVolume}
              aria-label="Pass chime volume"
            />
            <span>{passChimeVolumePercent}%</span>
          </label>
        </section>

        <div class="checklist-tools" aria-label="Checklist filters">
          <label>
            Search checklist
            <input
              id="checklist-search"
              bind:value={searchQuery}
              aria-label="Search checklist"
              placeholder="Search title, evidence, repo"
            />
          </label>
          <label>
            Status
            <select bind:value={statusFilter} aria-label="Status filter">
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="skipped">Skipped</option>
            </select>
          </label>
          <label>
            Source issue
            <select bind:value={sourceFilter} aria-label="Source issue filter">
              <option value="all">All source issues</option>
              {#each sourceIssueOptions as sourceIssueId}
                <option value={sourceIssueId}>{sourceIssueId}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="checklist" role="table" aria-label="QA checklist">
          {#each filteredItems as item, index (item.id)}
            <div
              role="row"
              tabindex="-1"
              aria-label={`${item.sourceIssueId} ${item.title} ${item.status}`}
              class="checklist-row"
              class:is-selected={index === selectedIndex}
              class:is-failed={item.status === 'failed'}
              onmouseenter={() => (selectedIndex = index)}
            >
              <div class="checklist-row__summary">
                <button
                  class={`status-square status-square--${item.status}`}
                  type="button"
                  aria-label={`Mark ${item.title} passed`}
                  onclick={() => togglePass(item)}
                >
                  <span aria-hidden="true">{item.status === 'passed' ? '✓' : ''}</span>
                </button>
                <span class="source-badge">{item.sourceIssueId}</span>
                <button class="row-title" type="button" onclick={() => toggleExpanded(item)}>{item.title}</button>
                {#if item.confidence === 'low'}
                  <span class="low-confidence">Low confidence</span>
                {/if}
                <span class={`item-state item-state--${item.status}`}>{item.status}</span>
              </div>
              <div class="row-actions">
                <button type="button" onclick={() => failItem(item)} aria-label={`Fail ${item.title}`}>Fail</button>
                <button type="button" onclick={() => startSkip(item)} aria-label={`Skip ${item.title}`}>Skip</button>
                <button type="button" onclick={() => startEdit(item)} aria-label={`Edit ${item.title}`}>Edit</button>
                <button type="button" onclick={() => toggleHistory(item)} aria-label={`History ${item.title}`}>History</button>
              </div>

              {#if expandedItemId === item.id}
                <div class="item-detail">
                  {#if editingItemId === item.id}
                    <div class="edit-form">
                      <label>Title<input bind:value={editTitle} aria-label="Title" /></label>
                      <label>Steps<textarea bind:value={editSteps} aria-label="Steps"></textarea></label>
                      <label>Expected result<textarea bind:value={editExpectedResult} aria-label="Expected result"></textarea></label>
                      <label>Notes<textarea bind:value={editNote} aria-label="Notes"></textarea></label>
                      <button type="button" onclick={() => saveEdit(item)}>Save edit</button>
                    </div>
                  {:else}
                    <section>
                      <h3>Steps</h3>
                      <ol>
                        {#each item.steps as step}
                          <li>{step}</li>
                        {/each}
                      </ol>
                    </section>
                    <section>
                      <h3>Expected result</h3>
                      <p>{item.expectedResult}</p>
                    </section>
                    <section>
                      <h3>Evidence</h3>
                      {#each item.sourceEvidence as evidence}
                        <p><strong>{evidence.label}</strong>: {evidence.value}</p>
                      {/each}
                    </section>
                    <section>
                      <h3>Notes</h3>
                      <p>{item.note ?? 'No reviewer notes yet.'}</p>
                    </section>
                    {#if item.failureEvidence}
                      <section class="failure-evidence-summary">
                        <h3>Failure evidence</h3>
                        <p>Failed: {item.failureEvidence.actualBehavior}</p>
                        {#if item.failureEvidence.screenshots.length > 0}
                          <p>Screenshots: {item.failureEvidence.screenshots.map((screenshot) => screenshot.name).join(', ')}</p>
                        {/if}
                      </section>
                    {/if}
                    {#if item.title !== item.originalTitle || item.expectedResult !== item.originalExpectedResult || item.steps.join('\n') !== item.originalSteps.join('\n')}
                      <section class="original-text">
                        <h3>Original generated text</h3>
                        <p>{item.originalTitle}</p>
                        <p>{item.originalExpectedResult}</p>
                      </section>
                    {/if}
                  {/if}

                  {#if failureComposerItemId === item.id && item.status === 'failed'}
                    <section class="failure-composer" aria-label={`Failure evidence for ${item.title}`} onpaste={handleFailurePaste}>
                      <h3>Failure evidence for {item.title}</h3>
                      <section>
                        <h3>QA instruction</h3>
                        <ol>
                          {#each item.steps as step}
                            <li>{step}</li>
                          {/each}
                        </ol>
                      </section>
                      <section>
                        <h3>Expected result</h3>
                        <p>{item.expectedResult}</p>
                      </section>
                      <section>
                        <h3>Source evidence</h3>
                        {#each item.sourceEvidence as evidence}
                          <p><strong>{evidence.label}</strong>: {evidence.value}</p>
                        {/each}
                      </section>
                      <label>
                        Actual behavior
                        <textarea bind:value={failureActualBehavior} aria-label="Actual behavior" required></textarea>
                      </label>
                      <label>
                        Attach screenshot files
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          aria-label="Attach screenshot files"
                          onchange={(event) => attachScreenshotFiles(event.currentTarget.files)}
                        />
                      </label>
                      <p class="paste-hint">Paste images while this composer is focused to attach clipboard screenshots.</p>
                      {#if failureScreenshots.length > 0}
                        <ul aria-label="Attached screenshots">
                          {#each failureScreenshots as screenshot}
                            <li>{screenshot.name}</li>
                          {/each}
                        </ul>
                      {/if}
                      <button type="button" disabled={failureActualBehavior.trim().length === 0} onclick={() => saveFailureEvidence(item)}>
                        Save failure evidence
                      </button>
                    </section>
                  {/if}

                  {#if skipItemId === item.id}
                    <div class="skip-form">
                      <label>Skip reason<input bind:value={skipReason} aria-label="Skip reason" /></label>
                      <button type="button" onclick={() => saveSkip(item)}>Save skip</button>
                    </div>
                  {/if}

                  {#if historyItemId === item.id}
                    <section class="history-panel" aria-label={`State history for ${item.title}`}>
                      <h3>State history</h3>
                      {#if item.history.length === 0}
                        <p>No state changes yet.</p>
                      {:else}
                        <ol>
                          {#each item.history as event}
                            <li>{formatHistory(event)}</li>
                          {/each}
                        </ol>
                      {/if}
                    </section>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  <section class="health" aria-labelledby="health-title">
    <div class="section-heading">
      <p class="section-kicker">Read-only setup health</p>
      <h2 id="health-title">Prerequisites</h2>
    </div>

    <div class="health-grid">
      {#each shellState.configHealth as item (item.id)}
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

<style>
  .shortcut-preview,
  .interaction-settings,
  .checklist-tools,
  .checklist-row__summary,
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .shortcut-preview {
    margin-top: 1rem;
  }

  .interaction-settings {
    margin-top: 1rem;
    padding: 0.75rem;
    border: 1px solid #1f1f1f;
    justify-content: space-between;
  }

  .interaction-settings h3,
  .interaction-settings p {
    margin: 0;
  }

  .shortcut-preview button,
  .row-actions button,
  .interaction-settings input,
  .checklist-tools input,
  .checklist-tools select,
  .edit-form input,
  .edit-form textarea,
  .skip-form input,
  .failure-composer textarea,
  .failure-composer input {
    border: 1px solid #1f1f1f;
    background: #fff;
    color: #111;
  }

  .shortcut-preview button,
  .row-actions button {
    padding: 0.25rem 0.5rem;
  }

  .checklist-tools {
    margin: 1rem 0;
  }

  .checklist-tools label,
  .interaction-settings label,
  .edit-form label,
  .skip-form label,
  .failure-composer label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .checklist-row {
    border-top: 1px solid #d8d8d8;
    padding: 0.55rem 0;
  }

  .checklist-row.is-selected {
    outline: 2px solid #111;
    outline-offset: 2px;
  }

  .checklist-row.is-failed .item-state {
    color: #b00020;
  }

  .status-square {
    width: 1.1rem;
    height: 1.1rem;
    border: 2px solid #111;
    background: #fff;
    display: inline-grid;
    place-items: center;
    line-height: 1;
  }

  .status-square--passed {
    background: #111;
    color: #fff;
  }

  .source-badge,
  .low-confidence,
  .item-state {
    border: 1px solid #1f1f1f;
    padding: 0.1rem 0.35rem;
    font-size: 0.78rem;
  }

  .low-confidence {
    border-style: dashed;
  }

  .row-title {
    border: 0;
    background: transparent;
    font: inherit;
    text-align: left;
    padding: 0;
  }

  .item-detail {
    margin-top: 0.75rem;
    padding-left: 2rem;
  }

  .edit-form,
  .skip-form,
  .failure-composer {
    display: grid;
    gap: 0.6rem;
    max-width: 42rem;
  }

  .edit-form textarea,
  .failure-composer textarea {
    min-height: 4rem;
  }

  .failure-composer {
    border: 1px solid #111;
    margin-top: 0.75rem;
    padding: 0.75rem;
  }

  .failure-evidence-summary {
    border-left: 3px solid #b00020;
    padding-left: 0.75rem;
  }

  .paste-hint {
    margin: 0;
    font-size: 0.85rem;
  }
</style>
