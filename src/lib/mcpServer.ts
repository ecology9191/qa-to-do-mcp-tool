import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveQaToDoMcpConfig } from './mcpConfig';
import {
  createQaSessionFromPayload,
  handleQaToDoMcpToolCall,
  qaToDoMcpToolDefinitions,
  runToQaParent,
  type QaToDoMcpToolDefinition,
  type QaToDoMcpToolName
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
const failedItemGetToolName = 'qa_failed_item_get';
const failedItemMarkFiledToolName = 'qa_failed_item_mark_filed';
const failedItemsListToolDefinition = requiredToolDefinition(failedItemsListToolName);
const failedItemGetToolDefinition = requiredToolDefinition(failedItemGetToolName);
const failedItemMarkFiledToolDefinition = requiredToolDefinition(failedItemMarkFiledToolName);

const failedItemsListInputSchema = {
  includeFiled: z.boolean().optional().describe(
    failedItemsListToolDefinition.inputSchema.properties.includeFiled.description
  )
};

const failedItemGetInputSchema = {
  sessionId: z.string().describe(failedItemGetToolDefinition.inputSchema.properties.sessionId.description),
  itemId: z.string().describe(failedItemGetToolDefinition.inputSchema.properties.itemId.description),
  includeDraftIssue: z.boolean().optional().describe(
    failedItemGetToolDefinition.inputSchema.properties.includeDraftIssue.description
  )
};

const failedItemMarkFiledInputSchema = {
  sessionId: z.string().describe(failedItemMarkFiledToolDefinition.inputSchema.properties.sessionId.description),
  itemId: z.string().describe(failedItemMarkFiledToolDefinition.inputSchema.properties.itemId.description),
  filedIssueId: z.string().describe(failedItemMarkFiledToolDefinition.inputSchema.properties.filedIssueId.description)
};

type StorageBackedToolInputSchema =
  | typeof failedItemsListInputSchema
  | typeof failedItemGetInputSchema
  | typeof failedItemMarkFiledInputSchema;

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
    storageBackedToolConfig('List Failed QA Items', failedItemsListToolDefinition, failedItemsListInputSchema),
    storageBackedToolHandler(env, failedItemsListToolName)
  );

  server.registerTool(
    failedItemGetToolName,
    storageBackedToolConfig('Get Failed QA Item', failedItemGetToolDefinition, failedItemGetInputSchema),
    storageBackedToolHandler(env, failedItemGetToolName)
  );

  server.registerTool(
    failedItemMarkFiledToolName,
    storageBackedToolConfig('Mark Failed QA Item Filed', failedItemMarkFiledToolDefinition, failedItemMarkFiledInputSchema),
    storageBackedToolHandler(env, failedItemMarkFiledToolName)
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

function storageBackedToolConfig(
  title: string,
  toolDefinition: QaToDoMcpToolDefinition,
  inputSchema: StorageBackedToolInputSchema
) {
  return {
    title,
    description: toolDefinition.description,
    inputSchema
  };
}

function storageBackedToolHandler(
  env: NodeJS.ProcessEnv,
  toolName: QaToDoMcpToolName
) {
  return async (input: unknown) => {
    const config = resolveQaToDoMcpConfig(env);
    const repository = new QaStorageRepository(config.databasePath, config.storageRoot);

    try {
      return toTextResult(handleQaToDoMcpToolCall(repository, toolName, input));
    } finally {
      repository.close();
    }
  };
}

function requiredToolDefinition(name: QaToDoMcpToolName): QaToDoMcpToolDefinition {
  const toolDefinition = qaToDoMcpToolDefinitions.find((tool) => tool.name === name);
  if (!toolDefinition) {
    throw new Error(`${name} MCP tool definition is missing.`);
  }
  return toolDefinition;
}
