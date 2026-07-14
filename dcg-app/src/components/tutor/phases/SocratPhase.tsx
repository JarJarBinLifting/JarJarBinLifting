import { useCallback, useEffect, useRef, useState } from "react";
import { genChat } from "../llm";
import { MAX_CHAT } from "../prompts";
import { Consigne } from "../shared";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export function SocratPhase({
  sys,
  weakLabel,
  model,
  adhd,
  onNext,
  onHint,
  onTranscript,
}: {
  sys: string;
  weakLabel: string | null;
  model: string;
  adhd: boolean;
  onNext: () => void;
  onHint: (hint: string) => void;
  onTranscript: (transcript: ChatMsg[]) => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [inp, setInp] = useState("");
  const [loading, setLoading] = useState(false);
  const [on, setOn] = useState(false);
  const [turns, setTurns] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<ChatMsg[]>(msgs);
  msgsRef.current = msgs;

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [msgs]);
  useEffect(() => {
    onHint(`Approfondissement — ${turns} échange${turns > 1 ? "s" : ""} avec le maître socratique`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);
  useEffect(() => {
    onTranscript(msgs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs]);

  const send = useCallback(
    async (t: string) => {
      const all = [...msgsRef.current, { role: "user" as const, content: t }];
      setMsgs(all);
      setInp("");
      setLoading(true);
      setTurns((n) => n + 1);
      const tr = all.length > MAX_CHAT ? all.slice(-MAX_CHAT) : all;
      try {
        const r = await genChat(sys, tr, 1000, model);
        setMsgs((p) => [...p, { role: "assistant", content: r }]);
      } catch (e: any) {
        setMsgs((p) => [...p, { role: "assistant", content: `Erreur: ${e?.message ?? e}` }]);
      }
      setLoading(false);
    },
    [sys, model],
  );

  const start = useCallback(async () => {
    setOn(true);
    setMsgs([]);
    setLoading(true);
    try {
      const r = await genChat(sys, [{ role: "user", content: "Commence. Pose-moi une première question." }], 1000, model);
      setMsgs([{ role: "assistant", content: r }]);
    } catch (e: any) {
      setMsgs([{ role: "assistant", content: `Erreur: ${e?.message ?? e}` }]);
    }
    setLoading(false);
  }, [sys, model]);

  const minTurns = adhd ? 2 : 3;

  return (
    <div className="tutor-card">
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <h3 style={{ fontFamily: "var(--font-story)", fontSize: 17, color: "var(--t-pri)", marginBottom: 4 }}>Approfondissement — Socratique</h3>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>{weakLabel ? `Ciblé sur : ${weakLabel}` : "L'IA te guide par des questions"}</p>
      </div>
      {!on ? (
        <div style={{ textAlign: "center", padding: 16 }}>
          {adhd && <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{minTurns} échanges suffisent — court et intense.</p>}
          <button className="tutor-bp" onClick={start}>
            Commencer
          </button>
        </div>
      ) : (
        <>
          <Consigne text="Réponds avec tes mots — le tuteur rebondit sur ce que tu dis" />
          <div ref={ref} style={{ height: adhd ? 280 : 350, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "6px 0" }}>
            {msgs.map((m, i) => (
              <div key={i} className={`tutor-cb ${m.role === "user" ? "tutor-cb-u" : "tutor-cb-a"}`}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="tutor-cb tutor-cb-a" style={{ animation: "pulse 1.5s ease-in-out infinite" }}>
                Réflexion…
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <input
              value={inp}
              onChange={(e) => setInp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && inp.trim() && !loading) send(inp.trim());
              }}
              placeholder="Ta réponse…"
              style={{ flex: 1, padding: "9px 12px", borderRadius: 2, border: "1px solid var(--border)", fontSize: 12, color: "var(--text)", background: "var(--input)" }}
            />
            <button className="tutor-bp" style={{ padding: "8px 14px", fontSize: 12 }} disabled={!inp.trim() || loading} onClick={() => send(inp.trim())}>
              OK
            </button>
          </div>
          {turns >= minTurns && (
            <button className="tutor-bo" onClick={onNext} style={{ width: "100%", marginTop: 10 }}>
              Application →
            </button>
          )}
        </>
      )}
    </div>
  );
}
