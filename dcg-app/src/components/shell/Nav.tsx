export type ShellView = "dash" | "ue" | "agenda" | "timer" | "settings";

const ITEMS: { id: ShellView; label: string; icon: string }[] = [
  { id: "dash", label: "Accueil", icon: "🏠" },
  { id: "agenda", label: "Agenda", icon: "📅" },
  { id: "timer", label: "Chrono", icon: "⏱" },
  { id: "settings", label: "Réglages", icon: "⚙️" },
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
      {ITEMS.map(({ id, label, icon }) => {
        const active = view === id || (id === "dash" && view === "ue");
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              padding: "10px 0 7px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              color: active ? "var(--accent-blue)" : "var(--muted)",
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
            <span style={{ fontSize: 9, fontWeight: active ? 800 : 500, letterSpacing: 1 }}>{label.toUpperCase()}</span>
          </button>
        );
      })}
    </div>
  );
}
