import type { SimMatchEvent } from "@brfut/shared-types";
import { dataClient } from "./redis.js";

function fieldsToObject(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return obj;
}

export interface ParsedStream {
  events: SimMatchEvent[];
  finalScore: { homeScore: number; awayScore: number } | null;
}

/** Reads the full event log the worker published for a match's simulation run. */
export async function readMatchStream(matchId: string): Promise<ParsedStream> {
  const streamKey = `match:${matchId}:events`;
  const entries = await dataClient.xrange(streamKey, "-", "+");

  const events: SimMatchEvent[] = [];
  let finalScore: ParsedStream["finalScore"] = null;

  for (const [, fields] of entries) {
    const obj = fieldsToObject(fields);
    if (obj.type === "STREAM_END") {
      const metadata = JSON.parse(obj.metadata || "{}");
      finalScore = { homeScore: metadata.homeScore ?? 0, awayScore: metadata.awayScore ?? 0 };
      continue;
    }
    events.push({
      minute: Number(obj.minute),
      second: Number(obj.second),
      type: obj.type as SimMatchEvent["type"],
      teamSide: obj.teamSide as SimMatchEvent["teamSide"],
      playerId: obj.playerId || undefined,
      relatedPlayerId: obj.relatedPlayerId || undefined,
      metadata: obj.metadata ? JSON.parse(obj.metadata) : undefined,
    });
  }

  return { events, finalScore };
}
