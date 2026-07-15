import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";

export class RealtimeDashboardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const connectionsTable = new dynamodb.Table(this, "ConnectionsTable", {
      partitionKey: {
        name: "connectionId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const commonEnv = { TABLE_NAME: connectionsTable.tableName };
    const lambdaDir = path.join(__dirname, "../../lambda");

    const runtime = lambda.Runtime.NODEJS_20_X;

    const connectFn = new NodejsFunction(this, "ConnectFn", {
      runtime,
      entry: path.join(lambdaDir, "connect.ts"),
      environment: commonEnv,
    });

    const disconnectFn = new NodejsFunction(this, "DisconnectFn", {
      runtime,
      entry: path.join(lambdaDir, "disconnect.ts"),
      environment: commonEnv,
    });

    const defaultFn = new NodejsFunction(this, "DefaultFn", {
      runtime,
      entry: path.join(lambdaDir, "default.ts"),
    });

    const sendMessageFn = new NodejsFunction(this, "SendMessageFn", {
      runtime,
      entry: path.join(lambdaDir, "sendMessage.ts"),
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
