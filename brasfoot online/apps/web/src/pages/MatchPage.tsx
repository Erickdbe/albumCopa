import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Timeline,
  Title,
} from "@mantine/core";
import { apiFetch, ApiError } from "../api/client.js";
import type { MatchReport, MatchReportEvent, MatchReportLineup, MatchReportStatLine } from "../api/types.js";

const REALTIME_URL = import.meta.env.VITE_REALTIME_URL ?? "http://localhost:4001";

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

const EVENT_LABELS: Record<string, string> = {
  KICK_OFF: "Inicio",
  HALF_TIME: "Intervalo",
  FULL_TIME: "Fim de jogo",
  GOAL: "Gol",
  PENALTY_GOAL: "Gol de penalti",
  PENALTY_MISSED: "Penalti perdido",
  OWN_GOAL: "Gol contra",
  CHANCE_MISSED: "Chance perdida",
  YELLOW_CARD: "Cartao amarelo",
  RED_CARD: "Cartao vermelho",
  INJURY: "Lesao",
  SUBSTITUTION: "Substituicao",
};

function isReportEvent(event: SimMatchEvent | MatchReportEvent): event is MatchReportEvent {
  return "id" in event;
}

function playerName(event: SimMatchEvent | MatchReportEvent): string {
  if (isReportEvent(event)) {
    return event.player?.name ?? "";
  }
  return event.playerId ? `Jogador ${event.playerId.slice(0, 8)}` : "";
}

function assistName(event: SimMatchEvent | MatchReportEvent): string {
  if (isReportEvent(event)) {
    return event.relatedPlayer?.name ? ` assistencia ${event.relatedPlayer.name}` : "";
  }
  return event.relatedPlayerId ? ` assistencia ${event.relatedPlayerId.slice(0, 8)}` : "";
}

function eventTitle(event: SimMatchEvent | MatchReportEvent): string {
  const label = EVENT_LABELS[event.type] ?? event.type;
  return `${event.minute}' - ${label}`;
}

function eventDescription(event: SimMatchEvent | MatchReportEvent): string {
  const name = playerName(event);
  const assist = assistName(event);
  const side = event.teamSide === "home" ? "Mandante" : "Visitante";
  return [side, name, assist].filter(Boolean).join(" - ");
}

function statRows(label: string, home: number, away: number) {
  return (
    <Table.Tr>
      <Table.Td>{label}</Table.Td>
      <Table.Td ta="center">{home}</Table.Td>
      <Table.Td ta="center">{away}</Table.Td>
    </Table.Tr>
  );
}

function StatsTable({
  homeName,
  awayName,
  home,
  away,
}: {
  homeName: string;
  awayName: string;
  home: MatchReportStatLine;
  away: MatchReportStatLine;
}) {
  return (
    <Table verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Estatistica</Table.Th>
          <Table.Th ta="center">{homeName}</Table.Th>
          <Table.Th ta="center">{awayName}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {statRows("Finalizacoes", home.shots, away.shots)}
        {statRows("Chances", home.chances, away.chances)}
        {statRows("Gols", home.goals, away.goals)}
        {statRows("Amarelos", home.yellowCards, away.yellowCards)}
        {statRows("Vermelhos", home.redCards, away.redCards)}
        {statRows("Lesoes", home.injuries, away.injuries)}
      </Table.Tbody>
    </Table>
  );
}

