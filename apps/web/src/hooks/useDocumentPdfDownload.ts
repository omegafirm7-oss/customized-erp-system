import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { useTemplateSettings } from "./useTemplateSettings";
import { downloadCommercialDocumentPdf, CommercialDocumentLine, FiscalBlock } from "../utils/documentPdf";

interface CurrentCompany {
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
    (params: {
      docTypeLabel: string;
      documentNumber: string;
      documentDate: string;
      partnerLabel: string;
      partner: { name: string; code: string; taxRegistrationNumber?: string | null };
      lines: CommercialDocumentLine[];
      fiscal?: FiscalBlock | null;
    }) => {
      // Pakistan: "Sales Tax" + seller NTN instead of VAT / VAT number.
      const isPakistan = company?.countryCode === "PK";
      const address = company ? [company.addressLine1, company.addressLine2, company.city].filter(Boolean).join(", ") : "";
      downloadCommercialDocumentPdf({
        cycle,
        companyName: company?.legalName ?? "",
        companyAddress: address || null,
        companyTaxNumber: (isPakistan ? company?.ntn : company?.taxRegistrationNumber) ?? null,
        taxLabel: isPakistan ? "Sales Tax" : "VAT",
        taxNumberLabel: isPakistan ? "NTN" : "VAT Reg. No",
        ...params,
        branding: settings
          ? {
              logoDataUrl,
              accentColor: settings.accentColor,
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
