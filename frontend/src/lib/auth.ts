import { NextAuthOptions } from "next-auth";
import CognitoProvider from "next-auth/providers/cognito";

export const authOptions: NextAuthOptions = {
  providers: [
    CognitoProvider({
      clientId: process.env.COGNITO_CLIENT_ID!,
      clientSecret: process.env.COGNITO_CLIENT_SECRET!,
      issuer: process.env.COGNITO_ISSUER!,
      checks: "nonce",
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // `account` is only populated on the initial sign-in pass, not on
      // every subsequent session check — this is where Cognito's raw
      // tokens are available, right after the OAuth exchange completes.
      if (account) {
        token.idToken = account.id_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.idToken = token.idToken as string;
      return session;
    },
  },
};
