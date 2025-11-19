import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { tool } from 'langchain';
import { z } from 'zod';
import { requireWorkspacePath } from '../path/resolver.js';

const runImageAnalyzer = async (workspaceRoot: string, absolutePath: string) => {
  const scriptPath = path.join(workspaceRoot, 'scripts/image_analyzer.py');
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.AGEN_TUI_PYTHON ?? 'python3', [scriptPath, '--input', absolutePath], {
      cwd: workspaceRoot
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `Image analyzer exited with code ${code}`));
    });
  });
};

const analyzeImageTool = (workspaceRoot: string) =>
  tool(
    async ({ imagePath }: { imagePath: string }) => {
      let resolved: string;
      try {
        resolved = requireWorkspacePath(workspaceRoot, imagePath).absolute;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      await fs.access(resolved);
      const raw = await runImageAnalyzer(workspaceRoot, resolved);
      return `Image analysis for ${resolved}: ${raw}`;
    },
    {
      name: 'analyze_image',
      description: 'Describe an image or plot referenced in the workspace.',
      schema: z.object({
        imagePath: z.string().describe('Path to the image file (relative or mention).')
      })
    }
  );

export const buildImageTools = (workspaceRoot: string) => [analyzeImageTool(workspaceRoot)];
