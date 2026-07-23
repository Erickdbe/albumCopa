import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm, type UseFormReturnType } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  Progress,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { apiFetch, ApiError } from "../api/client.js";
import { ALLOWED_FORMATIONS, MENTALITIES, starsForOverall, type Club, type Mentality, type Player } from "../api/types.js";

interface TacticsFormValues {
  formation: string;
  mentality: Mentality;
  pressing: number;
  width: number;
  tempo: number;
}

interface UnitStrength {
  attack: number;
  midfield: number;
  defense: number;
  goalkeeping: number;
  overall: number;
}

const POSITION_ORDER = ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];

const MENTALITY_LABELS: Record<Mentality, string> = {
  defensive: "Defensiva",
  balanced: "Equilibrada",
  offensive: "Ofensiva",
};

function TacticSlider({
  field,
  label,
  form,
}: {
  field: keyof Pick<TacticsFormValues, "pressing" | "width" | "tempo">;
  label: string;
  form: UseFormReturnType<TacticsFormValues>;
}) {
  return (
    <div>
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Badge variant="light">{form.values[field]}</Badge>
      </Group>
      <Slider min={0} max={100} value={form.values[field]} onChange={(value) => form.setFieldValue(field, value)} />
    </div>
  );
}

function positionRank(position: string): number {
  const rank = POSITION_ORDER.indexOf(position);
  return rank === -1 ? POSITION_ORDER.length : rank;
}

function sortPlayers(players: Player[], starterIds: string[]): Player[] {
  const selected = new Set(starterIds);
  return [...players].sort((a, b) => {
    const selectedDiff = Number(selected.has(b.id)) - Number(selected.has(a.id));
    if (selectedDiff !== 0) return selectedDiff;
    const positionDiff = positionRank(a.position) - positionRank(b.position);
    if (positionDiff !== 0) return positionDiff;
    return b.overall - a.overall;
  });
}

function pickDefaultStarters(players: Player[], savedIds: string[] | undefined): string[] {
  if (savedIds?.length === 11) {
    const ids = new Set(players.map((player) => player.id));
    const saved = savedIds.filter((id) => ids.has(id));
    if (saved.length === 11 && saved.some((id) => players.find((player) => player.id === id)?.position === "GK")) {
      return saved;
    }
  }

  const goalkeeper = players
    .filter((player) => player.position === "GK")
    .sort((a, b) => b.overall - a.overall)[0];
  const outfield = players
    .filter((player) => player.position !== "GK")
    .sort((a, b) => b.overall - a.overall)
    .slice(0, goalkeeper ? 10 : 11);

  return goalkeeper ? [goalkeeper.id, ...outfield.map((player) => player.id)] : outfield.map((player) => player.id);
}

