# Project State & Handoff Notes

_Last updated after Cleanup 5 (filesystem reliability)._

## Current Behavior

- **Real filesystem access**: The DeepAgents backend now runs with `virtualMode: false`, so `/Users/.../Projects/AgenTUI` matches what the CLI/UI display. Mentions (e.g., `@tmp/foo`) resolve to absolute paths before being sent to the LLM.
- **Reasoning/Actions UI**: Reasoning text is light-gray italics and omitted for trivial replies. Actions are rendered as natural-language summaries (e.g., `Listed /Users/.../tmp/ (0 entries)`).
- **Routing**: Conversation vs. tool intents are determined by `routePrompt`. Affirmative follow-ups (e.g., “yes, list them”) automatically escalate to tools.
- **Regression harnesses**:
  - `npm run agent:smoke` – greeting + listing + README summary + notebook creation.
  - `npm run agent:testfs` – resets `tmp/fs-spec` then runs list/copy/read/glob/delete prompts to ensure the agent sees the real filesystem consistently.
  - `npm run test` – Vitest suite (config, router, mentions, tool summarizer, etc.).

## Outstanding Work (Cleanup 5 onwards)

1. **Action Parser Enhancements** – Already emits natural sentences, but watch for new tool types when adding capabilities (update `src/utils/tool-summaries.ts` and tests).
2. **Path Highlighting** – Current regex covers most extensions; expand `PATH_FILE_EXTENSIONS` if new file types appear frequently.
3. **Filesystem Features** – Expand `scripts/test-filesystem.ts` with additional scenarios (append/move/delete directories, notebook helpers) as we build more shortcuts.
4. **Documentation** – Keep this file and the cleanup plans (`cleanup5_plan.md` / `cleanup5_specs.md`) up to date when new behaviors land.

## Getting Started

1. Install deps: `npm install` and configure `.env` with `OPENAI_API_KEY`.
2. Run the TUI: `npm run dev`.
3. When iterating on filesystem behavior:
   - Use CLI prompts: `npm run agent -- "list the files in @tmp/"`.
   - After changes, run `npm run agent:testfs` and `npm run agent:smoke`.
4. For task context or future requirements, start with `cleanup5_plan.md` / `cleanup5_specs.md` in the repo root.

Point new agents to this document (`docs/STATE.md`) for an up-to-date understanding of the project state and the verification commands available.
