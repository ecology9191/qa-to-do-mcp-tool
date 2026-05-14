# Sandcastle/RALPH QA To Do App PRD

## Problem Statement

Humans need a fast, reliable quality assurance step after Sandcastle/RALPH creates and merges AI-generated software work. The current workflow can produce completed Beads issues and `RALPH:` commits, but there is no dedicated place for a human to run focused QA checks, record pass/fail outcomes, preserve evidence, or turn failed QA into follow-up tracker issues.

The user wants a standalone, minimalist QA To Do app for the software QA phase. It should not be a generic personal todo app or a full project manager. It should take completed Sandcastle/RALPH work, produce actionable human QA checks, let the user pass items with satisfying feedback, capture failures with notes and screenshots, and create follow-up issues in the repo's tracker after explicit confirmation.

## Solution

Build a Linux-first standalone QA To Do app for Sandcastle/RALPH output. The primary flow is `/to-qa <parent issue>` from an agent-enabled repo. The agent inspects the parent issue, completed child issues, recent Sandcastle/RALPH commits, and any necessary repo context. The agent creates structured QA checks and calls a write-only MCP tool to create an active QA session in the app.

The app owns QA session state locally. It stores sessions, item state, edits, history, screenshots, archive state, and soft-deleted records in SQLite. MCP writes validated inbox JSON for app import instead of directly mutating the database. The app can be closed when MCP receives a session; it imports pending inbox entries when running or on next launch.

V1 is Sandcastle/RALPH-only for the source model. It supports Beads and a documented `.scratch` markdown convention. GitHub Issues support is intentionally out of scope. Broad provider invocation remains useful: OpenCode, Claude, Cursor, Codex, Zed, Pi, and similar tools may invoke `/to-qa` where they support skills, MCP, or terminal fallback, but the input model remains Sandcastle/RALPH.

When a QA item fails, the app opens a scoped failure composer for that item. The user explains what happened and may attach screenshots by file picker or clipboard paste. The app sends scoped context to MCP. MCP drafts the tracker issue, deduplicates by fingerprint, and waits for explicit confirmation before mutating Beads or `.scratch`. Failed drafts are preserved locally if the tracker is unavailable.

## User Stories

