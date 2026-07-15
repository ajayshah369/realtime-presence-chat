const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const username =
    (event.queryStringParameters && event.queryStringParameters.username) ||
    `guest-${connectionId.slice(0, 6)}`;

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { connectionId, username, connectedAt: new Date().toISOString() },
    }),
  );

  return { statusCode: 200, body: "Connected" };
};
