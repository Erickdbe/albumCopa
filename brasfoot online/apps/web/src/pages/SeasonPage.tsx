import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { apiFetch, ApiError } from "../api/client.js";
import type { Club, SeasonMatch, SeasonPayload, SeasonRound } from "../api/types.js";

interface SimulateResponse {
  enqueued: number;
  season: SeasonPayload;
}

function statusColor(status: SeasonMatch["status"]) {
  if (status === "FINISHED") return "gray";
  if (status === "LIVE") return "green";
  return "yellow";
}

function scoreText(match: SeasonMatch) {
  if (match.status !== "FINISHED") return "x";
  return `${match.homeScore ?? 0} x ${match.awayScore ?? 0}`;
}

function winnerName(match: SeasonMatch) {
  if (!match.winnerClubId) return null;
  if (match.winnerClubId === match.homeClub.id) return match.homeClub.name;
  if (match.winnerClubId === match.awayClub.id) return match.awayClub.name;
  return null;
}

function isEliminationFormat(format: string) {
  return format === "knockout" || format === "cup";
}

export function SeasonPage() {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [season, setSeason] = useState<SeasonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentRound = useMemo<SeasonRound | null>(() => {
    if (!season?.currentRoundNumber) return null;
    return season.rounds.find((round) => round.roundNumber === season.currentRoundNumber) ?? null;
  }, [season]);
  const hasScheduledMatches = useMemo(
    () => season?.rounds.some((round) => round.scheduledCount > 0) ?? false,
    [season]
  );

  async function loadSeason() {
    setError(null);
    try {
      let activeLeagueId = leagueId;
      if (!activeLeagueId) {
        const club = await apiFetch<Club>("/clubs/mine");
        if (!club.leagueId) throw new Error("Seu clube nao esta em uma liga");
        activeLeagueId = club.leagueId;
        setLeagueId(activeLeagueId);
      }

      const data = await apiFetch<SeasonPayload>(`/leagues/${activeLeagueId}/season`);
      setSeason(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Falha ao carregar temporada");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSeason();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!season || !hasScheduledMatches) return;
    const timer = setInterval(() => {
      loadSeason();
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season?.league.id, season?.currentRoundNumber, hasScheduledMatches]);

  async function simulateCurrentRound() {
    if (!leagueId || !currentRound) return;
    setSimulating(true);
    try {
      const response = await apiFetch<SimulateResponse>(
        `/leagues/${leagueId}/season/rounds/${currentRound.roundNumber}/simulate`,
        { method: "POST" }
      );
      setSeason(response.season);
      notifications.show({
        color: response.enqueued > 0 ? "green" : "blue",
        message:
          response.enqueued > 0
            ? `${response.enqueued} jogo(s) enviados para simulacao`
            : "Competicao atualizada",
      });
      setTimeout(() => loadSeason(), 1500);
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Falha ao simular rodada" });
    } finally {
      setSimulating(false);
    }
  }

  if (loading) {
    return (
      <Center h={240}>
        <Loader />
      </Center>
    );
  }

  if (error) {
    return (
      <Stack>
        <Alert color="red" title="Erro">
          {error}
        </Alert>
        <Button component={Link} to="/dashboard" variant="light">
          Ir para o dashboard
        </Button>
      </Stack>
    );
  }

  if (!season?.season) {
    return (
      <Alert color="yellow" title="Sem temporada">
        Esta liga ainda nao tem temporada ativa.
      </Alert>
    );
  }

  const canClickSeasonButton = currentRound && !simulating && !season.champion;
  const seasonButtonLabel =
    currentRound?.scheduledCount && currentRound.scheduledCount > 0
      ? isEliminationFormat(season.league.format)
        ? "Simular fase"
        : "Simular rodada"
      : isEliminationFormat(season.league.format)
        ? "Gerar proxima fase"
        : "Finalizar campeonato";

  return (
    <Stack>
      <Card withBorder shadow="sm" radius="md" p="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>{season.league.name}</Title>
            <Group gap="xs" mt="xs">
              <Badge color={isEliminationFormat(season.league.format) ? "red" : "green"}>{season.league.formatLabel}</Badge>
              <Badge variant="light">{season.season.name}</Badge>
              <Badge color={season.season.status === "FINISHED" ? "gray" : "blue"}>{season.season.status}</Badge>
            </Group>
          </div>
          <Button loading={simulating} disabled={!canClickSeasonButton} onClick={simulateCurrentRound}>
            {seasonButtonLabel}
          </Button>
        </Group>
        {season.champion && (
          <Alert color="green" mt="md" title="Campeao">
            {season.champion.name}
          </Alert>
        )}
      </Card>

      {currentRound && (
        <Card withBorder shadow="sm" radius="md" p="lg">
          <Group justify="space-between" mb="sm">
            <Title order={3}>{currentRound.label}</Title>
            <Text size="sm" c="dimmed">
              {currentRound.finishedCount}/{currentRound.totalMatches} jogos finalizados
            </Text>
          </Group>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Casa</Table.Th>
                <Table.Th>Placar</Table.Th>
                <Table.Th>Fora</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {currentRound.matches.map((match) => (
                <Table.Tr key={match.id}>
                  <Table.Td>
                    <Text fw={match.winnerClubId === match.homeClub.id ? 700 : 400}>{match.homeClub.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text fw={700}>{scoreText(match)}</Text>
                    {isEliminationFormat(season.league.format) && winnerName(match) && (
                      <Text size="xs" c="dimmed">
                        Avanca: {winnerName(match)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text fw={match.winnerClubId === match.awayClub.id ? 700 : 400}>{match.awayClub.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={statusColor(match.status)}>{match.status}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button component={Link} to={`/match?matchId=${match.id}`} size="xs" variant="light">
                      Ao vivo
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <Card withBorder shadow="sm" radius="md" p="lg">
        <Title order={3} mb="sm">
          Calendario
        </Title>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Rodada/Fase</Table.Th>
              <Table.Th>Jogos</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {season.rounds.map((round) => (
              <Table.Tr key={round.roundNumber}>
                <Table.Td>{round.label}</Table.Td>
                <Table.Td>{round.totalMatches}</Table.Td>
                <Table.Td>
                  <Badge color={round.isComplete ? "green" : round.scheduledCount > 0 ? "yellow" : "gray"}>
                    {round.isComplete ? "Completa" : `${round.finishedCount}/${round.totalMatches}`}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {season.league.format === "round_robin" && (
        <Card withBorder shadow="sm" radius="md" p="lg">
          <Title order={3} mb="sm">
            Classificacao
          </Title>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>Clube</Table.Th>
                <Table.Th>J</Table.Th>
                <Table.Th>V</Table.Th>
                <Table.Th>E</Table.Th>
                <Table.Th>D</Table.Th>
                <Table.Th>SG</Table.Th>
                <Table.Th>Pts</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {season.standings.map((standing, index) => (
                <Table.Tr key={standing.clubId}>
                  <Table.Td>{index + 1}</Table.Td>
                  <Table.Td>{standing.clubName}</Table.Td>
                  <Table.Td>{standing.played}</Table.Td>
                  <Table.Td>{standing.wins}</Table.Td>
                  <Table.Td>{standing.draws}</Table.Td>
                  <Table.Td>{standing.losses}</Table.Td>
                  <Table.Td>{standing.goalDifference}</Table.Td>
                  <Table.Td>
                    <Text fw={700}>{standing.points}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}
