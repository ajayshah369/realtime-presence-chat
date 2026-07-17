import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;
const MESSAGES_TABLE_NAME = process.env.MESSAGES_TABLE_NAME!;

interface ConnectionItem {
  connectionId: string;
  userId: string;
  username?: string;
}

interface SendMessagePayload {
  recipientUserId: string;
  text: string;
}

function buildConversationId(userA: string, userB: string): string {
  return [userA, userB].sort().join("#");
}

async function getConnectionsForUser(
  userId: string,
): Promise<ConnectionItem[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "byUserId",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
    }),
  );
  return (result.Items ?? []) as ConnectionItem[];
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const {
    domainName,
    stage,
    connectionId: senderConnectionId,
  } = event.requestContext;
  const apiClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

  // sendMessage isn't behind the authorizer (only $connect is), so we
  // recover the sender's verified identity from the record connect.ts
  // already wrote for this connectionId.
  const senderRecord = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { connectionId: senderConnectionId },
    }),
  );
  const sender = senderRecord.Item as ConnectionItem | undefined;

  if (!sender) {
    return { statusCode: 401, body: "Unknown connection" };
  }

  let body: Partial<SendMessagePayload>;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  if (!body.recipientUserId || !body.text) {
    return {
      statusCode: 400,
      body: 'Payload must include "recipientUserId" and "text"',
    };
  }

  const conversationId = buildConversationId(
    sender.userId,
    body.recipientUserId,
  );
  const timestamp = new Date().toISOString();
  const messageId = randomUUID();

  await ddb.send(
    new PutCommand({
      TableName: MESSAGES_TABLE_NAME,
      Item: {
        conversationId,
        sortKey: `${timestamp}#${messageId}`,
        senderId: sender.userId,
        recipientUserId: body.recipientUserId,
        text: body.text,
        sentAt: timestamp,
      },
    }),
  );

  // Deliver to the recipient's active connections, plus the sender's own
  // other open tabs/devices (so you see your own message everywhere you're
  // logged in, not just the tab that sent it).
  const [recipientConnections, senderConnections] = await Promise.all([
    getConnectionsForUser(body.recipientUserId),
    getConnectionsForUser(sender.userId),
  ]);
  const targetConnections = [...recipientConnections, ...senderConnections];

  const payload = Buffer.from(
    JSON.stringify({
      type: "message",
      conversationId,
      senderId: sender.userId,
      senderUsername: sender.username,
      text: body.text,
      timestamp,
    }),
  );

  const staleConnectionIds: string[] = [];

  await Promise.all(
    targetConnections.map(async ({ connectionId }) => {
      try {
        await apiClient.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: payload,
          }),
        );
      } catch (err: unknown) {
        const statusCode =
          err && typeof err === "object" && "$metadata" in err
            ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
                ?.httpStatusCode
            : undefined;

        if (statusCode === 410) {
          staleConnectionIds.push(connectionId);
        } else {
          console.error(`Failed to post to connection ${connectionId}`, err);
        }
      }
    }),
  );

  await Promise.all(
    staleConnectionIds.map((connectionId) =>
      ddb.send(
        new DeleteCommand({ TableName: TABLE_NAME, Key: { connectionId } }),
      ),
    ),
  );

  return { statusCode: 200, body: "Message sent" };
};
