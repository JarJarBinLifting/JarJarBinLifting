import { useEffect, useState } from "react";
import { useAppState } from "../../state/AppState";
import * as api from "../../lib/api";
import { todayIso } from "../../lib/format";
import type { Chapter, DueChapter } from "../../lib/types";
import { Spin } from "./common";

const OUTCOME_META: Record<string, { label: string; color: string }> = {
  strong: { label: "💪 Solide", color: "var(--accent-green)" },
  ok: { label: "🤔 Correct", color: "var(--accent-yellow)" },
  weak: { label: "😕 Fragile", color: "var(--accent-red)" },
};

function DueRow({ d, onStudy }: { d: DueChapter; onStudy: (chapterId: number, ueId: number) => void }) {
  const outcome = d.last_outcome ? OUTCOME_META[d.last_outcome] : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "var(--card2)",
        borderRadius: 12,
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, letterSpacing: 0.5, marginBottom: 2 }}>{d.ue_code} · {d.ue_name}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.chapter_name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>boîte {d.box_level} · {d.next_review_date}</span>
        {outcome && <span style={{ fontSize: 10, fontWeight: 700, color: outcome.color }}>{outcome.label}</span>}
      </div>
      <button
        onClick={() => onStudy(d.chapter_id, d.ue_id)}
        style={{ background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 11, fontWeight: 700, flexShrink: 0 }}
      >
        Réviser →
      </button>
    </div>
  );
}

export function Agenda({ onStudyChapter }: { onStudyChapter: (chapter: Chapter) => void }) {
  const { chapters, dueChapters, refreshAll } = useAppState();
  const [upcoming, setUpcoming] = useState<DueChapter[] | null>(null);

  useEffect(() => {
    api.listDueChapters(30).then(setUpcoming);
  }, [dueChapters]);

  const today = todayIso();
  const due = [...dueChapters].sort((a, b) => (a.next_review_date < b.next_review_date ? -1 : 1));
  const dueToday = due.filter((d) => d.next_review_date <= today);
  const dueThisWeek = due.filter((d) => d.next_review_date > today);
  const laterIds = new Set(due.map((d) => d.chapter_id));
  const later = (upcoming ?? []).filter((d) => !laterIds.has(d.chapter_id));

  const handleStudy = (chapterId: number) => {
    const c = chapters.find((x) => x.id === chapterId);
    if (c) onStudyChapter(c);
  };

  return (
    <div style={{ padding: 14, maxWidth: 920, margin: "0 auto" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, marginBottom: 4, color: "var(--text)" }}>📅 Agenda de révision</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
        Chaque chapitre revient automatiquement selon ta performance — pas de planning fixe à tenir à jour.
      </div>

      <Section title={`🔴 À réviser aujourd'hui (${dueToday.length})`} empty="Rien de prévu aujourd'hui — bien joué.">
        {dueToday.map((d) => (
          <DueRow key={d.chapter_id} d={d} onStudy={handleStudy} />
        ))}
      </Section>

      <Section title={`🟡 Cette semaine (${dueThisWeek.length})`} empty="Rien d'autre prévu cette semaine.">
        {dueThisWeek.map((d) => (
          <DueRow key={d.chapter_id} d={d} onStudy={handleStudy} />
        ))}
      </Section>

      {upcoming === null ? (
        <Spin text="Chargement de l'agenda…" />
      ) : (
        later.length > 0 && (
          <Section title={`🔵 Plus tard (${later.length})`} empty="">
            {later.map((d) => (
              <DueRow key={d.chapter_id} d={d} onStudy={handleStudy} />
            ))}
          </Section>
        )
      )}

      <button
        onClick={() => refreshAll()}
        style={{ width: "100%", marginTop: 8, padding: 10, background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, fontSize: 12, color: "var(--muted)" }}
      >
        ↺ Rafraîchir
      </button>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>{title}</div>
      {hasChildren ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
      ) : (
        empty && <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 2px" }}>{empty}</div>
      )}
    </div>
  );
}
