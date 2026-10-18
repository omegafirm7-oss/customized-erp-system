import { useAuth } from "../auth/AuthContext";

/** True when the signed-in user's token carries the given permission key. */
export function useHasPermission(key: string): boolean {
  const { user } = useAuth();
  return !!user?.permissions?.includes(key);
}