1. As a developer using Sandcastle, I want `/to-qa <parent issue>` to create a QA session from completed RALPH work, so that I can verify AI-generated changes before accepting them.
2. As a developer using Sandcastle, I want the QA source model to focus on RALPH output, so that the app matches my actual post-Sandcastle workflow.
3. As a QA reviewer, I want QA to mean software quality assurance, so that generated items are human verification checks rather than generic todos or questions.
4. As a QA reviewer, I want each QA item to verify one independently testable behavior, so that pass/fail decisions are precise.
5. As a QA reviewer, I want generated QA items to include title, steps, expected result, and source evidence, so that I know exactly what to test and why.
6. As a QA reviewer, I want the app to show which repo and parent issue a session came from, so that I do not QA the wrong work.
7. As a QA reviewer, I want the default session title to include repo and parent issue identity, so that sessions are readable across projects.
8. As a QA reviewer, I want the app to support sessions from multiple repos, so that a global tool can be useful across my projects.
9. As a QA reviewer, I want the app to default to my most recent active session, so that I can resume QA quickly.
10. As a QA reviewer, I want active sessions grouped or filterable by repo, so that cross-project work remains organized.
11. As a QA reviewer, I want the UI to be minimalist and monochrome, so that the checklist stays calm and focused.
12. As a QA reviewer, I want the UI to feel polished rather than barebones, so that the tool feels intentional and worth using.
13. As a QA reviewer, I want semantic red only for failure states, so that failure is clear without turning the UI into a colorful dashboard.
14. As a QA reviewer, I want compact checklist rows, so that I can scan a QA session quickly.
15. As a QA reviewer, I want rows to expand or open detail on selection, so that steps, expected results, evidence, and notes are available without clutter.
16. As a QA reviewer, I want each row to show a status square, source issue badge, and short title, so that the checklist is dense but understandable.
17. As a QA reviewer, I want one square control for pass/fail-oriented interaction, so that each QA item has a simple primary affordance.
18. As a QA reviewer, I want single click or Space to mark a QA item passed, so that routine pass actions are fast.
19. As a QA reviewer, I want a satisfying generated ding when I pass an item, so that completion feels rewarding.
20. As a QA reviewer, I want mute and volume controls for the ding, so that I can use the app in quiet environments.
21. As a QA reviewer, I want the pass sound generated in code, so that the app stays lightweight.
22. As a QA reviewer, I want an explicit fail action instead of double-click, so that I do not accidentally mark an item failed.
23. As a keyboard-focused reviewer, I want `j/k` navigation, Space pass/unpass, `f` fail, `s` skip, `e` edit, `/` search, Enter expand, and `a` archive, so that I can work quickly.
24. As a new user, I want a shortcut preview on the main screen, so that I can discover keyboard controls without reading docs.
25. As a QA reviewer, I want hotkeys disabled while typing in text inputs, so that writing notes does not trigger actions.
26. As a QA reviewer, I want search and filters for text, status, source issue, repo, and session, so that large QA sessions remain navigable.
27. As a QA reviewer, I want subtle warning markers on low-confidence generated items, so that I know when source criteria were weak.
28. As a QA reviewer, I want low-confidence warnings not to block checking items off, so that QA can continue even when source issues are imperfect.
29. As a QA reviewer, I want generated items inferred from weak criteria to be marked, so that I understand the limits of the generated QA list.
30. As a QA reviewer, I want to edit generated QA items, so that unclear wording can be fixed quickly.
31. As a QA reviewer, I want original generated text and source evidence preserved after edits, so that provenance is not lost.
32. As a QA reviewer, I want to add lightweight manual QA items to a session, so that gaps in generated coverage can be captured immediately.
33. As a QA reviewer, I want manual items marked as manual, so that generated coverage and human-added coverage remain distinguishable.
34. As a QA reviewer, I want manual items to support the same pass, fail, skip, notes, and screenshot flow, so that ad hoc checks feel first-class.
35. As a QA reviewer, I want to soft delete bad sessions or items, so that generated mistakes can be cleaned up without losing recoverability.
36. As a QA reviewer, I want deleted sessions and items restorable, so that accidental deletion does not destroy QA evidence.
37. As a QA reviewer, I want no QA-specific due dates or priorities in v1, so that the app does not become a project manager.
38. As a QA reviewer, I want source issue priority shown only as read-only metadata when available, so that tracker context is visible without adding scheduling features.
39. As a QA reviewer, I want automated test/build/CI evidence shown as read-only session evidence, so that I can consider it without letting it replace human QA.
40. As a QA reviewer, I want passing a completed item to be reversible, so that human mistakes can be corrected.
41. As a QA reviewer, I want state changes to preserve history, so that QA decisions are auditable.
42. As a QA reviewer, I want failed items to open a scoped composer, so that failure reporting stays tied to the exact QA check.
43. As a QA reviewer, I want the failure composer to show the QA instruction, expected result, source evidence, and a text box for actual behavior, so that I can report failures precisely.
44. As a QA reviewer, I want failure drafting to require my failure note, so that created bugs are not empty or vague.
45. As a QA reviewer, I want screenshots only for failed QA items in v1, so that screenshot evidence stays focused on bug reporting.
46. As a QA reviewer, I want to add screenshots by file picker, so that saved evidence can be attached.
47. As a QA reviewer, I want to paste screenshots from the clipboard, so that failure evidence can be captured quickly.
48. As a QA reviewer, I want the app to copy screenshots into app storage, so that evidence is not lost if original files move.
49. As a QA reviewer, I want screenshots uploaded or embedded when the tracker supports it, so that failure issues carry evidence.
50. As a QA reviewer, I want local screenshot references preserved when upload is unsupported, so that evidence is not silently dropped.
51. As a QA reviewer, I want MCP to draft a failure issue before any tracker mutation, so that I can review what will be filed.
52. As a QA reviewer, I want to explicitly confirm failure issue creation or update, so that the tool does not spam the tracker.
53. As a QA reviewer, I want failure issues deduped by fingerprint, so that repeated failures do not create duplicate tracker bugs.
54. As a QA reviewer, I want existing matching failure issues updated or commented on when appropriate, so that follow-up context stays together.
55. As a QA reviewer, I want failed QA issues labeled `needs-triage` and `bug`, so that they enter the normal triage flow safely.
56. As a QA reviewer, I want Beads failure issues linked with `discovered-from` to the source child or parent issue, so that follow-up defects preserve traceability.
57. As a QA reviewer, I want `.scratch` failure issues written using a documented convention, so that local markdown tracking remains parseable.
58. As a QA reviewer, I want failed drafts saved locally when tracker creation fails, so that failures are not lost.
59. As a QA reviewer, I want tracker errors to show exact recovery guidance or copyable issue text, so that I can file later.
60. As a QA reviewer, I want a session to be archive-eligible only when every item is passed, failed-filed, or skipped with a reason, so that unresolved failures cannot disappear.
61. As a QA reviewer, I want archive to be manual, so that I can review the completed session before closing it.
62. As a QA reviewer, I want archive to be app-only by default, so that tracker state is not mutated by local QA cleanup.
63. As a QA reviewer, I want archived sessions preserved and searchable, so that previous QA evidence remains available.
64. As a QA reviewer, I want rerunning `/to-qa` for the same active parent to merge only new deduped items, so that existing pass/fail state is preserved.
65. As a QA reviewer, I want rerunning `/to-qa` after archive to create a new session version, so that archived history remains immutable.
66. As a QA reviewer, I want `/to-qa <parent issue>` to create items only from completed or closed source work, so that the checklist is executable.
67. As a QA reviewer, I want incomplete child work summarized as a warning or count, so that I know the parent-level QA may be partial.
68. As a QA reviewer, I want an empty parent with no completed work to fail clearly instead of creating unrelated QA, so that mistakes are not hidden.
69. As a Beads user, I want closed child issues under the parent to be the primary Beads source, so that QA follows my Sandcastle issue decomposition.
70. As a Beads user, I want the parent being closed not to imply all children are complete, so that QA scope is accurate.
71. As a `.scratch` user, I want v1 to support only documented markdown/frontmatter issue files, so that parsing is reliable.
72. As a `.scratch` user, I want unsupported freeform markdown to fail with setup guidance, so that the tool does not infer the wrong work.
73. As a user with multiple trackers in one repo, I want the tool to ask which tracker to use, so that it does not guess incorrectly.
74. As a user with multiple trackers in one repo, I want the chosen tracker remembered per repo and changeable later, so that repeated runs are convenient.
75. As a user launching the app before any sessions exist, I want a minimal empty state explaining `/to-qa <parent issue>`, so that the app does not feel broken.
76. As a user launching the app, I want config health indicators for MCP, inbox writability, and tracker readiness, so that setup issues are visible.
77. As a user, I want `/to-qa` session creation to work when the app is closed, so that the agent workflow does not require app launch first.
78. As a user, I want schema export/import, so that sessions can be backed up, debugged, or moved without cloud sync.
79. As a Linux user, I want a `.deb` package, so that the app installs cleanly on Debian/Ubuntu-style systems.
80. As a Linux user, I want an AppImage, so that I can run the app on other Linux distributions without root.
81. As an agent user, I want a global `/to-qa` skill where supported, so that I do not need to copy skill files into each repo.
82. As an agent user, I want providers without native skill support to have MCP/rules/CLI fallback instructions, so that the workflow is still usable.
83. As an installer user, I want preview-then-apply setup, so that provider config is never silently overwritten.
84. As a security-conscious user, I want no app-managed secrets in v1, so that credentials stay in user env/config/provider auth.
85. As an implementation agent, I want `npm run typecheck` and `npm run test` to exist from the start, so that Sandcastle quality gates are real.
86. As an implementation agent, I want Sandcastle's existing Beads-first automation preserved, so that building this product does not disrupt repo workflow.
87. As a maintainer, I want GitHub Issues out of v1, so that implementation stays focused on trackers the user actually uses.
88. As a maintainer, I want the app to be single-user local-first in v1, so that team sync does not block the first useful version.
89. As a maintainer, I want the first success test to be the end-to-end RALPH QA loop, so that v1 proves the real workflow before expanding.

