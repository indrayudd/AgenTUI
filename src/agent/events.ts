import type { AgentMessage, AgentRunner } from './index.js';
import type { MessageAction } from '../state/session.js';
import type { TokenUsage } from '../state/usage.js';
import { formatToolDetail } from '../utils/text.js';
import { formatActionDigest } from '../utils/actions.js';
import { stripReasoningVisibilityLine } from '../utils/messages.js';
import { describeToolAction } from '../utils/tool-summaries.js';

export type PlanSource = 'llm' | 'todos';

export type AgentStructuredEvent =
  | { kind: 'plan'; text: string; source: PlanSource }
  | { kind: 'action'; action: MessageAction }
  | { kind: 'usage'; usage: TokenUsage }
  | { kind: 'model'; model: string }
  | { kind: 'reasoning_visibility'; visible: boolean }
  | { kind: 'answer'; text: string };

export interface AgentStreamState {
  reasoning: string;
  answer: string;
  actions: MessageAction[];
  usage?: TokenUsage | null;
  model?: string;
  showReasoning?: boolean;
}

const normalizeContent = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeContent(entry)).join('');
  }
  if (typeof value === 'object') {
    if ('text' in (value as Record<string, unknown>)) {
      const maybe = (value as { text?: string }).text;
      return typeof maybe === 'string' ? maybe : '';
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
};

const getChunkContent = (chunk: any): unknown => {
  if (!chunk) return '';
  if ('content' in chunk && chunk.content !== undefined) {
    return chunk.content;
  }
  if ('kwargs' in chunk && chunk.kwargs && 'content' in chunk.kwargs) {
    return chunk.kwargs.content;
  }
  return '';
};

const extractUsageFromChunk = (chunk: any): TokenUsage | null => {
  const usage =
    chunk?.usage_metadata ??
    chunk?.response_metadata?.usage ??
    chunk?.kwargs?.response_metadata?.usage;
  if (!usage) return null;
  const inputTokens = usage.prompt_tokens ?? usage.promptTokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.completionTokens ?? 0;
  const totalTokens =
    usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens;
  if (!inputTokens && !outputTokens && !totalTokens) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
};

const VISIBILITY_REGEX = /ReasoningVisible:\s*(yes|no)/i;
const ACTIONS_REGEX = /Actions:\s*/i;

export const streamAgentEvents = async (
  runner: AgentRunner,
  messages: AgentMessage[],
  onEvent: (event: AgentStructuredEvent) => void
): Promise<AgentStreamState> => {
  const state: AgentStreamState = {
    reasoning: '',
    answer: '',
    actions: [],
    showReasoning: undefined
  };
  const actionsMap = new Map<string, MessageAction>();
  const planToolRunIds = new Set<string>();
  const stream = runner.stream(messages);
  let visibilityBuffer = '';

  const truncateAfterActions = (value: string) => {
    const idx = value.search(ACTIONS_REGEX);
    if (idx === -1) return value;
    return value.slice(0, idx).trim();
  };

  const consumeVisibilitySignal = (chunkText: string): string => {
    if (state.showReasoning !== undefined) {
      return chunkText;
    }
    visibilityBuffer += chunkText;
    const match = VISIBILITY_REGEX.exec(visibilityBuffer);
    if (!match) {
      return '';
    }
    state.showReasoning = match[1].toLowerCase() === 'yes';
    onEvent({ kind: 'reasoning_visibility', visible: state.showReasoning });
    const before = visibilityBuffer.slice(0, match.index);
    const after = visibilityBuffer
      .slice(match.index + match[0].length)
      .replace(/^\s*/, '');
    visibilityBuffer = '';
    return before + after;
  };

  for await (const raw of stream) {
    const event = raw ?? {};
    if (event.event === 'on_chat_model_stream') {
      let chunkText = normalizeContent(getChunkContent(event?.data?.chunk));
      if (!chunkText) continue;
      if (state.showReasoning === undefined) {
        chunkText = consumeVisibilitySignal(chunkText);
      }
      if (!chunkText) continue;
      state.reasoning = truncateAfterActions(
        `${state.reasoning}${chunkText}`.trim()
      );
      if (state.showReasoning !== false) {
        onEvent({ kind: 'plan', text: state.reasoning, source: 'llm' });
      }
    } else if (event.event === 'on_chat_model_end') {
      const chunk = event?.data?.output;
      let chunkText = normalizeContent(getChunkContent(chunk));
      if (chunkText) {
        if (state.showReasoning === undefined) {
          visibilityBuffer += chunkText;
          const match = VISIBILITY_REGEX.exec(visibilityBuffer);
          if (match) {
            state.showReasoning = match[1].toLowerCase() === 'yes';
            onEvent({ kind: 'reasoning_visibility', visible: state.showReasoning });
            const before = visibilityBuffer.slice(0, match.index);
            const after = visibilityBuffer
              .slice(match.index + match[0].length)
              .replace(/^\s*/, '');
            chunkText = `${before}${after}`;
            visibilityBuffer = '';
          } else {
            chunkText = visibilityBuffer;
          }
        }
        state.reasoning = truncateAfterActions(
          `${state.reasoning}${chunkText}`.trim()
        );
        state.answer = chunkText;
      }
      const usage = extractUsageFromChunk(chunk);
      if (usage) {
        state.usage = usage;
        onEvent({ kind: 'usage', usage });
      }
      const modelName =
        typeof event?.metadata?.ls_model_name === 'string'
          ? (event.metadata.ls_model_name as string)
          : undefined;
      if (modelName) {
        state.model = modelName;
        onEvent({ kind: 'model', model: modelName });
      }
    } else if (event.event === 'on_tool_start') {
      const id = event?.run_id ?? `tool-${Date.now()}`;
      const name = typeof event?.name === 'string' ? event.name : 'tool';
      if (name === 'write_todos') {
        planToolRunIds.add(id);
        continue;
      }
      const detail = describeToolAction(name, event?.data?.input, undefined, 'running');
      const action: MessageAction = {
        id,
        name,
        status: 'running',
        detail,
        meta: { input: event?.data?.input }
      };
      actionsMap.set(id, action);
      state.actions = Array.from(actionsMap.values());
      onEvent({ kind: 'action', action });
    } else if (event.event === 'on_tool_end') {
      const runId = event?.run_id ?? '';
      if (planToolRunIds.has(runId)) {
        planToolRunIds.delete(runId);
        const planText = describeToolAction(
          'write_todos',
          event?.data?.input,
          formatToolDetail(event?.data?.output),
          'success'
        );
        if (planText) {
          state.reasoning = planText;
          onEvent({ kind: 'plan', text: state.reasoning.trim(), source: 'todos' });
        }
        continue;
      }
      const existing = actionsMap.get(runId);
      const inputMeta = existing?.meta?.input ?? event?.data?.input;
      const detail = describeToolAction(
        existing?.name ?? event?.name,
        inputMeta,
        formatToolDetail(event?.data?.output),
        'success'
      );
      const action: MessageAction = {
        id: runId || existing?.id || `tool-${Date.now()}`,
        name: existing?.name ?? (typeof event?.name === 'string' ? event.name : 'tool'),
        status: 'success',
        detail: detail || existing?.detail,
        meta: { input: inputMeta }
      };
      actionsMap.set(action.id, action);
      state.actions = Array.from(actionsMap.values());
      onEvent({ kind: 'action', action });
    } else if (event.event === 'on_tool_error') {
      const runId = event?.run_id ?? '';
      const existing = actionsMap.get(runId);
      const inputMeta = existing?.meta?.input ?? event?.data?.input;
      const detail = describeToolAction(
        existing?.name ?? event?.name,
        inputMeta,
        formatToolDetail(event?.data ?? event?.error),
        'error'
      );
      const action: MessageAction = {
        id: runId || existing?.id || `tool-${Date.now()}`,
        name: existing?.name ?? (typeof event?.name === 'string' ? event.name : 'tool'),
        status: 'error',
        detail: detail || existing?.detail,
        meta: { input: inputMeta }
      };
      actionsMap.set(action.id, action);
      state.actions = Array.from(actionsMap.values());
      onEvent({ kind: 'action', action });
    }
  }

  if (!state.answer?.trim()) {
    const digest = formatActionDigest(state.actions);
    if (digest) {
      state.answer = digest;
    } else if (state.reasoning.trim()) {
      state.answer = state.reasoning.trim();
    } else {
      state.answer = 'All set. Let me know what you need next.';
    }
  }

  const { text: cleanedAnswer, visible } = stripReasoningVisibilityLine(state.answer);
  if (state.showReasoning === undefined && visible !== undefined) {
    state.showReasoning = visible;
    onEvent({ kind: 'reasoning_visibility', visible });
  }
  if (state.showReasoning === undefined) {
    state.showReasoning = true;
  }
  state.reasoning = truncateAfterActions(state.reasoning.trim());
  state.answer = cleanedAnswer.trim();
  onEvent({ kind: 'answer', text: state.answer });
  return state;
};
