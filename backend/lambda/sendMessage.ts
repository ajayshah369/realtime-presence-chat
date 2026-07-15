import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME!;

interface ConnectionItem {
  connectionId: string;
  username?: string;
  connectedAt?: string;
}

interface SendMessagePayload {
  text: string;
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { domainName, stage, connectionId: senderId } = event.requestContext;
  const apiClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

  let body: Partial<SendMessagePayload>;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  if (!body.text || typeof body.text !== "string") {
    return { statusCode: 400, body: 'Payload must include a "text" string' };
  }

  const scanResult = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
  const connections = (scanResult.Items ?? []) as ConnectionItem[];
  const sender = connections.find((c) => c.connectionId === senderId);

  const payload = Buffer.from(
    JSON.stringify({
      type: "message",
      username: sender ? sender.username : "unknown",
      text: body.text,
      timestamp: new Date().toISOString(),
    }),
  );

  const staleConnectionIds: string[] = [];

  await Promise.all(
    connections.map(async ({ connectionId }) => {
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

  return { statusCode: 200, body: "Message broadcast" };
};
