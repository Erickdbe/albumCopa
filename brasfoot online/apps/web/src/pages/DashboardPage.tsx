import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  Title,
  Text,
  Group,
  Stack,
  Button,
  Table,
  Badge,
  Rating,
  Alert,
  Center,
  Loader,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { apiFetch, ApiError } from "../api/client.js";
import { starsForOverall, type Club, type ClubSummary, type League } from "../api/types.js";

export function DashboardPage() {
  const [club, setClub] = useState<Club | null>(null);
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
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setClub(null);
        loadLeagues();
      } else {
        setError(err instanceof ApiError ? err.message : "Failed to load club");
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
      setError(err instanceof ApiError ? err.message : "Failed to load leagues");
    }
  }

  async function selectLeague(leagueId: string) {
    setSelectedLeagueId(leagueId);
    setError(null);
    try {
      const data = await apiFetch<{ clubs: ClubSummary[] }>(`/leagues/${leagueId}/clubs`);
      setLeagueClubs(data.clubs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load clubs");
    }
  }

  async function joinRoomById() {
    const leagueId = roomIdInput.trim();
    if (!leagueId) return;
    setJoiningRoom(true);
    setError(null);
    try {
      // Private rooms don't show up in GET /leagues — this looks one up
      // directly by ID, which is how the "invite link" works.
      await apiFetch(`/leagues/${leagueId}`);
      await selectLeague(leagueId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sala não encontrada");
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
      setError(err instanceof ApiError ? err.message : "Failed to claim club");
    } finally {
      setClaimingId(null);
    }
  }

  if (loadingClub) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    );
  }

  if (club) {
    return (
      <Stack>
        <Card withBorder shadow="sm" radius="md" p="lg">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={2}>{club.name}</Title>
              <Group gap="xs" mt="xs">
                <Badge color="green" variant="light">
                  R$ {Number(club.balance).toLocaleString("pt-BR")}
                </Badge>
                <Badge color="blue" variant="light">
                  Reputação {club.reputation}
                </Badge>
                <Badge color="gray" variant="light">
                  {club.formation}
                </Badge>
              </Group>
            </div>
            <Button component={Link} to="/tactics" variant="light">
              Editar tática
            </Button>
          </Group>
        </Card>

        <Card withBorder shadow="sm" radius="md" p="lg">
          <Title order={4} mb="sm">
            Elenco ({club.players?.length ?? 0})
          </Title>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Posição</Table.Th>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Nível</Table.Th>
                <Table.Th>Overall</Table.Th>
                <Table.Th>Potencial</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {club.players?.map((player) => (
                <Table.Tr key={player.id}>
                  <Table.Td>{player.position}</Table.Td>
                  <Table.Td>{player.name}</Table.Td>
                  <Table.Td>
                    <Rating value={starsForOverall(player.overall)} readOnly count={5} size="xs" />
                  </Table.Td>
                  <Table.Td>{player.overall}</Table.Td>
                  <Table.Td>{player.potential}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack>
      <Title order={2}>Você ainda não gerencia nenhum clube</Title>
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
                    <Badge variant="light">Reputação {c.reputation}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {c.isClaimed ? (
                      <Badge color="gray">Já reivindicado</Badge>
                    ) : (
                      <Button
                        size="xs"
                        loading={claimingId === c.id}
                        onClick={() => claim(c.id)}
                      >
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
