import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function listScratchMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listScratchMarkdownFiles(path);
      if (entry.isFile() && entry.name.endsWith('.md')) return [path];
      return [];
    })
  );
  return files.flat();
}

export function sanitizeScratchPathSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized : 'issue';
}
