const DEV_DEFAULT_JWT_SECRET = "dev-only-change-me";
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Fails fast at boot instead of quietly running with dev-grade config in
 * production. Catches the single most common real-world deploy mistake:
 * copying `.env.example` verbatim and never rotating the JWT secret.
 */
export function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;

  const secret = process.env.JWT_SECRET ?? "";
  if (secret === DEV_DEFAULT_JWT_SECRET || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `Refusing to start in production with an insecure JWT_SECRET (must be a random string of at least ${MIN_JWT_SECRET_LENGTH} characters, not the dev default).`
    );
  }

  if ((process.env.CORS_ORIGIN ?? "").includes("localhost")) {
    console.warn(
      "[warn] CORS_ORIGIN includes 'localhost' while NODE_ENV=production — confirm this is intentional."
    );
  }
}
