import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { WebSocketLambdaAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as lambda from "aws-cdk-lib/aws-lambda";

interface RealtimeDashboardStackProps extends cdk.StackProps {
  userPoolId: string;
  userPoolClientId: string;
}

export class RealtimeDashboardStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: RealtimeDashboardStackProps,
  ) {
    super(scope, id, props);

    const connectionsTable = new dynamodb.Table(this, "ConnectionsTable", {
      partitionKey: {
        name: "connectionId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // New: lets us query "give me every active connection for this user"
    // instead of scanning the whole table — needed since one person can
    // have multiple tabs/devices open (multiple connectionIds, one userId).
    connectionsTable.addGlobalSecondaryIndex({
      indexName: "byUserId",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
    });

    const usersTable = new dynamodb.Table(this, "UsersTable", {
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const conversationsTable = new dynamodb.Table(this, "ConversationsTable", {
      partitionKey: {
        name: "conversationId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const conversationMembersTable = new dynamodb.Table(
      this,
      "ConversationMembersTable",
      {
        partitionKey: {
          name: "conversationId",
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: { name: "userId", type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    conversationMembersTable.addGlobalSecondaryIndex({
      indexName: "byUserId",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
    });

    const messagesTable = new dynamodb.Table(this, "MessagesTable", {
      partitionKey: {
        name: "conversationId",
        type: dynamodb.AttributeType.STRING,
      },
      // sortKey format: `${timestamp}#${messageId}` — keeps messages ordered
      // chronologically within a conversation and paginable, while the
      // messageId suffix guarantees uniqueness if two messages land in the
      // same millisecond.
      sortKey: { name: "sortKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const runtime = lambda.Runtime.NODEJS_20_X;
    const lambdaDir = path.join(__dirname, "../../lambda");
    const commonEnv = { TABLE_NAME: connectionsTable.tableName };

    const authorizerFn = new NodejsFunction(this, "AuthorizerFn", {
      runtime,
      entry: path.join(lambdaDir, "authorizer.ts"),
      environment: {
        USER_POOL_ID: props.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClientId,
      },
    });

    const connectAuthorizer = new WebSocketLambdaAuthorizer(
      "ConnectAuthorizer",
      authorizerFn,
      {
        identitySource: ["route.request.querystring.token"],
      },
    );

    const connectFn = new NodejsFunction(this, "ConnectFn", {
      runtime,
      entry: path.join(lambdaDir, "connect.ts"),
      environment: {
        TABLE_NAME: connectionsTable.tableName,
        USERS_TABLE_NAME: usersTable.tableName,
      },
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
      environment: {
        TABLE_NAME: connectionsTable.tableName,
        MESSAGES_TABLE_NAME: messagesTable.tableName,
        CONVERSATIONS_TABLE_NAME: conversationsTable.tableName,
        CONVERSATION_MEMBERS_TABLE_NAME: conversationMembersTable.tableName,
      },
    });

    const createConversationFn = new NodejsFunction(
      this,
      "CreateConversationFn",
      {
        runtime,
        entry: path.join(lambdaDir, "createConversation.ts"),
        environment: {
          TABLE_NAME: connectionsTable.tableName,
          CONVERSATIONS_TABLE_NAME: conversationsTable.tableName,
          CONVERSATION_MEMBERS_TABLE_NAME: conversationMembersTable.tableName,
        },
      },
    );

    connectionsTable.grantReadWriteData(connectFn);
    connectionsTable.grantReadWriteData(disconnectFn);
    usersTable.grantReadWriteData(connectFn);
    usersTable.grantReadWriteData(sendMessageFn);
    messagesTable.grantReadWriteData(sendMessageFn);
    connectionsTable.grantReadWriteData(sendMessageFn);
    connectionsTable.grantReadData(createConversationFn);
    messagesTable.grantReadWriteData(sendMessageFn);
    conversationsTable.grantReadWriteData(sendMessageFn);
    conversationsTable.grantReadWriteData(createConversationFn);
    conversationMembersTable.grantReadWriteData(sendMessageFn);
    conversationMembersTable.grantReadWriteData(createConversationFn);

    const webSocketApi = new apigwv2.WebSocketApi(
      this,
      "RealtimeDashboardApi",
      {
        connectRouteOptions: {
          integration: new integrations.WebSocketLambdaIntegration(
            "ConnectIntegration",
            connectFn,
          ),
          authorizer: connectAuthorizer,
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

    webSocketApi.addRoute("createGroup", {
      integration: new integrations.WebSocketLambdaIntegration(
        "CreateGroupIntegration",
        createConversationFn,
      ),
    });

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

    new cdk.CfnOutput(this, "WebSocketURL", { value: stage.url });
  }
}
