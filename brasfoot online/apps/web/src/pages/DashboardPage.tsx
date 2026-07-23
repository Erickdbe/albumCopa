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
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { apiFetch, ApiError } from "../api/client.js";
import {
  starsForOverall,
  type Club,
  type ClubSummary,
  type League,
  type Player,
  type SeasonMatch,
  type SeasonPayload,
  type SeasonStanding,
} from "../api/types.js";

function formatMoney(value: string | number | null | undefined): string {
  return `R$ ${Number(value ?? 0).toLocaleString("pt-BR")}`;
}

function wageBill(players: Player[]): number {
  return players.reduce((sum, player) => sum + Number(player.wage ?? 0), 0);
}

function averageOverall(players: Player[]): number {
  if (players.length === 0) return 0;
  return Math.round(players.reduce((sum, player) => sum + player.overall, 0) / players.length);
}

function matchInvolvesClub(match: SeasonMatch, clubId: string): boolean {
  return match.homeClub.id === clubId || match.awayClub.id === clubId;
}

function opponentName(match: SeasonMatch, clubId: string): string {
  return match.homeClub.id === clubId ? match.awayClub.name : match.homeClub.name;
}

function venueLabel(match: SeasonMatch, clubId: string): string {
  return match.homeClub.id === clubId ? "Casa" : "Fora";
}

function resultNews(match: SeasonMatch, clubId: string): string {
  const homeScore = match.homeScore ?? 0;
  const awayScore = match.awayScore ?? 0;
  const clubScore = match.homeClub.id === clubId ? homeScore : awayScore;
  const rivalScore = match.homeClub.id === clubId ? awayScore : homeScore;
  const rival = opponentName(match, clubId);
  const result = clubScore > rivalScore ? "venceu" : clubScore < rivalScore ? "perdeu" : "empatou";
  return `${match.homeClub.shortName} ${homeScore} x ${awayScore} ${match.awayClub.shortName}: seu time ${result} contra ${rival}.`;
}

function collectClubMatches(season: SeasonPayload | null, clubId: string, status: SeasonMatch["status"]): SeasonMatch[] {
  if (!season) return [];
  return season.rounds
    .flatMap((round) => round.matches)
    .filter((match) => match.status === status && matchInvolvesClub(match, clubId));
}

function buildNews(
  club: Club,
  season: SeasonPayload | null,
  standing: SeasonStanding | undefined,
  nextMatch: SeasonMatch | undefined,
  lastMatch: SeasonMatch | undefined,
  bestPlayer: Player | undefined
): string[] {
  const items: string[] = [];
  if (lastMatch) items.push(resultNews(lastMatch, club.id));
  if (nextMatch) items.push(`Proximo compromisso: ${venueLabel(nextMatch, club.id)} contra ${opponentName(nextMatch, club.id)}.`);
  if (standing) items.push(`${club.shortName} esta em ${standing.points} pontos, com saldo de gols ${standing.goalDifference}.`);
  if (season?.champion) items.push(`${season.champion.name} levantou a taca da temporada.`);
  if (bestPlayer) items.push(`${bestPlayer.name} e o destaque do elenco com forca ${bestPlayer.overall}.`);
  items.push(`Folha salarial estimada: ${formatMoney(wageBill(club.players ?? []))} por rodada.`);
  return items.slice(0, 5);
}

