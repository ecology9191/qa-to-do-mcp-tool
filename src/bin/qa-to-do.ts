#!/usr/bin/env node
import { runQaToDoMcpServer } from '../lib/mcpServer';

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'mcp') {
    await runQaToDoMcpServer();
    return;
  }

  process.stderr.write('Usage: qa-to-do mcp\n');
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
