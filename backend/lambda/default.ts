import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      type: "error",
      message:
        'Unknown action. Send { "action": "sendMessage", "text": "..." }',
    }),
  };
};
