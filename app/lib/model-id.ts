/**
 * Match-friendly normalization for model identifiers.
 *
 * Why this exists: the catalog uses one convention for IDs
 * (`Mixtral-8x7B-Instruct-v0.1-Q5_K_M`) but the runtime resolves
 * each catalog ref to a real Hugging Face filename and stores the
 * model under that filename's stem (which on TheBloke / mradermacher
 * GGUFs looks like `Mixtral-8x7B-Instruct-v0.1.q5_k_m`). Exact-string
 * matching then misses the round-trip and the model lands in the
 * "Custom model — not in our catalog" orphan bucket on the Models
 * page even though the user just downloaded it from our catalog.
 *
 * The fix is intentionally permissive — case folded, dots and
 * underscores collapsed to a single dash, trailing `.gguf` stripped.
 * It's _only_ used for catalog ⇄ installed-model matching; the raw
 * IDs are never rewritten on disk or in API requests, so a false
 * positive here at worst displays a model under a slightly nicer
 * name. Keeping it more aggressive than necessary is safer than
 * keeping it stricter and shipping more orphan rows.
 */

export function normalizeModelId(id: string): string {
  return id
    .toLowerCase()
    .replace(/\.gguf$/, "")
    // Treat `.` and `_` as separator-equivalent to `-`. This is what
    // makes `v0.1.q5_k_m` and `v0.1-Q5_K_M` collapse to the same
    // canonical form.
    .replace(/[._]/g, "-")
    // Collapse runs of dashes that the substitutions above sometimes
    // produce (e.g. `--` from `Q4_K_M-...`). Cosmetic but keeps the
    // canonical form predictable.
    .replace(/-+/g, "-");
}

/**
 * `true` iff `a` and `b` refer to the same model under the
 * normalization above. Cheap; no caching needed.
 *
 * Also treats a single leading org/namespace segment as optional so a
 * Hugging Face stem like `google_gemma-3-27b-it-Q4_K_M` matches the
 * catalog id `Gemma-3-27B-it-Q4_K_M`. Without this, vision attach and
 * other catalog gates fail for publisher-prefixed runtime names.
 */
export function modelIdsMatch(a: string, b: string): boolean {
  const na = normalizeModelId(a);
  const nb = normalizeModelId(b);
  if (na === nb) return true;
  return na.endsWith("-" + nb) || nb.endsWith("-" + na);
}
