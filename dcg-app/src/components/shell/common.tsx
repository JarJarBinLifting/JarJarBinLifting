export function Spin({ text = "Chargement…" }: { text?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 20, justifyContent: "center" }}>
      <div
        style={{
          width: 16,
          height: 16,
          border: "2px solid var(--border)",
          borderTopColor: "var(--accent-blue)",
          borderRadius: "50%",
          animation: "spin .7s linear infinite",
        }}
      />
      <span style={{ color: "var(--muted)", fontSize: 13 }}>{text}</span>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <p style={{ color: "var(--accent-red)", padding: 12, fontSize: 13 }}>Erreur : {message}</p>;
}

export function StatTile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "14px 10px",
        textAlign: "center",
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 5, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.4 }}>
        {label.toUpperCase()}
      </div>
    </div>
  );
}

export function ProgressBar({ pct, color, height = 6 }: { pct: number; color: string; height?: number }) {
  return (
    <div style={{ background: "var(--track)", borderRadius: 99, height, overflow: "hidden" }}>
      <div
        className="pfill"
        style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99 }}
      />
    </div>
  );
}
