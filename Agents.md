# AGENTS.md

Context and conventions for any AI coding agent (Claude Code, Cursor, etc.) working in this repository.

## Project overview

This is a monorepo with two top-level directories:

- **`backend/`** — serverless real-time chat/messaging backend. AWS API Gateway WebSocket API (with a Lambda authorizer gating `$connect`) → Lambda (Node.js, TypeScript) → DynamoDB, deployed via AWS CDK (TypeScript). Two CDK stacks: `AuthStack` (Cognito User Pool + Google federated identity provider + Hosted UI domain) and `RealtimeDashboardStack` (tables, Lambdas, WebSocket API). No traditional server; connection state lives in DynamoDB because Lambda has no memory between invocations.
- **`frontend/`** — Next.js (App Router) chat UI, WhatsApp/Telegram-style layout (sidebar conversation list + chat pane). Uses NextAuth with a custom `CognitoProvider` for Google sign-in through Cognito Hosted UI, and a single `useChatSocket` hook that owns the WebSocket connection and all app-level chat state. Package manager: **pnpm** (separate from backend's npm).

Region deployed to: `ap-south-1` (Mumbai). Stack names: `AuthStack`, `RealtimeDashboardStack`.

## Setup commands

**Backend** — run from inside `backend/`, not the repo root:

```bash
cd backend
npm install                              # install all dependencies
cdk bootstrap aws://<ACCOUNT_ID>/<REGION> # one-time per account/region
cdk synth                                # validate + render CloudFormation locally, no AWS calls
cdk deploy --all                         # deploy AuthStack then RealtimeDashboardStack, prompts for IAM change approval
cdk destroy --all                        # tear down all resources
```

Type-check before deploying:

```bash
npx tsc --noEmit
```

There is no local dev server or offline emulator configured for the backend — testing happens against real deployed AWS resources (see "Testing" below). Do not assume `npm start` or similar exists there.

**Frontend** — run from inside `frontend/`:

```bash
cd frontend
pnpm install
pnpm dev          # Next.js dev server, http://localhost:3000
pnpm build         # production build (also type-checks)
pnpm lint          # ESLint
```

Requires a `.env.local` with `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_ISSUER`, `COGNITO_DOMAIN`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_WEBSOCKET_URL` (see README.md's Setup section for where each value comes from — most are CDK outputs from `AuthStack` and `RealtimeDashboardStack`).

## Code style

**Backend:**
- TypeScript throughout, across both `backend/cdk/` and `backend/lambda/`. `tsconfig.json` has `strict: true` and an explicit `"types": ["node", "aws-lambda"]` — do not weaken `strict` to make errors go away, and don't remove the `types` override without confirming `@types/node`/`@types/aws-lambda` still get picked up.
- AWS SDK v3 only (`@aws-sdk/client-*`, `@aws-sdk/lib-dynamodb`), never v2 (`aws-sdk`).
- Lambda handlers are typed with `@types/aws-lambda` handler types (e.g. `APIGatewayProxyWebsocketHandlerV2` for routes, plain `APIGatewayRequestAuthorizerEvent`/`APIGatewayAuthorizerResult` for the authorizer) and exported as `export const handler: <HandlerType> = async (event) => {...}`.
- CDK Lambda constructs use `NodejsFunction` (`aws-cdk-lib/aws-lambda-nodejs`), not `lambda.Function` + `Code.fromAsset` — each handler is bundled individually via esbuild, pointed at by its `entry` path. All Lambdas explicitly pin `runtime: lambda.Runtime.NODEJS_20_X` (see "Errors already hit" below for why this matters).
- TypeScript pinned to `^5.6.0` in `backend/package.json` — do not bump to TS 7.x, it breaks `ts-node`'s classic API (`cdk synth` uses `ts-node` under the hood).

**Frontend:**
- Next.js App Router, Server/Client Components split — anything using hooks or browser APIs (`useSession`, `useChatSocket`, event handlers) is marked `"use client"`.
- Session/JWT shape is extended via module augmentation in `src/types/next-auth.d.ts` (`session.idToken`, `session.user.id`, `session.error`) — update this file if you add new fields to the NextAuth `jwt`/`session` callbacks in `src/lib/auth.ts`.
- Respect the `react-hooks/set-state-in-effect` ESLint rule: don't call `setState` synchronously as the first line of a `useEffect`. Derive state during render where possible (see `status` in `useChatSocket.ts`, derived from `isOpen`/`idToken` rather than tracked as its own state variable); only call `setState` from inside real async/event callbacks (WebSocket `message`/`open`/`close` handlers).

## Common strict-mode pitfalls in backend (already hit once, avoid repeating)

- `process.env.SOME_VAR` is typed `string | undefined`. CDK-injected env vars (like `TABLE_NAME`, `USER_POOL_ID`) are asserted non-null at the top of each handler (`process.env.TABLE_NAME!`) since CDK guarantees they're set — don't remove the `!` without adding a runtime check instead.
- `event.body` on WebSocket events is typed `string | undefined`. Always guard before `JSON.parse` (e.g. `JSON.parse(event.body ?? "")`), never pass it directly.
- `catch (err)` binds `err` as `unknown` under strict mode. Narrow it (`typeof err === "object" && "$metadata" in err`, or `err instanceof Error`) before accessing any property — never access `err.<anything>` directly. See the 410-Gone handling in `sendMessage.ts` for the established pattern.
- Arrays declared with no initializer type (`const x = []`) and later mutated inside a nested closure (e.g. a `.map()` callback) will implicitly type as `any[]`. Always annotate explicitly (`const x: string[] = []`).
- DynamoDB `QueryCommand`/`GetCommand` results are loosely typed (generic attribute records). Cast into a proper interface (see `ConnectionItem` in `sendMessage.ts`) before destructuring fields you expect to be a specific type.

## Architecture notes agents should know before editing

- **Auth flow:** Frontend (NextAuth) authenticates the user against Cognito Hosted UI (Google as the only federated IdP, configured in `auth-stack.ts`). NextAuth's `jwt` callback stores `idToken`/`accessToken`/`refreshToken`/`expiresAt` on first sign-in and silently calls `refreshAccessToken()` (POSTs to `${COGNITO_DOMAIN}/oauth2/token` with `grant_type=refresh_token`) whenever the token is close to expiring — this is checked on every `jwt` callback invocation, not on a timer. If refresh fails, `session.error = "RefreshAccessTokenError"` is set and the frontend (`page.tsx`) forces a re-sign-in.
- **WebSocket auth:** The frontend opens the socket as `wss://.../prod?token=<idToken>` (see `useChatSocket.ts`). `authorizer.ts` is a `REQUEST`-type Lambda authorizer wired only on `connectRouteOptions.authorizer` in `realtime-dashboard-stack.ts` — it verifies the token via `CognitoJwtVerifier` (`aws-jwt-verify`, `tokenUse: "id"`) and returns `context: {userId, email}`. Every downstream Lambda (`connect.ts`, `sendMessage.ts`, etc.) reads `event.requestContext.authorizer` to get the caller's identity — there is no per-message re-verification, connection identity is trusted once `$connect` succeeds.
- **WebSocket routes have no automatic response — this is the single most common source of "silently does nothing" bugs in this codebase.** A Lambda's `{statusCode, body}` return value from a custom route (`sendMessage`, `startConversation`, `listConversations`, `getMessages`, `createGroup`) is NOT delivered to the client; it's only visible in logs. Any route that needs to notify the caller (or other users) must construct an `ApiGatewayManagementApiClient` and explicitly call `PostToConnectionCommand`. Every existing route already does this — follow the same pattern for new ones, and don't assume a plain `return` is enough.
- **Unified Conversations model:** `ConversationsTable` (PK `conversationId`) + `ConversationMembersTable` (PK `conversationId`, SK `userId`, plus a `byUserId` GSI) serve both DMs and groups. DM conversation IDs are deterministic (`dm#<sortedUserIds>`, built by sorting the two user IDs so either party starting the conversation lands on the same ID — this is what makes `startConversation` idempotent via a `ConditionExpression: "attribute_not_exists(...)"` write). Group IDs are generated (`group#<uuid>`). `sendMessage.ts` never special-cases DM vs. group — it always resolves recipients via `ConversationMembersTable`.
- **Each Lambda is bundled individually** via `NodejsFunction`'s `entry` option in `backend/cdk/lib/realtime-dashboard-stack.ts` — there is no shared zipped asset. Adding a new Lambda means adding a new `NodejsFunction` construct pointing at its own `.ts` file in `backend/lambda/`.
- **Env vars and grants are not automatic.** Any Lambda touching a table needs that table's name injected via `environment`, plus an explicit `<table>.grantReadData(fn)` / `grantReadWriteData(fn)` call — being in the same stack does not imply permission. Any Lambda that pushes data back to a client additionally needs `stage.grantManagementApiAccess(fn)` (separate from the DynamoDB grants, easy to forget — it's what allows `PostToConnectionCommand` to succeed).
- **Stale connection handling is intentional, don't remove it.** `sendMessage.ts` catches `410 Gone` errors from `PostToConnectionCommand` and deletes those rows from `ConnectionsTable`. This is the self-healing mechanism for connections that closed without a clean `$disconnect` handshake (e.g. laptop lid closed, network drop).
- **API Gateway routes messages by the `action` field** in the JSON body (`$request.body.action`, CDK's default route selection expression). Any new route must match on this field; clients must send `{"action": "<routeName>", ...}`.
- **Frontend message routing:** `useChatSocket.ts` switches on a `type` field in every pushed-down event (`conversationList`, `conversationStarted`, `groupCreated`, `messageHistory`, `message`) to decide how to update state — if you add a new pushed event from the backend, give it a `type` and add a matching `case` here.

## Testing instructions

There are no automated tests in this repo yet. Manual verification flow:

**Backend changes** (`backend/lambda/` or the CDK stacks):

1. `npx tsc --noEmit` — catch type errors before touching AWS
2. `cdk synth` — catch construct errors before deploying (always run this first when adding a new Lambda or route)
3. `cd backend && cdk deploy --all`
4. Exercise the change end-to-end through the frontend (`pnpm dev` in `frontend/`, sign in as two different Google accounts in two browsers) — this is the most reliable way to confirm both the Lambda logic and the push-response wiring are correct, since a route that "deploys fine" can still silently fail to notify the client (see the WebSocket gotcha above)
5. For lower-level debugging without the frontend: `wscat -c "wss://<url>/prod?token=<idToken>"` (grab a live ID token from the browser session/devtools), then send `{"action": "<route>", ...}` manually
6. Check CloudWatch Logs for the relevant Lambda if something is silently failing — WebSocket routes don't surface errors to the client
7. Check DynamoDB (AWS Console → Explore table items, or `aws dynamodb scan --table-name <table>`) to confirm writes/deletes landed as expected

**Frontend changes:**

1. `pnpm lint` and `pnpm build` (build also type-checks)
2. Manually verify in the browser against a real deployed backend — there's no mocked/offline mode for the WebSocket layer

## Security considerations

- Never commit AWS credentials, Cognito client secrets, or `.env`/`.env.local` files. `aws configure` output lives in `~/.aws/credentials`, outside this repo.
- The deploying IAM user currently has `AdministratorAccess` for development convenience — if this project is ever used beyond personal learning, scope this down to least-privilege before considering it production-ready.
- All identity now comes from a verified Cognito ID token (via the WebSocket authorizer) — there is no more client-supplied, unauthenticated `username`. Don't reintroduce a trust-the-client identity field without going through the authorizer.
- The Cognito `UserPoolClient` has `generateSecret: true` and NextAuth holds that secret server-side (in `frontend/.env.local`, never exposed to the browser) — don't move token exchange logic into a Client Component, it would leak the secret.
- `session.idToken` is passed to the browser (it has to be, to open the WebSocket) — treat it as a bearer credential with a real expiry, not a long-lived secret. Token refresh is handled in `src/lib/auth.ts`.

## Commit conventions

Prefer small, incremental commits that each represent one feature or fix (e.g. "Add online-user count broadcast", "Add chat rooms via partition key") rather than large batched commits — this repo is a portfolio project where commit history itself is part of what's being evaluated.
