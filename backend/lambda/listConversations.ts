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
const USERS_TABLE_NAME = process.env.USERS_TABLE_NAME!;
const CONVERSATIONS_TABLE_NAME = process.env.CONVERSATIONS_TABLE_NAME!;
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

  const membershipResult = await ddb.send(
    new QueryCommand({
      TableName: CONVERSATION_MEMBERS_TABLE_NAME,
      IndexName: "byUserId",
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": sender.userId },
    }),
  );
  const conversationIds = (membershipResult.Items ?? []).map(
    (item) => item.conversationId as string,
  );

  const conversations = await Promise.all(
    conversationIds.map(async (conversationId) => {
      const conversationRecord = await ddb.send(
        new GetCommand({
          TableName: CONVERSATIONS_TABLE_NAME,
          Key: { conversationId },
        }),
      );
      const conversation = conversationRecord.Item;
      if (!conversation) return null;

      if (conversation.type === "group") {
        return {
          conversationId,
          type: "group",
          name: conversation.name as string,
        };
      }

      const membersResult = await ddb.send(
        new QueryCommand({
          TableName: CONVERSATION_MEMBERS_TABLE_NAME,
          KeyConditionExpression: "conversationId = :conversationId",
          ExpressionAttributeValues: { ":conversationId": conversationId },
        }),
      );
      const otherUserId = (membersResult.Items ?? [])
        .map((item) => item.userId as string)
        .find((id) => id !== sender.userId);

      let name = otherUserId ?? "Unknown";
      if (otherUserId) {
        const userRecord = await ddb.send(
          new GetCommand({
            TableName: USERS_TABLE_NAME,
            Key: { userId: otherUserId },
          }),
        );
        name = (userRecord.Item?.email as string) ?? otherUserId;
      }

      return { conversationId, type: "dm", name, otherUserId };
    }),
  );

  await apiClient.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(
        JSON.stringify({
          type: "conversationList",
          conversations: conversations.filter(Boolean),
        }),
      ),
    }),
  );

  return { statusCode: 200, body: "Conversations listed" };
};
