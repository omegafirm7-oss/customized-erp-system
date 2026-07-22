import { InvoiceList } from "../components/InvoiceList";
import { InvoiceForm } from "../components/InvoiceForm";

export function SalesInvoicesPage() {
  return <InvoiceList side="ar" />;
}

export function NewSalesInvoicePage() {
  return <InvoiceForm side="ar" />;
}
