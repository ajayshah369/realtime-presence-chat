#!/usr/bin/env node
const cdk = require("aws-cdk-lib");
const { RealtimeDashboardStack } = require("../lib/realtime-dashboard-stack");

const app = new cdk.App();

new RealtimeDashboardStack(app, "RealtimeDashboardStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-south-1",
  },
});
