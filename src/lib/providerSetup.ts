import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type ProviderSetupStatus = 'ready' | 'manual';
export type ProviderSetupOperationAction = 'create' | 'update' | 'noop';
export type ProviderSetupCapabilityStatus = 'automated' | 'manual';

export interface ProviderSetupOptions {
  readonly provider: string;
  readonly configDir: string;
  readonly mcpCommand: readonly string[];
  readonly appOpenCommand?: readonly string[];
}

export interface ProviderSetupOperation {
  readonly action: ProviderSetupOperationAction;
  readonly path: string;
  readonly before?: string;
  readonly after: string;
}

export interface ProviderSetupPlan {
  readonly provider: string;
  readonly status: ProviderSetupStatus;
  readonly capabilities: readonly ProviderSetupCapability[];
  readonly operations: readonly ProviderSetupOperation[];
  readonly manualInstructions: readonly string[];
}

export interface ProviderSetupCapability {
  readonly name: string;
  readonly status: ProviderSetupCapabilityStatus;
  readonly detail: string;
}

export interface ProviderSetupApplyResult {
  readonly appliedPaths: readonly string[];
  readonly skippedPaths: readonly string[];
}

export class ProviderSetupApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderSetupApplyError';
  }
}

const openCodeSchema = 'https://opencode.ai/config.json';
const mcpServerName = 'qa-to-do';

const openCodeCapabilities: readonly ProviderSetupCapability[] = [
  { name: 'global /to-qa command', status: 'automated', detail: 'Previewed as an OpenCode command file.' },
  { name: 'to-qa skill', status: 'automated', detail: 'Previewed as an OpenCode global skill.' },
  {
    name: 'qa-to-do MCP registration',
    status: 'automated',
    detail: 'Safely merged into object-shaped OpenCode config.'
  }
];

const manualProviderCapabilities: readonly ProviderSetupCapability[] = [
  {
    name: 'global /to-qa command',
    status: 'manual',
    detail: 'Provider command or rule location is not safely editable by this installer.'
  },
  {
    name: 'to-qa skill',
    status: 'manual',
    detail: 'Provider skill support must be installed manually or replaced with provider-native rules.'
  },
  {
    name: 'qa-to-do MCP registration',
    status: 'manual',
    detail: 'Provider config shape is not safely editable by this installer.'
  }
];

type OpenCodeConfigOperationResult =
  | { readonly status: 'ready'; readonly operation: ProviderSetupOperation }
  | { readonly status: 'manual'; readonly manualInstructions: readonly string[] };

export async function createProviderSetupPlan(options: ProviderSetupOptions): Promise<ProviderSetupPlan> {
  if (options.provider !== 'opencode') {
    return createManualProviderSetupPlan(
      options.provider,
      [
        `${options.provider} setup is not safely editable by this installer yet.`,
        'Install a global /to-qa command or rule that invokes the to-qa workflow, then register the local qa-to-do MCP server with your provider.',
        'Use provider-native auth or user environment/config for credentials; do not store secrets in QA To Do setup files.'
      ]
    );
  }

  return createOpenCodeSetupPlan(options);
}

