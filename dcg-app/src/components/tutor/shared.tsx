export function TutorSpin({ text = "Génération…" }: { text?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 20, justifyContent: "center" }}>
      <div
        style={{
          width: 16,
          height: 16,
          border: "2px solid var(--border)",
          borderTopColor: "var(--t-pri)",
          borderRadius: "50%",
          animation: "spin .7s linear infinite",
        }}
      />
      <span style={{ color: "var(--muted)", fontSize: 13 }}>{text}</span>
    </div>
  );
}

export function TutorError({ message }: { message: string }) {
  return <p style={{ color: "var(--t-err)", padding: 12, fontSize: 13 }}>Erreur : {message}</p>;
}

export function Consigne({ text }: { text: string }) {
  return (
    <div className="tutor-consigne">
      <span>👉</span>
      <span>{text}</span>
    </div>
  );
}
