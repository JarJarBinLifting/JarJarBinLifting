import { useRef, useState } from "react";
import { DIFFS, type Diff } from "../prompts";

export interface StartConfig {
  diff: Diff;
  adhd: boolean;
  text: string;
  fileContent: { type: "document" | "image"; source: { type: "base64"; media_type: string; data: string } } | null;
}

export function InputPhase({
  chapterName,
  onStart,
}: {
  chapterName: string;
  onStart: (cfg: StartConfig) => void;
}) {
  const [diff, setDiff] = useState<Diff>(DIFFS[0]);
  const [text, setText] = useState("");
  const [fname, setFname] = useState("");
  const [fileError, setFileError] = useState("");
  const [fdata, setFdata] = useState<StartConfig["fileContent"]>(null);
  const [adhd, setAdhd] = useState(false);
  const fref = useRef<HTMLInputElement>(null);

  // Anthropic caps requests at 32 MB (and PDFs at 100 pages); past ~28 MB of
  // file the base64-encoded body would exceed that anyway, so reject early
  // with a real explanation instead of letting the request fail opaquely.
  const MAX_FILE_BYTES = 28 * 1024 * 1024;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setFileError(`« ${f.name} » fait ${(f.size / 1024 / 1024).toFixed(1)} Mo — trop lourd pour l'API (limite ~28 Mo). Découpe le PDF ou colle le texte du chapitre.`);
      setFname("");
      setFdata(null);
      e.target.value = "";
      return;
    }
    setFileError("");
    setFname(f.name);
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      const b = result.split(",")[1];
      if (f.type === "application/pdf") {
        setFdata({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b } });
      } else if (f.type.startsWith("image/")) {
        setFdata({ type: "image", source: { type: "base64", media_type: f.type, data: b } });
      } else {
        const t2 = new FileReader();
        t2.onload = () => setText(t2.result as string);
        t2.readAsText(f);
        setFdata(null);
      }
    };
    r.readAsDataURL(f);
  };

  const ok = text.trim() || fdata;

  return (
    <div className="tutor-card">
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h2 style={{ fontFamily: "var(--font-story)", fontSize: 20, color: "var(--t-pri)", marginBottom: 6 }}>{chapterName}</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>Parcours actif en 5 étapes</p>
      </div>

      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Contenu du chapitre</label>
      <textarea
        className="tutor-tf"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Colle ici le texte du chapitre à maîtriser…"
        rows={7}
        style={{ marginTop: 4 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input type="file" ref={fref} onChange={handleFile} accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" style={{ display: "none" }} />
        <button className="tutor-bo" onClick={() => fref.current?.click()}>
          Importer
        </button>
        {fname && <span style={{ fontSize: 11, color: "var(--t-ok)", fontWeight: 500 }}>{fname}</span>}
      </div>
      {fileError && <p style={{ marginTop: 8, fontSize: 12, color: "var(--t-err)", lineHeight: 1.5 }}>{fileError}</p>}

      <div style={{ marginTop: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Difficulté du QCM</label>
        <select
          value={diff}
          onChange={(e) => setDiff(e.target.value as Diff)}
          style={{ width: "100%", marginTop: 4, background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: "10px 14px", color: "var(--text)", fontSize: 14 }}
        >
          {DIFFS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>

      <div className={`tutor-adhd-card${adhd ? " on" : ""}`} style={{ marginTop: 14 }} onClick={() => setAdhd(!adhd)}>
        <div>
          <strong style={{ fontSize: 13, color: adhd ? "var(--t-pri)" : "var(--text)" }}>Mode TDAH / concentration {adhd ? "— activé" : ""}</strong>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
            Micro-blocs avec pauses planifiées, une question à la fois, réponses par choix rapide, feedback immédiat, animations réduites, pause/reprise à tout moment.
          </p>
        </div>
      </div>

      <button
        className="tutor-bp"
        disabled={!ok}
        onClick={() => onStart({ diff, adhd, text, fileContent: fdata })}
        style={{ width: "100%", marginTop: 14, padding: "13px 24px", fontSize: 15 }}
      >
        {adhd ? "Juste le 1er concept (2 min) →" : "Commencer la maîtrise →"}
      </button>
    </div>
  );
}
