import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ThemeName = "dark" | "light";

const ThemeCtx = createContext<{ theme: ThemeName; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

const STORAGE_KEY = "dcg-theme"; // per-machine cosmetic preference, not synced via the db

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }),
    [theme],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

/** Small style-builder helpers so component code stays close to plain inline
 * styles instead of pulling in a CSS-in-JS dependency for a single-user app. */
export const cardStyle = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 20,
  ...extra,
});

export const btnStyle = (color: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: color,
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  ...extra,
});

export const inputStyle = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: "var(--input)",
  border: "1px solid var(--input-border)",
  borderRadius: 10,
  padding: "10px 14px",
  color: "var(--text)",
  fontSize: 14,
  width: "100%",
  ...extra,
});

export const scoreColor = (pct: number) => (pct >= 60 ? "var(--accent-green)" : pct >= 40 ? "var(--accent-yellow)" : "var(--accent-red)");
