import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

export interface TemplateSettings {
  id: string;
  companyId: string;
  hasLogo: boolean;
  logoMimeType: string | null;
  headerTagline: string | null;
  headerMissionLine: string | null;
  accentColor: string;
  footerText: string | null;
  showAddressInHeader: boolean;
  showTaxNumberInHeader: boolean;
  timesheetTitle: string;
  timesheetShowIqama: boolean;
  timesheetShowDesignation: boolean;
  salesShowItemCode: boolean;
  salesShowVatBreakdown: boolean;
  salesTermsText: string | null;
  purchaseShowItemCode: boolean;
  purchaseShowVatBreakdown: boolean;
  purchaseTermsText: string | null;
}

/**
 * The `/settings/templates/logo` route requires the same JWT auth header as
 * every other API call, so a raw `<img src>` can't hit it directly — fetch
 * it as a blob (mirrors AttachmentViewer's pattern) and hand back an object
 * URL instead.
 */
export function useTemplateSettings() {
  const [settings, setSettings] = useState<TemplateSettings | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<TemplateSettings>("/settings/templates");
      setSettings(res.data);
      if (res.data.hasLogo) {
        const logoRes = await apiClient.get("/settings/templates/logo", { responseType: "blob" });
        const blob = logoRes.data as Blob;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        setLogoDataUrl(dataUrl);
      } else {
        setLogoDataUrl(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { settings, logoDataUrl, loading, reload };
}
