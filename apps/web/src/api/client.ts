import axios, { AxiosError } from "axios";

export const apiClient = axios.create({
  baseURL: "/api",
  withCredentials: true, // sends the httpOnly refresh-token cookie
});

let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;
// Set around an intentional logout so a request that was already in flight
// (or the read of the now-revoked refresh cookie it triggers) doesn't race
// the interceptor's own hard-redirect below — AuthContext's logout() already
// clears state and the router's own `if (!user) <Navigate to="/login">`
// handles the redirect client-side, with no full-page reload/flash.
let loggingOut = false;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setLoggingOut(value: boolean) {
  loggingOut = value;
}

/**
 * Single-flight refresh: ALL refresh attempts (the AuthProvider's initial
 * session restore and the 401-retry interceptor below) must go through this
 * function. The server rotates the refresh token on every use and treats
 * presentation of an already-rotated token as a compromise signal that
 * revokes the whole session — so two concurrent refresh calls with the same
 * cookie (e.g. React StrictMode double-mounting AuthProvider in dev) would
 * log the user out. Sharing one in-flight promise makes that impossible
 * within a page load.
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post("/auth/refresh")
      .then((res) => {
        const token = (res.data as { accessToken: string }).accessToken;
        setAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const isRefreshCall = original?.url?.includes("/auth/refresh");
    if (error.response?.status === 401 && original && !original._retry && !isRefreshCall) {
      original._retry = true;
      try {
        await refreshAccessToken();
        return apiClient.request(original);
      } catch {
        setAccessToken(null);
        if (!loggingOut && window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  },
);
