import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import type { WeeklyBilan as Bilan } from "../../lib/types";
import type { ShellView } from "./Nav";

/** Bilan de la semaine: the Sunday ritual. One calm read of what the week
 * actually looked like and what next week asks — pure SQL server-side, no
 * LLM, opens instantly. */
export function WeeklyBilanModal({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: ShellView) => void }) {
  const [bilan, setBilan] = useState<Bilan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getWeeklyBilan().then(setBilan).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fmtHours = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`);

  const touched = bilan?.per_ue.filter((ue) => ue.minutes > 0) ?? [];
  const untouched = bilan?.per_ue.filter((ue) => ue.minutes === 0) ?? [];
  const maxMinutes = Math.max(1, ...touched.map((ue) => ue.minutes));
  const delta = bilan ? bilan.minutes_this_week - bilan.minutes_last_week : 0;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 500, display: "flex", alignItems: "flex-start", justifyContent: "center", background: "rgba(0,0,0,.72)", padding: 16, overflowY: "auto" }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640, width: "100%", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 24, margin: "24px 0" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
          <div>
            <div className="section-kicker">Bilan de la semaine</div>
            {bilan && <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--text)", marginTop: 6 }}>Semaine du {bilan.week_start}</div>}
          </div>
          <button className="soft-button" onClick={onClose}>Fermer</button>
        </div>

        {error && <p style={{ color: "var(--accent-red)", fontSize: 13 }}>{error}</p>}
        {!bilan && !error && <p style={{ color: "var(--muted)", fontSize: 13 }}>Chargement…</p>}

        {bilan && (
          <>
            {/* ── temps de travail ── */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 700, color: "var(--text)" }}>{fmtHours(bilan.minutes_this_week)}</div>
              <div style={{ fontSize: 12, color: delta >= 0 ? "var(--accent-green)" : "var(--accent-yellow)" }}>
                {delta >= 0 ? "▲" : "▼"} {fmtHours(Math.abs(delta))} vs semaine dernière ({fmtHours(bilan.minutes_last_week)})
              </div>
            </div>
            {touched.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {touched.map((ue) => (
                  <div key={ue.ue_id} style={{ display: "grid", gridTemplateColumns: "52px 1fr 64px", alignItems: "center", gap: 10, fontSize: 11 }}>
                    <span style={{ fontWeight: 800, color: ue.ue_color ?? "var(--muted)" }}>{ue.ue_code}</span>
                    <div style={{ height: 6, background: "var(--track)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${(ue.minutes / maxMinutes) * 100}%`, height: "100%", background: ue.ue_color ?? "var(--accent-blue)", borderRadius: 4 }} />
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--muted)", textAlign: "right" }}>{fmtHours(ue.minutes)}</span>
                  </div>
                ))}
              </div>
            )}
            {untouched.length > 0 && (
              <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>
                Pas touchées cette semaine : {untouched.map((ue) => ue.ue_code).join(", ")}
              </p>
            )}

            {/* ── travail accompli ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, margin: "6px 0 16px" }}>
              <BilanStat value={bilan.tutor_sessions_completed} label="sessions tuteur" />
              <BilanStat value={bilan.cards_reviewed} label="cartes travaillées" />
              <BilanStat value={bilan.quiz_answered} label="questions quiz" />
              <BilanStat value={bilan.qcm_avg_pct === null ? "—" : `${Math.round(bilan.qcm_avg_pct)}%`} label="QCM moyen" />
            </div>

            {/* ── carnet d'erreurs ── */}
            <div style={{ background: "var(--card2)", border: "1px solid var(--border)", borderRadius: 2, padding: "11px 13px", fontSize: 12, lineHeight: 1.7, color: "var(--text)", marginBottom: 14 }}>
              <strong>Carnet d'erreurs :</strong> {bilan.errors_created} nouvelle{bilan.errors_created > 1 ? "s" : ""},{" "}
              {bilan.errors_mastered} maîtrisée{bilan.errors_mastered > 1 ? "s" : ""}.
              {bilan.errors_stalled > 0 && (
                <span style={{ color: "var(--accent-yellow)" }}>
                  {" "}{bilan.errors_stalled} en panne sur l'échelle depuis plus de 3 jours —{" "}
                  <button className="text-action" onClick={() => { onNavigate("progress"); onClose(); }}>reprendre dans Progrès →</button>
                </span>
              )}
            </div>

            {/* ── annales ── */}
            {bilan.annales.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="section-kicker" style={{ marginBottom: 7 }}>Annales de la semaine</div>
                {bilan.annales.map((annale, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "6px 0", borderTop: i ? "1px solid var(--border)" : "none", color: "var(--text)" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{annale.ue_code} · {annale.title}</span>
                    <b style={{ fontFamily: "var(--font-mono)", flexShrink: 0, color: annale.total && (annale.score ?? 0) >= annale.total / 2 ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {annale.score}/{annale.total}
                    </b>
                  </div>
                ))}
              </div>
            )}

            {/* ── semaine prochaine ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, background: "color-mix(in srgb, var(--accent-blue) 8%, var(--card2))", border: "1px solid var(--border)", borderRadius: 2, padding: "12px 14px" }}>
              <div style={{ flex: 1, fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
                <strong>{bilan.due_next_week}</strong> chapitre{bilan.due_next_week > 1 ? "s" : ""} à réviser dans les 7 prochains jours.
              </div>
              <button className="primary-button" onClick={() => { onNavigate("dash"); onClose(); }}>Voir le plan du jour →</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BilanStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{ background: "var(--card2)", border: "1px solid var(--border)", borderRadius: 2, padding: "10px 12px" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{value}</div>
      <div style={{ color: "var(--muted)", fontSize: 9, fontWeight: 800, letterSpacing: 0.6, marginTop: 5, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}
