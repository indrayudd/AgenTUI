#!/usr/bin/env tsx
import process from 'node:process';
import { loadConfig } from './config/index.js';
import { createAgentRunner, type AgentMessage } from './agent/index.js';
import { prepareAgentInput } from './agent/prompt.js';
import { streamAgentEvents } from './agent/events.js';
import type { MessageAction } from './state/session.js';
import { formatActionSummary } from './utils/actions.js';
import { splitReasoningAndAnswer } from './utils/messages.js';
import { maybeExecuteFsCommand } from './fs/shortcuts.js';

const main = async () => {
  const prompt = process.argv.slice(2).join(' ').trim();
  if (!prompt) {
    console.error('Usage: npm run agent -- "prompt"');
    process.exit(1);
  }

  const config = loadConfig();
  const runner = createAgentRunner(config);
  const root = process.cwd();
  const shortcut = await maybeExecuteFsCommand(prompt, root);
  if (shortcut) {
    console.log(shortcut);
    return;
  }

  const prepared = prepareAgentInput(prompt, root);
  const messages: AgentMessage[] = [{ role: 'user', content: prepared.content }];
  const finalState = await streamAgentEvents(runner, messages, () => {});
  const sections = splitReasoningAndAnswer(finalState.answer);
  const reasoning = sections.reasoning || finalState.reasoning.trim();
  const finalAnswer = sections.answer || finalState.answer.trim();
  const actions = finalState.actions;
  const showReasoning = (finalState.showReasoning ?? sections.visible ?? true) && reasoning.trim().length > 0;

  if (showReasoning) {
    console.log('Reasoning:');
    console.log(reasoning.trim());
  }
  if (actions.length) {
    console.log(showReasoning ? '\nActions:' : 'Actions:');
    actions.forEach((action: MessageAction) => {
      console.log(formatActionSummary(action));
    });
  }
  console.log('\nAnswer:');
  console.log(finalAnswer.trim());
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
