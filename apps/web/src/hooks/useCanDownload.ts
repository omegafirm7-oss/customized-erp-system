import { useAuth } from "../auth/AuthContext";

/** True only for the platform admin — every download/export button is gated on this. */
export function useCanDownload(): boolean {
  const { user } = useAuth();
  return !!user?.isPlatformAdmin;
}
