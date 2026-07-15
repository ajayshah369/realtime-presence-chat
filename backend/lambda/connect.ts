import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const username =
    (event.queryStringParameters && event.queryStringParameters.username) ||
    `guest-${connectionId.slice(0, 6)}`;

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { connectionId, username, connectedAt: new Date().toISOString() },
    })
  );

  return { statusCode: 200, body: "Connected" };
};