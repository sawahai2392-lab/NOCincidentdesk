import { betterAuth } from "better-auth";
import { env } from "./env.js";
import { pool } from "./db/client.js";

const googleProvider =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          scope: ["openid", "email", "profile"]
        }
      }
    : {};

export const auth = betterAuth({
  database: pool,
  baseURL: env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 12
  },
  socialProviders: googleProvider,
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
    cookiePrefix: "nocdesk"
  }
});
