import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm, type UseFormReturnType } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { Card, Title, Select, Slider, Text, Button, Group, Stack, Alert, Center, Loader, Anchor } from "@mantine/core";
import { apiFetch, ApiError } from "../api/client.js";
import { ALLOWED_FORMATIONS, MENTALITIES, type Club, type Mentality } from "../api/types.js";

interface TacticsFormValues {
  formation: string;
  mentality: Mentality;
  pressing: number;
  width: number;
  tempo: number;
}

function TacticSlider({
  field,
  form,
}: {
  field: keyof TacticsFormValues;
  form: UseFormReturnType<TacticsFormValues>;
}) {
  return (
    <Slider min={0} max={100} value={form.values[field] as number} onChange={(value) => form.setFieldValue(field, value)} />
  );
}

export function TacticsPage() {
  const navigate = useNavigate();
  const [clubId, setClubId] = useState<string | null>(null);
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

  useEffect(() => {
    apiFetch<Club>("/clubs/mine")
      .then((clubData) => {
        setClubId(clubData.id);
        form.setValues({
          formation: clubData.formation,
          mentality: clubData.tacticStyle?.mentality ?? "balanced",
          pressing: clubData.tacticStyle?.pressing ?? 50,
          width: clubData.tacticStyle?.width ?? 50,
          tempo: clubData.tacticStyle?.tempo ?? 50,
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load club"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(values: TacticsFormValues) {
    if (!clubId) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/clubs/${clubId}`, {
        method: "PATCH",
        body: {
          formation: values.formation,
          tacticStyle: {
            mentality: values.mentality,
            pressing: values.pressing,
            width: values.width,
            tempo: values.tempo,
          },
        },
      });
      notifications.show({ color: "green", message: "Tática salva!" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
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

  if (!clubId) {
    return (
      <Stack>
        <Alert color="red" title="Erro">
          {error ?? "Você precisa reivindicar um clube primeiro."}
        </Alert>
        <Anchor component={Link} to="/dashboard">
          Voltar ao dashboard
        </Anchor>
      </Stack>
    );
  }

  return (
    <Card withBorder shadow="sm" radius="md" p="lg" maw={480}>
      <Title order={2} mb="md">
        Tática
      </Title>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <Select label="Formação" data={[...ALLOWED_FORMATIONS]} {...form.getInputProps("formation")} />
          <Select label="Mentalidade" data={MENTALITIES} {...form.getInputProps("mentality")} />

          <div>
            <Text size="sm" fw={500} mb={4}>
              Pressão ({form.values.pressing})
            </Text>
            <TacticSlider field="pressing" form={form} />
          </div>
          <div>
            <Text size="sm" fw={500} mb={4}>
              Largura ({form.values.width})
            </Text>
            <TacticSlider field="width" form={form} />
          </div>
          <div>
            <Text size="sm" fw={500} mb={4}>
              Ritmo ({form.values.tempo})
            </Text>
            <TacticSlider field="tempo" form={form} />
          </div>

          {error && (
            <Alert color="red" title="Erro">
              {error}
            </Alert>
          )}

          <Group>
            <Button type="submit" loading={saving}>
              Salvar
            </Button>
            <Button type="button" variant="default" onClick={() => navigate("/dashboard")}>
              Voltar
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}
