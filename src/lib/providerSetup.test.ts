// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { applyProviderSetupPlan, createProviderSetupPlan } from './providerSetup';

describe('provider setup', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('previews and applies exact safe OpenCode skill, command, and MCP config changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-to-do-setup-'));
    temporaryDirectories.push(root);
    await mkdir(root, { recursive: true });
    const configPath = join(root, 'opencode.json');
    await writeFile(configPath, `${JSON.stringify({ theme: 'system', mcp: { existing: { type: 'local', command: ['existing'] } } }, null, 2)}\n`);

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
    expect(plan.operations[1].after).toContain('Use the `to-qa` skill for $ARGUMENTS.');
    expect(plan.operations[2].after).toContain('No app-managed secrets are stored by this setup.');

    const result = await applyProviderSetupPlan(plan);
    const appliedConfig = JSON.parse(await readFile(configPath, 'utf8'));

    expect(result.appliedPaths).toEqual(plan.operations.map((operation) => operation.path));
    expect(appliedConfig.mcp['qa-to-do']).toEqual({ type: 'local', command: ['qa-to-do', 'mcp'], enabled: true });
    await expect(readFile(join(root, 'commands', 'to-qa.md'), 'utf8')).resolves.toBe(plan.operations[1].after);
    await expect(readFile(join(root, 'skills', 'to-qa', 'SKILL.md'), 'utf8')).resolves.toBe(plan.operations[2].after);
  });

  it('refuses to apply a stale preview instead of silently overwriting OpenCode config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-to-do-setup-'));
    temporaryDirectories.push(root);
    const configPath = join(root, 'opencode.json');
    await writeFile(configPath, `${JSON.stringify({ mcp: {} }, null, 2)}\n`);
    const plan = await createProviderSetupPlan({
      provider: 'opencode',
      configDir: root,
      mcpCommand: ['qa-to-do', 'mcp']
    });
    await writeFile(configPath, `${JSON.stringify({ mcp: { changed: { type: 'local', command: ['changed'] } } }, null, 2)}\n`);

    await expect(applyProviderSetupPlan(plan)).rejects.toThrow('changed since preview');
    await expect(readFile(configPath, 'utf8')).resolves.toContain('changed');
  });

  it('falls back to manual instructions for unsupported providers without writing setup files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-to-do-setup-'));
    temporaryDirectories.push(root);
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

  it('falls back to manual instructions for unknown or conflicting OpenCode config shapes', async () => {
    const unknownRoot = await mkdtemp(join(tmpdir(), 'qa-to-do-setup-'));
    const conflictingRoot = await mkdtemp(join(tmpdir(), 'qa-to-do-setup-'));
    temporaryDirectories.push(unknownRoot, conflictingRoot);
    await writeFile(join(unknownRoot, 'opencode.json'), `${JSON.stringify({ mcp: ['not-safe'] }, null, 2)}\n`);
    await writeFile(join(conflictingRoot, 'opencode.json'), `${JSON.stringify({
      mcp: { 'qa-to-do': { type: 'remote', url: 'https://example.invalid/mcp', enabled: true } }
    }, null, 2)}\n`);

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
    const root = await mkdtemp(join(tmpdir(), 'qa-to-do-setup-'));
    temporaryDirectories.push(root);
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
