const EXTERNAL_API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const BRFUT_TOKEN_STORAGE_KEY = "brfut_token";
const ALBUM_TOKEN_STORAGE_KEY = "mp_token";

export function isAlbumIntegratedMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return (
    window.location.pathname.startsWith("/brasfoot-online") &&
    (params.get("online") === "1" || params.has("room") || Boolean(localStorage.getItem(ALBUM_TOKEN_STORAGE_KEY)))
  );
}

function getApiUrl(): string {
  return isAlbumIntegratedMode() ? "/api/brasfoot" : EXTERNAL_API_URL;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(BRFUT_TOKEN_STORAGE_KEY) || localStorage.getItem(ALBUM_TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(BRFUT_TOKEN_STORAGE_KEY, token);
    if (isAlbumIntegratedMode()) localStorage.setItem(ALBUM_TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(BRFUT_TOKEN_STORAGE_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

interface ApiFetchOptions {
  method?: string;
  body?: unknown;
}

/** Every backend error response is `{ error: string }` (see apps/api's
 * errorHandler.ts and route validation) — this surfaces that message
 * directly instead of a generic "request failed". */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const token = getStoredToken();

  const res = await fetch(`${getApiUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }

  return data as T;
}
