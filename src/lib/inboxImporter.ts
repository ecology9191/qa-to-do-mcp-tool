import { mkdir, readFile, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { validateQaSessionInboxEntry } from './mcpInbox';
import type { QaStorageRepository } from './qaStorage';

export interface InboxImportResult {
  readonly importedSessionIds: readonly string[];
  readonly quarantinedEntries: readonly string[];
}

export async function importQaSessionInboxEntries(
  entryPaths: readonly string[],
  repository: QaStorageRepository,
  processedDir: string,
  quarantineDir: string
): Promise<InboxImportResult> {
  await mkdir(processedDir, { recursive: true });
  await mkdir(quarantineDir, { recursive: true });

  const importedSessionIds: string[] = [];
  const quarantinedEntries: string[] = [];

  for (const entryPath of entryPaths) {
    try {
      const rawEntry = JSON.parse(await readFile(entryPath, 'utf8')) as unknown;
      const entry = validateQaSessionInboxEntry(rawEntry);
      const sessionId = repository.importSession(entry.payload, entry.createdAt);
      importedSessionIds.push(sessionId);
      await rename(entryPath, join(processedDir, basename(entryPath)));
    } catch {
      quarantinedEntries.push(entryPath);
      await rename(entryPath, join(quarantineDir, basename(entryPath)));
    }
  }

  return { importedSessionIds, quarantinedEntries };
}