## Implementation Decisions

- V1 is specifically a Sandcastle/RALPH QA To Do app, not a generic QA platform.
- Broad provider support means broad invocation support for `/to-qa` and MCP, while the input model remains Sandcastle/RALPH.
- The visible workflow is skill to MCP to app. CLI support may exist as fallback or internal plumbing, but it is not the primary product story.
- The app owns QA session state, item state, edit history, screenshots, archive state, soft delete state, and settings.
- The tracker remains the source of truth for engineering issues, not for local QA checklist state.
- Supported v1 trackers are Beads and a documented `.scratch` markdown convention.
- GitHub Issues support is out of scope for v1.
- If multiple supported trackers are detected, the user is asked which one to use. The choice is remembered per repo and can be changed later.
- `/to-qa <parent issue>` is the primary generation entry point. Parent inference may be a convenience later but should not replace the explicit path.
- Beads scope comes from the parent issue and completed closed children. Open children may be summarized as warnings but do not generate actionable QA items by default.
- For Beads, completed child work should be discovered through exhaustive parent-scoped listing rather than default-limited child commands.
- A parent with zero completed source work should not create a session by default.
- `.scratch` support requires structured frontmatter or documented headings for ID, title, status, parent, and acceptance notes.
- `.scratch` freeform markdown should fail with setup guidance rather than best-effort parsing.
- The agent may inspect whatever repo/tracker context is necessary, but it should start from parent issue, completed children, recent RALPH commits, changed files, and read deeper only when needed.
- The MCP is write-only from the agent-facing perspective. It does not provide repo/tracker context gathering tools.
- MCP validates finished QA sessions and failure actions, then writes app inbox messages.
- MCP v1 tools are session creation, failure issue drafting, and confirmed failure issue creation/update.
- MCP must not expose pass, fail, edit, archive, or delete operations for QA items in v1.
- MCP must enforce strict schema validation for QA sessions.
- Each QA item requires a title, human-verifiable steps, expected result, source evidence, stable ID, and fingerprint.
- MCP should reject or warn on vague implementation-oriented QA items that are not human-verifiable checks.
- MCP writes validated inbox JSON first. The app imports inbox entries into SQLite.
- The app can be closed when MCP creates a session. Inbox entries are imported on next app launch or while running.
- Processed inbox entries are moved to processed retention with result metadata for debugging and dedupe.
- The app stores durable state in SQLite and uses JSON only as the MCP, import, export, and backup contract.
- A browser dev mode should exist for fast UI iteration with mock/local data. Desktop integration remains in Tauri and MCP flows.
- The app uses Tauri 2, Vite, Svelte 5, TypeScript, SQLite, and JSON schema boundaries.
- Linux is the v1 platform target, with `.deb` and AppImage packaging.
- The global installer previews changes before applying them and must not silently overwrite provider config.
- The app should show minimal onboarding when empty, including the `/to-qa <parent issue>` workflow and config health indicators.
- The app should support multiple repos, grouped or filterable in a simple session list.
- Session titles default to repo plus parent issue identity.
- QA item display is compact with expandable detail.
- The app includes minimal keyboard shortcuts and a shortcut preview on the main screen.
- Pass feedback uses a generated Web Audio-style chime with mute and volume controls.
- The failure composer is scoped to one QA item and is not a general chatbot.
- Failure drafting is handled through MCP from scoped app context.
- Failure context defaults to QA item, expected result, source evidence, repo/tracker metadata, user failure note, and screenshots. MCP re-investigates only if explicitly requested.
- Failure issue creation is draft first, confirm second. Tracker mutation requires explicit confirmation.
- Failure issues are deduped by stable fingerprint before creation.
- Beads failure bugs use `discovered-from` against the source child issue when known, otherwise the parent issue.
- Failure issues default to type `bug` and labels `needs-triage` and `bug`.
- Screenshots are supported in v1 only for failed QA items.
- Screenshot input uses file picker and clipboard paste, not built-in screen capture.
- Screenshots are copied into app storage and uploaded or embedded in tracker issues only when the tracker adapter supports it.
- Generated prompts and private reasoning are not stored by default. Store evidence, generated outputs, warnings, model/provider metadata, and timestamps.
- QA items can be edited with original generated text and source evidence preserved.
- Manual QA items can be added to existing sessions and are clearly marked manual.
- Pass/fail/skip states are reversible with history.
- Sessions become archive-eligible only when all items are terminal: passed, failed-filed, or skipped with a reason.
- Archive is manual and app-only by default.
- Soft delete is supported for cleanup and restore.
- Dates, due dates, and QA-specific priorities are not included in v1.
- App-triggered rerun/generation is not included in v1. The app may show the rerun command.
- Opening the desktop app directly to a newly created session through a command or deep link is out of scope for v1.
- The current Sandcastle workflow for this repo remains Beads-first. Product tracker abstraction is separate from implementation automation.

