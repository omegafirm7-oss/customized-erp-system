const FEATURES: Array<{ label: string; path: string }> = [
  { label: "Finance & Accounting", path: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
  { label: "ZATCA e-Invoicing", path: "M6 2h9l5 5v15H6z M15 2v5h5 M9 13h6 M9 17h6 M9 9h2" },
  { label: "Projects & WIP", path: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  {
    label: "HR & Payroll (GOSI/WPS)",
    path: "M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1 M17 13a5 5 0 0 1 5 5v3",
  },
  { label: "Inventory", path: "M21 8 12 3 3 8l9 5 9-5Z M3 8v8l9 5 9-5V8M12 13v8" },
  { label: "Manpower Contracts", path: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" },
  {
    label: "Equipment & Depreciation",
    path: "M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z",
  },
  { label: "Multi-Company Access", path: "M3 21h18M6 21V8l6-4 6 4v13M10 21v-4h4v4M9 12h.01M9 9h.01M15 12h.01M15 9h.01" },
];

export function AuthFeatureCircles() {
  return (
    <div className="auth-features">
      {FEATURES.map((f) => (
        <div className="auth-feature" key={f.label}>
          <div className="auth-feature-circle">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
              <path d={f.path} />
            </svg>
          </div>
          <span>{f.label}</span>
        </div>
      ))}
    </div>
  );
}
