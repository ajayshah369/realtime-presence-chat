import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.TABLE_NAME!;
const CONVERSATIONS_TABLE_NAME = process.env.CONVERSATIONS_TABLE_NAME!;
const CONVERSATION_MEMBERS_TABLE_NAME =
  process.env.CONVERSATION_MEMBERS_TABLE_NAME!;

interface ConnectionItem {
  connectionId: string;
  userId: string;
}

interface CreateGroupPayload {
  name: string;
  memberUserIds: string[];
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const senderRecord = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { connectionId: event.requestContext.connectionId },
    }),
  );
  const sender = senderRecord.Item as ConnectionItem | undefined;

  if (!sender) {
    return { statusCode: 401, body: "Unknown connection" };
  }

  let body: Partial<CreateGroupPayload>;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  if (!body.name || !Array.isArray(body.memberUserIds)) {
    return {
      statusCode: 400,
      body: 'Payload must include "name" and "memberUserIds" (array)',
    };
  }

  const conversationId = `group#${randomUUID()}`;
  const now = new Date().toISOString();
  const allMemberIds = Array.from(
    new Set([sender.userId, ...body.memberUserIds]),
  );

  await ddb.send(
    new PutCommand({
      TableName: CONVERSATIONS_TABLE_NAME,
      Item: {
        conversationId,
        type: "group",
        name: body.name,
        createdBy: sender.userId,
        createdAt: now,
      },
    }),
  );

  await Promise.all(
    allMemberIds.map((userId) =>
      ddb.send(
        new PutCommand({
          TableName: CONVERSATION_MEMBERS_TABLE_NAME,
          Item: { conversationId, userId, joinedAt: now },
        }),
      ),
    ),
  );

  return { statusCode: 200, body: JSON.stringify({ conversationId }) };
};
