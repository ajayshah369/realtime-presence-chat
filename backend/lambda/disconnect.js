const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  await ddb.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: { connectionId } }),
  );

  return { statusCode: 200, body: "Disconnected" };
};
