import { useEffect, useRef, useState } from "react";

export interface SearchableOption {
  id: string;
  code: string;
  name: string;
}

/**
 * A text-input combobox that filters `options` by code OR name as the user
 * types — native `<select>` typeahead only jump-matches from the start of
 * the visible label, so it can't find e.g. "ACME" by typing "acm" once the
 * list is long. Click-outside closes the dropdown; selecting an option
 * shows "CODE — Name" the same way the old `<select>` did.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  required,
  disabled,
}: {
  options: SearchableOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = options.find((o) => o.id === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)) : options;

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <input
        value={open ? query : selected ? `${selected.code} — ${selected.name}` : ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        required={required && !value}
        disabled={disabled}
        autoComplete="off"
      />
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 30,
            background: "#fff",
            border: "1px solid #d0d5dd",
            borderRadius: 6,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            minWidth: 240,
            maxHeight: 260,
            overflowY: "auto",
            marginTop: 2,
          }}
        >
          {filtered.length === 0 && <div style={{ padding: "8px 10px", color: "#667085", fontSize: 13 }}>No matches</div>}
          {filtered.map((o) => (
            <div
              key={o.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o.id);
                setOpen(false);
                setQuery("");
              }}
              style={{
                padding: "6px 10px",
                fontSize: 13,
                cursor: "pointer",
                background: o.id === value ? "#eef4ff" : undefined,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
              onMouseLeave={(e) => (e.currentTarget.style.background = o.id === value ? "#eef4ff" : "")}
            >
              {o.code} — {o.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