export function renderProviderSetupDryRun(plan: ProviderSetupPlan): string {
  const lines = [`Dry run for ${plan.provider} provider setup`, '', 'Capabilities:'];

  for (const capability of plan.capabilities) {
    lines.push(`- ${capability.name}: ${capability.status} - ${capability.detail}`);
  }

  if (plan.operations.length > 0) {
    lines.push('', 'Operations:');
    for (const operation of plan.operations) {
      lines.push(`- ${operation.action} ${operation.path}`);
      if (operation.before !== undefined) {
        lines.push('  Before:');
        lines.push(indent(operation.before.trimEnd()));
      }
      lines.push('  After:');
      lines.push(indent(operation.after.trimEnd()));
    }
  } else {
    lines.push('', 'No files will be changed automatically. Follow these manual steps instead.');
  }

  if (plan.manualInstructions.length > 0) {
    lines.push('', 'Instructions:');
    for (const instruction of plan.manualInstructions) {
      lines.push(`- ${instruction}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function applyProviderSetupPlan(plan: ProviderSetupPlan): Promise<ProviderSetupApplyResult> {
  if (plan.status !== 'ready') {
    return { appliedPaths: [], skippedPaths: plan.operations.map((operation) => operation.path) };
  }

  const appliedPaths: string[] = [];
  const skippedPaths: string[] = [];

  for (const operation of plan.operations) {
    await assertOperationStillMatchesPreview(operation);

    if (operation.action === 'noop') {
      skippedPaths.push(operation.path);
      continue;
    }

    await mkdir(dirname(operation.path), { recursive: true });
    await writeFile(operation.path, operation.after, 'utf8');
    appliedPaths.push(operation.path);
  }

  return { appliedPaths, skippedPaths };
}

async function createOpenCodeSetupPlan(options: ProviderSetupOptions): Promise<ProviderSetupPlan> {
  const configPath = join(options.configDir, 'opencode.json');
  const commandPath = join(options.configDir, 'commands', 'to-qa.md');
  const skillPath = join(options.configDir, 'skills', 'to-qa', 'SKILL.md');
  const configRead = await readOptionalFile(configPath);
  const configOperation = createOpenCodeConfigOperation(configPath, configRead, options.mcpCommand);

  if (configOperation.status === 'manual') {
    return createManualProviderSetupPlan(options.provider, configOperation.manualInstructions);
  }

  const [commandRead, skillRead] = await Promise.all([readOptionalFile(commandPath), readOptionalFile(skillPath)]);
  const operations = [
    configOperation.operation,
    createFileOperation(commandPath, commandRead, createToQaCommandContent(options.appOpenCommand)),
    createFileOperation(skillPath, skillRead, createToQaSkillContent(options.mcpCommand))
  ];

  return {
    provider: options.provider,
    status: 'ready',
    capabilities: openCodeCapabilities,
    operations,
    manualInstructions: [
      'Preview every operation before applying; these file contents are the exact OpenCode setup changes.',
      'This setup does not store app-managed secrets. Use user environment, existing provider config, or provider-native auth.'
    ]
  };
}

function createManualProviderSetupPlan(
  provider: string,
  manualInstructions: readonly string[]
): ProviderSetupPlan {
  return {
    provider,
    status: 'manual',
    capabilities: manualProviderCapabilities,
    operations: [],
    manualInstructions
  };
}

function createOpenCodeConfigOperation(
  configPath: string,
  configRead: OptionalFileRead,
  mcpCommand: readonly string[]
): OpenCodeConfigOperationResult {
  const desiredMcp = { type: 'local', command: [...mcpCommand], enabled: true };

  if (!configRead.exists) {
    return {
      status: 'ready',
      operation: createFileOperation(
        configPath,
        configRead,
        stringifyConfig({ $schema: openCodeSchema, mcp: { [mcpServerName]: desiredMcp } })
      )
    };
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(configRead.content);
  } catch {
    return manualOpenCodeConfigInstructions(configPath, 'OpenCode config is not valid JSON.', mcpCommand);
  }

  if (!isRecord(parsedConfig)) {
    return manualOpenCodeConfigInstructions(configPath, 'OpenCode config must be a JSON object.', mcpCommand);
  }

  const currentMcp = parsedConfig.mcp;
  if (currentMcp !== undefined && !isRecord(currentMcp)) {
    return manualOpenCodeConfigInstructions(configPath, 'OpenCode config has an unsupported non-object mcp shape.', mcpCommand);
  }

  const mcpConfig = currentMcp ?? {};
  const existingServer = mcpConfig[mcpServerName];
  if (existingServer !== undefined && !sameJson(existingServer, desiredMcp)) {
    return manualOpenCodeConfigInstructions(configPath, 'OpenCode config already has a qa-to-do MCP server with different settings.', mcpCommand);
  }

  const nextConfig = {
    ...parsedConfig,
    mcp: {
      ...mcpConfig,
      [mcpServerName]: desiredMcp
    }
  };

  return {
    status: 'ready',
    operation: createFileOperation(configPath, configRead, stringifyConfig(nextConfig))
  };
}

function manualOpenCodeConfigInstructions(
  configPath: string,
  reason: string,
  mcpCommand: readonly string[]
): { readonly status: 'manual'; readonly manualInstructions: readonly string[] } {
  return {
    status: 'manual',
    manualInstructions: [
      `${reason} The installer will not overwrite ${configPath}.`,
      `Manually add an OpenCode local MCP server named qa-to-do with command ${JSON.stringify(mcpCommand)} and enabled true.`,
      'Manually add ~/.config/opencode/commands/to-qa.md and ~/.config/opencode/skills/to-qa/SKILL.md using the QA To Do setup preview from a clean OpenCode config.',
      'Do not add app-managed secrets; rely on user environment, existing config, or OpenCode native auth.'
    ]
  };
}

async function assertOperationStillMatchesPreview(operation: ProviderSetupOperation): Promise<void> {
  const current = await readOptionalFile(operation.path);

  if (operation.action === 'create') {
    if (current.exists) {
      throw new ProviderSetupApplyError(`${operation.path} changed since preview; re-run setup preview before applying.`);
    }
    return;
  }

  if (!current.exists || current.content !== operation.before) {
    throw new ProviderSetupApplyError(`${operation.path} changed since preview; re-run setup preview before applying.`);
  }
}

function createFileOperation(path: string, read: OptionalFileRead, after: string): ProviderSetupOperation {
  if (!read.exists) {
    return { action: 'create', path, after };
  }

  if (read.content === after) {
    return { action: 'noop', path, before: read.content, after };
  }

  return { action: 'update', path, before: read.content, after };
}

function createToQaCommandContent(appOpenCommand: readonly string[] | undefined): string {
  void appOpenCommand;

  return `---
description: Create a QA To Do session from completed Sandcastle/RALPH work
---

Use the \`to-qa\` skill for $ARGUMENTS.

When finished, report the created QA session and tell the user to open QA To Do to run the checks.
`;
}

function createToQaSkillContent(mcpCommand: readonly string[]): string {
  void mcpCommand;

  return `---
name: to-qa
description: Create a local QA To Do session from Sandcastle/RALPH completed source work, including older non-parent Beads issues.
compatibility: opencode
metadata:
  workflow: sandcastle-ralph-qa
---

Use this skill when the user runs \`/to-qa <issue>\`.

For Beads, the issue can be a parent with child work, an older cumulative issue, a discovered-from source issue, or a completed standalone issue with no parent-child structure. For structured .scratch, the issue is normally a parent with child files.

## Workflow

1. Inspect the explicit source issue in the current repo.
2. Find completed source work only: closed/completed/done Beads child issues, discovered-from Beads issues, older cumulative or standalone Beads issues, or structured .scratch child files.
3. Read commits, changed files, and implementation context only as needed to write concrete QA checks.
4. Create human-verifiable QA checks with title, runnable steps, expected result, source issue ID, source evidence, stable ID, and fingerprint.
5. Call the \`qa-to-do\` MCP server to create the QA session. The MCP input field \`parentIssueId\` is legacy-named; for Beads, pass the requested issue ID even when it is not a literal parent.
6. Report the session title, source issue, item count, and warnings.

## Beads Fallback

- Do not require parent-child relationships for Beads; older Sandcastle/RALPH Beads may be cumulative or standalone.
- Prefer parent-child children when present.
- If no parent-child children exist, use completed discovered-from issues when present.
- If neither relationship exists and the requested Beads issue is closed, completed, or done, use that issue itself as the completed source work.

## Rules

- Do not create checks from open/incomplete source work; warn about excluded work.
- If there is no completed source work, fail clearly and do not create a session.
- Do not write vague checks like "verify implementation" or "works as expected".
- Do not mutate pass/fail/skip/edit/archive/delete state through MCP.
- Do not file, close, or update tracker issues during \`/to-qa\`.
- QA To Do owns checklist execution, evidence, pass/fail state, and archive.
- No app-managed secrets are stored by this setup.
`;
}

function stringifyConfig(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function indent(value: string): string {
  return value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface OptionalFileRead {
  readonly exists: boolean;
  readonly content: string;
}

async function readOptionalFile(path: string): Promise<OptionalFileRead> {
  try {
    return { exists: true, content: await readFile(path, 'utf8') };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { exists: false, content: '' };
    }

    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
