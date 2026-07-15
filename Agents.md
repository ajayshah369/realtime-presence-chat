# AGENTS.md

Context and conventions for any AI coding agent (Claude Code, Cursor, etc.) working in this repository.

## Project overview

This is a monorepo with two top-level directories:

- **`backend/`** — serverless real-time chat/presence backend. AWS API Gateway WebSocket API → Lambda (Node.js) → DynamoDB, deployed via AWS CDK (JavaScript, not TypeScript — TypeScript migration in progress, update this file once complete). No traditional server; connection state lives in DynamoDB because Lambda has no memory between invocations.
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

## Code style

- Plain JavaScript (CommonJS, `require`/`module.exports`), not TypeScript, across both `backend/cdk/` and `backend/lambda/` — TypeScript migration in progress, update this section once complete.
- AWS SDK v3 only (`@aws-sdk/client-*`, `@aws-sdk/lib-dynamodb`), never v2 (`aws-sdk`).
- Lambda handlers are always named `exports.handler = async (event) => {...}`.
- No build step or transpiler — files run as-is in both CDK synth and the Lambda runtime.

## Architecture notes agents should know before editing

- **`connect.js`, `disconnect.js`, `default.js`, and `sendMessage.js` all share one zipped asset** (`lambda.Code.fromAsset('../../lambda')` in `backend/cdk/lib/realtime-dashboard-stack.js`). Adding a new file to `backend/lambda/` does not require a new `fromAsset` call — just reference the new file's handler in a new `lambda.Function` construct. Note: this will change once the TypeScript migration switches to the `NodejsFunction` construct, which bundles each handler file individually instead of sharing one zipped folder — update this note when that lands.
- **`TABLE_NAME` env var** is injected by CDK (`connectionsTable.tableName`), not hardcoded. Any new Lambda that touches DynamoDB needs this in its `environment` block, plus an explicit `connectionsTable.grantReadWriteData(fn)` call — permissions are not automatic just because a Lambda is in the same stack.
- **`sendMessage.js` needs a second, different grant**: `stage.grantManagementApiAccess(sendMessageFn)`. This is separate from the DynamoDB grant and easy to forget — it's what allows the Lambda to call back into API Gateway to push data to clients (`PostToConnectionCommand`).
- **Stale connection handling is intentional, don't remove it.** `sendMessage.js` catches `410 Gone` errors from `PostToConnectionCommand` and deletes those rows from DynamoDB. This is the self-healing mechanism for connections that closed without a clean `$disconnect` handshake (e.g. laptop lid closed, network drop).
- **API Gateway routes messages by the `action` field** in the JSON body (`$request.body.action`, CDK's default route selection expression). Any new route must match on this field; clients must send `{"action": "<routeName>", ...}`.

## Testing instructions

There are no automated tests in this repo yet. Manual verification flow after any change to `backend/lambda/` or the CDK stack:

1. `cd backend && cdk deploy`
2. Connect two clients (either `wscat -c "wss://<url>/prod?username=X"` in two terminals, or `backend/client/index.html` in two browser tabs)
3. Send a message from one client, confirm it's received by both
4. Disconnect one client, then check DynamoDB (`aws dynamodb scan --table-name <table>` or AWS Console → Explore table items) to confirm its row was removed

If adding a new Lambda or route, always run `cdk synth` first to catch syntax/construct errors before `cdk deploy`.

## Security considerations

- Never commit AWS credentials. `aws configure` output lives in `~/.aws/credentials`, outside this repo.
- The deploying IAM user currently has `AdministratorAccess` for development convenience — if this project is ever used beyond personal learning, scope this down to least-privilege before considering it production-ready.
- Client-supplied `username` (via query string on `$connect`) is not authenticated. Anyone can claim any username. Don't treat it as a trusted identity without adding real auth (see "Extending it" in README.md — Cognito is the suggested next step).

## Commit conventions

Prefer small, incremental commits that each represent one feature or fix (e.g. "Add online-user count broadcast", "Add chat rooms via partition key") rather than large batched commits — this repo is a portfolio project where commit history itself is part of what's being evaluated.
