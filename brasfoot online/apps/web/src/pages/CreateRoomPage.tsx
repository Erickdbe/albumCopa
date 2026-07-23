import { useState } from "react";
import { useForm } from "@mantine/form";
import { Card, Title, Text, TextInput, NumberInput, Select, Button, Stack, Alert, CopyButton, Group } from "@mantine/core";
import { apiFetch, ApiError } from "../api/client.js";

const COMPETITIONS = [
  { value: "PD", label: "La Liga (PD) — confirmado funcionando" },
  { value: "PL", label: "Premier League (PL)" },
  { value: "BL1", label: "Bundesliga (BL1)" },
  { value: "SA", label: "Serie A (SA)" },
  { value: "FL1", label: "Ligue 1 (FL1)" },
  { value: "BSA", label: "Brasileirão (BSA)" },
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

export function CreateRoomPage() {
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<{
    id: string;
    name: string;
    clubCount: number;
    formatLabel: string;
  } | null>(null);

  const form = useForm<CreateRoomForm>({
    initialValues: { name: "", competitionCode: "PD", clubCount: 8, format: "round_robin" },
  });

  async function handleSubmit(values: CreateRoomForm) {
    setError(null);
    setCreating(true);
    try {
      const room = await apiFetch<{ id: string; name: string; clubCount: number; formatLabel: string }>("/leagues", {
        method: "POST",
        body: values,
      });
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
          <strong>{createdRoom.name}</strong> com {createdRoom.clubCount} clubes. Essa sala é privada — não aparece na
          lista pública de ligas. Compartilhe o ID abaixo com quem você quiser que entre.
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
            label="Competição"
            data={COMPETITIONS}
            required
            {...form.getInputProps("competitionCode")}
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
              if (isEliminationFormat(nextFormat) && ![2, 4, 8, 16, 32].includes(form.values.clubCount)) {
                form.setFieldValue("clubCount", 8);
              }
            }}
          />
          <Text size="xs" c="dimmed">
            Disponibilidade de cada competição depende do plano grátis da sua chave football-data.org — só a La Liga
            (PD) foi confirmada nesta sessão.
          </Text>
          {isEliminationFormat(form.values.format) ? (
            <Select
              label="Quantidade de clubes"
              data={[
                { value: "2", label: "2 clubes (final direta)" },
                { value: "4", label: "4 clubes" },
                { value: "8", label: "8 clubes" },
                { value: "16", label: "16 clubes" },
                { value: "32", label: "32 clubes" },
              ]}
              value={String(form.values.clubCount)}
              onChange={(value) => form.setFieldValue("clubCount", Number(value ?? 8))}
              required
            />
          ) : (
            <NumberInput
              label="Quantidade de clubes"
              min={2}
              max={40}
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
