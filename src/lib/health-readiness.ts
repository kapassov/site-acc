export function recentSuccessfulProbeAge(
  now: number,
  lastSuccessAt: number | null,
  maximumAgeMs: number,
): number | null {
  if (!Number.isFinite(now) || lastSuccessAt === null || !Number.isFinite(lastSuccessAt) || lastSuccessAt <= 0
      || !Number.isFinite(maximumAgeMs) || maximumAgeMs <= 0) return null;
  const age = Math.max(0, now - lastSuccessAt);
  return age <= maximumAgeMs ? age : null;
}

export function dependencyReadiness(input: {
  postgresRequired: boolean;
  postgresReady: boolean;
  medusaRequired: boolean;
  medusaReachable: boolean;
  medusaStale?: boolean;
}): { ready: boolean; degraded: boolean } {
  const ready = (!input.postgresRequired || input.postgresReady)
    && (!input.medusaRequired || input.medusaReachable);
  return {
    ready,
    degraded: !ready || (input.medusaRequired && input.medusaStale === true),
  };
}
