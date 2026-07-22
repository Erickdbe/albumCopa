import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch, getStoredToken, setStoredToken } from "../api/client.js";
import type { AuthResponse, AuthUser } from "../api/types.js";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, a stored token doesn't tell us the token is still valid (it
  // may have expired) — GET /auth/me both restores the user and verifies
  // the token in one request.
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<{ user: AuthUser }>("/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => setStoredToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await apiFetch<AuthResponse>("/auth/login", { method: "POST", body: { email, password } });
    setStoredToken(res.token);
    setUser(res.user);
  }

  async function register(email: string, password: string, username: string) {
    const res = await apiFetch<AuthResponse>("/auth/register", {
      method: "POST",
      body: { email, password, username },
    });
    setStoredToken(res.token);
    setUser(res.user);
  }

  function logout() {
    setStoredToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
