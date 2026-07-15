# Realtime Presence & Chat

A serverless real-time chat/presence backend built on AWS API Gateway WebSocket API, Lambda, and DynamoDB, defined entirely as infrastructure-as-code with AWS CDK. No servers to manage, scales to zero, and demonstrates the fan-out broadcast pattern used in production systems for notifications, live dashboards, and collaborative apps.

## Architecture

```mermaid
sequenceDiagram
    participant Client A
    participant Client B
    participant API Gateway (WebSocket)
    participant Lambda
    participant DynamoDB

    Client A->>API Gateway (WebSocket): $connect ?username=ajay
    API Gateway (WebSocket)->>Lambda: connect.ts
    Lambda->>DynamoDB: PutItem(connectionId, username)

    Client B->>API Gateway (WebSocket): $connect ?username=sam
    API Gateway (WebSocket)->>Lambda: connect.ts
    Lambda->>DynamoDB: PutItem(connectionId, username)

    Client A->>API Gateway (WebSocket): {action: "sendMessage", text}
    API Gateway (WebSocket)->>Lambda: sendMessage.ts
    Lambda->>DynamoDB: Scan connections
    Lambda->>API Gateway (WebSocket): PostToConnection (A and B)
    API Gateway (WebSocket)->>Client A: broadcast message
    API Gateway (WebSocket)->>Client B: broadcast message
```

Four Lambda functions (TypeScript, bundled individually via CDK's `NodejsFunction`) handle the WebSocket lifecycle:

- **`connect.ts`** — runs on `$connect`, stores `connectionId` + `username` in DynamoDB
- **`disconnect.ts`** — runs on `$disconnect`, removes that row
- **`sendMessage.ts`** — runs on the custom `sendMessage` route, scans all open connections and pushes the message to each one via the API Gateway Management API, pruning any connection that comes back `410 Gone` (stale/closed without a clean disconnect)
- **`default.ts`** — catch-all for any message whose `action` doesn't match a known route

## Project structure

This is a monorepo: `backend/` (AWS CDK + Lambda, this README's main focus for now) and `frontend/` (Next.js app, in progress — see roadmap below).

```
realtime-presence-chat/
├── backend/
│   ├── cdk/
│   │   ├── bin/app.ts                     # CDK app entry point
│   │   └── lib/realtime-dashboard-stack.ts # Infrastructure definition
│   ├── lambda/
│   │   ├── connect.ts
│   │   ├── disconnect.ts
│   │   ├── sendMessage.ts
│   │   └── default.ts
│   ├── client/
│   │   └── index.html                     # Plain-HTML WebSocket test client
│   ├── cdk.json
│   ├── tsconfig.json
│   └── package.json
├── frontend/                              # Next.js app (placeholder for now)
├── README.md
├── AGENTS.md
└── CLAUDE.md
```

## Prerequisites

- Node.js 18+
- An AWS account with the CLI configured (`aws configure`)
- AWS CDK CLI: `npm install -g aws-cdk`

## Setup

```bash
cd backend
npm install

# one-time per AWS account/region
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

## Deploy

```bash
cd backend
cdk deploy
```

CDK prints a `WebSocketURL` output when it finishes, e.g.:

```
RealtimeDashboardStack.WebSocketURL = wss://abc123.execute-api.ap-south-1.amazonaws.com/prod
```

## Try it out

**Quick check with wscat:**

```bash
npm install -g wscat
wscat -c "wss://<your-url>/prod?username=ajay"
```

Once connected, send: `{"action": "sendMessage", "text": "hello"}`

**Full test with the browser client:**

1. Open `backend/client/index.html` in two browser tabs
2. Paste the `WebSocketURL` into each, give each tab a different username, click Connect
3. Send a message from one tab — it should appear in both, proving the broadcast fan-out works

**Inspect the data:** AWS Console → DynamoDB → Tables → your `ConnectionsTable` → _Explore table items_. Rows only exist while a connection is open — expect 0 items when nothing's connected, which confirms cleanup is working, not broken.

## Cleaning up

Everything here is pay-per-use, so idle cost is near zero, but tear it down when you're done demoing:

```bash
cd backend
cdk destroy
```

## Why this project is a good portfolio piece

It goes beyond a typical CRUD tutorial: it requires reasoning about connection state in a stateless compute model (Lambda has no memory between invocations, so DynamoDB stands in for the "who's connected" state a long-running server would normally hold in memory), handling partial failure during a broadcast (one dead connection shouldn't break delivery to everyone else), and expressing the whole thing as versioned, reviewable infrastructure code instead of console clicks.

## Roadmap

This project is growing from a WebSocket demo into a full messaging platform (auth, 1:1 and group chat, file sharing, notifications), built serverless first and later rebuilt as a comparison project on self-managed microservices infrastructure. Current/planned phases:

1. ~~Migrate backend to TypeScript~~ — done
2. Authentication (Cognito + Google) + Next.js frontend scaffold
3. Persistent 1:1 chat (message history, conversations)
4. Group chat
5. File sharing (images, PDFs, audio, video via S3)
6. Notifications (push + delivered/read receipts)
7. Stretch: message search, load testing, rate limiting
8. Rebuild the same feature set on self-managed microservices infrastructure, for comparison
