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
}

export function CreateRoomPage() {
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<{ id: string; name: string; clubCount: number } | null>(null);

  const form = useForm<CreateRoomForm>({
    initialValues: { name: "", competitionCode: "PD", clubCount: 10 },
  });

  async function handleSubmit(values: CreateRoomForm) {
    setError(null);
    setCreating(true);
    try {
      const room = await apiFetch<{ id: string; name: string; clubCount: number }>("/leagues", {
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
          <Text size="xs" c="dimmed">
            Disponibilidade de cada competição depende do plano grátis da sua chave football-data.org — só a La Liga
            (PD) foi confirmada nesta sessão.
          </Text>
          <NumberInput
            label="Quantidade de clubes"
            min={2}
            max={40}
            required
            {...form.getInputProps("clubCount")}
          />
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
