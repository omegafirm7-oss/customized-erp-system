import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useCompanies } from "../hooks/useCompanies";

interface NavSection {
  label: string;
  items: Array<{ to: string; label: string }>;
}

// Grouped for the finance team to navigate by function rather than hunt
// through one long flat list — every `to` path is unchanged from before,
// this only changes how the links are organized, not where they go.
const NAV_SECTIONS: NavSection[] = [
  {
    label: "Master Data",
    items: [
      { to: "/companies", label: "Companies" },
      { to: "/coa", label: "Chart of Accounts" },
      { to: "/partners", label: "Partners" },
      { to: "/items", label: "Items" },
    ],
  },
  {
    label: "Working Capital",
    items: [
      { to: "/ar/invoices", label: "Sales Invoices" },
      { to: "/ap/invoices", label: "Purchase Invoices" },
      { to: "/payments", label: "Payments" },
      { to: "/reports/ar-aging", label: "AR Aging" },
      { to: "/reports/ap-aging", label: "AP Aging" },
      { to: "/reports/vat-return", label: "VAT Return" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { to: "/inventory/stock", label: "Stock Summary" },
      { to: "/inventory/movements", label: "Stock Movements" },
      { to: "/inventory/transfers", label: "Stock Transfers" },
      { to: "/inventory/adjustments", label: "Stock Adjustments" },
    ],
  },
  {
    label: "Projects",
    items: [
      { to: "/projects", label: "Projects" },
      { to: "/reports/project-profitability", label: "Project Profitability" },
      { to: "/reports/wip-schedule", label: "WIP Schedule" },
    ],
  },
  {
    label: "HR & Payroll",
    items: [
      { to: "/hr/employees", label: "Employees" },
      { to: "/hr/employees/timesheets", label: "Update Timesheets" },
      { to: "/hr/payroll-runs", label: "Payroll Runs" },
      { to: "/hr/reports/gosi-summary", label: "GOSI Summary" },
      { to: "/hr/reports/eosb-leave", label: "EOSB & Leave" },
      { to: "/hr/settings", label: "HR Settings" },
    ],
  },
  {
    label: "Manpower",
    items: [
      { to: "/manpower/contracts", label: "Manpower Contracts" },
      { to: "/manpower/reports/profitability", label: "Manpower Profitability" },
    ],
  },
  {
    label: "Equipment",
    items: [
      { to: "/equipment/units", label: "Equipment" },
      { to: "/equipment/contracts", label: "Equipment Contracts" },
      { to: "/equipment/depreciation", label: "Depreciation" },
      { to: "/equipment/reports/profitability", label: "Equipment Profitability" },
    ],
  },
  {
    label: "Reporting",
    items: [
      { to: "/trial-balance", label: "Trial Balance" },
      { to: "/profit-or-loss", label: "Profit or Loss" },
      { to: "/financial-position", label: "Financial Position" },
      { to: "/changes-in-equity", label: "Changes in Equity" },
      { to: "/cash-flow", label: "Cash Flow" },
      { to: "/journal-entries", label: "Journal Entries" },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/settings/zatca", label: "ZATCA Settings" },
      { to: "/admin/users", label: "Users" },
    ],
  },
];

// Gated behind Company.enabledModules — only shown when the active
// company's platform admin has entitled it to "purchase" (or the viewer is
// the platform admin themself, who always sees every module).
const PURCHASE_SECTION: NavSection = {
  label: "Purchase",
  items: [
    { to: "/ap/quotations", label: "Purchase Quotations" },
    { to: "/ap/orders", label: "Purchase Orders" },
  ],
};

// Same entitlement-gating pattern as PURCHASE_SECTION, keyed on "sales".
const SALES_SECTION: NavSection = {
  label: "Sales & Marketing",
  items: [
    { to: "/ar/quotations", label: "Sales Quotations" },
    { to: "/ar/orders", label: "Sales Orders" },
  ],
};

// Same entitlement-gating pattern as PURCHASE_SECTION, keyed on "crm".
const CRM_SECTION: NavSection = {
  label: "CRM",
  items: [
    { to: "/crm/leads", label: "Leads" },
    { to: "/crm/opportunities", label: "Opportunities" },
  ],
};

function loadExpandedSections(): Set<string> {
  const stored = localStorage.getItem("sidebarExpandedSections");
  if (stored) {
    try {
      return new Set(JSON.parse(stored));
    } catch {
      // fall through to default below
    }
  }
  // First visit: open the section containing the current page so it's
  // never hidden on load, matching the previous always-expanded behavior.
  const current = NAV_SECTIONS.find((s) => s.items.some((i) => location.pathname.startsWith(i.to)));
  return new Set(current ? [current.label] : [NAV_SECTIONS[0].label]);
}

export function Layout() {
  const { user, logout, switchCompany } = useAuth();
  const { companies } = useCompanies();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "1");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(loadExpandedSections);

  // Cross-tenant SaaS-provider dashboard — visible only to the platform
  // owner's account, kept as its own top-level section (not nested under
  // Settings) since it isn't scoped to whichever company happens to be
  // selected right now.
  const isEntitled = (moduleKey: string) => !!user?.isPlatformAdmin || !!user?.enabledModules?.includes(moduleKey);

  const workingCapitalIndex = NAV_SECTIONS.findIndex((s) => s.label === "Working Capital");
  const gatedSections: NavSection[] = [
    ...(isEntitled("purchase") ? [PURCHASE_SECTION] : []),
    ...(isEntitled("sales") ? [SALES_SECTION] : []),
    ...(isEntitled("crm") ? [CRM_SECTION] : []),
  ];
  const sectionsWithModules =
    gatedSections.length > 0
      ? [...NAV_SECTIONS.slice(0, workingCapitalIndex + 1), ...gatedSections, ...NAV_SECTIONS.slice(workingCapitalIndex + 1)]
      : NAV_SECTIONS;

  const sections: NavSection[] = user?.isPlatformAdmin
    ? [{ label: "Platform", items: [{ to: "/platform", label: "Client Dashboard" }] }, ...sectionsWithModules]
    : sectionsWithModules;

  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      return next;
    });
  }

  function toggleSection(label: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      localStorage.setItem("sidebarExpandedSections", JSON.stringify([...next]));
      return next;
    });
  }

  // Auto-open whichever section contains the page just navigated to, so
  // following a link (e.g. from a KPI tile) never lands you on a page
  // whose own nav tab is collapsed.
  useEffect(() => {
    const current = sections.find((s) => s.items.some((i) => routerLocation.pathname.startsWith(i.to)));
    if (current && !expandedSections.has(current.label)) {
      setExpandedSections((prev) => new Set(prev).add(current.label));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerLocation.pathname]);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  async function handleSwitchCompany(companyId: string) {
    if (companyId) {
      await switchCompany(companyId);
    }
  }

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <h1>Universa Centrix</h1>
        <nav>
          {sections.map((section) => {
            const isOpen = expandedSections.has(section.label);
            return (
              <div className="nav-section" key={section.label}>
                <button
                  type="button"
                  className={`nav-section-label ${isOpen ? "open" : ""}`}
                  onClick={() => toggleSection(section.label)}
                  aria-expanded={isOpen}
                >
                  <span className="nav-section-caret">{isOpen ? "▾" : "▸"}</span>
                  {section.label}
                </button>
                {isOpen && (
                  <div className="nav-section-items">
                    {section.items.map((item) => (
                      <NavLink key={item.to} to={item.to}>
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main-area">
        <div className="topbar">
          <button
            className="secondary sidebar-toggle"
            onClick={toggleSidebar}
            title={collapsed ? "Expand menu" : "Collapse menu (full-screen view)"}
          >
            {collapsed ? "☰" : "≡ ✕"}
          </button>
          <select value={user?.activeCompanyId ?? ""} onChange={(e) => handleSwitchCompany(e.target.value)}>
            <option value="" disabled>
              Select a company…
            </option>
            {companies.map((c) => (
              <option key={c.companyId} value={c.companyId}>
                {c.companyName} ({c.companyCode})
              </option>
            ))}
          </select>
          <span>
            {user?.email}{" "}
            <button className="secondary" onClick={handleLogout}>
              Log out
            </button>
          </span>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
