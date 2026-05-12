# .scratch Tracker Convention

QA To Do v1 supports `.scratch` only when issues are structured markdown files under `.scratch/`.

Each issue file must start with YAML-style frontmatter:

```markdown
---
id: child-1
title: Import QA sessions
status: closed
parent: parent-1
---

## Acceptance notes

- The dashboard shows the imported QA session with repo context.
```

Required fields are `id`, `title`, and `status`. Child issues set `parent` to the parent issue ID. Completed child statuses are `closed`, `completed`, and `done`.

QA generation reads bullet points under `## Acceptance notes` or `## Acceptance criteria`. Freeform markdown without the required frontmatter is rejected with setup guidance instead of inferred into QA work.

Confirmed QA failures are written as structured bug files with `type: bug`, `labels: needs-triage, bug`, `parent`, and `qaFailureFingerprint` frontmatter. Local screenshot references are preserved in the `## Screenshots` section when tracker upload is unsupported.
