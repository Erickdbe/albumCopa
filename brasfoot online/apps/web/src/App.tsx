import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, Link, useNavigate } from "react-router-dom";
import { MantineProvider, AppShell, Group, Button, Text, Anchor, Loader, Center, Container } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { TacticsPage } from "./pages/TacticsPage.js";
import { MatchPage } from "./pages/MatchPage.js";
import { MarketPage } from "./pages/MarketPage.js";
import { CreateRoomPage } from "./pages/CreateRoomPage.js";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return (
      <Center mih="100vh">
        <Container size="xs" w="100%">
          {children}
        </Container>
      </Center>
    );
  }

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Text fw={700} size="lg">
              ⚽ BrFut
            </Text>
            <Anchor component={Link} to="/dashboard">
              Dashboard
            </Anchor>
            <Anchor component={Link} to="/match">
              Partida ao vivo
            </Anchor>
            <Anchor component={Link} to="/market">
              Mercado
            </Anchor>
            <Anchor component={Link} to="/create-room">
              Criar sala
            </Anchor>
          </Group>
          <Group>
            <Text c="dimmed">{user.username}</Text>
            <Button
              variant="light"
              size="xs"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              Sair
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="md">{children}</Container>
      </AppShell.Main>
    </AppShell>
  );
}

export function App() {
  return (
    <MantineProvider defaultColorScheme="light" theme={{ primaryColor: "green" }}>
      <Notifications />
      <BrowserRouter basename="/brasfoot-online">
        <AuthProvider>
          <Shell>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <DashboardPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/tactics"
                element={
                  <RequireAuth>
                    <TacticsPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/match"
                element={
                  <RequireAuth>
                    <MatchPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/market"
                element={
                  <RequireAuth>
                    <MarketPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/create-room"
                element={
                  <RequireAuth>
                    <CreateRoomPage />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Shell>
        </AuthProvider>
      </BrowserRouter>
    </MantineProvider>
  );
}
