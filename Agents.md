# AGENTS.md

Context and conventions for any AI coding agent (Claude Code, Cursor, etc.) working in this repository.

## Project overview

This is a monorepo with two top-level directories:

- **`backend/`** — serverless real-time chat/presence backend. AWS API Gateway WebSocket API → Lambda (Node.js, TypeScript) → DynamoDB, deployed via AWS CDK (TypeScript). No traditional server; connection state lives in DynamoDB because Lambda has no memory between invocations.
- **`frontend/`** — Next.js app (placeholder as of this writing; will host the chat UI once built).

Everything below this section describes `backend/` unless stated otherwise, since that's the only implemented half so far.

Region deployed to: `ap-south-1` (Mumbai). Stack name: `RealtimeDashboardStack`.

## Setup commands

Run all backend commands from inside `backend/`, not the repo root:

```bash
cd backend
npm install                              # install all dependencies
cdk bootstrap aws://<ACCOUNT_ID>/<REGION> # one-time per account/region
cdk synth                                # validate + render CloudFormation locally, no AWS calls
cdk deploy                               # deploy to AWS, prompts for IAM change approval
cdk destroy                              # tear down all resources
```

There is no local dev server or offline emulator configured for the backend — testing happens against real deployed AWS resources (see "Testing" below). Do not assume `npm start` or similar exists there. The frontend's dev server commands will be documented here once `frontend/` is scaffolded.

Type-check before deploying:

```bash
npx tsc --noEmit
```

## Code style

- TypeScript throughout, across both `backend/cdk/` and `backend/lambda/`. `tsconfig.json` has `strict: true` — do not weaken this to make errors go away.
- AWS SDK v3 only (`@aws-sdk/client-*`, `@aws-sdk/lib-dynamodb`), never v2 (`aws-sdk`).
- Lambda handlers are typed with `@types/aws-lambda` handler types (e.g. `APIGatewayProxyWebsocketHandlerV2`) and exported as `export const handler: <HandlerType> = async (event) => {...}`.
- CDK Lambda constructs use `NodejsFunction` (`aws-cdk-lib/aws-lambda-nodejs`), not `lambda.Function` + `Code.fromAsset` — each handler is bundled individually via esbuild, pointed at by its `entry` path.

## Common strict-mode pitfalls in this codebase (already hit once, avoid repeating)

- `process.env.SOME_VAR` is typed `string | undefined`. CDK-injected env vars (like `TABLE_NAME`) are asserted non-null at the top of each handler (`process.env.TABLE_NAME!`) since CDK guarantees they're set — don't remove the `!` without adding a runtime check instead.
- `event.body` on WebSocket events is typed `string | undefined`. Always guard before `JSON.parse` (e.g. `JSON.parse(event.body ?? "")`), never pass it directly.
- `catch (err)` binds `err` as `unknown` under strict mode. Narrow it (`typeof err === "object" && "$metadata" in err`, or `err instanceof Error`) before accessing any property — never access `err.<anything>` directly.
- Arrays declared with no initializer type (`const x = []`) and later mutated inside a nested closure (e.g. a `.map()` callback) will implicitly type as `any[]`. Always annotate explicitly (`const x: string[] = []`).
- DynamoDB `ScanCommand`/`GetCommand` results are loosely typed (generic attribute records). Cast or validate into a proper interface (see `ConnectionItem` in `sendMessage.ts`) before destructuring fields you expect to be a specific type.

## Architecture notes agents should know before editing

- **Each Lambda (`connect.ts`, `disconnect.ts`, `default.ts`, `sendMessage.ts`) is bundled individually** via `NodejsFunction`'s `entry` option in `backend/cdk/lib/realtime-dashboard-stack.ts` — there is no shared zipped asset anymore (that was true only in the pre-TypeScript JS version). Adding a new Lambda means adding a new `NodejsFunction` construct pointing at its own `.ts` file.
- **`TABLE_NAME` env var** is injected by CDK (`connectionsTable.tableName`), not hardcoded. Any new Lambda that touches DynamoDB needs this in its `environment` block, plus an explicit `connectionsTable.grantReadWriteData(fn)` call — permissions are not automatic just because a Lambda is in the same stack.
- **`sendMessage.ts` needs a second, different grant**: `stage.grantManagementApiAccess(sendMessageFn)`. This is separate from the DynamoDB grant and easy to forget — it's what allows the Lambda to call back into API Gateway to push data to clients (`PostToConnectionCommand`).
- **Stale connection handling is intentional, don't remove it.** `sendMessage.ts` catches `410 Gone` errors from `PostToConnectionCommand` and deletes those rows from DynamoDB. This is the self-healing mechanism for connections that closed without a clean `$disconnect` handshake (e.g. laptop lid closed, network drop).
- **API Gateway routes messages by the `action` field** in the JSON body (`$request.body.action`, CDK's default route selection expression). Any new route must match on this field; clients must send `{"action": "<routeName>", ...}`.

## Testing instructions

There are no automated tests in this repo yet. Manual verification flow after any change to `backend/lambda/` or the CDK stack:

1. `npx tsc --noEmit` — catch type errors before touching AWS
2. `cd backend && cdk deploy`
3. Connect two clients (either `wscat -c "wss://<url>/prod?username=X"` in two terminals, or `backend/client/index.html` in two browser tabs)
4. Send a message from one client, confirm it's received by both
5. Disconnect one client, then check DynamoDB (`aws dynamodb scan --table-name <table>` or AWS Console → Explore table items) to confirm its row was removed

If adding a new Lambda or route, always run `cdk synth` first to catch construct errors before `cdk deploy`.

## Security considerations

- Never commit AWS credentials. `aws configure` output lives in `~/.aws/credentials`, outside this repo.
- The deploying IAM user currently has `AdministratorAccess` for development convenience — if this project is ever used beyond personal learning, scope this down to least-privilege before considering it production-ready.
- Client-supplied `username` (via query string on `$connect`) is not authenticated. Anyone can claim any username. Don't treat it as a trusted identity without adding real auth (see "Extending it" in README.md — Cognito is the suggested next step).

## Commit conventions

Prefer small, incremental commits that each represent one feature or fix (e.g. "Add online-user count broadcast", "Add chat rooms via partition key") rather than large batched commits — this repo is a portfolio project where commit history itself is part of what's being evaluated.
