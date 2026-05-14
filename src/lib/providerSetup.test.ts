// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProviderSetupPlan, createProviderSetupPlan, renderProviderSetupDryRun } from './providerSetup';

describe('provider setup', () => {
  const temporaryDirectories: string[] = [];

  async function createTemporaryDirectory(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'qa-to-do-setup-'));
    temporaryDirectories.push(root);
    return root;
  }

  async function writeJsonFile(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('previews and applies exact safe OpenCode skill, command, and MCP config changes', async () => {
    const root = await createTemporaryDirectory();
    const configPath = join(root, 'opencode.json');
    await writeJsonFile(configPath, { theme: 'system', mcp: { existing: { type: 'local', command: ['existing'] } } });

    const plan = await createProviderSetupPlan({
      provider: 'opencode',
      configDir: root,
      mcpCommand: ['qa-to-do', 'mcp'],
      appOpenCommand: ['qa-to-do', 'open']
    });

    expect(plan.status).toBe('ready');
    expect(plan.operations.map((operation) => ({ action: operation.action, path: operation.path }))).toEqual([
      { action: 'update', path: configPath },
      { action: 'create', path: join(root, 'commands', 'to-qa.md') },
      { action: 'create', path: join(root, 'skills', 'to-qa', 'SKILL.md') }
    ]);
    expect(plan.operations[0].after).toBe(`${JSON.stringify({
      theme: 'system',
      mcp: {
        existing: { type: 'local', command: ['existing'] },
        'qa-to-do': { type: 'local', command: ['qa-to-do', 'mcp'], enabled: true }
      }
    }, null, 2)}\n`);
    expect(plan.operations[1].after).toContain('When finished, report the created QA session');
    expect(plan.operations[2].after).toContain('older non-parent Beads issues');
    expect(plan.operations[2].after).toContain('parentIssueId` is legacy-named');
    expect(plan.operations[2].after).toContain('Do not mutate pass/fail/skip/edit/archive/delete state through MCP.');

    const result = await applyProviderSetupPlan(plan);
    const appliedConfig = JSON.parse(await readFile(configPath, 'utf8'));

    expect(result.appliedPaths).toEqual(plan.operations.map((operation) => operation.path));
    expect(appliedConfig.mcp['qa-to-do']).toEqual({ type: 'local', command: ['qa-to-do', 'mcp'], enabled: true });
    await expect(readFile(join(root, 'commands', 'to-qa.md'), 'utf8')).resolves.toBe(plan.operations[1].after);
    await expect(readFile(join(root, 'skills', 'to-qa', 'SKILL.md'), 'utf8')).resolves.toBe(plan.operations[2].after);
  });

  it('refuses to apply a stale preview instead of silently overwriting OpenCode config', async () => {
    const root = await createTemporaryDirectory();
    const configPath = join(root, 'opencode.json');
    await writeJsonFile(configPath, { mcp: {} });
    const plan = await createProviderSetupPlan({
      provider: 'opencode',
      configDir: root,
      mcpCommand: ['qa-to-do', 'mcp']
    });
    await writeJsonFile(configPath, { mcp: { changed: { type: 'local', command: ['changed'] } } });

    await expect(applyProviderSetupPlan(plan)).rejects.toThrow('changed since preview');
    await expect(readFile(configPath, 'utf8')).resolves.toContain('changed');
  });

  it('falls back to manual instructions for unsupported providers without writing setup files', async () => {
    const root = await createTemporaryDirectory();
    const plan = await createProviderSetupPlan({
      provider: 'cursor',
      configDir: root,
      mcpCommand: ['qa-to-do', 'mcp']
    });
    const result = await applyProviderSetupPlan(plan);

    expect(plan.status).toBe('manual');
    expect(plan.operations).toEqual([]);
    expect(plan.manualInstructions.join('\n')).toContain('cursor setup is not safely editable');
    expect(result.appliedPaths).toEqual([]);
    await expect(stat(join(root, 'opencode.json'))).rejects.toThrow();
  });

  it('reports provider capabilities and renders dry-run output with safe fallback instructions', async () => {
    const openCodeRoot = await createTemporaryDirectory();
    const unsupportedRoot = await createTemporaryDirectory();

    const openCodePlan = await createProviderSetupPlan({
      provider: 'opencode',
      configDir: openCodeRoot,
      mcpCommand: ['qa-to-do', 'mcp']
    });
    const unsupportedPlan = await createProviderSetupPlan({
      provider: 'zed',
      configDir: unsupportedRoot,
      mcpCommand: ['qa-to-do', 'mcp']
    });

    expect(openCodePlan.capabilities).toEqual([
      { name: 'global /to-qa command', status: 'automated', detail: 'Previewed as an OpenCode command file.' },
      { name: 'to-qa skill', status: 'automated', detail: 'Previewed as an OpenCode global skill.' },
      { name: 'qa-to-do MCP registration', status: 'automated', detail: 'Safely merged into object-shaped OpenCode config.' }
    ]);
    expect(unsupportedPlan.capabilities).toContainEqual({
      name: 'qa-to-do MCP registration',
      status: 'manual',
      detail: 'Provider config shape is not safely editable by this installer.'
    });

    const openCodeDryRun = renderProviderSetupDryRun(openCodePlan);
    const unsupportedDryRun = renderProviderSetupDryRun(unsupportedPlan);

    expect(openCodeDryRun).toContain('Dry run for opencode provider setup');
    expect(openCodeDryRun).toContain('create ' + join(openCodeRoot, 'commands', 'to-qa.md'));
    expect(openCodeDryRun).toContain('qa-to-do MCP registration: automated');
    expect(unsupportedDryRun).toContain('zed setup is not safely editable');
    expect(unsupportedDryRun).toContain('No files will be changed automatically. Follow these manual steps instead.');
  });

  it('falls back to manual instructions for unknown or conflicting OpenCode config shapes', async () => {
    const unknownRoot = await createTemporaryDirectory();
    const conflictingRoot = await createTemporaryDirectory();
    await writeJsonFile(join(unknownRoot, 'opencode.json'), { mcp: ['not-safe'] });
    await writeJsonFile(join(conflictingRoot, 'opencode.json'), {
      mcp: { 'qa-to-do': { type: 'remote', url: 'https://example.invalid/mcp', enabled: true } }
    });

    const unknownPlan = await createProviderSetupPlan({
      provider: 'opencode',
      configDir: unknownRoot,
      mcpCommand: ['qa-to-do', 'mcp']
    });
    const conflictingPlan = await createProviderSetupPlan({
      provider: 'opencode',
      configDir: conflictingRoot,
      mcpCommand: ['qa-to-do', 'mcp']
    });

    expect(unknownPlan.status).toBe('manual');
    expect(unknownPlan.operations).toEqual([]);
    expect(unknownPlan.manualInstructions.join('\n')).toContain('unsupported non-object mcp shape');
    expect(conflictingPlan.status).toBe('manual');
    expect(conflictingPlan.operations).toEqual([]);
    expect(conflictingPlan.manualInstructions.join('\n')).toContain('different settings');
  });

  it('does not preview app-managed secrets in OpenCode setup files', async () => {
    const root = await createTemporaryDirectory();
    const plan = await createProviderSetupPlan({
      provider: 'opencode',
      configDir: root,
      mcpCommand: ['qa-to-do', 'mcp']
    });
    const preview = plan.operations.map((operation) => operation.after).join('\n');
    const configPreview = plan.operations.find((operation) => operation.path.endsWith('opencode.json'))?.after ?? '';

    expect(configPreview).not.toMatch(/api[_-]?key|authorization|bearer|token|password|headers|oauth|environment/i);
    expect(preview).toContain('No app-managed secrets are stored by this setup.');
  });
});
