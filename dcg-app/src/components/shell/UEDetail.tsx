import { useState } from "react";
import { useAppState } from "../../state/AppState";
import * as api from "../../lib/api";
import { avgScorePct, chapterProgress, todayIso } from "../../lib/format";
import type { Chapter, ChapterStatus, Ue } from "../../lib/types";

const STATUS_META: Record<ChapterStatus, { color: string; label: string; icon: string; bg: string }> = {
  todo: { color: "var(--muted)", label: "À faire", icon: "○", bg: "transparent" },
  ongoing: { color: "var(--accent-yellow)", label: "En cours", icon: "◑", bg: "color-mix(in srgb, var(--accent-yellow) 8%, transparent)" },
  done: { color: "var(--accent-green)", label: "Terminé", icon: "●", bg: "color-mix(in srgb, var(--accent-green) 8%, transparent)" },
};

export function UEDetail({
  ue,
  onBack,
  onStudyChapter,
}: {
  ue: Ue;
  onBack: () => void;
  onStudyChapter: (chapter: Chapter) => void;
}) {
  const { chapters, qcmScores, refreshAll } = useAppState();
  const ueChapters = chapters.filter((c) => c.ue_id === ue.id).sort((a, b) => a.position - b.position);
  const pct = chapterProgress(ueChapters);
  const ueChapterIds = new Set(ueChapters.map((c) => c.id));
  const ueScores = qcmScores.filter((s) => ueChapterIds.has(s.chapter_id)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const avg = avgScorePct(ueScores);

  const [scoreModalChapter, setScoreModalChapter] = useState<Chapter | null>(null);
  const [notesDraft, setNotesDraft] = useState({
    points_forts: ue.points_forts ?? "",
    points_faibles: ue.points_faibles ?? "",
    notes: ue.notes ?? "",
  });

  const saveNotes = async (patch: Partial<typeof notesDraft>) => {
    const next = { ...notesDraft, ...patch };
    setNotesDraft(next);
    await api.updateUeNotes(ue.id, next.points_forts || null, next.points_faibles || null, next.notes || null);
  };

  const cycleStatus = async (chapterId: number) => {
    await api.cycleChapterStatus(chapterId);
    await refreshAll();
  };

  return (
    <div style={{ padding: 14, maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button
          onClick={onBack}
          style={{ background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 600, color: "var(--text)" }}
        >
          ← Retour
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: ue.color ?? undefined, fontWeight: 800, letterSpacing: 1.5 }}>{ue.code}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
            {ue.name}
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700, color: ue.color ?? undefined, flexShrink: 0 }}>{pct}%</div>
      </div>

      <div style={{ background: "var(--track)", borderRadius: 99, height: 10, marginBottom: 18, overflow: "hidden" }}>
        <div className="pfill" style={{ width: `${pct}%`, height: "100%", background: ue.color ?? undefined, borderRadius: 99 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
        {[
          { l: "Terminés", v: ueChapters.filter((c) => c.status === "done").length, c: "var(--accent-green)", i: "✅" },
          { l: "En cours", v: ueChapters.filter((c) => c.status === "ongoing").length, c: "var(--accent-yellow)", i: "🔄" },
          { l: "À faire", v: ueChapters.filter((c) => c.status === "todo").length, c: "var(--muted)", i: "📋" },
        ].map(({ l, v, c, i }) => (
          <div key={l} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, textAlign: "center", padding: "14px 10px" }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{i}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 800, color: c, lineHeight: 1 }}>{v}</div>
            <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, letterSpacing: 0.5, marginTop: 5 }}>{l.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 20, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>📚 Chapitres</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Cliquer le statut pour le changer · bouton pour étudier</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {ueChapters.map((ch) => {
            const s = STATUS_META[ch.status];
            return (
              <div
                key={ch.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, background: s.bg, border: `1px solid ${s.color}33` }}
              >
                <div
                  onClick={() => cycleStatus(ch.id)}
                  style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, background: `${s.color}22`, display: "flex", alignItems: "center", justifyContent: "center", color: s.color, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  {s.icon}
                </div>
                <div onClick={() => cycleStatus(ch.id)} style={{ flex: 1, fontSize: 13, fontWeight: 500, color: ch.status === "done" ? "var(--muted)" : "var(--text)", lineHeight: 1.4, cursor: "pointer" }}>
                  {ch.name}
                </div>
                <div style={{ fontSize: 10, color: s.color, fontWeight: 700, letterSpacing: 0.5, minWidth: 55, textAlign: "right" }}>{s.label}</div>
                <button
                  onClick={() => onStudyChapter(ch)}
                  style={{ background: ue.color ?? "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700, flexShrink: 0 }}
                >
                  {ch.status === "done" ? "Réviser" : "Étudier"} →
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 20, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>📊 Historique QCM</div>
          {avg !== null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700 }}>∅ {avg}%</span>}
        </div>
        {ueScores.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {ueScores.slice(0, 10).map((s) => {
              const scPct = Math.round((s.score / s.total) * 100);
              const chapterName = ueChapters.find((c) => c.id === s.chapter_id)?.name ?? "";
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--card2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)", minWidth: 90, flexShrink: 0 }}>{s.date}</span>
                  <span style={{ flex: 1, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chapterName}</span>
                  {s.source === "tutor" && <span style={{ fontSize: 9, color: "var(--accent-purple)", fontWeight: 700 }}>TUTEUR</span>}
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, minWidth: 65, textAlign: "right", flexShrink: 0 }}>
                    {s.score}/{s.total} · {scPct}%
                  </span>
                  <button
                    onClick={async () => {
                      await api.deleteQcmScore(s.id);
                      await refreshAll();
                    }}
                    style={{ background: "none", border: "none", color: "var(--accent-red)", fontSize: 18, cursor: "pointer", padding: "0 3px", flexShrink: 0 }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "18px 0" }}>
            Aucun score enregistré — étudie un chapitre ou ajoute un score manuellement.
          </div>
        )}
        <button
          onClick={() => setScoreModalChapter(ueChapters[0] ?? null)}
          disabled={!ueChapters.length}
          style={{ marginTop: 12, width: "100%", padding: 10, background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, fontSize: 12, color: "var(--text)" }}
        >
          + Ajouter un score manuellement
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        {(
          [
            { k: "points_forts" as const, l: "💪 Points forts", ph: "Ex : Maîtrise de la TVA…", c: "var(--accent-green)" },
            { k: "points_faibles" as const, l: "⚠️ Points faibles", ph: "Ex : Procédures collectives…", c: "var(--accent-red)" },
          ]
        ).map(({ k, l, ph, c }) => (
          <div key={k} style={{ background: "var(--card)", border: `1px solid ${c}44`, borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: c, marginBottom: 10 }}>{l}</div>
            <textarea
              value={notesDraft[k]}
              onChange={(e) => setNotesDraft((p) => ({ ...p, [k]: e.target.value }))}
              onBlur={() => saveNotes({ [k]: notesDraft[k] })}
              placeholder={ph}
              rows={4}
              style={{ width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, padding: 10, color: "var(--text)", fontSize: 13, lineHeight: 1.6 }}
            />
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>📝 Notes personnelles</div>
        <textarea
          value={notesDraft.notes}
          onChange={(e) => setNotesDraft((p) => ({ ...p, notes: e.target.value }))}
          onBlur={() => saveNotes({ notes: notesDraft.notes })}
          placeholder="Vos notes de cours, définitions clés, points à retenir…"
          rows={6}
          style={{ width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, padding: 10, color: "var(--text)", fontSize: 13, lineHeight: 1.7 }}
        />
      </div>

      {scoreModalChapter && (
        <AddScoreModal
          chapter={scoreModalChapter}
          chapters={ueChapters}
          color={ue.color ?? "var(--accent-blue)"}
          onClose={() => setScoreModalChapter(null)}
          onSaved={async () => {
            setScoreModalChapter(null);
            await refreshAll();
          }}
        />
      )}
    </div>
  );
}

function AddScoreModal({
  chapter,
  chapters,
  color,
  onClose,
  onSaved,
}: {
  chapter: Chapter;
  chapters: Chapter[];
  color: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [chapterId, setChapterId] = useState(chapter.id);
  const [date, setDate] = useState(todayIso());
  const [score, setScore] = useState("");
  const [total, setTotal] = useState("20");
  const pct = score && total ? Math.round((Number(score) / Number(total)) * 100) : null;

  const save = async () => {
    if (!score || !total) return;
    await api.addQcmScore(chapterId, date, Number(score), Number(total));
    onSaved();
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, maxWidth: 380, width: "100%", padding: 24 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, marginBottom: 20, color: "var(--text)" }}>Ajouter un score QCM</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 7, letterSpacing: 1.5 }}>CHAPITRE</label>
            <select
              value={chapterId}
              onChange={(e) => setChapterId(Number(e.target.value))}
              style={{ width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, padding: "10px 14px", color: "var(--text)", fontSize: 13 }}
            >
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 7, letterSpacing: 1.5 }}>DATE</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, padding: "10px 14px", color: "var(--text)", fontSize: 14 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 7, letterSpacing: 1.5 }}>SCORE</label>
              <input type="number" min={0} step={0.5} value={score} onChange={(e) => setScore(e.target.value)} placeholder="Ex : 14" style={{ width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, padding: "10px 14px", color: "var(--text)", fontSize: 14 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 7, letterSpacing: 1.5 }}>TOTAL</label>
              <input type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} style={{ width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, padding: "10px 14px", color: "var(--text)", fontSize: 14 }} />
            </div>
          </div>
          {pct !== null && !Number.isNaN(pct) && (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{pct}%</div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 11, background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 10, color: "var(--text)", fontWeight: 600 }}>
            Annuler
          </button>
          <button onClick={save} style={{ flex: 1, padding: 11, background: color, color: "#fff", border: "none", borderRadius: 10, fontWeight: 600 }}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