function RatingsTable({ lineups }: { lineups: MatchReportLineup[] }) {
  const rated = [...lineups]
    .filter((lineup) => lineup.rating !== null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  if (rated.length === 0) {
    return <Text c="dimmed">Notas aparecem apos a simulacao.</Text>;
  }

  return (
    <Table striped highlightOnHover verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Jogador</Table.Th>
          <Table.Th>Clube</Table.Th>
          <Table.Th>Pos</Table.Th>
          <Table.Th>Nota</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rated.slice(0, 12).map((lineup) => (
          <Table.Tr key={lineup.id}>
            <Table.Td>{lineup.player.name}</Table.Td>
            <Table.Td>{lineup.club.shortName}</Table.Td>
            <Table.Td>{lineup.position}</Table.Td>
            <Table.Td>
              <Badge color={(lineup.rating ?? 0) >= 7 ? "green" : "gray"}>{lineup.rating?.toFixed(1)}</Badge>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function MatchPage() {
  const [searchParams] = useSearchParams();
  const initialMatchId = searchParams.get("matchId") ?? "";
  const [matchId, setMatchId] = useState(initialMatchId);
  const [joinedMatchId, setJoinedMatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<MatchSnapshot["status"] | null>(null);
  const [score, setScore] = useState({ home: 0, away: 0 });
  const [events, setEvents] = useState<SimMatchEvent[]>([]);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const loadReport = useCallback(async (id: string) => {
    setReportLoading(true);
    setError(null);
    try {
      const data = await apiFetch<MatchReport>(`/matches/${id}/report`);
      setReport(data);
      if (data.homeScore !== null && data.awayScore !== null) {
        setScore({ home: data.homeScore, away: data.awayScore });
      }
      setStatus((current) => current ?? data.status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar partida");
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    const socket = io(REALTIME_URL);
    socketRef.current = socket;

    socket.on("match:snapshot", (snapshot: MatchSnapshot) => {
      setStatus(snapshot.status);
      setScore({ home: snapshot.homeScore, away: snapshot.awayScore });
      setEvents(snapshot.eventsSoFar);
      if (snapshot.status === "FINISHED") {
        void loadReport(snapshot.matchId);
      }
    });

    socket.on("match:event", ({ event }: { event: SimMatchEvent }) => {
      setEvents((prev) => [...prev, event]);
    });

    socket.on("match:score", (payload: { homeScore: number; awayScore: number }) => {
      setScore({ home: payload.homeScore, away: payload.awayScore });
      setStatus("LIVE");
    });

    if (initialMatchId) {
      socket.emit("match:join", { matchId: initialMatchId });
      setJoinedMatchId(initialMatchId);
      void loadReport(initialMatchId);
    }

    return () => {
      socket.disconnect();
    };
  }, [initialMatchId, loadReport]);

  function handleJoin() {
    const nextMatchId = matchId.trim();
    if (!nextMatchId) return;
    socketRef.current?.emit("match:join", { matchId: nextMatchId });
    setJoinedMatchId(nextMatchId);
    setEvents([]);
    setScore({ home: 0, away: 0 });
    setReport(null);
    void loadReport(nextMatchId);
  }

  const visibleEvents = useMemo<(SimMatchEvent | MatchReportEvent)[]>(() => {
    return events.length > 0 ? events : report?.events ?? [];
  }, [events, report]);

  const homeName = report?.homeClub.shortName ?? "Casa";
  const awayName = report?.awayClub.shortName ?? "Fora";
  const shownStatus = status ?? report?.status ?? null;

  return (
    <Stack gap="md">
      <Card withBorder shadow="sm" radius="md" p="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>Partida</Title>
            <Text c="dimmed" size="sm">
              Ao vivo e relatorio
            </Text>
          </div>
          <Badge color={shownStatus === "LIVE" ? "green" : shownStatus === "FINISHED" ? "gray" : "yellow"}>
            {shownStatus ?? "Aguardando"}
          </Badge>
        </Group>

        <Group mt="md">
          <TextInput
            value={matchId}
            onChange={(e) => setMatchId(e.currentTarget.value)}
            placeholder="matchId"
            style={{ flex: 1 }}
          />
          <Button onClick={handleJoin}>Entrar</Button>
        </Group>
      </Card>

      {error && (
        <Alert color="red" title="Erro">
          {error}
        </Alert>
      )}

      {joinedMatchId && (
        <>
          <Card withBorder shadow="sm" radius="md" p="lg">
            <Group justify="space-between" mb="md">
              <div>
                <Text c="dimmed" size="sm">
                  {report?.league.name ?? "Campeonato"} - Rodada {report?.roundNumber ?? "-"}
                </Text>
                <Title order={2}>
                  {homeName} {score.home} x {score.away} {awayName}
                </Title>
              </div>
              {reportLoading && <Loader size="sm" />}
            </Group>

            {report && (
              <StatsTable
                homeName={report.homeClub.shortName}
                awayName={report.awayClub.shortName}
                home={report.stats.home}
                away={report.stats.away}
              />
            )}
          </Card>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Card withBorder shadow="sm" radius="md" p="lg">
              <Title order={4} mb="sm">
                Eventos
              </Title>
              <Timeline active={visibleEvents.length} bulletSize={20} lineWidth={2}>
                {visibleEvents.map((event, i) => (
                  <Timeline.Item key={isReportEvent(event) ? event.id : `${event.minute}-${event.second}-${i}`} title={eventTitle(event)}>
                    <Text size="sm" c="dimmed">
                      {eventDescription(event)}
                    </Text>
                  </Timeline.Item>
                ))}
              </Timeline>
              {visibleEvents.length === 0 && <Text c="dimmed">Sem eventos ainda.</Text>}
            </Card>

            <Card withBorder shadow="sm" radius="md" p="lg">
              <Title order={4} mb="sm">
                Notas
              </Title>
              {report ? <RatingsTable lineups={report.lineups} /> : <Text c="dimmed">Carregando relatorio.</Text>}
            </Card>
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
}
