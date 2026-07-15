const path = require("path");
const cdk = require("aws-cdk-lib");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigwv2 = require("aws-cdk-lib/aws-apigatewayv2");
const integrations = require("aws-cdk-lib/aws-apigatewayv2-integrations");

class RealtimeDashboardStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const connectionsTable = new dynamodb.Table(this, "ConnectionsTable", {
      partitionKey: {
        name: "connectionId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const runtime = lambda.Runtime.NODEJS_20_X;
    const lambdaAsset = lambda.Code.fromAsset(
      path.join(__dirname, "../../lambda"),
    );
    const commonEnv = { TABLE_NAME: connectionsTable.tableName };

    const connectFn = new lambda.Function(this, "ConnectFn", {
      runtime,
      handler: "connect.handler",
      code: lambdaAsset,
      environment: commonEnv,
    });

    const disconnectFn = new lambda.Function(this, "DisconnectFn", {
      runtime,
      handler: "disconnect.handler",
      code: lambdaAsset,
      environment: commonEnv,
    });

    const defaultFn = new lambda.Function(this, "DefaultFn", {
      runtime,
      handler: "default.handler",
      code: lambdaAsset,
    });

    const sendMessageFn = new lambda.Function(this, "SendMessageFn", {
      runtime,
      handler: "sendMessage.handler",
      code: lambdaAsset,
      environment: commonEnv,
    });

    connectionsTable.grantReadWriteData(connectFn);
    connectionsTable.grantReadWriteData(disconnectFn);
    connectionsTable.grantReadWriteData(sendMessageFn);

    const webSocketApi = new apigwv2.WebSocketApi(
      this,
      "RealtimeDashboardApi",
      {
        connectRouteOptions: {
          integration: new integrations.WebSocketLambdaIntegration(
            "ConnectIntegration",
            connectFn,
          ),
        },
        disconnectRouteOptions: {
          integration: new integrations.WebSocketLambdaIntegration(
            "DisconnectIntegration",
            disconnectFn,
          ),
        },
        defaultRouteOptions: {
          integration: new integrations.WebSocketLambdaIntegration(
            "DefaultIntegration",
            defaultFn,
          ),
        },
      },
    );

    webSocketApi.addRoute("sendMessage", {
      integration: new integrations.WebSocketLambdaIntegration(
        "SendMessageIntegration",
        sendMessageFn,
      ),
    });

    const stage = new apigwv2.WebSocketStage(this, "ProdStage", {
      webSocketApi,
      stageName: "prod",
      autoDeploy: true,
    });

    stage.grantManagementApiAccess(sendMessageFn);

    new cdk.CfnOutput(this, "WebSocketURL", {
      value: stage.url,
      description: "wss:// URL clients connect to",
    });
  }
}

module.exports = { RealtimeDashboardStack };