### Deep Modules To Build

- QA Session Domain: owns session and item state transitions, archive eligibility, rerun merge behavior, edit history, soft delete, and terminal-state rules behind a small command interface.
- Session Schema Validator: owns MCP/import/export schema validation, QA item quality validation, versioning, and actionable error reporting.
- MCP Inbox Writer: owns write-only tool validation, atomic inbox entry creation, idempotency, and correlation IDs.
- Inbox Importer: owns idempotent import from processed inbox artifacts into app storage, duplicate detection, and import error retention.
- Storage Repository: owns SQLite persistence for sessions, items, history, screenshots, drafts, settings, archive, and export/import.
- Tracker Adapter Layer: owns Beads and `.scratch` detection, source issue reading, failure issue drafting, failure issue creation/update, dedupe search, and capability reporting.
- Failure Issue Flow: owns scoped failure draft generation, dedupe fingerprinting, confirm-then-mutate rules, local failed-draft fallback, and tracker result reconciliation.
- Screenshot Store: owns picker/paste imports, validation, local copy, metadata, linking to failed items, and tracker attachment/reference behavior.
- Interaction Settings: owns pass chime configuration, mute/volume, hotkey policy, and reduced-motion/reduced-audio behavior where detectable.
- App Shell/UI: owns minimalist session list, checklist view, item detail, failure composer, archive prompts, search/filter, empty state, and shortcut preview.
- Installer/Provider Setup: owns global skill/MCP setup, preview-then-apply configuration, provider capability reporting, and fallback instructions.

