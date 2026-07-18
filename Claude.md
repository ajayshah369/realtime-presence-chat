# CLAUDE.md

This project's agent context lives in **AGENTS.md** (setup commands, architecture notes, code style, testing flow, security considerations). Read that file first. Note: this is a monorepo — backend code (AWS CDK + Lambda, Cognito auth) lives in `backend/`, the Next.js frontend (NextAuth + WhatsApp-style chat UI) lives in `frontend/`.

Everything below is Claude Code-specific; everything else is in AGENTS.md so it stays usable by other agent tools too.

## Claude Code-specific notes

- No custom slash commands or hooks are configured for this repo.
- No MCP servers are required to work on this project — it's plain Node.js/pnpm + AWS CLI + CDK CLI, all invoked via the shell.
- When asked to "deploy" or "test," prefer describing the exact `cdk` / `aws` / `wscat` / `pnpm` commands to run (per AGENTS.md's Testing instructions) rather than assuming a hidden script exists — there is no `npm test` in the backend, and the frontend's only scripts are `pnpm dev` / `pnpm build` / `pnpm lint`.
- If asked to add a new Lambda route, remember the checklist from AGENTS.md — and it now has **four** parts, not three: (1) new `.ts` file in `backend/lambda/`, (2) new `NodejsFunction` construct + env vars + grants (including `stage.grantManagementApiAccess(fn)` if the route talks back to a client) in `backend/cdk/lib/realtime-dashboard-stack.ts`, (3) new `webSocketApi.addRoute(...)` call, and (4) **explicitly push any response back to the client via `PostToConnectionCommand`** — a route's `{statusCode, body}` return value is never delivered to the WebSocket client, only visible in CloudWatch. Missing any one of these four is the most common source of "it deploys but doesn't work" bugs in this codebase; (4) specifically is the one that's bitten this project before (`createConversation.ts` originally returned data instead of pushing it).
- Backend is TypeScript with `strict: true` — see AGENTS.md's "Common strict-mode pitfalls" section before writing or editing any Lambda handler, it lists the exact errors this codebase has already hit.
- Frontend is TypeScript + Next.js App Router — respect the `react-hooks/set-state-in-effect` ESLint rule (see AGENTS.md's Code style section) when touching `useChatSocket.ts` or any component with effects.
- This repo's WebSocket connection is authenticated end-to-end (Cognito ID token verified by a Lambda authorizer on `$connect`) — there is no more unauthenticated `username` query param. Any new backend logic can assume `event.requestContext.authorizer.{userId,email}` is trustworthy.
- Do not run `git` commands (status/add/commit/etc.) against this repo through the sandboxed shell — a prior session hit a recurring `.git/index.lock` issue caused by the sandbox's Virtualization-framework shared mount holding a file handle open. Ask the user to run git commands themselves in their own terminal instead.
