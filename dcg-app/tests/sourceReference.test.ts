import assert from "node:assert/strict";
import {
  hasUsableSourceReference,
  MIN_SOURCE_EXCERPT_LENGTH,
  sourceReferenceFrom,
} from "../src/lib/sourceReference.ts";

const excerpt = "Le support impose cette condition lorsque le seuil est depasse.";

assert.deepEqual(sourceReferenceFrom({ section: "2.1", extrait: `  ${excerpt}  ` }), {
  section: "2.1",
  extrait: excerpt,
});
assert.equal(hasUsableSourceReference({ extrait: excerpt }), true);
assert.equal(hasUsableSourceReference({ extrait: "trop court" }), false);
assert.equal(hasUsableSourceReference({ extrait: "x".repeat(MIN_SOURCE_EXCERPT_LENGTH - 1) }), false);
assert.equal(sourceReferenceFrom({ section: "2.1" }), null);

console.log("source reference checks passed");
