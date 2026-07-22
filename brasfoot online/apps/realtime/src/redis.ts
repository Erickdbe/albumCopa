import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// Socket.io's Redis adapter requires its own dedicated pub/sub pair
// (a client in subscriber mode can't run other commands).
export const pubClient = new Redis(redisUrl);
export const subClient = pubClient.duplicate();

// Separate client for plain commands (XRANGE, etc.) so we never fight the
// pub/sub clients' subscribed state.
export const dataClient = new Redis(redisUrl);
