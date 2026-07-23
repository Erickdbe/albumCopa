import { useState } from "react";
import { useForm } from "@mantine/form";
import { Alert, Button, Card, CopyButton, Group, NumberInput, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { apiFetch, ApiError } from "../api/client.js";

const COMPETITIONS = [
  { value: "BSA", label: "Brasileirao Serie A 2026 (sorteio)" },
  { value: "PD", label: "La Liga (PD)" },
  { value: "PL", label: "Premier League (PL)" },
  { value: "BL1", label: "Bundesliga (BL1)" },
  { value: "SA", label: "Serie A (SA)" },
  { value: "FL1", label: "Ligue 1 (FL1)" },
  { value: "CL", label: "Champions League (CL)" },
];

interface CreateRoomForm {
  name: string;
  competitionCode: string;
  clubCount: number;
  format: "round_robin" | "knockout" | "cup";
}

function isEliminationFormat(format: CreateRoomForm["format"]): boolean {
  return format === "knockout" || format === "cup";
}

function isBrazilianSerieA(competitionCode: string): boolean {
  return competitionCode === "BSA";
}

function clubCountOptions(values: CreateRoomForm) {
  const max = isBrazilianSerieA(values.competitionCode) ? 16 : 32;
  return [
    { value: "2", label: "2 clubes (final direta)" },
    { value: "4", label: "4 clubes" },
    { value: "8", label: "8 clubes" },
    { value: "16", label: "16 clubes" },
    ...(max >= 32 ? [{ value: "32", label: "32 clubes" }] : []),
  ];
}

export function CreateRoomPage() {
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<{
    id: string;
    name: string;
    clubCount: number;
    formatLabel: string;
    clubs: { name: string; shortName: string }[];
  } | null>(null);

  const form = useForm<CreateRoomForm>({
    initialValues: { name: "", competitionCode: "BSA", clubCount: 8, format: "round_robin" },
  });

  async function handleSubmit(values: CreateRoomForm) {
    setError(null);
    setCreating(true);
    try {
      const room = await apiFetch<{
        id: string;
        name: string;
        clubCount: number;
        formatLabel: string;
        clubs: { name: string; shortName: string }[];
      }>("/leagues", { method: "POST", body: values });
      setCreatedRoom(room);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar a sala");
    } finally {
      setCreating(false);
    }
  }

  if (createdRoom) {
    return (
      <Card withBorder shadow="sm" radius="md" p="lg" maw={480}>
        <Title order={2} mb="xs">
          Sala criada!
        </Title>
        <Text size="sm" c="dimmed" mb="xs">
          Modalidade: {createdRoom.formatLabel}
        </Text>
        <Text mb="sm">
          <strong>{createdRoom.name}</strong> com {createdRoom.clubCount} clubes sorteados. Essa sala e privada e nao
          aparece na lista publica de ligas. Compartilhe o ID abaixo com quem voce quiser que entre.
        </Text>
        <Group>
          <TextInput value={createdRoom.id} readOnly style={{ flex: 1 }} />
          <CopyButton value={createdRoom.id}>
            {({ copied, copy }) => (
              <Button color={copied ? "teal" : "green"} onClick={copy}>
                {copied ? "Copiado!" : "Copiar"}
              </Button>
            )}
          </CopyButton>
        </Group>
        {createdRoom.clubs.length > 0 && (
          <Stack gap={4} mt="md">
            <Text fw={700} size="sm">
              Clubes sorteados
            </Text>
            {createdRoom.clubs.map((club) => (
              <Text key={club.shortName} size="sm">
                {club.shortName} - {club.name}
              </Text>
            ))}
          </Stack>
        )}
      </Card>
    );
  }

  return (
    <Card withBorder shadow="sm" radius="md" p="lg" maw={480}>
      <Title order={2} mb="md">
        Criar sala privada
      </Title>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput label="Nome da sala" placeholder="Liga dos Amigos" required {...form.getInputProps("name")} />
          <Select
            label="Competicao"
            data={COMPETITIONS}
            required
            value={form.values.competitionCode}
            onChange={(value) => {
              const nextCompetition = value ?? "BSA";
              form.setFieldValue("competitionCode", nextCompetition);
              if (isBrazilianSerieA(nextCompetition)) {
                if (isEliminationFormat(form.values.format) && form.values.clubCount > 16) {
                  form.setFieldValue("clubCount", 16);
                } else if (!isEliminationFormat(form.values.format) && form.values.clubCount > 20) {
                  form.setFieldValue("clubCount", 20);
                }
              }
            }}
          />
          <Select
            label="Modalidade"
            data={[
              { value: "round_robin", label: "Pontos corridos" },
              { value: "knockout", label: "Mata-mata" },
              { value: "cup", label: "Copa" },
            ]}
            required
            value={form.values.format}
            onChange={(value) => {
              const nextFormat = (value ?? "round_robin") as CreateRoomForm["format"];
              form.setFieldValue("format", nextFormat);
              const allowedCounts = clubCountOptions({ ...form.values, format: nextFormat }).map((option) => Number(option.value));
              if (isEliminationFormat(nextFormat) && !allowedCounts.includes(form.values.clubCount)) {
                form.setFieldValue("clubCount", 8);
              }
            }}
          />
          <Text size="xs" c="dimmed">
            No Brasileirao, os clubes reais da Serie A 2026 sao sorteados ao criar a sala. Em outras competicoes, a API
            usa os clubes disponiveis e tambem sorteia os participantes.
          </Text>
          {isEliminationFormat(form.values.format) ? (
            <Select
              label="Quantidade de clubes"
              data={clubCountOptions(form.values)}
              value={String(form.values.clubCount)}
              onChange={(value) => form.setFieldValue("clubCount", Number(value ?? 8))}
              required
            />
          ) : (
            <NumberInput
              label="Quantidade de clubes"
              min={2}
              max={isBrazilianSerieA(form.values.competitionCode) ? 20 : 40}
              required
              {...form.getInputProps("clubCount")}
            />
          )}
          {error && (
            <Alert color="red" title="Erro">
              {error}
            </Alert>
          )}
          <Button type="submit" loading={creating}>
            Criar sala
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
