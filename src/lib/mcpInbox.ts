import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateQaSessionPayload, type QaSessionPayload } from './qaSession';

export interface QaSessionInboxEntry {
  readonly messageType: 'qa-session.create';
  readonly correlationId: string;
  readonly createdAt: string;
  readonly payload: QaSessionPayload;
}

export async function writeQaSessionInboxEntry(
  inboxDir: string,
  payload: QaSessionPayload,
  options: { readonly correlationId?: string; readonly createdAt?: string } = {}
): Promise<string> {
  const validatedPayload = validateQaSessionPayload(payload);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const correlationId = options.correlationId ?? randomUUID();
  const entry: QaSessionInboxEntry = {
    messageType: 'qa-session.create',
    correlationId,
    createdAt,
    payload: validatedPayload
  };

  await mkdir(inboxDir, { recursive: true });

  const finalPath = join(inboxDir, `${createdAt.replace(/[:.]/g, '-')}-${correlationId}.json`);
  const temporaryPath = `${finalPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(entry, null, 2)}\n`, { flag: 'wx' });
  await rename(temporaryPath, finalPath);

  return finalPath;
}

export function validateQaSessionInboxEntry(value: unknown): QaSessionInboxEntry {
  if (!isRecord(value)) {
    throw new Error('Inbox entry must be an object.');
  }
  if (value.messageType !== 'qa-session.create') {
    throw new Error('Inbox entry messageType must be qa-session.create.');
  }
  if (typeof value.correlationId !== 'string' || value.correlationId.trim().length === 0) {
    throw new Error('Inbox entry correlationId is required.');
  }
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) {
    throw new Error('Inbox entry createdAt must be an ISO timestamp.');
  }

  return {
    messageType: 'qa-session.create',
    correlationId: value.correlationId,
    createdAt: value.createdAt,
    payload: validateQaSessionPayload(value.payload)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
