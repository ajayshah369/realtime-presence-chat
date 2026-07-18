import { NextAuthOptions } from "next-auth";
import { JWT } from "next-auth/jwt";
import CognitoProvider from "next-auth/providers/cognito";

const COGNITO_DOMAIN = process.env.COGNITO_DOMAIN!; // e.g. https://realtime-chat-ajay.auth.ap-south-1.amazoncognito.com

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.COGNITO_CLIENT_ID!,
        client_secret: process.env.COGNITO_CLIENT_SECRET!,
        refresh_token: token.refreshToken as string,
      }),
    });

    const refreshed = await response.json();
    if (!response.ok) throw refreshed;

    return {
      ...token,
      idToken: refreshed.id_token,
      accessToken: refreshed.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
      error: undefined,
    };
  } catch (err) {
    console.error("Failed to refresh Cognito token", err);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

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
    async jwt({ token, account, profile }) {
      if (account) {
        return {
          ...token,
          idToken: account.id_token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          sub: profile?.sub,
        };
      }

      if (Date.now() < (token.expiresAt as number) * 1000 - 60_000) {
        return token;
      }

      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.idToken = token.idToken as string;
      session.error = token.error as string | undefined;
      if (session.user) {
        session.user.id = token.sub as string;
      }
      return session;
    },
  },
};
