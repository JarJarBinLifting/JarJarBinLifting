import { useTheme } from "../../lib/theme";

export type ShellView = "dash" | "programme" | "ue" | "progress" | "annales" | "timer" | "settings";

const ITEMS: { id: "dash" | "programme" | "progress" | "annales"; label: string; icon: "today" | "programme" | "progress" | "annales" }[] = [
  { id: "dash", label: "Plan du jour", icon: "today" },
  { id: "programme", label: "Réviser", icon: "programme" },
  { id: "progress", label: "Progression", icon: "progress" },
  { id: "annales", label: "Annales", icon: "annales" },
];

export function Nav({ view, onNavigate }: { view: ShellView; onNavigate: (view: ShellView) => void }) {
  const { theme, toggle } = useTheme();

  return (
    <aside className="app-nav" aria-label="Navigation principale">
      <div className="nav-brand">
        <div className="nav-brand-mark">DCG</div>
        <div><div className="nav-brand-name">DCG Étude</div><div className="nav-brand-sub">Préparation structurée</div></div>
      </div>

      <nav className="nav-items">
        {ITEMS.map(({ id, label, icon }) => {
          const active = view === id || (id === "programme" && view === "ue");
          return (
            <button key={id} className={`nav-item${active ? " active" : ""}`} onClick={() => onNavigate(id)} aria-current={active ? "page" : undefined}>
              <NavIcon icon={icon} /><span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="nav-footer">
        <small>Épreuve nationale</small>
        <strong>30 mai 2027</strong>
        <p>Réglages, sauvegardes et import de leçons.</p>
        <button className="nav-settings" onClick={() => onNavigate("settings")} aria-current={view === "settings" ? "page" : undefined}>Données et réglages</button>
        <button className="nav-theme" onClick={toggle}>{theme === "dark" ? "Passer au mode clair" : "Passer au mode sombre"}</button>
      </div>
    </aside>
  );
}

function NavIcon({ icon }: { icon: (typeof ITEMS)[number]["icon"] }) {
  if (icon === "today") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4zM8 3v5M16 3v5M4 10h16" /><path d="m8 15 2 2 5-5" /></svg>;
  if (icon === "programme") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4Z" /><path d="M20 4h-4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h4Z" /></svg>;
  if (icon === "progress") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-8M22 19H2" /><path d="m5 6 4-3 4 3 6-4" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2M9 3h6" /></svg>;
}
