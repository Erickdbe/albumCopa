import rateLimit from "express-rate-limit";

/** Baseline throttle applied to every route — generous, just a backstop
 * against basic scripted abuse/scraping. Keyed by IP (express-rate-limit
 * default); a shared store (Redis) would be needed behind multiple
 * instances. Specific endpoints (auth, room creation) layer stricter
 * limits on top of this one. */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

/** POST /leagues calls out to football-data.org — that's a shared API key
 * with its own rate limit, so a burst of room-creation requests from one
 * IP can exhaust everyone's quota, not just that IP's. Much stricter than
 * the general limit. */
export const createRoomRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many rooms created recently, please try again later" },
});
