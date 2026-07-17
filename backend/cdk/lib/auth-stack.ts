import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";

interface AuthStackProps extends cdk.StackProps {
  googleClientId: string;
  googleClientSecret: string;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "realtime-chat-users",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolDomain = this.userPool.addDomain("UserPoolDomain", {
      cognitoDomain: { domainPrefix: "realtime-chat-ajay" },
    });

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
      this,
      "GoogleProvider",
      {
        userPool: this.userPool,
        clientId: props.googleClientId,
        clientSecretValue: cdk.SecretValue.unsafePlainText(
          props.googleClientSecret,
        ),
        scopes: ["email", "profile", "openid"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
          profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
        },
      },
    );

    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: this.userPool,
      generateSecret: true, // NextAuth runs server-side, safe to hold a client secret
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ["http://localhost:3000/api/auth/callback/cognito"],
        logoutUrls: ["http://localhost:3000"],
      },
    });

    // Cognito won't let the client reference Google as a provider until Google is registered
    this.userPoolClient.node.addDependency(googleProvider);

    new cdk.CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "UserPoolDomainUrl", {
      value: this.userPoolDomain.baseUrl(),
    });
  }
}
