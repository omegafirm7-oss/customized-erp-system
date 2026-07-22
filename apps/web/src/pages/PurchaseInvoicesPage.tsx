import { InvoiceList } from "../components/InvoiceList";
import { InvoiceForm } from "../components/InvoiceForm";

export function PurchaseInvoicesPage() {
  return <InvoiceList side="ap" />;
}

export function NewPurchaseInvoicePage() {
  return <InvoiceForm side="ap" />;
}
