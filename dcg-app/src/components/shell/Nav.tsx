export type ShellView = "dash" | "ue" | "agenda" | "pilotage" | "timer" | "settings";

const ITEMS: { id: Exclude<ShellView, "ue">; label: string; icon: "home" | "agenda" | "pilotage" | "timer" | "settings" }[] = [
  { id: "dash", label: "Vue d'ensemble", icon: "home" },
  { id: "agenda", label: "Révisions", icon: "agenda" },
  { id: "pilotage", label: "Pilotage", icon: "pilotage" },
  { id: "timer", label: "Session", icon: "timer" },
  { id: "settings", label: "Réglages", icon: "settings" },
];

export function Nav({ view, onNavigate }: { view: ShellView; onNavigate: (v: ShellView) => void }) {
  return (
    <aside className="app-nav" aria-label="Navigation principale">
      <div className="nav-brand">
        <div className="nav-brand-mark">D</div>
        <div>
          <div className="nav-brand-name">DCG Étude</div>
          <div className="nav-brand-sub">Espace personnel</div>
        </div>
      </div>

      <div className="nav-label">Travail</div>
      <nav className="nav-items">
        {ITEMS.map(({ id, label, icon }) => {
          const active = view === id || (id === "dash" && view === "ue");
          return (
            <button key={id} className={`nav-item${active ? " active" : ""}`} onClick={() => onNavigate(id)} aria-current={active ? "page" : undefined}>
              <NavIcon icon={icon} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="nav-footer">
        <strong>Ton espace de travail</strong>
        <p>Local, privé et pensé pour la session d'examen.</p>
      </div>
    </aside>
  );
}

function NavIcon({ icon }: { icon: (typeof ITEMS)[number]["icon"] }) {
  if (icon === "home") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /><path d="M9 21v-7h6v7" /></svg>;
  if (icon === "agenda") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" /></svg>;
  if (icon === "pilotage") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-8M22 19H2" /><path d="m5 6 4-3 4 3 6-4" /></svg>;
  if (icon === "timer") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M9 2h6M12 5V2M12 13l3-2" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.2 2.2-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.1h-3.1v-.1a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.2-2.2.06-.06A1.7 1.7 0 0 0 6.74 15a1.7 1.7 0 0 0-1.56-1.04h-.1v-3.1h.1A1.7 1.7 0 0 0 6.74 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.2-2.2.06.06A1.7 1.7 0 0 0 10.48 5.26a1.7 1.7 0 0 0 1.04-1.56v-.1h3.1v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.2 2.2-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.04h.1v3.1h-.1A1.7 1.7 0 0 0 19.4 15Z" /></svg>;
}
