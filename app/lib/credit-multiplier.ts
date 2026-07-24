/**
 * Phase 5.B — reputation → future credit-rate multiplier.
 *
 * Policy is defined here; economically inert until `SENDA_CREDIT_SLASH` is
 * enabled (STRATEGY Decision 3 / oracle-before-slashing). Default multiplier
 * is always 1.0. Never claw back past credits — only scale future accruals.
 *
 * Grades mirror runtime `ReputationGrade` (trusted / watch / unproven).
 * `unproven` stays at 1.0 so new peers are not punished for lack of samples.
 */

export type CreditAttribution = "serving-peer" | "sla-heuristic";

const SLASH_ENV = "SENDA_CREDIT_SLASH";

/** Truthy env values that enable non-1.0 multipliers. */
export function creditSlashEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[SLASH_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Map a reputation grade to a future-accrual multiplier.
 * When slash is disabled, always returns 1.
 */
export function creditMultiplierForGrade(
  grade: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (!creditSlashEnabled(env)) return 1;
  switch ((grade ?? "").trim().toLowerCase()) {
    case "trusted":
      return 1;
    case "unproven":
      return 1;
    case "watch":
      return 0.5;
    default:
      return 1;
  }
}

/**
 * Only `serving-peer` attributions may be rate-scaled. SLA-heuristic credits
 * are ranking fallbacks — do not slash them via verify reputation.
 */
export function creditMultiplierForAttribution(
  grade: string | null | undefined,
  attribution: CreditAttribution | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (attribution !== "serving-peer") return 1;
  return creditMultiplierForGrade(grade, env);
}

/** Apply multiplier to a non-negative credit count; rounds to integer. */
export function applyCreditMultiplier(
  baseCredits: number,
  multiplier: number,
): number {
  if (!Number.isFinite(baseCredits) || baseCredits <= 0) return 0;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  const clamped = Math.min(multiplier, 1);
  return Math.round(baseCredits * clamped);
}
