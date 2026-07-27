import type { SourceReference } from "../lib/types";

/** The excerpt appears only after an answer is exposed, so it grounds the
 * correction in the supplied chapter without replacing active recall. */
export function SourceExcerpt({ reference }: { reference: SourceReference | null | undefined }) {
  if (!reference?.extrait) return null;
  return (
    <aside style={{ marginTop: 12, padding: "10px 11px", borderLeft: "3px solid var(--accent-blue)", background: "color-mix(in srgb,var(--accent-blue) 7%,var(--card))", color: "var(--text)" }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".55px", textTransform: "uppercase", color: "var(--accent-blue)", marginBottom: 5 }}>
        Extrait déclaré du support{reference.section ? ` · ${reference.section}` : ""}
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>« {reference.extrait} »</p>
    </aside>
  );
}