## Testing Decisions

- This QA To Do project should include quality gates from the start.
- Sandcastle's existing expected quality gates must remain `npm run typecheck` and `npm run test`.
- Adding tests must not disrupt the current Sandcastle Beads-first workflow.
- Tests should verify external behavior, not private helpers or implementation details.
- Schema tests should verify valid QA session payloads, missing required fields, duplicate fingerprints, unsupported schema versions, and vague non-human-verifiable QA items.
- Domain tests should verify item transitions, reversibility, edit history, terminal states, archive eligibility, and invalid transition rejection.
- Rerun tests should verify active-session merge behavior preserves existing pass/fail state and archived-session reruns create new versions.
- MCP tests should verify strict validation, atomic inbox write behavior, idempotency, app-closed session creation, rejection of invalid sessions, and lack of pass/fail mutation tools.
- Importer tests should verify valid imports, invalid entry quarantine, processed retention, duplicate import safety, and preserving generated text, warnings, evidence, timestamps, and metadata.
- Storage tests should verify persisted sessions, item history, failure drafts, tracker issue links, screenshots metadata, archive state, soft delete, and export/import round trips.
- Tracker adapter tests should verify Beads detection, parent closed child discovery, Beads `discovered-from` failure relation, default labels, `.scratch` convention parsing, `.scratch` failure issue writing, and unsupported tracker behavior.
- Failure flow tests should verify scoped context, required user failure note, draft-first behavior, explicit confirmation before tracker mutation, dedupe fingerprint handling, local failed-draft fallback, and transition to failed-filed on success.
- Screenshot tests should verify picker/paste metadata, failure-only attachment rules, local copy behavior, tracker capability handling, and local path/reference fallback.
- Keyboard/UI behavior tests should verify visible state changes for navigation, pass, fail, skip, edit, search, expand, archive, and hotkey suppression while typing.
- Archive tests should verify only passed, failed-filed, and skipped-with-reason states are terminal.
- Packaging/setup tests should verify installer dry-run output, no silent config overwrite, provider capability detection, and safe fallback instructions.
- Prior art in this repo is minimal: current package metadata lacks app code and lacks `test`/`typecheck` scripts. Initial implementation should establish the project testing pattern.

