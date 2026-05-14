import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveQaToDoMcpConfig } from './mcpConfig';
import {
  createQaSessionFromPayload,
  handleQaToDoMcpToolCall,
  qaToDoMcpToolDefinitions,
  runToQaParent
} from './mcpToolHandlers';
import { QaStorageRepository } from './qaStorage';

const payloadInputSchema = {
  payload: z.unknown().describe('Validated by QA To Do as a qa-session.v1 payload.'),
  correlationId: z.string().optional(),
  createdAt: z.string().optional()
};

const runToQaInputSchema = {
  parentIssueId: z.string(),
  repoPath: z.string(),
  repoName: z.string().optional(),
  tracker: z.enum(['auto', 'beads', 'scratch']).optional(),
  correlationId: z.string().optional(),
  generatedAt: z.string().optional()
};

const failedItemsListToolName = 'qa_failed_items_list';
const failedItemsListToolDefinition = requiredToolDefinition(failedItemsListToolName);

const failedItemsListInputSchema = {
  includeFiled: z.boolean().optional().describe(
    failedItemsListToolDefinition.inputSchema.properties.includeFiled.description
  )
};

export function createQaToDoMcpServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer({ name: 'qa-to-do', version: '0.1.0' });

  server.registerTool(
    'qa_session_create',
    {
      title: 'Create QA To Do Session',
      description: 'Validate a QA session payload, write the local inbox entry, and import it into QA To Do storage.',
      inputSchema: payloadInputSchema
    },
    async (input) => toTextResult(await createQaSessionFromPayload(input, resolveQaToDoMcpConfig(env)))
  );

  server.registerTool(
    'run_to_qa_parent',
    {
      title: 'Run To QA Parent Flow',
      description: 'Create a QA session from completed Beads or structured .scratch child work for a parent issue.',
      inputSchema: runToQaInputSchema
    },
    async (input) => toTextResult(await runToQaParent(input, resolveQaToDoMcpConfig(env)))
  );

  server.registerTool(
    failedItemsListToolName,
    {
      title: 'List Failed QA Items',
      description: failedItemsListToolDefinition.description,
      inputSchema: failedItemsListInputSchema
    },
    async (input) => {
      const config = resolveQaToDoMcpConfig(env);
      const repository = new QaStorageRepository(config.databasePath, config.storageRoot);

      try {
        return toTextResult(handleQaToDoMcpToolCall(repository, failedItemsListToolName, input));
      } finally {
        repository.close();
      }
    }
  );

  return server;
}

export async function runQaToDoMcpServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const server = createQaToDoMcpServer(env);
  await server.connect(new StdioServerTransport());
}

function toTextResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function requiredToolDefinition(name: typeof failedItemsListToolName) {
  const toolDefinition = qaToDoMcpToolDefinitions.find((tool) => tool.name === name);
  if (!toolDefinition) {
    throw new Error(`${name} MCP tool definition is missing.`);
  }
  return toolDefinition;
}
