import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.TABLE_NAME!;
const USERS_TABLE_NAME = process.env.USERS_TABLE_NAME!;
const CONVERSATIONS_TABLE_NAME = process.env.CONVERSATIONS_TABLE_NAME!;
const CONVERSATION_MEMBERS_TABLE_NAME =
  process.env.CONVERSATION_MEMBERS_TABLE_NAME!;

interface ConnectionItem {
  connectionId: string;
  userId: string;
}

function buildDmConversationId(userA: string, userB: string): string {
  return `dm#${[userA, userB].sort().join("#")}`;
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { domainName, stage, connectionId } = event.requestContext;
  const apiClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

  const senderRecord = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { connectionId } }),
  );
  const sender = senderRecord.Item as ConnectionItem | undefined;
  if (!sender) return { statusCode: 401, body: "Unknown connection" };

  let body: { recipientUserId?: string };
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }
  if (!body.recipientUserId) {
    return { statusCode: 400, body: 'Payload must include "recipientUserId"' };
  }

  const conversationId = buildDmConversationId(
    sender.userId,
    body.recipientUserId,
  );
  const now = new Date().toISOString();

  try {
    await ddb.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE_NAME,
        Item: {
          conversationId,
          type: "dm",
          createdBy: sender.userId,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(conversationId)",
      }),
    );
  } catch (err: unknown) {
    const alreadyExists =
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name?: string }).name === "ConditionalCheckFailedException";
    if (!alreadyExists) throw err;
  }

  await Promise.all(
    [sender.userId, body.recipientUserId].map((userId) =>
      ddb.send(
        new PutCommand({
          TableName: CONVERSATION_MEMBERS_TABLE_NAME,
          Item: { conversationId, userId, joinedAt: now },
        }),
      ),
    ),
  );

  const recipientRecord = await ddb.send(
    new GetCommand({
      TableName: USERS_TABLE_NAME,
      Key: { userId: body.recipientUserId },
    }),
  );
  const recipientEmail =
    (recipientRecord.Item?.email as string) ?? body.recipientUserId;

  await apiClient.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(
        JSON.stringify({
          type: "conversationStarted",
          conversationId,
          otherUser: { userId: body.recipientUserId, email: recipientEmail },
        }),
      ),
    }),
  );

  return { statusCode: 200, body: "Conversation started" };
};
