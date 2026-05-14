export const qaSessionSchemaVersion = 1;

export interface SourceEvidence {
  readonly label: string;
  readonly value: string;
}

export interface QaSourceIssue {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly priority?: number;
  readonly closedAt?: string;
  readonly evidence: readonly SourceEvidence[];
}

export interface QaSessionPayload {
  readonly schemaVersion: typeof qaSessionSchemaVersion;
  readonly title: string;
  readonly generatedAt: string;
  readonly source: {
    readonly tracker: 'beads' | 'scratch';
    readonly repo: {
      readonly name: string;
      readonly path: string;
    };
    readonly parentIssue: {
      readonly id: string;
      readonly title: string;
      readonly status: string;
    };
    readonly sourceIssues: readonly QaSourceIssue[];
    readonly sessionEvidence: readonly SourceEvidence[];
  };
  readonly warnings: readonly string[];
  readonly items: readonly QaItemPayload[];
}

export interface QaItemPayload {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly expectedResult: string;
  readonly fingerprint: string;
  readonly sourceIssueId: string;
  readonly sourceEvidence: readonly SourceEvidence[];
  readonly confidence: 'normal' | 'low';
  readonly warnings: readonly string[];
}

export class QaSessionValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid QA session payload: ${issues.join('; ')}`);
    this.name = 'QaSessionValidationError';
  }
}

export function validateQaSessionPayload(payload: unknown): QaSessionPayload {
  const issues: string[] = [];
  let completedSourceIssueIds: ReadonlySet<string> | undefined;

  if (!isRecord(payload)) {
    throw new QaSessionValidationError(['payload must be an object']);
  }

  if (payload.schemaVersion !== qaSessionSchemaVersion) {
    issues.push(`schemaVersion must be ${qaSessionSchemaVersion}`);
  }

  requireString(payload.title, 'title', issues);
  requireIsoDate(payload.generatedAt, 'generatedAt', issues);

  if (!isRecord(payload.source)) {
    issues.push('source is required');
  } else {
    if (payload.source.tracker !== 'beads' && payload.source.tracker !== 'scratch') {
      issues.push('source.tracker must be beads or scratch');
    }
    validateRepo(payload.source.repo, issues);
    validateParentIssue(payload.source.parentIssue, issues);
    validateEvidenceArray(payload.source.sessionEvidence, 'source.sessionEvidence', issues);
    completedSourceIssueIds = validateSourceIssues(payload.source.sourceIssues, issues);
  }

  if (!Array.isArray(payload.warnings) || !payload.warnings.every((warning) => isNonEmptyString(warning))) {
    issues.push('warnings must be an array of strings');
  }

  validateItems(payload.items, issues, completedSourceIssueIds);

  if (issues.length > 0) {
    throw new QaSessionValidationError(issues);
  }

  return payload as unknown as QaSessionPayload;
}

function validateRepo(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push('source.repo is required');
    return;
  }

  requireString(value.name, 'source.repo.name', issues);
  requireString(value.path, 'source.repo.path', issues);
}

function validateParentIssue(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push('source.parentIssue is required');
    return;
  }

  requireString(value.id, 'source.parentIssue.id', issues);
  requireString(value.title, 'source.parentIssue.title', issues);
  requireString(value.status, 'source.parentIssue.status', issues);
}

function validateSourceIssues(value: unknown, issues: string[]): Set<string> | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push('source.sourceIssues must include at least one completed source issue');
    return undefined;
  }

  const sourceIssueIds = new Set<string>();

  value.forEach((sourceIssue, index) => {
    if (!isRecord(sourceIssue)) {
      issues.push(`source.sourceIssues[${index}] must be an object`);
      return;
    }

    requireString(sourceIssue.id, `source.sourceIssues[${index}].id`, issues);
    if (isNonEmptyString(sourceIssue.id)) {
      sourceIssueIds.add(sourceIssue.id);
    }
    requireString(sourceIssue.title, `source.sourceIssues[${index}].title`, issues);
    requireString(sourceIssue.status, `source.sourceIssues[${index}].status`, issues);
    validateEvidenceArray(sourceIssue.evidence, `source.sourceIssues[${index}].evidence`, issues);
  });

  return sourceIssueIds;
}

function validateItems(value: unknown, issues: string[], completedSourceIssueIds?: ReadonlySet<string>): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push('items must include at least one QA check');
    return;
  }

  const fingerprints = new Set<string>();
  const itemSourceIssueIds = new Set<string>();

  value.forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push(`items[${index}] must be an object`);
      return;
    }

    requireString(item.id, `items[${index}].id`, issues);
    requireString(item.title, `items[${index}].title`, issues);
    requireString(item.expectedResult, `items[${index}].expectedResult`, issues);
    requireString(item.fingerprint, `items[${index}].fingerprint`, issues);
    requireString(item.sourceIssueId, `items[${index}].sourceIssueId`, issues);

    if (isNonEmptyString(item.sourceIssueId)) {
      itemSourceIssueIds.add(item.sourceIssueId);
      if (completedSourceIssueIds && !completedSourceIssueIds.has(item.sourceIssueId)) {
        issues.push(`items[${index}].sourceIssueId must match one completed source issue`);
      }
    }

    if (!Array.isArray(item.steps) || item.steps.length === 0 || !item.steps.every((step) => isNonEmptyString(step))) {
      issues.push(`items[${index}].steps must include human-verifiable steps`);
    }

    validateEvidenceArray(item.sourceEvidence, `items[${index}].sourceEvidence`, issues);

    if (item.confidence !== 'normal' && item.confidence !== 'low') {
      issues.push(`items[${index}].confidence must be normal or low`);
    }

    if (!Array.isArray(item.warnings) || !item.warnings.every((warning) => isNonEmptyString(warning))) {
      issues.push(`items[${index}].warnings must be an array of strings`);
    }

    if (typeof item.fingerprint === 'string') {
      if (fingerprints.has(item.fingerprint)) {
        issues.push(`items[${index}].fingerprint duplicates another QA item`);
      }
      fingerprints.add(item.fingerprint);
    }

    if (isVagueQaItem(item)) {
      issues.push(`items[${index}] must describe a human-verifiable behavior, not implementation review`);
    }
  });

  if (itemSourceIssueIds.size !== value.length) {
    issues.push('each QA item must map to one completed source issue');
  }

  if (completedSourceIssueIds && hasMissingSourceIssueQaItem(completedSourceIssueIds, itemSourceIssueIds)) {
    issues.push('each completed source issue must have one QA item');
  }
}

function hasMissingSourceIssueQaItem(
  completedSourceIssueIds: ReadonlySet<string>,
  itemSourceIssueIds: ReadonlySet<string>
): boolean {
  for (const sourceIssueId of completedSourceIssueIds) {
    if (!itemSourceIssueIds.has(sourceIssueId)) {
      return true;
    }
  }

  return false;
}

function validateEvidenceArray(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${path} must include evidence`);
    return;
  }

  value.forEach((evidence, index) => {
    if (!isRecord(evidence)) {
      issues.push(`${path}[${index}] must be an object`);
      return;
    }

    requireString(evidence.label, `${path}[${index}].label`, issues);
    requireString(evidence.value, `${path}[${index}].value`, issues);
  });
}

function isVagueQaItem(item: Record<string, unknown>): boolean {
  const text = `${String(item.title ?? '')} ${String(item.expectedResult ?? '')} ${Array.isArray(item.steps) ? item.steps.join(' ') : ''}`.toLowerCase();
  return /review implementation|inspect code|check the code|works as expected|verify implementation/.test(text);
}

function requireIsoDate(value: unknown, path: string, issues: string[]): void {
  if (!isNonEmptyString(value) || Number.isNaN(Date.parse(value))) {
    issues.push(`${path} must be an ISO timestamp`);
  }
}

function requireString(value: unknown, path: string, issues: string[]): void {
  if (!isNonEmptyString(value)) {
    issues.push(`${path} is required`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