## Out of Scope

- GitHub Issues support in v1.
- GitLab, Jira, Linear, or other remote tracker adapters in v1.
- Generic QA checklist app behavior beyond Sandcastle/RALPH v1.
- Non-Sandcastle provider-specific source formats in v1.
- Team sync, shared accounts, shared databases, or real-time collaboration.
- Cloud sync.
- Built-in screen capture.
- General file attachments beyond failed-item screenshots.
- App-managed secrets, keychain integration, or built-in credential vault in v1.
- Dates, due dates, priorities, scheduling, or productivity planning.
- Dashboards, analytics, reporting views, or productivity stats.
- Storing full prompts, chain-of-thought, or private model reasoning by default.
- Direct SQLite writes from MCP.
- MCP read/query APIs for app state.
- Agent-driven pass/fail/edit/archive/delete mutations.
- Automatic tracker mutation without explicit confirmation.
- App-triggered QA generation or rerun buttons in v1.
- Opening the desktop app directly to a newly created QA session through a command or deep link.
- Replacing or generalizing this repo's Sandcastle Beads-first implementation automation.
- macOS or Windows packaging in v1.

## Further Notes

- QA means quality assurance in the software development lifecycle.
- The first useful version succeeds when, after a Sandcastle/RALPH run, `/to-qa <parent issue>` creates an active QA session; the user can pass checks with a ding; the user can fail a check with a note and screenshot; the user can confirm a Beads or `.scratch` failure issue; and the completed session can be manually archived.
- Beads should prove the end-to-end core loop first. `.scratch` proves adapter breadth after the core loop is stable.
- The app should not feel like a tracker replacement. It is a local QA execution surface that can round-trip failures into the tracker.
- Low-quality source issues should not block all QA generation. The agent can infer useful checks from issues, commits, and code, but low-confidence items should be marked subtly.
- The installer must be conservative. Preview changes, merge safely where possible, and print manual instructions rather than overwriting provider configuration.
- No app secrets are stored in v1. Credentials live in user environment/config or provider-native auth, and the app may show config health without collecting keys.
- The PRD intentionally removes GitHub Issues because the user does not use it.
