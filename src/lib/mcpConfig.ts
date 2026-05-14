import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface QaToDoMcpConfig {
  readonly inboxDir: string;
  readonly processedDir: string;
  readonly quarantineDir: string;
  readonly databasePath: string;
  readonly storageRoot: string;
}

export function resolveQaToDoMcpConfig(env: NodeJS.ProcessEnv = process.env): QaToDoMcpConfig {
  const dataRoot = expandPath(env.QA_TO_DO_DATA_DIR ?? join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'qa-to-do'));
  const config = {
    inboxDir: expandPath(env.QA_TO_DO_INBOX_DIR ?? join(dataRoot, 'inbox')),
    processedDir: expandPath(env.QA_TO_DO_PROCESSED_DIR ?? join(dataRoot, 'processed')),
    quarantineDir: expandPath(env.QA_TO_DO_QUARANTINE_DIR ?? join(dataRoot, 'quarantine')),
    databasePath: expandPath(env.QA_TO_DO_DB_PATH ?? join(dataRoot, 'qa-to-do.sqlite')),
    storageRoot: expandPath(env.QA_TO_DO_STORAGE_ROOT ?? join(dataRoot, 'evidence'))
  };

  mkdirSync(config.inboxDir, { recursive: true });
  mkdirSync(config.processedDir, { recursive: true });
  mkdirSync(config.quarantineDir, { recursive: true });
  mkdirSync(dirname(config.databasePath), { recursive: true });
  mkdirSync(config.storageRoot, { recursive: true });

  return config;
}

function expandPath(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return resolve(path);
}
