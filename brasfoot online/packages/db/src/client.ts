import { PrismaClient } from "../generated/client/index.js";

export const prisma = new PrismaClient();

export * from "../generated/client/index.js";
export * from "./market.js";
export * from "./leagueSetup.js";
export * from "./fallbackPlayers.js";
