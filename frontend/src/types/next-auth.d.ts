import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    idToken?: string;
    error?: string;
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    idToken?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
    sub?: string;
  }
}
