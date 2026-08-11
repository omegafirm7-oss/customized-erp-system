import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { CoaPage } from "./pages/CoaPage";
import { JournalEntriesPage } from "./pages/JournalEntriesPage";
import { NewJournalEntryPage } from "./pages/NewJournalEntryPage";
import { TrialBalancePage } from "./pages/TrialBalancePage";
import { ProfitOrLossPage } from "./pages/ProfitOrLossPage";
import { FinancialPositionPage } from "./pages/FinancialPositionPage";
import { ChangesInEquityPage } from "./pages/ChangesInEquityPage";
import { CashFlowPage } from "./pages/CashFlowPage";
import { PartnersPage } from "./pages/PartnersPage";
import { PartnerDetailPage } from "./pages/PartnerDetailPage";
import { EditPurchaseInvoicePage } from "./pages/EditPurchaseInvoicePage";
import { ItemsPage } from "./pages/ItemsPage";
import { SalesInvoicesPage, NewSalesInvoicePage } from "./pages/SalesInvoicesPage";
import { PurchaseInvoicesPage, NewPurchaseInvoicePage } from "./pages/PurchaseInvoicesPage";
import { PurchaseQuotationsPage } from "./pages/PurchaseQuotationsPage";
import { PurchaseOrdersPage } from "./pages/PurchaseOrdersPage";
import { SalesQuotationsPage } from "./pages/SalesQuotationsPage";
import { SalesOrdersPage } from "./pages/SalesOrdersPage";
import { LeadsPage } from "./pages/crm/LeadsPage";
import { OpportunitiesPage } from "./pages/crm/OpportunitiesPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { NewPaymentPage } from "./pages/NewPaymentPage";
import { ArAgingPage, ApAgingPage } from "./pages/AgingPage";
import { VatReturnPage } from "./pages/VatReturnPage";
import { ZatcaSettingsPage } from "./pages/ZatcaSettingsPage";
import { TemplateSettingsPage } from "./pages/TemplateSettingsPage";
import { ActivityLogPage } from "./pages/ActivityLogPage";
import { StockSummaryPage } from "./pages/StockSummaryPage";
import { StockMovementsPage } from "./pages/StockMovementsPage";
import { StockTransferPage } from "./pages/StockTransferPage";
import { StockAdjustmentPage } from "./pages/StockAdjustmentPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectEquipmentTimesheetPage } from "./pages/ProjectEquipmentTimesheetPage";
import { ProjectCostCategoryPage } from "./pages/ProjectCostCategoryPage";
import { ProjectCostAccountDetailPage } from "./pages/ProjectCostAccountDetailPage";
import { ProjectLaborDetailPage } from "./pages/ProjectLaborDetailPage";
import { ProjectProfitabilityPage } from "./pages/ProjectProfitabilityPage";
import { WipSchedulePage } from "./pages/WipSchedulePage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { EmployeeDetailPage } from "./pages/EmployeeDetailPage";
import { EmployeeTimesheetDetailPage } from "./pages/EmployeeTimesheetDetailPage";
import { EmployeesOverviewPage } from "./pages/EmployeesOverviewPage";
import { ActiveEmployeesDetailPage } from "./pages/ActiveEmployeesDetailPage";
import { ReleasedEmployeesDetailPage } from "./pages/ReleasedEmployeesDetailPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { PlatformDashboardPage } from "./pages/PlatformDashboardPage";
import { UpdateTimesheetsPage } from "./pages/UpdateTimesheetsPage";
import { PayrollRunsPage } from "./pages/PayrollRunsPage";
import { PayrollRunDetailPage } from "./pages/PayrollRunDetailPage";
import { HrSettingsPage } from "./pages/HrSettingsPage";
import { GosiSummaryPage, EosbLeavePage } from "./pages/HrReportsPage";
import { ManpowerContractsPage } from "./pages/ManpowerContractsPage";
import { ManpowerContractDetailPage } from "./pages/ManpowerContractDetailPage";
import { TimesheetPage } from "./pages/TimesheetPage";
import { HiredEquipmentContractsPage } from "./pages/HiredEquipmentContractsPage";
import { HiredEquipmentContractDetailPage } from "./pages/HiredEquipmentContractDetailPage";
import { HiredEquipmentTimesheetPage } from "./pages/HiredEquipmentTimesheetPage";
import { ManpowerProfitabilityPage } from "./pages/ManpowerProfitabilityPage";
import { EquipmentPage } from "./pages/EquipmentPage";
import { EquipmentContractsPage } from "./pages/EquipmentContractsPage";
import { EquipmentContractDetailPage } from "./pages/EquipmentContractDetailPage";
import { UsageLogPage } from "./pages/UsageLogPage";
import { DepreciationRunsPage } from "./pages/DepreciationRunsPage";
import { EquipmentProfitabilityPage } from "./pages/EquipmentProfitabilityPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireCompany({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user?.activeCompanyId) return <Navigate to="/companies" replace />;
  return children;
}

