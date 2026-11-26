import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { useTemplateSettings } from "./useTemplateSettings";
import { downloadCommercialDocumentPdf, CommercialDocumentExtras, CommercialDocumentLine, FiscalBlock } from "../utils/documentPdf";

interface CurrentCompany {
  crNumber?: string | null;
  baseCurrencyCode?: string;
  legalName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  taxRegistrationNumber: string | null;
  countryCode?: string;
  ntn?: string | null;
}

/** Shared by every Sales/Purchase list page's "PDF" button — bundles the
 * company/branding lookups that would otherwise be duplicated 5 times. */
export function useDocumentPdfDownload(cycle: "sales" | "purchase") {
  const { settings, logoDataUrl } = useTemplateSettings();
  const [company, setCompany] = useState<CurrentCompany | null>(null);

  useEffect(() => {
    apiClient.get<CurrentCompany>("/companies/current").then((res) => setCompany(res.data));
  }, []);

  const download = useCallback(
    (
      params: CommercialDocumentExtras & {
        docTypeLabel: string;
        documentNumber: string | null;
        documentDate: string;
        partnerLabel?: string;
        partner?: { name: string; code: string; taxRegistrationNumber?: string | null };
        lines: CommercialDocumentLine[];
        fiscal?: FiscalBlock | null;
      },
    ) => {
      // Pakistan: "Sales Tax" + seller NTN instead of VAT / VAT number.
      const isPakistan = company?.countryCode === "PK";
      // The street line is often a full pasted address already containing the city, so don't repeat parts.
      const addressParts: string[] = [];
      for (const part of company ? [company.addressLine1, company.addressLine2, company.city] : []) {
        const t = part?.trim();
        if (t && !addressParts.join(", ").toLowerCase().includes(t.toLowerCase())) addressParts.push(t);
      }
      const address = addressParts.join(", ");
      downloadCommercialDocumentPdf({
        cycle,
        companyName: company?.legalName ?? "",
        companyAddress: address || null,
        companyTaxNumber: (isPakistan ? company?.ntn : company?.taxRegistrationNumber) ?? null,
        companyCrNumber: company?.crNumber ?? null,
        currency: company?.baseCurrencyCode ?? null,
        taxLabel: isPakistan ? "Sales Tax" : "VAT",
        taxNumberLabel: isPakistan ? "NTN" : "VAT Reg. No",
        ...params,
        branding: settings
          ? {
              logoDataUrl,
              accentColor: settings.accentColor,
              headerTagline: settings.headerTagline,
              headerMissionLine: settings.headerMissionLine,
              footerText: settings.footerText,
              showAddress: settings.showAddressInHeader,
              showTaxNumber: settings.showTaxNumberInHeader,
              showItemCode: cycle === "sales" ? settings.salesShowItemCode : settings.purchaseShowItemCode,
              showVatBreakdown: cycle === "sales" ? settings.salesShowVatBreakdown : settings.purchaseShowVatBreakdown,
              termsText: cycle === "sales" ? settings.salesTermsText : settings.purchaseTermsText,
            }
          : undefined,
      });
    },
    [cycle, company, settings, logoDataUrl],
  );

  return { download };
}