function average(values: number[]): number {
  if (values.length === 0) return 50;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function attr(player: Player, key: keyof Player): number {
  const value = player[key];
  return typeof value === "number" ? value : player.overall;
}

function calculateStrength(players: Player[], mentality: Mentality): UnitStrength {
  const attackers = players.filter((player) => ["AM", "LW", "RW", "ST"].includes(player.position));
  const midfielders = players.filter((player) => ["DM", "CM", "AM"].includes(player.position));
  const defenders = players.filter((player) => ["CB", "LB", "RB"].includes(player.position));
  const keeper = players.find((player) => player.position === "GK");
  const avgCondition = average(players.map((player) => player.fitness * 0.6 + player.morale * 0.4));
  const condition = 0.75 + (avgCondition / 100) * 0.35;
  const attackMod = mentality === "offensive" ? 1.08 : mentality === "defensive" ? 0.93 : 1;
  const defenseMod = mentality === "defensive" ? 1.08 : mentality === "offensive" ? 0.93 : 1;

  const attack = average(attackers.flatMap((player) => [attr(player, "finishing"), attr(player, "passing"), attr(player, "dribbling")])) * attackMod * condition;
  const midfield = average(midfielders.flatMap((player) => [attr(player, "passing"), attr(player, "stamina"), attr(player, "tackling")])) * condition;
  const defense = average(defenders.flatMap((player) => [attr(player, "tackling"), attr(player, "strength")])) * defenseMod * condition;
  const goalkeeping = keeper ? average([attr(keeper, "gkReflexes"), attr(keeper, "gkPositioning")]) * condition : 40;
  const overall = attack * 0.3 + midfield * 0.25 + defense * 0.25 + goalkeeping * 0.2;

  return {
    attack: Math.round(attack),
    midfield: Math.round(midfield),
    defense: Math.round(defense),
    goalkeeping: Math.round(goalkeeping),
    overall: Math.round(overall),
  };
}

function ageFromBirthDate(birthDate: string | undefined): string {
  if (!birthDate) return "-";
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return "-";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return String(age);
}

function formatMoney(value: string | null | undefined): string {
  if (!value) return "-";
  return `R$ ${Number(value).toLocaleString("pt-BR")}`;
}

function StrengthLine({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <Group justify="space-between" mb={4}>
        <Text size="sm">{label}</Text>
        <Text size="sm" fw={700}>
          {value}
        </Text>
      </Group>
      <Progress value={Math.max(0, Math.min(100, value))} />
    </div>
  );
}

export function TacticsPage() {
  const navigate = useNavigate();
  const [club, setClub] = useState<Club | null>(null);
  const [starterIds, setStarterIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<TacticsFormValues>({
    initialValues: {
      formation: ALLOWED_FORMATIONS[0],
      mentality: "balanced",
      pressing: 50,
      width: 50,
      tempo: 50,
    },
  });

  const players = club?.players ?? [];
  const selectedPlayers = useMemo(
    () => starterIds.map((id) => players.find((player) => player.id === id)).filter((player): player is Player => Boolean(player)),
    [players, starterIds]
  );
  const sortedPlayers = useMemo(() => sortPlayers(players, starterIds), [players, starterIds]);
  const strength = useMemo(() => calculateStrength(selectedPlayers, form.values.mentality), [selectedPlayers, form.values.mentality]);
  const hasGoalkeeper = selectedPlayers.some((player) => player.position === "GK");
  const ready = selectedPlayers.length === 11 && hasGoalkeeper;

  useEffect(() => {
    apiFetch<Club>("/clubs/mine")
      .then((clubData) => {
        setClub(clubData);
        form.setValues({
          formation: clubData.formation,
          mentality: clubData.tacticStyle?.mentality ?? "balanced",
          pressing: clubData.tacticStyle?.pressing ?? 50,
          width: clubData.tacticStyle?.width ?? 50,
          tempo: clubData.tacticStyle?.tempo ?? 50,
        });
        setStarterIds(pickDefaultStarters(clubData.players ?? [], clubData.tacticStyle?.starterIds));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Falha ao carregar clube"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleStarter(player: Player) {
    setStarterIds((current) => {
      if (current.includes(player.id)) {
        return current.filter((id) => id !== player.id);
      }
      if (current.length >= 11) {
        notifications.show({ color: "yellow", message: "O time titular ja tem 11 jogadores." });
        return current;
      }
      return [...current, player.id];
    });
  }

  async function handleSubmit(values: TacticsFormValues) {
    if (!club) return;
    if (!ready) {
      setError("Escolha 11 titulares com pelo menos um goleiro.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/clubs/${club.id}`, {
        method: "PATCH",
        body: {
          formation: values.formation,
          tacticStyle: {
            mentality: values.mentality,
            pressing: values.pressing,
            width: values.width,
            tempo: values.tempo,
            starterIds,
          },
        },
      });
      notifications.show({ color: "green", message: "Tatica salva!" });
      navigate("/season");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar tatica");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    );
  }

  if (!club) {
    return (
      <Stack>
        <Alert color="red" title="Erro">
          {error ?? "Voce precisa reivindicar um clube primeiro."}
        </Alert>
        <Button component={Link} to="/dashboard" variant="light" w="fit-content">
          Voltar ao dashboard
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>Tatica</Title>
          <Text c="dimmed" size="sm">
            {club.name} - {selectedPlayers.length}/11 titulares
          </Text>
        </div>
        <Button component={Link} to="/season" variant="light">
          Temporada
        </Button>
      </Group>

      <form onSubmit={form.onSubmit(handleSubmit)}>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card withBorder shadow="sm" radius="md" p="lg">
            <Stack>
              <Title order={4}>Plano de jogo</Title>
              <Select label="Formacao" data={[...ALLOWED_FORMATIONS]} {...form.getInputProps("formation")} />
              <Select
                label="Mentalidade"
                data={MENTALITIES.map((mentality) => ({ value: mentality, label: MENTALITY_LABELS[mentality] }))}
                {...form.getInputProps("mentality")}
              />
              <TacticSlider field="pressing" label="Pressao" form={form} />
              <TacticSlider field="width" label="Largura" form={form} />
              <TacticSlider field="tempo" label="Ritmo" form={form} />
            </Stack>
          </Card>

          <Card withBorder shadow="sm" radius="md" p="lg">
            <Stack>
              <Group justify="space-between">
                <Title order={4}>Forca do XI</Title>
                <Badge color={ready ? "green" : "yellow"}>{ready ? "Pronto" : "Incompleto"}</Badge>
              </Group>
              <Group>
                <Badge size="lg" variant="filled">
                  Geral {strength.overall}
                </Badge>
                <Badge variant="light">{MENTALITY_LABELS[form.values.mentality]}</Badge>
                <Badge variant="light">{form.values.formation}</Badge>
              </Group>
              <StrengthLine label="Ataque" value={strength.attack} />
              <StrengthLine label="Meio" value={strength.midfield} />
              <StrengthLine label="Defesa" value={strength.defense} />
              <StrengthLine label="Goleiro" value={strength.goalkeeping} />
              <Group gap="xs">
                <Badge color={selectedPlayers.length === 11 ? "green" : "yellow"}>{selectedPlayers.length}/11</Badge>
                <Badge color={hasGoalkeeper ? "green" : "red"}>{hasGoalkeeper ? "GK ok" : "Sem GK"}</Badge>
              </Group>
            </Stack>
          </Card>
        </SimpleGrid>

        <Card withBorder shadow="sm" radius="md" p="lg" mt="md">
          <Group justify="space-between" mb="sm">
            <Title order={4}>Elenco</Title>
            <Group>
              {error && <Badge color="red">{error}</Badge>}
              <Button type="submit" loading={saving}>
                Salvar tatica
              </Button>
            </Group>
          </Group>

          <div style={{ overflowX: "auto" }}>
            <Table striped highlightOnHover verticalSpacing="xs" miw={820}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Titular</Table.Th>
                  <Table.Th>Pos</Table.Th>
                  <Table.Th>Jogador</Table.Th>
                  <Table.Th>Idade</Table.Th>
                  <Table.Th>Forca</Table.Th>
                  <Table.Th>Pot</Table.Th>
                  <Table.Th>Fis</Table.Th>
                  <Table.Th>Moral</Table.Th>
                  <Table.Th>Salario</Table.Th>
                  <Table.Th>Contrato</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedPlayers.map((player) => {
                  const isStarter = starterIds.includes(player.id);
                  return (
                    <Table.Tr key={player.id}>
                      <Table.Td>
                        <Checkbox
                          checked={isStarter}
                          onChange={() => toggleStarter(player)}
                          aria-label={`Titular ${player.name}`}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light">{player.position}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text fw={isStarter ? 700 : 400}>{player.name}</Text>
                        {player.injuryStatus && (
                          <Text size="xs" c="red">
                            {player.injuryStatus}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>{ageFromBirthDate(player.birthDate)}</Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <Text size="sm" fw={700}>
                            {player.overall}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {starsForOverall(player.overall)}/5
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>{player.potential}</Table.Td>
                      <Table.Td>{player.fitness}</Table.Td>
                      <Table.Td>{player.morale}</Table.Td>
                      <Table.Td>{formatMoney(player.wage)}</Table.Td>
                      <Table.Td>{player.contractEndDate ? new Date(player.contractEndDate).getFullYear() : "-"}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>
        </Card>
      </form>
    </Stack>
  );
}
