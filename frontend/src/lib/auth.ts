import { NextAuthOptions } from "next-auth";
import CognitoProvider from "next-auth/providers/cognito";

export const authOptions: NextAuthOptions = {
  providers: [
    CognitoProvider({
      clientId: process.env.COGNITO_CLIENT_ID!,
      clientSecret: process.env.COGNITO_CLIENT_SECRET!,
      issuer: process.env.COGNITO_ISSUER!,
      // Documented next-auth + Cognito bug (nextauthjs/next-auth #3544):
      // nonce isn't tracked correctly against third-party IdPs (Google,
      // Okta, etc.) unless explicitly forced on here. Fixed via PR #4100.
      checks: "nonce",
    }),
  ],
};
