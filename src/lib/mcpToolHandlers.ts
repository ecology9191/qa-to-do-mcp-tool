import { draftBeadsFailureIssue, type BeadsFailureIssueContext, type BeadsFailureIssueDraft } from './beadsFailureIssue';
import { type FailedQaItemRecord, type FailureScreenshot, type QaStorageRepository } from './qaStorage';
import { draftScratchFailureIssue, type ScratchFailureIssueDraft } from './scratchFailureIssue';

export type QaToDoMcpToolName = 'qa_failed_items_list' | 'qa_failed_item_get' | 'qa_failed_item_mark_filed';

export interface QaToDoMcpToolDefinition {
  readonly name: QaToDoMcpToolName;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, { readonly type: 'string' | 'boolean'; readonly description: string }>;
    readonly required?: readonly string[];
    readonly additionalProperties: false;
  };
}

export interface FailedQaItemsListResponse {
  readonly schemaVersion: 1;
  readonly kind: 'qa-failed-items.list';
  readonly includeFiled: boolean;
  readonly statusLegend: typeof failedStatusLegend;
  readonly items: readonly FailedQaItemRow[];
}

export interface FailedQaItemRow {
  readonly schemaVersion: 1;
  readonly kind: 'qa-failed-item.row';
  readonly sessionId: string;
  readonly itemId: string;
  readonly status: 'failed' | 'failed-filed';
  readonly tracker: 'beads' | 'scratch';
  readonly repo: {
    readonly name: string;
    readonly path: string;
  };
  readonly parentIssue: {
    readonly id: string;
    readonly title: string;
  };
  readonly sourceIssue?: {
    readonly id: string;
  };
  readonly actualBehavior: string;
  readonly screenshotCount: number;
  readonly archivedAt?: string;
}

export interface FailedQaItemDetailResponse {
  readonly schemaVersion: 1;
  readonly kind: 'qa-failed-item.detail';
  readonly sessionId: string;
  readonly itemId: string;
  readonly status: 'failed' | 'failed-filed';
  readonly tracker: 'beads' | 'scratch';
  readonly actualBehavior: string;
  readonly failureContext: FailureContext;
  readonly screenshots: readonly FailureScreenshotEvidence[];
  readonly draftIssue?: DraftIssueResponse;
}

export interface MarkFailedQaItemFiledResponse {
  readonly schemaVersion: 1;
  readonly kind: 'qa-failed-item.mark-filed';
  readonly sessionId: string;
  readonly itemId: string;
  readonly status: 'failed-filed';
  readonly filedIssueId: string;
}

export type QaToDoMcpToolResponse = FailedQaItemsListResponse | FailedQaItemDetailResponse | MarkFailedQaItemFiledResponse;

export type FailureContext = BeadsFailureIssueContext;

export interface FailureScreenshotEvidence {
  readonly id: string;
  readonly originalName: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly localReference: string;
  readonly localPath: string;
  readonly capturedAt: string;
}

export type DraftIssueResponse =
  | (BeadsFailureIssueDraft & { readonly kind: 'beads-failure-issue-draft' })
  | (ScratchFailureIssueDraft & { readonly kind: 'scratch-failure-issue-draft' });

const failedStatusLegend = {
  failed: 'User-provided failure evidence exists, but no tracker issue has been confirmed filed.',
  'failed-filed': 'A tracker issue has already been recorded for the saved failure; avoid duplicate filing unless auditing or recovering.'
} as const;

export const qaToDoMcpToolDefinitions: readonly QaToDoMcpToolDefinition[] = [
  {
    name: 'qa_failed_items_list',
    description:
      'List saved QA failures from local QA To Do storage. failed means user-provided failure evidence exists but no tracker issue is confirmed; failed-filed means a tracker issue has already been recorded. Defaults avoid duplicate filing by excluding failed-filed items.',
    inputSchema: {
      type: 'object',
      properties: {
        includeFiled: {
          type: 'boolean',
          description:
            'When true, include failed-filed items for audit or recovery. Leaving this false reduces duplicate filing risk.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'qa_failed_item_get',
    description:
      'Fetch one failed or failed-filed QA item by exact sessionId and itemId, returning saved actual behavior, screenshot references, canonical failureContext, and a ready-to-file draft issue by default. failed means unfiled user evidence; failed-filed means already recorded in a tracker.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Exact QA session id from qa_failed_items_list. Required to avoid ambiguous extraction.'
        },
        itemId: {
          type: 'string',
          description: 'Exact QA item id from qa_failed_items_list. Required to avoid ambiguous extraction.'
        },
        includeDraftIssue: {
          type: 'boolean',
          description: 'Defaults to true. When false, returns only saved evidence and failureContext.'
        }
      },
      required: ['sessionId', 'itemId'],
      additionalProperties: false
    }
  },
  {
    name: 'qa_failed_item_mark_filed',
    description:
      'Mark one currently failed QA item as failed-filed after an agent has explicitly filed or updated an external tracker issue. This never creates tracker issues and rejects already filed, pending, passed, or skipped items to avoid corruption and duplicate filing.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Exact QA session id containing the failed item. Required for deterministic mutation.'
        },
        itemId: {
          type: 'string',
          description: 'Exact failed QA item id. Only items currently in failed status can transition to failed-filed.'
        },
        filedIssueId: {
          type: 'string',
          description: 'Non-empty tracker issue id that was filed or updated outside this MCP tool.'
        }
      },
      required: ['sessionId', 'itemId', 'filedIssueId'],
      additionalProperties: false
    }
  }
];

