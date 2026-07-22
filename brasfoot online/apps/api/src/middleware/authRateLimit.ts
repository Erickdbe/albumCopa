import rateLimit from "express-rate-limit";

/** Throttles brute-force/credential-stuffing attempts. Keyed by IP
 * (express-rate-limit's default) — fine for a single-instance dev/MVP
 * deployment; a shared store (Redis) would be needed once the API runs
 * behind multiple instances.
 *
 * Login and register each get their own instance (own counter) — sharing
 * one budget between them would mean a burst of failed logins from an IP
 * also blocks legitimate signups from that same IP, which isn't the
 * intent. */
function createAuthRateLimit() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts, please try again later" },
  });
}

export const loginRateLimit = createAuthRateLimit();
export const registerRateLimit = createAuthRateLimit();
