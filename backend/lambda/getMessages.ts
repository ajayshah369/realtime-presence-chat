import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
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

  let body: { conversationId?: string };
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }
  if (!body.conversationId) {
    return { statusCode: 400, body: 'Payload must include "conversationId"' };
  }

  const membership = await ddb.send(
    new GetCommand({
      TableName: CONVERSATION_MEMBERS_TABLE_NAME,
      Key: { conversationId: body.conversationId, userId: sender.userId },
    }),
  );
  if (!membership.Item) {
    return {
      statusCode: 403,
      body: "You are not a member of this conversation",
    };
  }

  const messagesResult = await ddb.send(
    new QueryCommand({
      TableName: MESSAGES_TABLE_NAME,
      KeyConditionExpression: "conversationId = :conversationId",
      ExpressionAttributeValues: { ":conversationId": body.conversationId },
    }),
  );

  await apiClient.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(
        JSON.stringify({
          type: "messageHistory",
          conversationId: body.conversationId,
          messages: messagesResult.Items ?? [],
        }),
      ),
    }),
  );

  return { statusCode: 200, body: "Messages fetched" };
};
