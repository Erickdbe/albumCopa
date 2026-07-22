import jwt from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  username: string;
}

// Read lazily (not at module load) so import order relative to
// "dotenv/config" in index.ts never matters.
function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set — refusing to sign or verify tokens");
  }
  return secret;
}

const ALGORITHM = "HS256" as const;

export function signAccessToken(payload: AccessTokenPayload): string {
  const expiresIn = process.env.JWT_EXPIRES_IN ?? "7d";
  return jwt.sign(payload, getSecret(), { expiresIn, algorithm: ALGORITHM } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  // Pinning algorithms here prevents a token forged with a different alg
  // (or "none") from ever being accepted, regardless of what's inside it.
  return jwt.verify(token, getSecret(), { algorithms: [ALGORITHM] }) as AccessTokenPayload;
}
