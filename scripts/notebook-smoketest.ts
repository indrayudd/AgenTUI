#!/usr/bin/env tsx
import path from 'path';
import { promises as fs } from 'fs';
import { createNotebook, runNotebook, summarizeNotebook } from '../src/tools/notebook.js';

const root = process.cwd();

const main = async () => {
  const planPath = path.join(root, 'examples/notebooks/demo_plan.json');
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  const target = 'examples/notebooks/demo.ipynb';
  const executed = 'examples/notebooks/demo-executed.ipynb';

  const createResult = await createNotebook(root, plan, target);
  console.log(createResult.message);

  const runResult = await runNotebook(root, target, executed);
  console.log(runResult.message);
  if (runResult.metadata) {
    console.log(`Run metadata: ${JSON.stringify(runResult.metadata)}`);
  }
  if (runResult.artifacts.length) {
    console.log(`Artifacts: ${runResult.artifacts.map((artifact) => artifact.path).join(', ')}`);
  }
  if (runResult.errors && runResult.errors.length) {
    console.log(`Captured ${runResult.errors.length} error(s) during execution.`);
  }

  const summary = await summarizeNotebook(root, executed);
  console.log(summary.raw);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
