import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Card, Title, Text, TextInput, Button, Group, Stack, Timeline, Badge } from "@mantine/core";

const REALTIME_URL = import.meta.env.VITE_REALTIME_URL ?? window.location.origin;

// Minimal local shapes mirroring @brfut/shared-types' realtime contracts —
// duplicated here rather than imported so this proof-of-pipeline page has
// no build-time dependency on the workspace TS source resolution.
interface SimMatchEvent {
  minute: number;
  second: number;
  type: string;
  teamSide: "home" | "away";
  playerId?: string;
  relatedPlayerId?: string;
}

interface MatchSnapshot {
  matchId: string;
  homeScore: number;
  awayScore: number;
  elapsedMinute: number;
  eventsSoFar: SimMatchEvent[];
  status: "SCHEDULED" | "LIVE" | "FINISHED";
}

export function MatchPage() {
  const [matchId, setMatchId] = useState("");
  const [joinedMatchId, setJoinedMatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<MatchSnapshot["status"] | null>(null);
  const [score, setScore] = useState({ home: 0, away: 0 });
  const [events, setEvents] = useState<SimMatchEvent[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(REALTIME_URL);
    socketRef.current = socket;

    socket.on("match:snapshot", (snapshot: MatchSnapshot) => {
      setStatus(snapshot.status);
      setScore({ home: snapshot.homeScore, away: snapshot.awayScore });
      setEvents(snapshot.eventsSoFar);
    });

    socket.on("match:event", ({ event }: { event: SimMatchEvent }) => {
      setEvents((prev) => [...prev, event]);
    });

    socket.on("match:score", (payload: { homeScore: number; awayScore: number }) => {
      setScore({ home: payload.homeScore, away: payload.awayScore });
      setStatus("LIVE");
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  function handleJoin() {
    if (!matchId.trim()) return;
    socketRef.current?.emit("match:join", { matchId: matchId.trim() });
    setJoinedMatchId(matchId.trim());
    setEvents([]);
    setScore({ home: 0, away: 0 });
  }

  return (
    <Stack>
      <Card withBorder shadow="sm" radius="md" p="lg">
        <Title order={2} mb="xs">
          Partida ao vivo
        </Title>
        <Text c="dimmed" size="sm" mb="md">
          Cole um Match id (veja a saída do seed ou consulte a API), entre na room e acompanhe os eventos chegando do
          gateway de tempo real no ritmo configurado da liga.
        </Text>

        <Group>
          <TextInput
            value={matchId}
            onChange={(e) => setMatchId(e.currentTarget.value)}
            placeholder="matchId"
            style={{ flex: 1 }}
          />
          <Button onClick={handleJoin}>Join</Button>
        </Group>
      </Card>

      {joinedMatchId && (
        <Card withBorder shadow="sm" radius="md" p="lg">
          <Group justify="space-between" mb="md">
            <Title order={2}>
              {score.home} — {score.away}
            </Title>
            <Badge color={status === "LIVE" ? "green" : status === "FINISHED" ? "gray" : "yellow"}>
              {status ?? "connecting..."}
            </Badge>
          </Group>

          <Timeline active={events.length} bulletSize={20} lineWidth={2}>
            {events.map((event, i) => (
              <Timeline.Item key={i} title={`${event.minute}' — ${event.type}`}>
                <Text size="sm" c="dimmed">
                  [{event.teamSide}]{event.playerId ? ` player ${event.playerId.slice(0, 8)}` : ""}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Card>
      )}
    </Stack>
  );
}
