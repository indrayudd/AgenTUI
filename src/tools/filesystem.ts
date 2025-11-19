import { promises as fs, Dirent } from 'fs';
import path from 'path';
import { tool } from 'langchain';
import { z } from 'zod';
import { requireWorkspacePath } from '../path/resolver.js';

const formatEntry = async (absolute: string) => {
  const stats = await fs.stat(absolute);
  const type = stats.isDirectory() ? 'dir ' : stats.isFile() ? 'file' : 'other';
  const size = stats.isDirectory() ? '' : `${stats.size}B`;
  return `${type.padEnd(4)} ${absolute}${size ? ` (${size})` : ''}`;
};

const listDirectory = async (absolute: string) => {
  const entries = await fs.readdir(absolute);
  if (!entries.length) {
    return 'Directory is empty.';
  }
  const lines = await Promise.all(entries.map((name) => formatEntry(path.join(absolute, name))));
  return lines.join('\n');
};

const summarizeAction = (label: string, absolute: string) => `${label}: ${absolute}`;

const wrapError = (err: unknown) => (err instanceof Error ? err.message : String(err));

const resolveForTool = (workspaceRoot: string, raw: string) => {
  const result = requireWorkspacePath(workspaceRoot, raw);
  return result;
};

const createLsTool = (workspaceRoot: string) =>
  tool(
    async ({ targetPath }: { targetPath?: string }) => {
      const resolved = resolveForTool(workspaceRoot, targetPath ?? '.');
      try {
        const stats = await fs.stat(resolved.absolute);
        if (!stats.isDirectory()) {
          return `${resolved.absolute} is not a directory.`;
        }
        const body = await listDirectory(resolved.absolute);
        return `Listing for ${resolved.virtual}:\n${body}`;
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'list_path',
      description: 'List files/directories at a path (ls).',
      schema: z.object({
        targetPath: z.string().optional().describe('Directory to list (default: current workspace root).')
      })
    }
  );

const createReadTool = (workspaceRoot: string) =>
  tool(
    async ({ targetPath, maxBytes }: { targetPath: string; maxBytes?: number }) => {
      try {
        const resolved = resolveForTool(workspaceRoot, targetPath);
        const limit = maxBytes ?? 4000;
        const data = await fs.readFile(resolved.absolute, 'utf8');
        return data.length > limit ? `${data.slice(0, limit)}\n… truncated (${data.length - limit} more bytes)` : data;
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'read_file',
      description: 'Read a file (cat/head).',
      schema: z.object({
        targetPath: z.string().describe('File to read.'),
        maxBytes: z.number().int().positive().optional().describe('Limit output size (default 4000 bytes).')
      })
    }
  );

const createWriteTool = (workspaceRoot: string) =>
  tool(
    async ({ targetPath, content }: { targetPath: string; content: string }) => {
      try {
        const resolved = resolveForTool(workspaceRoot, targetPath);
        await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
        await fs.writeFile(resolved.absolute, content, 'utf8');
        return summarizeAction('Wrote file', resolved.absolute);
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with given content.',
      schema: z.object({
        targetPath: z.string().describe('File to write.'),
        content: z.string().describe('Content to write entirely.')
      })
    }
  );

const createAppendTool = (workspaceRoot: string) =>
  tool(
    async ({ targetPath, content }: { targetPath: string; content: string }) => {
      try {
        const resolved = resolveForTool(workspaceRoot, targetPath);
        await fs.appendFile(resolved.absolute, content, 'utf8');
        return summarizeAction('Appended to file', resolved.absolute);
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'append_file',
      description: 'Append text to an existing file.',
      schema: z.object({
        targetPath: z.string().describe('File to append to.'),
        content: z.string().describe('Text to append.')
      })
    }
  );

const createCopyTool = (workspaceRoot: string) =>
  tool(
    async ({ sourcePath, destinationPath, overwrite = false }: { sourcePath: string; destinationPath: string; overwrite?: boolean }) => {
      try {
        const source = resolveForTool(workspaceRoot, sourcePath);
        const destination = resolveForTool(workspaceRoot, destinationPath);
        const stats = await fs.stat(source.absolute);
        await fs.mkdir(path.dirname(destination.absolute), { recursive: true });
        if (stats.isDirectory()) {
          await fs.cp(source.absolute, destination.absolute, { recursive: true, force: overwrite });
        } else {
          if (!overwrite) {
            try {
              await fs.access(destination.absolute);
              return `Destination ${destination.absolute} exists. Set overwrite=true to replace.`;
            } catch {
              // ok
            }
          }
          await fs.copyFile(source.absolute, destination.absolute);
        }
        return `Copied ${source.absolute} to ${destination.absolute}.`;
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'copy_path',
      description: 'Copy a file or directory (cp).',
      schema: z.object({
        sourcePath: z.string().describe('Source path.'),
        destinationPath: z.string().describe('Destination path.'),
        overwrite: z.boolean().optional().describe('Whether to overwrite destination if it exists.')
      })
    }
  );

const createMoveTool = (workspaceRoot: string) =>
  tool(
    async ({ sourcePath, destinationPath, overwrite = false }: { sourcePath: string; destinationPath: string; overwrite?: boolean }) => {
      try {
        const source = resolveForTool(workspaceRoot, sourcePath);
        const destination = resolveForTool(workspaceRoot, destinationPath);
        if (!overwrite) {
          try {
            await fs.access(destination.absolute);
            return `Destination ${destination.absolute} exists. Set overwrite=true to replace.`;
          } catch {
            // available
          }
        }
        await fs.mkdir(path.dirname(destination.absolute), { recursive: true });
        await fs.rename(source.absolute, destination.absolute);
        return `Moved ${source.absolute} to ${destination.absolute}.`;
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'move_path',
      description: 'Move or rename files/directories (mv).',
      schema: z.object({
        sourcePath: z.string().describe('Source path.'),
        destinationPath: z.string().describe('Destination path.'),
        overwrite: z.boolean().optional().describe('Set true to replace destination.')
      })
    }
  );

const createDeleteTool = (workspaceRoot: string) =>
  tool(
    async ({ targetPath }: { targetPath: string }) => {
      try {
        const resolved = resolveForTool(workspaceRoot, targetPath);
        await fs.rm(resolved.absolute, { recursive: true, force: true });
        return summarizeAction('Deleted', resolved.absolute);
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'delete_path',
      description: 'Delete files or directories (rm -rf).',
      schema: z.object({
        targetPath: z.string().describe('Path to delete.')
      })
    }
  );

const createMkdirTool = (workspaceRoot: string) =>
  tool(
    async ({ targetPath, recursive = true }: { targetPath: string; recursive?: boolean }) => {
      try {
        const resolved = resolveForTool(workspaceRoot, targetPath);
        await fs.mkdir(resolved.absolute, { recursive });
        return summarizeAction('Created directory', resolved.absolute);
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'make_directory',
      description: 'Create directories (mkdir).',
      schema: z.object({
        targetPath: z.string().describe('Directory to create.'),
        recursive: z.boolean().optional().describe('Whether to create parent folders (default true).')
      })
    }
  );

const createSearchTool = (workspaceRoot: string) =>
  tool(
    async ({ pattern, targetPath, maxDepth = 5 }: { pattern: string; targetPath?: string; maxDepth?: number }) => {
      try {
        const base = targetPath ? resolveForTool(workspaceRoot, targetPath).absolute : workspaceRoot;
        const regex = new RegExp(pattern, 'i');
        const results: string[] = [];
        await walkDirectory(base, async (abs, entry, depth) => {
          if (!entry.isFile()) return;
          const content = await fs.readFile(abs, 'utf8');
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (regex.test(line)) {
              results.push(`${abs}:${idx + 1} ${line.trim()}`);
            }
          });
        }, maxDepth);
        if (!results.length) {
          return `No matches for "${pattern}" under ${base}.`;
        }
        if (results.length > 50) {
          return results.slice(0, 50).join('\n') + `\n… ${results.length - 50} more matches`;
        }
        return results.join('\n');
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'search_text',
      description: 'Search files for a regex or keyword (non-recursive by default).',
      schema: z.object({
        pattern: z.string().describe('Regex or plain-text pattern to search for.'),
        targetPath: z.string().optional().describe('Directory to search (default workspace root).'),
        maxDepth: z.number().int().min(0).optional().describe('Maximum directory depth to search (default 5).')
      })
    }
  );

const createGlobTool = (workspaceRoot: string) =>
  tool(
    async ({ pattern, targetPath, maxDepth = 0 }: { pattern: string; targetPath?: string; maxDepth?: number }) => {
      try {
        const base = targetPath ? resolveForTool(workspaceRoot, targetPath).absolute : workspaceRoot;
        const regex = globToRegex(pattern);
        const matches: string[] = [];
        await walkDirectory(
          base,
          async (abs, entry) => {
            if (entry.isFile() && regex.test(entry.name)) {
              matches.push(abs);
            }
          },
          maxDepth
        );
        if (!matches.length) {
          return `No files matched pattern "${pattern}" under ${base}.`;
        }
        return matches.join('\n');
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'glob_path',
      description: 'Find files matching a glob pattern at a given depth.',
      schema: z.object({
        pattern: z.string().describe('Glob pattern (e.g., *.md).'),
        targetPath: z.string().optional().describe('Directory to search (default workspace root).'),
        maxDepth: z.number().int().min(0).optional().describe('Depth to traverse (default 1 for top-level).')
      })
    }
  );

const walkDirectory = async (
  base: string,
  visitor: (absolute: string, entry: Dirent, depth: number) => Promise<void> | void,
  maxDepth = Infinity,
  depth = 0
) => {
  if (depth > maxDepth) return;
  const entries = await fs.readdir(base, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(base, entry.name);
    await visitor(absolute, entry, depth);
    if (entry.isDirectory()) {
      await walkDirectory(absolute, visitor, maxDepth, depth + 1);
    }
  }
};

const globToRegex = (pattern: string) => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
};

const createDiffTool = (workspaceRoot: string) =>
  tool(
    async ({ leftPath, rightPath }: { leftPath: string; rightPath: string }) => {
      try {
        const left = resolveForTool(workspaceRoot, leftPath);
        const right = resolveForTool(workspaceRoot, rightPath);
        const [leftContent, rightContent] = await Promise.all([
          fs.readFile(left.absolute, 'utf8'),
          fs.readFile(right.absolute, 'utf8')
        ]);
        if (leftContent === rightContent) {
          return 'Files are identical.';
        }
        const leftLines = leftContent.split('\n');
        const rightLines = rightContent.split('\n');
        const max = Math.max(leftLines.length, rightLines.length);
        const result: string[] = [];
        for (let i = 0; i < max; i++) {
          const l = leftLines[i];
          const r = rightLines[i];
          if (l === r) continue;
          if (l !== undefined) {
            result.push(`- ${i + 1}: ${l}`);
          }
          if (r !== undefined) {
            result.push(`+ ${i + 1}: ${r}`);
          }
        }
        return [`Diff between ${left.virtual} and ${right.virtual}:`, ...result].join('\n');
      } catch (error) {
        return wrapError(error);
      }
    },
    {
      name: 'diff_paths',
      description: 'Compare two files (rough diff).',
      schema: z.object({
        leftPath: z.string().describe('First file.'),
        rightPath: z.string().describe('Second file.')
      })
    }
  );

export const buildFilesystemTools = (workspaceRoot: string) => [
  createLsTool(workspaceRoot),
  createReadTool(workspaceRoot),
  createWriteTool(workspaceRoot),
  createAppendTool(workspaceRoot),
  createCopyTool(workspaceRoot),
  createMoveTool(workspaceRoot),
  createDeleteTool(workspaceRoot),
  createMkdirTool(workspaceRoot),
  createSearchTool(workspaceRoot),
  createGlobTool(workspaceRoot),
  createDiffTool(workspaceRoot)
];
