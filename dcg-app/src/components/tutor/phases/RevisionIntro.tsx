import { useState } from "react";
import type { Story } from "../../../lib/types";

export function RevisionIntro({
  chapterName,
  story,
  compteRendu,
  onStart,
  onRestart,
}: {
  chapterName: string;
  story: Story;
  compteRendu: string | null;
  onStart: (adhd: boolean) => void;
  onRestart: () => void;
}) {
  const [adhd, setAdhd] = useState(false);

  return (
    <div className="tutor-card">
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
        <h2 style={{ fontFamily: "var(--font-story)", fontSize: 19, color: "var(--t-pri)", marginBottom: 6 }}>{chapterName}</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          Révision ciblée avec {story.personnage}
          {story.entreprise ? ` · ${story.entreprise}` : ""} — flashcards, QCM et dialogue, pas de relecture complète. ~15 min.
        </p>
      </div>

      {compteRendu ? (
        <div className="tutor-reveal-box" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--t-pri)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            📝 Depuis la dernière session
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>{compteRendu}</p>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginBottom: 16 }}>
          Première révision de ce chapitre — le tuteur ciblera les notions selon tes réponses aujourd'hui.
        </p>
      )}

      <div className={`tutor-adhd-card${adhd ? " on" : ""}`} onClick={() => setAdhd(!adhd)}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>🧩</span>
        <div>
          <strong style={{ fontSize: 13, color: adhd ? "var(--t-pri)" : "var(--text)" }}>Mode TDAH / concentration {adhd ? "— activé ✓" : ""}</strong>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            Une question à la fois, feedback immédiat, animations réduites, pause/reprise à tout moment.
          </p>
        </div>
      </div>

      <button className="tutor-bp" onClick={() => onStart(adhd)} style={{ width: "100%", marginTop: 14, padding: "13px 24px", fontSize: 15 }}>
        Commencer la révision →
      </button>
      <button className="tutor-bs" onClick={onRestart} style={{ width: "100%", marginTop: 8, color: "var(--muted)" }}>
        Recommencer ce chapitre depuis le début (nouvelle histoire complète)
      </button>
    </div>
  );
}