const companyRoutes: Array<{ path: string; element: JSX.Element }> = [
  { path: "/coa", element: <CoaPage /> },
  { path: "/journal-entries", element: <JournalEntriesPage /> },
  { path: "/journal-entries/new", element: <NewJournalEntryPage /> },
  { path: "/partners", element: <PartnersPage /> },
  { path: "/partners/:id", element: <PartnerDetailPage /> },
  { path: "/items", element: <ItemsPage /> },
  { path: "/ar/invoices", element: <SalesInvoicesPage /> },
  { path: "/ar/invoices/new", element: <NewSalesInvoicePage /> },
  { path: "/ap/invoices", element: <PurchaseInvoicesPage /> },
  { path: "/ap/invoices/new", element: <NewPurchaseInvoicePage /> },
  { path: "/ap/invoices/:id/edit", element: <EditPurchaseInvoicePage /> },
  { path: "/ap/quotations", element: <PurchaseQuotationsPage /> },
  { path: "/ap/orders", element: <PurchaseOrdersPage /> },
  { path: "/ar/quotations", element: <SalesQuotationsPage /> },
  { path: "/ar/orders", element: <SalesOrdersPage /> },
  { path: "/crm/leads", element: <LeadsPage /> },
  { path: "/crm/opportunities", element: <OpportunitiesPage /> },
  { path: "/payments", element: <PaymentsPage /> },
  { path: "/payments/new", element: <NewPaymentPage /> },
  { path: "/trial-balance", element: <TrialBalancePage /> },
  { path: "/profit-or-loss", element: <ProfitOrLossPage /> },
  { path: "/financial-position", element: <FinancialPositionPage /> },
  { path: "/changes-in-equity", element: <ChangesInEquityPage /> },
  { path: "/cash-flow", element: <CashFlowPage /> },
  { path: "/reports/ar-aging", element: <ArAgingPage /> },
  { path: "/reports/ap-aging", element: <ApAgingPage /> },
  { path: "/reports/vat-return", element: <VatReturnPage /> },
  { path: "/settings/zatca", element: <ZatcaSettingsPage /> },
  { path: "/settings/templates", element: <TemplateSettingsPage /> },
  { path: "/settings/activity-log", element: <ActivityLogPage /> },
  { path: "/inventory/stock", element: <StockSummaryPage /> },
  { path: "/inventory/movements", element: <StockMovementsPage /> },
  { path: "/inventory/transfers", element: <StockTransferPage /> },
  { path: "/inventory/adjustments", element: <StockAdjustmentPage /> },
  { path: "/projects", element: <ProjectsPage /> },
  { path: "/projects/:id", element: <ProjectDetailPage /> },
  { path: "/projects/:id/equipment-timesheet", element: <ProjectEquipmentTimesheetPage /> },
  { path: "/projects/:id/costs/labor", element: <ProjectLaborDetailPage /> },
  { path: "/projects/:id/costs/accounts/:accountId", element: <ProjectCostAccountDetailPage /> },
  { path: "/projects/:id/costs/:category", element: <ProjectCostCategoryPage /> },
  { path: "/reports/project-profitability", element: <ProjectProfitabilityPage /> },
  { path: "/reports/wip-schedule", element: <WipSchedulePage /> },
  { path: "/hr/employees", element: <EmployeesPage /> },
  { path: "/hr/employees/overview", element: <EmployeesOverviewPage /> },
  { path: "/hr/employees/overview/active", element: <ActiveEmployeesDetailPage /> },
  { path: "/hr/employees/overview/released", element: <ReleasedEmployeesDetailPage /> },
  { path: "/hr/employees/timesheets", element: <UpdateTimesheetsPage /> },
  { path: "/hr/employees/:id/timesheets", element: <EmployeeTimesheetDetailPage /> },
  { path: "/hr/employees/:id", element: <EmployeeDetailPage /> },
  { path: "/admin/users", element: <AdminUsersPage /> },
  { path: "/platform", element: <PlatformDashboardPage /> },
  { path: "/hr/payroll-runs", element: <PayrollRunsPage /> },
  { path: "/hr/payroll-runs/:id", element: <PayrollRunDetailPage /> },
  { path: "/hr/settings", element: <HrSettingsPage /> },
  { path: "/hr/reports/gosi-summary", element: <GosiSummaryPage /> },
  { path: "/hr/reports/eosb-leave", element: <EosbLeavePage /> },
  { path: "/manpower/contracts", element: <ManpowerContractsPage /> },
  { path: "/manpower/contracts/:id", element: <ManpowerContractDetailPage /> },
  { path: "/manpower/timesheets/:id", element: <TimesheetPage /> },
  { path: "/hired-equipment/contracts", element: <HiredEquipmentContractsPage /> },
  { path: "/hired-equipment/contracts/:id", element: <HiredEquipmentContractDetailPage /> },
  { path: "/hired-equipment/timesheets/:id", element: <HiredEquipmentTimesheetPage /> },
  { path: "/manpower/reports/profitability", element: <ManpowerProfitabilityPage /> },
  { path: "/equipment/units", element: <EquipmentPage /> },
  { path: "/equipment/contracts", element: <EquipmentContractsPage /> },
  { path: "/equipment/contracts/:id", element: <EquipmentContractDetailPage /> },
  { path: "/equipment/usage-logs/:id", element: <UsageLogPage /> },
  { path: "/equipment/depreciation", element: <DepreciationRunsPage /> },
  { path: "/equipment/reports/profitability", element: <EquipmentProfitabilityPage /> },
];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/companies" element={<CompaniesPage />} />
        {companyRoutes.map(({ path, element }) => (
          <Route key={path} path={path} element={<RequireCompany>{element}</RequireCompany>} />
        ))}
        <Route path="/" element={<Navigate to="/companies" replace />} />
      </Route>
    </Routes>
  );
}
