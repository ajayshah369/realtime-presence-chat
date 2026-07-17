#!/usr/bin/env node
import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { RealtimeDashboardStack } from "../lib/realtime-dashboard-stack";
import { AuthStack } from "../lib/auth-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || "ap-south-1",
};

new RealtimeDashboardStack(app, "RealtimeDashboardStack", { env });

new AuthStack(app, "AuthStack", {
  env,
  googleClientId: process.env.GOOGLE_CLIENT_ID!,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
});