export function handleQaToDoMcpToolCall(
  repository: QaStorageRepository,
  toolName: 'qa_failed_items_list',
  input: unknown,
  options?: { readonly now?: string }
): FailedQaItemsListResponse;
export function handleQaToDoMcpToolCall(
  repository: QaStorageRepository,
  toolName: 'qa_failed_item_get',
  input: unknown,
  options?: { readonly now?: string }
): FailedQaItemDetailResponse;
export function handleQaToDoMcpToolCall(
  repository: QaStorageRepository,
  toolName: 'qa_failed_item_mark_filed',
  input: unknown,
  options?: { readonly now?: string }
): MarkFailedQaItemFiledResponse;
export function handleQaToDoMcpToolCall(
  repository: QaStorageRepository,
  toolName: QaToDoMcpToolName,
  input: unknown,
  options: { readonly now?: string } = {}
): QaToDoMcpToolResponse {
  switch (toolName) {
    case 'qa_failed_items_list':
      return listFailedQaItems(repository, input);
    case 'qa_failed_item_get':
      return getFailedQaItem(repository, input);
    case 'qa_failed_item_mark_filed':
      return markFailedQaItemFiled(repository, input, options.now);
  }
}

function listFailedQaItems(repository: QaStorageRepository, input: unknown): FailedQaItemsListResponse {
  const args = optionalRecord(input);
  const includeFiled = args.includeFiled === true;
  return {
    schemaVersion: 1,
    kind: 'qa-failed-items.list',
    includeFiled,
    statusLegend: failedStatusLegend,
    items: repository.listFailedQaItems({ includeFiled }).map(toFailedQaItemRow)
  };
}

function getFailedQaItem(repository: QaStorageRepository, input: unknown): FailedQaItemDetailResponse {
  const args = requiredRecord(input);
  const sessionId = requiredString(args.sessionId, 'sessionId');
  const itemId = requiredString(args.itemId, 'itemId');
  const includeDraftIssue = args.includeDraftIssue !== false;
  const record = repository.getFailedQaItem(sessionId, itemId);
  const failureContext = toFailureContext(record);
  const response: FailedQaItemDetailResponse = {
    schemaVersion: 1,
    kind: 'qa-failed-item.detail',
    sessionId: record.session.id,
    itemId: record.item.id,
    status: record.item.status,
    tracker: record.session.tracker,
    actualBehavior: failureContext.actualBehavior,
    failureContext,
    screenshots: record.item.screenshots.map(toScreenshotEvidence)
  };

  return includeDraftIssue ? { ...response, draftIssue: createDraftIssue(record, failureContext) } : response;
}

function markFailedQaItemFiled(
  repository: QaStorageRepository,
  input: unknown,
  now = new Date().toISOString()
): MarkFailedQaItemFiledResponse {
  const args = requiredRecord(input);
  const sessionId = requiredString(args.sessionId, 'sessionId');
  const itemId = requiredString(args.itemId, 'itemId');
  const filedIssueId = requiredString(args.filedIssueId, 'filedIssueId');
  repository.markFailureFiled(sessionId, itemId, filedIssueId, now);
  return {
    schemaVersion: 1,
    kind: 'qa-failed-item.mark-filed',
    sessionId,
    itemId,
    status: 'failed-filed',
    filedIssueId
  };
}

function toFailedQaItemRow(record: FailedQaItemRecord): FailedQaItemRow {
  return {
    schemaVersion: 1,
    kind: 'qa-failed-item.row',
    sessionId: record.session.id,
    itemId: record.item.id,
    status: record.item.status,
    tracker: record.session.tracker,
    repo: {
      name: record.session.repoName,
      path: record.session.repoPath
    },
    parentIssue: {
      id: record.session.parentIssueId,
      title: record.session.parentIssueTitle
    },
    ...(record.item.sourceIssueId.trim().length > 0 ? { sourceIssue: { id: record.item.sourceIssueId } } : {}),
    actualBehavior: record.item.note ?? '',
    screenshotCount: record.item.screenshots.length,
    ...(record.session.archivedAt ? { archivedAt: record.session.archivedAt } : {})
  };
}

function toFailureContext(record: FailedQaItemRecord): FailureContext {
  return {
    repo: {
      name: record.session.repoName,
      path: record.session.repoPath
    },
    parentIssue: {
      id: record.session.parentIssueId,
      title: record.session.parentIssueTitle
    },
    item: {
      id: record.item.id,
      title: record.item.title,
      steps: record.item.steps,
      expectedResult: record.item.expectedResult,
      fingerprint: record.item.fingerprint,
      ...(record.item.sourceIssueId.trim().length > 0 ? { sourceIssueId: record.item.sourceIssueId } : {}),
      sourceEvidence: record.item.sourceEvidence
    },
    actualBehavior: record.item.note ?? '',
    screenshots: record.item.screenshots.map((screenshot) => ({
      name: screenshot.originalName,
      mimeType: screenshot.mimeType,
      sizeBytes: screenshot.sizeBytes,
      localReference: screenshot.localReference
    }))
  };
}

function createDraftIssue(record: FailedQaItemRecord, failureContext: FailureContext): DraftIssueResponse {
  if (record.session.tracker === 'scratch') {
    return { kind: 'scratch-failure-issue-draft', ...draftScratchFailureIssue(failureContext) };
  }
  return { kind: 'beads-failure-issue-draft', ...draftBeadsFailureIssue(failureContext) };
}

function toScreenshotEvidence(screenshot: FailureScreenshot): FailureScreenshotEvidence {
  return {
    id: screenshot.id,
    originalName: screenshot.originalName,
    name: screenshot.originalName,
    mimeType: screenshot.mimeType,
    sizeBytes: screenshot.sizeBytes,
    localReference: screenshot.localReference,
    localPath: screenshot.localPath,
    capturedAt: screenshot.capturedAt
  };
}

function optionalRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  return requiredRecord(value);
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('MCP tool input must be an object.');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}
