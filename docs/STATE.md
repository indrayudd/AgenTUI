# Project State & Handoff Notes

_Last updated during Sprint 7 (Composer responsiveness & formatting)._ 

## Current Behavior

- **Real filesystem access**: The DeepAgents backend now runs with `virtualMode: false`, so `/Users/.../Projects/AgenTUI` matches what the CLI/UI display. Mentions (e.g., `@tmp/foo`) resolve to absolute paths before being sent to the LLM.
- **Reasoning/Actions UI**: Reasoning text is light-gray italics and omitted for trivial replies. Actions are rendered as natural-language summaries (e.g., `Listed /Users/.../tmp/ (0 entries)`).
- **Routing**: Conversation vs. tool intents are determined by `routePrompt`. Affirmative follow-ups (e.g., “yes, list them”) automatically escalate to tools.
- **Notebook tooling**: The agent exposes `ipynb_create`, `ipynb_patch`, `ipynb_run`, `ipynb_analyze`, and `ipynb_artifacts` for create → patch → run → summarize → artifact lookup flows. See `docs/notebook-pipeline.md`.
- **Composer UX**: `renderComposerView(value, cursor, width)` now drives the Ink composer, yielding a deterministic 6-line viewport with scroll-safe cursor tracking, left/right padding that respects `string-width`, ANSI-free ASCII snapshots so Vitest can lock in wall-of-text/paste/arrow-navigation regressions, and clipboard sanitization (`\r`, `\t`, stray control chars) so pasting odd text never corrupts the borders.
- **Regression harnesses**:
  - `npm run agent:smoke` – greeting + listing + README summary + notebook creation + notebook summarize + patch→run→artifact listing prompts.
  - `npm run agent:testfs` – resets `tmp/fs-spec` then runs list/copy/read/glob/delete prompts to ensure the agent sees the real filesystem consistently.
  - `npm run test` – Vitest suite (config, router, mentions, tool summarizer, composer renderer snapshots, etc.).

## Outstanding Work

1. **Enhanced notebook analysis** – CSV plotting helpers and richer summarize output (Phase 4 follow-ups) remain open once composer work stabilizes.
2. **Artifact Q&A UX** – `ipynb_artifacts` lists files; future work can auto-link images into final answers or surface quick “analyze_image” suggestions.
3. **Model smoke re-run** – Once valid OpenAI credentials are available, re-run `npm run agent:smoke` end-to-end to capture a transcript that includes the new composer behavior.

## Getting Started

1. Install deps: `npm install` and configure `.env` with `OPENAI_API_KEY`.
2. Run the TUI: `npm run dev`.
3. When iterating on filesystem behavior:
   - Use CLI prompts: `npm run agent -- "list the files in @tmp/"`.
   - After changes, run `npm run agent:testfs` and `npm run agent:smoke`.
4. For task context or future requirements, start with `cleanup5_plan.md` / `cleanup5_specs.md` in the repo root.

Point new agents to this document (`docs/STATE.md`) for an up-to-date understanding of the project state and the verification commands available.
