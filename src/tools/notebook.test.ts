import { describe, expect, it, vi } from 'vitest';
import { buildNotebookTools, createNotebook } from './notebook.js';
import path from 'path';
import { promises as fs } from 'fs';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: (_evt: string, handler: (chunk: string) => void) => handler('{"status":"ok"}') },
    stderr: { on: () => {} },
    on: (event: string, handler: (code: number) => void) => {
      if (event === 'close') handler(0);
    }
  }))
}));

const root = process.cwd();

describe('notebook tools', () => {
  it('builds notebook tools array', () => {
    const tools = buildNotebookTools(root);
    expect(tools.length).toBe(3);
  });

  it('creates a notebook from sections JSON', async () => {
    const output = path.join('tmp', 'test-notebook.ipynb');
    const sections = [{ title: 'Test', code: "print('ok')" }];
    const result = await createNotebook(root, sections, output);
    expect(result.message).toContain('Notebook created');
    await fs.rm(path.resolve(root, output), { force: true });
  });
});
