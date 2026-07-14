export type ShellView = "dash" | "ue" | "agenda" | "timer" | "settings";

const ITEMS: { id: ShellView; label: string }[] = [
  { id: "dash", label: "Accueil" },
  { id: "agenda", label: "Agenda" },
  { id: "timer", label: "Chrono" },
  { id: "settings", label: "Réglages" },
];

export function Nav({ view, onNavigate }: { view: ShellView; onNavigate: (v: ShellView) => void }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "var(--card)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        zIndex: 100,
      }}
    >
      {ITEMS.map(({ id, label }) => {
        const active = view === id || (id === "dash" && view === "ue");
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              borderTop: `2px solid ${active ? "var(--accent-blue)" : "transparent"}`,
              padding: "12px 0 10px",
              color: active ? "var(--accent-blue)" : "var(--muted)",
            }}
          >
            <span style={{ fontSize: 10, fontWeight: active ? 800 : 600, letterSpacing: 1.2 }}>{label.toUpperCase()}</span>
          </button>
        );
      })}
    </div>
  );
}
