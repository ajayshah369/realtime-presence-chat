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
const CONVERSATION_MEMBERS_TABLE_NAME =
  process.env.CONVERSATION_MEMBERS_TABLE_NAME!;

interface ConnectionItem {
  connectionId: string;
  userId: string;
  username?: string;
}

interface SendMessagePayload {
  conversationId: string;
  text: string;
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

async function getConversationMembers(
  conversationId: string,
): Promise<string[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: CONVERSATION_MEMBERS_TABLE_NAME,
      KeyConditionExpression: "conversationId = :conversationId",
      ExpressionAttributeValues: { ":conversationId": conversationId },
    }),
  );
  return (result.Items ?? []).map((item) => item.userId as string);
}

async function isMember(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const result = await ddb.send(
    new GetCommand({
      TableName: CONVERSATION_MEMBERS_TABLE_NAME,
      Key: { conversationId, userId },
    }),
  );
  return !!result.Item;
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

  const senderRecord = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { connectionId: senderConnectionId },
    }),
  );
  const sender = senderRecord.Item as ConnectionItem | undefined;
  if (!sender) return { statusCode: 401, body: "Unknown connection" };

  let body: Partial<SendMessagePayload>;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  if (!body.conversationId || !body.text) {
    return {
      statusCode: 400,
      body: 'Payload must include "conversationId" and "text"',
    };
  }

  if (!(await isMember(body.conversationId, sender.userId))) {
    return {
      statusCode: 403,
      body: "You are not a member of this conversation",
    };
  }

  const conversationId = body.conversationId;
  const timestamp = new Date().toISOString();
  const messageId = randomUUID();

  await ddb.send(
    new PutCommand({
      TableName: MESSAGES_TABLE_NAME,
      Item: {
        conversationId,
        sortKey: `${timestamp}#${messageId}`,
        senderId: sender.userId,
        text: body.text,
        sentAt: timestamp,
      },
    }),
  );

  const memberIds = await getConversationMembers(conversationId);
  const connectionGroups = await Promise.all(
    memberIds.map(getConnectionsForUser),
  );
  const targetConnections = connectionGroups.flat();

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
        if (statusCode === 410) staleConnectionIds.push(connectionId);
        else console.error(`Failed to post to connection ${connectionId}`, err);
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
