import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

export interface CompanyMembership {
  companyId: string;
  companyCode: string;
  companyName: string;
  roleName: string;
  isDefault: boolean;
}

export function useCompanies() {
  const [companies, setCompanies] = useState<CompanyMembership[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return apiClient
      .get<CompanyMembership[]>("/iam/me/companies")
      .then((res) => setCompanies(res.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { companies, loading, reload };
}
