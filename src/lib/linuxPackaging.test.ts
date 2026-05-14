// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Linux packaging', () => {
  it('exposes a Linux package command that builds Debian and AppImage artifacts', async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts['package:linux']).toBe('tauri build --bundles deb,appimage');
  });

  it('configures Tauri to bundle installable Linux artifacts with Debian metadata', async () => {
    const config = JSON.parse(await readFile(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'));

    expect(config.productName).toBe('QA-To-Do');
    expect(config.productName).not.toContain(' ');
    expect(config.bundle.active).toBe(true);
    expect(config.bundle.targets).toEqual(['deb', 'appimage']);
    expect(config.bundle.category).toBe('DeveloperTool');
    expect(config.bundle.linux.appimage.bundleMediaFramework).toBe(false);
    expect(config.bundle.linux.deb.section).toBe('devel');
    expect(config.bundle.linux.deb.priority).toBe('optional');
    expect(config.bundle.linux.deb.depends).toEqual(
      expect.arrayContaining(['libwebkit2gtk-4.1-0', 'libgtk-3-0'])
    );
  });
});
