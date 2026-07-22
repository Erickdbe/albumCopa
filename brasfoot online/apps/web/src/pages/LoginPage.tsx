import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "@mantine/form";
import { Paper, Title, Tabs, TextInput, PasswordInput, Button, Alert, Stack } from "@mantine/core";
import { useAuth } from "../auth/AuthContext.js";
import { ApiError } from "../api/client.js";

export function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({
    initialValues: { email: "", password: "", username: "" },
    validate: {
      email: (value) => (value.trim() ? null : "Email é obrigatório"),
      password: (value) => (value.length >= 8 ? null : "Mínimo 8 caracteres"),
      username: (value) => (mode === "register" && !value.trim() ? "Nome de usuário é obrigatório" : null),
    },
  });

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(values.email, values.password);
      } else {
        await register(values.email, values.password, values.username);
      }
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Algo deu errado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper withBorder shadow="md" p="xl" radius="md">
      <Title order={2} ta="center" mb="md">
        ⚽ BrFut
      </Title>

      <Tabs value={mode} onChange={(value) => setMode(value as "login" | "register")} mb="md">
        <Tabs.List grow>
          <Tabs.Tab value="login">Entrar</Tabs.Tab>
          <Tabs.Tab value="register">Registrar</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput label="Email" placeholder="voce@email.com" required {...form.getInputProps("email")} />
          <PasswordInput label="Senha" placeholder="mín. 8 caracteres" required {...form.getInputProps("password")} />
          {mode === "register" && (
            <TextInput label="Nome de usuário" placeholder="seu_usuario" required {...form.getInputProps("username")} />
          )}
          {error && (
            <Alert color="red" title="Erro">
              {error}
            </Alert>
          )}
          <Button type="submit" loading={submitting} fullWidth>
            {mode === "login" ? "Entrar" : "Registrar"}
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}
