import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;
const USERS_TABLE_NAME = process.env.USERS_TABLE_NAME!;

interface AuthorizedRequestContext {
  connectionId: string;
  authorizer?: { userId?: string; email?: string };
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const requestContext =
    event.requestContext as unknown as AuthorizedRequestContext;
  const connectionId = requestContext.connectionId;
  const userId = requestContext.authorizer?.userId;
  const email = requestContext.authorizer?.email;
  const username = email || `user-${userId?.slice(0, 6)}`;
  const now = new Date().toISOString();

  await Promise.all([
    ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { connectionId, userId, username, connectedAt: now },
      }),
    ),
    ddb.send(
      new PutCommand({
        TableName: USERS_TABLE_NAME,
        Item: { userId, email: username, updatedAt: now },
      }),
    ),
  ]);

  return { statusCode: 200, body: "Connected" };
};
