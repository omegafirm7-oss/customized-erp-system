import { useAuth } from "../auth/AuthContext";

/** True when the user may change a purchase-invoice line's evidence (the same permission the upload route needs). */
export function useCanEditEvidence(): boolean {
  const { user } = useAuth();
  return !!user?.permissions?.includes("ap.invoice.create");
}