export function DashboardPage() {
  const [club, setClub] = useState<Club | null>(null);
  const [season, setSeason] = useState<SeasonPayload | null>(null);
  const [loadingClub, setLoadingClub] = useState(true);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [leagueClubs, setLeagueClubs] = useState<ClubSummary[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomIdInput, setRoomIdInput] = useState("");
  const [joiningRoom, setJoiningRoom] = useState(false);

  useEffect(() => {
    loadMyClub();
  }, []);

  async function loadMyClub() {
    setLoadingClub(true);
    try {
      const data = await apiFetch<Club>("/clubs/mine");
      setClub(data);
      if (data.leagueId) {
        const seasonData = await apiFetch<SeasonPayload>(`/leagues/${data.leagueId}/season`);
        setSeason(seasonData);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setClub(null);
        loadLeagues();
      } else {
        setError(err instanceof ApiError ? err.message : "Falha ao carregar clube");
      }
    } finally {
      setLoadingClub(false);
    }
  }

  async function loadLeagues() {
    try {
      const data = await apiFetch<{ leagues: League[] }>("/leagues");
      setLeagues(data.leagues);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar ligas");
    }
  }

  async function selectLeague(leagueId: string) {
    setSelectedLeagueId(leagueId);
    setError(null);
    try {
      const data = await apiFetch<{ clubs: ClubSummary[] }>(`/leagues/${leagueId}/clubs`);
      setLeagueClubs(data.clubs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar clubes");
    }
  }

  async function joinRoomById() {
    const leagueId = roomIdInput.trim();
    if (!leagueId) return;
    setJoiningRoom(true);
    setError(null);
    try {
      await apiFetch(`/leagues/${leagueId}`);
      await selectLeague(leagueId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sala nao encontrada");
    } finally {
      setJoiningRoom(false);
    }
  }

  async function claim(clubId: string) {
    setClaimingId(clubId);
    setError(null);
    try {
      await apiFetch(`/clubs/${clubId}/claim`, { method: "POST" });
      notifications.show({ color: "green", message: "Clube reivindicado!" });
      await loadMyClub();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao reivindicar clube");
    } finally {
      setClaimingId(null);
    }
  }

  const managerData = useMemo(() => {
    if (!club) return null;
    const players = club.players ?? [];
    const upcoming = collectClubMatches(season, club.id, "SCHEDULED").sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    );
    const finished = collectClubMatches(season, club.id, "FINISHED").sort(
      (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
    );
    const standing = season?.standings.find((item) => item.clubId === club.id);
    const positionIndex = season?.standings.findIndex((item) => item.clubId === club.id);
    const bestPlayer = [...players].sort((a, b) => b.overall - a.overall)[0];

    return {
      players,
      nextMatch: upcoming[0],
      lastMatch: finished[0],
      standing,
      leaguePosition: positionIndex !== undefined && positionIndex >= 0 ? positionIndex + 1 : null,
      bestPlayer,
      averageOverall: averageOverall(players),
      payroll: wageBill(players),
      news: buildNews(club, season, standing, upcoming[0], finished[0], bestPlayer),
    };
  }, [club, season]);

  if (loadingClub) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    );
  }

  if (club && managerData) {
    return (
      <Stack gap="md">
        <Card withBorder shadow="sm" radius="md" p="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={2}>{club.name}</Title>
              <Group gap="xs" mt="xs">
                <Badge color="green" variant="light">
                  {formatMoney(club.balance)}
                </Badge>
                <Badge color="blue" variant="light">
                  Rep {club.reputation}
                </Badge>
                <Badge color="gray" variant="light">
                  {club.formation}
                </Badge>
                {season && <Badge variant="light">{season.league.formatLabel}</Badge>}
              </Group>
            </div>
            <Group>
              <Button component={Link} to="/tactics" variant="filled">
                Tatica
              </Button>
              <Button component={Link} to="/season" variant="light">
                Temporada
              </Button>
              <Button component={Link} to="/market" variant="light">
                Mercado
              </Button>
            </Group>
          </Group>
        </Card>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          <Card withBorder shadow="sm" radius="md" p="lg">
            <Text c="dimmed" size="sm">
              Saldo
            </Text>
            <Title order={3}>{formatMoney(club.balance)}</Title>
          </Card>
          <Card withBorder shadow="sm" radius="md" p="lg">
            <Text c="dimmed" size="sm">
              Classificacao
            </Text>
            <Title order={3}>{managerData.leaguePosition ? `${managerData.leaguePosition}o` : "-"}</Title>
            {managerData.standing && (
              <Text size="sm" c="dimmed">
                {managerData.standing.points} pts
              </Text>
            )}
          </Card>
          <Card withBorder shadow="sm" radius="md" p="lg">
            <Text c="dimmed" size="sm">
              Estadio
            </Text>
            <Title order={3}>{club.stadiumCapacity.toLocaleString("pt-BR")}</Title>
            <Text size="sm" c="dimmed">
              {club.stadiumName}
            </Text>
          </Card>
          <Card withBorder shadow="sm" radius="md" p="lg">
            <Text c="dimmed" size="sm">
              Elenco
            </Text>
            <Title order={3}>{managerData.averageOverall}</Title>
            <Text size="sm" c="dimmed">
              Folha {formatMoney(managerData.payroll)}
            </Text>
          </Card>
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card withBorder shadow="sm" radius="md" p="lg">
            <Title order={4} mb="sm">
              Proximo jogo
            </Title>
            {managerData.nextMatch ? (
              <Stack gap={4}>
                <Text fw={700}>
                  {managerData.nextMatch.homeClub.name} x {managerData.nextMatch.awayClub.name}
                </Text>
                <Text c="dimmed" size="sm">
                  Rodada {season?.rounds.find((round) => round.matches.some((match) => match.id === managerData.nextMatch?.id))?.label}
                </Text>
                <Badge w="fit-content" variant="light">
                  {venueLabel(managerData.nextMatch, club.id)}
                </Badge>
              </Stack>
            ) : (
              <Text c="dimmed">Sem jogo agendado.</Text>
            )}
          </Card>

          <Card withBorder shadow="sm" radius="md" p="lg">
            <Title order={4} mb="sm">
              Noticias
            </Title>
            <Stack gap="xs">
              {managerData.news.map((item) => (
                <Text key={item} size="sm">
                  {item}
                </Text>
              ))}
            </Stack>
          </Card>
        </SimpleGrid>

        <Card withBorder shadow="sm" radius="md" p="lg">
          <Group justify="space-between" mb="sm">
            <Title order={4}>Elenco</Title>
            <Badge variant="light">{managerData.players.length} jogadores</Badge>
          </Group>
          <div style={{ overflowX: "auto" }}>
            <Table striped highlightOnHover verticalSpacing="xs" miw={760}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Pos</Table.Th>
                  <Table.Th>Nome</Table.Th>
                  <Table.Th>Nivel</Table.Th>
                  <Table.Th>Forca</Table.Th>
                  <Table.Th>Pot</Table.Th>
                  <Table.Th>Fis</Table.Th>
                  <Table.Th>Salario</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...managerData.players]
                  .sort((a, b) => b.overall - a.overall)
                  .slice(0, 18)
                  .map((player) => (
                    <Table.Tr key={player.id}>
                      <Table.Td>
                        <Badge variant="light">{player.position}</Badge>
                      </Table.Td>
                      <Table.Td>{player.name}</Table.Td>
                      <Table.Td>{starsForOverall(player.overall)}/5</Table.Td>
                      <Table.Td>{player.overall}</Table.Td>
                      <Table.Td>{player.potential}</Table.Td>
                      <Table.Td>{player.fitness}</Table.Td>
                      <Table.Td>{formatMoney(player.wage)}</Table.Td>
                    </Table.Tr>
                  ))}
              </Table.Tbody>
            </Table>
          </div>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack>
      <Title order={2}>Voce ainda nao gerencia nenhum clube</Title>
      {error && (
        <Alert color="red" title="Erro">
          {error}
        </Alert>
      )}

      <Card withBorder shadow="sm" radius="md" p="lg">
        <Title order={4} mb="sm">
          Entrar numa sala privada
        </Title>
        <Group>
          <TextInput
            placeholder="ID da sala"
            value={roomIdInput}
            onChange={(e) => setRoomIdInput(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button loading={joiningRoom} onClick={joinRoomById}>
            Entrar
          </Button>
        </Group>
      </Card>

      <Card withBorder shadow="sm" radius="md" p="lg">
        <Title order={4} mb="sm">
          Escolha uma liga
        </Title>
        <Group>
          {leagues.map((league) => (
            <Button
              key={league.id}
              variant={selectedLeagueId === league.id ? "filled" : "light"}
              onClick={() => selectLeague(league.id)}
            >
              {league.name} ({league.country})
            </Button>
          ))}
        </Group>
      </Card>

      {selectedLeagueId && (
        <Card withBorder shadow="sm" radius="md" p="lg">
          <Title order={4} mb="sm">
            Clubes
          </Title>
          <Table verticalSpacing="xs">
            <Table.Tbody>
              {leagueClubs.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    {c.name} ({c.shortName})
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">Rep {c.reputation}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {c.isClaimed ? (
                      <Badge color="gray">Ja reivindicado</Badge>
                    ) : (
                      <Button size="xs" loading={claimingId === c.id} onClick={() => claim(c.id)}>
                        Reivindicar
                      </Button>
                    )}
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
