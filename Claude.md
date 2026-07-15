# CLAUDE.md

This project's agent context lives in **AGENTS.md** (setup commands, architecture notes, code style, testing flow, security considerations). Read that file first. Note: this is now a monorepo — backend code lives in `backend/`, the Next.js frontend (in progress) lives in `frontend/`.

Everything below is Claude Code-specific; everything else is in AGENTS.md so it stays usable by other agent tools too.

## Claude Code-specific notes

- No custom slash commands or hooks are configured for this repo.
- No MCP servers are required to work on this project — it's plain Node.js + AWS CLI + CDK CLI, all invoked via the shell.
- When asked to "deploy" or "test," prefer describing the exact `cdk` / `aws` / `wscat` commands to run (per AGENTS.md's Testing instructions) rather than assuming a hidden script exists — there is no `npm test` or `npm run dev` in this repo.
- If asked to add a new Lambda route, remember the three-part checklist from AGENTS.md: (1) new `.ts` file in `backend/lambda/`, (2) new `NodejsFunction` construct + grants in `backend/cdk/lib/realtime-dashboard-stack.ts`, (3) new `webSocketApi.addRoute(...)` call. Missing any one of these is the most common source of "it deploys but doesn't work" bugs in this codebase.
- Backend is TypeScript with `strict: true` — see AGENTS.md's "Common strict-mode pitfalls" section before writing or editing any Lambda handler, it lists the exact errors this codebase has already hit once.
