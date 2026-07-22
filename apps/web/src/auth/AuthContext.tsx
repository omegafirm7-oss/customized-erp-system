import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiClient, refreshAccessToken, setAccessToken } from "../api/client";
import { decodeAccessToken, DecodedAccessToken } from "./jwt";

interface AuthContextValue {
  user: DecodedAccessToken | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DecodedAccessToken | null>(null);
  const [loading, setLoading] = useState(true);

  const applyToken = useCallback((token: string) => {
    setAccessToken(token);
    setUser(decodeAccessToken(token));
  }, []);

  useEffect(() => {
    // Restore the session from the httpOnly refresh cookie on load — via the
    // single-flight refreshAccessToken so a StrictMode double-mount can't
    // fire two rotations of the same token (which the server treats as
    // token-reuse and punishes by revoking the whole session).
    refreshAccessToken()
      .then((token) => applyToken(token))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [applyToken]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiClient.post("/auth/login", { email, password });
      applyToken(res.data.accessToken);
    },
    [applyToken],
  );

  const logout = useCallback(async () => {
    await apiClient.post("/auth/logout");
    setAccessToken(null);
    setUser(null);
  }, []);

  const switchCompany = useCallback(
    async (companyId: string) => {
      const res = await apiClient.post("/auth/switch-company", { companyId });
      applyToken(res.data.accessToken);
    },
    [applyToken],
  );

  const value = useMemo(() => ({ user, loading, login, logout, switchCompany }), [user, loading, login, logout, switchCompany]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
