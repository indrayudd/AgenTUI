import path from 'path';
import os from 'os';
import crypto from 'node:crypto';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { tool } from 'langchain';
import { z } from 'zod';
import { requireWorkspacePath } from '../path/resolver.js';

const PYTHON_BIN = process.env.AGEN_TUI_PYTHON ?? 'python3';

type NotebookArtifact = { cell: number; path: string; mimetype?: string };
type RunnerMetadata = {
  run_id?: string;
  attempts?: number;
  max_retries?: number;
  allow_errors?: boolean;
  started_at?: string;
  finished_at?: string;
  python_version?: string;
  matplotlib_backend?: string | null;
  artifact_dir?: string;
  last_exception?: string | null;
};

type RunnerResult = {
  status: 'ok' | 'error';
  action?: string;
  path?: string;
  output?: string;
  artifacts?: NotebookArtifact[];
  errors?: Array<{ cell: number; ename?: string; evalue?: string; traceback?: string[] }>;
  summary?: Array<{ cell: number; type: string; preview: string }>;
  metadata?: RunnerMetadata;
  message?: string;
};

const runRunner = async (workspaceRoot: string, args: string[]): Promise<RunnerResult> => {
  const scriptPath = path.join(workspaceRoot, 'scripts/ipynb/runner.py');
  return new Promise<RunnerResult>((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [scriptPath, ...args], { cwd: workspaceRoot });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Runner exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim() || '{}'));
      } catch (error) {
        reject(new Error(`Failed to parse runner output: ${stdout}`));
      }
    });
  });
};

const normalizeSections = (sections: unknown) => {
  if (typeof sections === 'string') {
    try {
      return JSON.parse(sections);
    } catch {
      const lines = sections.split('\n').filter(Boolean);
      return lines.map((line: string, idx: number) => ({ title: line.trim() || `Section ${idx + 1}` }));
    }
  }
  return sections;
};

export const createNotebook = async (workspaceRoot: string, sections: unknown, outputPath: string) => {
  const normalizedSections = normalizeSections(sections);
  const planSchema = z.array(z.object({ title: z.string(), code: z.string().optional() }));
  const parsedPlan = planSchema.parse(normalizedSections);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentui-plan-'));
  const planPath = path.join(tmpDir, 'plan.json');
  await fs.writeFile(planPath, JSON.stringify(parsedPlan, null, 2));
  const resolvedOutput = requireWorkspacePath(workspaceRoot, outputPath).absolute;
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  const result = await runRunner(workspaceRoot, ['create', '--plan', planPath, '--output', resolvedOutput]);
  if (result.status !== 'ok') {
    throw new Error(result.message ?? 'Notebook creation failed');
  }
  return { message: `Notebook created at ${resolvedOutput}.`, raw: JSON.stringify(result) };
};

const createNotebookTool = (workspaceRoot: string) =>
  tool(
    async ({ sections, outputPath }: { sections: unknown; outputPath: string }) => {
      const result = await createNotebook(workspaceRoot, sections, outputPath);
      return `${result.message} Details: ${result.raw}`;
    },
    {
      name: 'ipynb_create',
      description: 'Create a Jupyter notebook from a structured plan (title + optional code per section).',
      schema: z.object({
        sections: z.union([z.string(), z.array(z.object({ title: z.string(), code: z.string().optional() }))]).describe(
          'Plan describing sections/cells. Either JSON array or newline-separated outline.'
        ),
        outputPath: z.string().describe('Target notebook path (relative to workspace).')
      })
    }
  );

const MAX_NOTEBOOK_RETRIES = Number(process.env.AGEN_TUI_NOTEBOOK_MAX_RETRIES ?? '2');

export type NotebookRunResult = {
  message: string;
  raw: string;
  metadata?: RunnerMetadata;
  artifacts: NotebookArtifact[];
  errors: RunnerResult['errors'] | undefined;
};

export const runNotebook = async (
  workspaceRoot: string,
  inputPath: string,
  outputPath: string,
  options: { allowErrors?: boolean; runId?: string } = {}
): Promise<NotebookRunResult> => {
  const resolvedInput = requireWorkspacePath(workspaceRoot, inputPath).absolute;
  const resolvedOutput = requireWorkspacePath(workspaceRoot, outputPath).absolute;
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  const runId = options.runId ?? crypto.randomUUID();
  const runnerArgs = [
    'run',
    '--input',
    resolvedInput,
    '--output',
    resolvedOutput,
    '--workspace-root',
    workspaceRoot,
    '--max-retries',
    String(Math.max(1, MAX_NOTEBOOK_RETRIES)),
    '--run-id',
    runId
  ];
  if (options.allowErrors) {
    runnerArgs.push('--allow-errors');
  }
  const result = await runRunner(workspaceRoot, runnerArgs);
  if (result.status !== 'ok') {
    throw new Error(result.message ?? 'Notebook execution failed');
  }
  const errorCount = result.errors?.length ?? 0;
  const artifactCount = result.artifacts?.length ?? 0;
  const runLabel = result.metadata?.run_id ? `Run ${result.metadata.run_id}` : 'Notebook run';
  const summaryParts = [
    `${errorCount} error${errorCount === 1 ? '' : 's'}`,
    `${artifactCount} artifact${artifactCount === 1 ? '' : 's'}`
  ];
  const message = `${runLabel}: ${summaryParts.join(', ')}. Results saved to ${resolvedOutput}.`;
  return {
    message,
    raw: JSON.stringify(result),
    metadata: result.metadata,
    artifacts: result.artifacts ?? [],
    errors: result.errors
  };
};

const runNotebookTool = (workspaceRoot: string) =>
  tool(
    async ({ inputPath, outputPath, allowErrors }: { inputPath: string; outputPath: string; allowErrors?: boolean }) => {
      const result = await runNotebook(workspaceRoot, inputPath, outputPath, { allowErrors });
      return `${result.message} Raw response: ${result.raw}`;
    },
    {
      name: 'ipynb_run',
      description: 'Execute a notebook and capture outputs/artifacts.',
      schema: z.object({
        inputPath: z.string().describe('Path to the source notebook.'),
        outputPath: z.string().describe('Path to write the executed notebook (nbclient output).'),
        allowErrors: z
          .boolean()
          .optional()
          .describe('Set true to keep executing even if cells raise errors (gathers all tracebacks).')
      })
    }
  );

export const summarizeNotebook = async (workspaceRoot: string, inputPath: string) => {
  const resolvedInput = requireWorkspacePath(workspaceRoot, inputPath).absolute;
  const result = await runRunner(workspaceRoot, ['summarize', '--input', resolvedInput]);
  if (result.status !== 'ok') {
    throw new Error(result.message ?? 'Notebook summarize failed');
  }
  return { message: `Notebook summary for ${resolvedInput}`, raw: JSON.stringify(result.summary ?? []) };
};

const analyzeNotebookTool = (workspaceRoot: string) =>
  tool(
    async ({ inputPath }: { inputPath: string }) => {
      const result = await summarizeNotebook(workspaceRoot, inputPath);
      return `${result.message}: ${result.raw}`;
    },
    {
      name: 'ipynb_analyze',
      description: 'Summarize notebook cells (type + preview).',
      schema: z.object({
        inputPath: z.string().describe('Notebook to summarize.')
      })
    }
  );

export const buildNotebookTools = (workspaceRoot: string) => [
  createNotebookTool(workspaceRoot),
  runNotebookTool(workspaceRoot),
  analyzeNotebookTool(workspaceRoot)
];
