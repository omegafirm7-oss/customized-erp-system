import { CSSProperties, ReactNode } from "react";

/**
 * The module wheel — eleven modules in a circle around a central
 * "Universa ERP" hub, following the ERP-wheel diagram this design was
 * based on: a glossy white disc per module with the icon and label inside,
 * and a colored accent arc on the ring facing the hub.
 *
 * Positions are pre-computed percentages of the wheel box (eleven points at
 * 32.727° steps) rather than CSS rotate transforms, so each disc stays
 * circular and every label stays upright however large the wheel is.
 * `arc` rotates each accent so it points inward at the hub.
 *
 * Line icons rather than emoji: emoji render far too small to read at disc
 * size, and vary by platform.
 */
type Module = {
  label: ReactNode;
  ring: string;
  left: string;
  top: string;
  arc: string;
  icon: ReactNode;
};

const MODULES: Module[] = [
  {
    label: "Finance",
    ring: "#f5893f",
    left: "40.75%",
    top: "3.75%",
    arc: "144deg",
    icon: (
      <>
        <path d="M3 21h18" />
        <path d="M6 21v-5" />
        <path d="M11 21V9" />
        <path d="M16 21v-8" />
        <path d="M21 21V5" />
      </>
    ),
  },
  {
    label: "e-Invoicing",
    ring: "#e8503a",
    left: "60.75%",
    top: "9.62%",
    arc: "176.7deg",
    icon: (
      <>
        <path d="M7 2h7l4 4v16H7z" />
        <path d="M14 2v4h4" />
        <path d="M10 12h6" />
        <path d="M10 16h6" />
      </>
    ),
  },
  {
    label: (
      <>
        Sales &amp;
        <br />
        Marketing
      </>
    ),
    ring: "#d92d55",
    left: "74.41%",
    top: "25.38%",
    arc: "209.5deg",
    icon: (
      <>
        <path d="M3 10v4h3l7 4V6l-7 4H3z" />
        <path d="M17.5 9.5a4 4 0 0 1 0 5" />
        <path d="M20 7.2a7.6 7.6 0 0 1 0 9.6" />
      </>
    ),
  },
  {
    label: "CRM",
    ring: "#b8206b",
    left: "77.37%",
    top: "46.02%",
    arc: "242.2deg",
    icon: (
      <>
        <path d="M2.5 4.5h19v13h-19z" />
        <path d="M9.5 21h5" />
        <path d="M12 17.5V21" />
        <circle cx="8.5" cy="9.3" r="1.7" />
        <path d="M6 14c0-1.5 1.1-2.4 2.5-2.4S11 12.5 11 14" />
        <path d="M14 9h4.5" />
        <path d="M14 12.5h4.5" />
      </>
    ),
  },
  {
    label: "Purchase",
    ring: "#8b3aa8",
    left: "68.71%",
    top: "64.98%",
    arc: "274.9deg",
    icon: (
      <>
        <path d="M2.5 4h2.7l2.4 11h9.9" />
        <path d="M6.6 7.5h14.4l-1.9 6.2H8" />
        <circle cx="9" cy="19" r="1.6" />
        <circle cx="17.5" cy="19" r="1.6" />
      </>
    ),
  },
  {
    label: "Inventory",
    ring: "#5b46c4",
    left: "51.17%",
    top: "76.25%",
    arc: "307.6deg",
    icon: (
      <>
        <path d="M3 8l9-5 9 5v9l-9 5-9-5V8z" />
        <path d="M3 8l9 5 9-5" />
        <path d="M12 13v9" />
      </>
    ),
  },
  {
    label: "Projects",
    ring: "#2f6fd0",
    left: "30.33%",
    top: "76.25%",
    arc: "340.4deg",
    icon: (
      <>
        <path d="M3 3v18" />
        <path d="M6 6h10" />
        <path d="M6 11h13" />
        <path d="M6 16h8" />
        <path d="M6 21h11" />
      </>
    ),
  },
  {
    label: "Manpower",
    ring: "#1f9fd4",
    left: "12.79%",
    top: "64.98%",
    arc: "13.1deg",
    icon: (
      <>
        <path d="M2.5 17h19" />
        <path d="M5 17a7 7 0 0 1 14 0" />
        <path d="M9.5 10.6V6.5h5v4.1" />
      </>
    ),
  },
  {
    label: "Equipment",
    ring: "#16a89a",
    left: "4.13%",
    top: "46.02%",
    arc: "45.8deg",
    icon: (
      <>
        <path d="M2 16V6h11v10" />
        <path d="M13 9.5h4l4 4V16" />
        <path d="M2 16h2.2" />
        <path d="M9.8 16h4.4" />
        <path d="M19.8 16H21" />
        <circle cx="7" cy="17.8" r="2.4" />
        <circle cx="17" cy="17.8" r="2.4" />
      </>
    ),
  },
  {
    label: (
      <>
        HR &amp;
        <br />
        Payroll
      </>
    ),
    ring: "#35b06a",
    left: "7.09%",
    top: "25.38%",
    arc: "78.5deg",
    icon: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M2.5 20c0-3.4 2.9-5.2 6.5-5.2s6.5 1.8 6.5 5.2" />
        <circle cx="18" cy="9.5" r="2.3" />
        <path d="M17.5 15c2.6 0 4.5 1.7 4.5 4.3" />
      </>
    ),
  },
  {
    label: "Companies",
    ring: "#b7cf2e",
    left: "20.75%",
    top: "9.62%",
    arc: "111.3deg",
    icon: (
      <>
        <path d="M2.5 21h19" />
        <path d="M4 21V9h7v12" />
        <path d="M11 21V4h9v17" />
        <path d="M6.5 13h2" />
        <path d="M6.5 17h2" />
        <path d="M14 8h3" />
        <path d="M14 12h3" />
        <path d="M14 16h3" />
      </>
    ),
  },
];

export function AuthFeatureCircles() {
  return (
    <div className="auth-wheel">
      {MODULES.map((m, i) => (
        <div
          className="auth-feature"
          key={i}
          style={{ left: m.left, top: m.top, "--ring": m.ring, "--arc": m.arc } as CSSProperties}
        >
          <div className="auth-feature-circle">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {m.icon}
            </svg>
            <span>{m.label}</span>
          </div>
        </div>
      ))}

      <div className="auth-hub">
        <div className="auth-hub-inner">
          <b>Universa</b>
          <b>ERP</b>
        </div>
      </div>
    </div>
  );
}
