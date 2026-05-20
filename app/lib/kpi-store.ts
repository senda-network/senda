import { getRedis, kvConfigured } from "./redis";
import {
  type KpiSnapshot,
  isoWeekLabel,
  previousIsoWeekLabel,
  KPI_HOUR_TTL_SEC,
  KPI_WEEK_TTL_SEC,
  kpiHourKey,
  kpiWeekKey,
  KPI_WEEK_PREFIX,
} from "./kpi-snapshot";

export async function saveKpiSnapshot(
  snapshot: KpiSnapshot,
  at = new Date(),
): Promise<{ hourKey: string; weekKey: string; backend: "redis" | "none" }> {
  const hourKey = kpiHourKey(at);
  const weekKey = kpiWeekKey(at);
  const redis = getRedis();
  if (!redis) {
    return { hourKey, weekKey, backend: "none" };
  }
  await Promise.all([
    redis.set(hourKey, snapshot, { ex: KPI_HOUR_TTL_SEC }),
    redis.set(weekKey, snapshot, { ex: KPI_WEEK_TTL_SEC }),
  ]);
  return { hourKey, weekKey, backend: "redis" };
}

export async function getKpiWeek(
  week: string,
): Promise<KpiSnapshot | null> {
  const redis = getRedis();
  if (!redis) return null;
  return redis.get<KpiSnapshot>(`${KPI_WEEK_PREFIX}${week}`);
}

export async function getKpiLatestWeek(): Promise<KpiSnapshot | null> {
  return getKpiWeek(isoWeekLabel(new Date()));
}

export function kpiStoreReady(): boolean {
  return kvConfigured();
}

export type KpiDashboardPayload = {
  storeReady: boolean;
  week: string;
  previousWeek: string;
  latest: KpiSnapshot | null;
  previous: KpiSnapshot | null;
};

export async function getKpiDashboard(
  at = new Date(),
): Promise<KpiDashboardPayload> {
  const week = isoWeekLabel(at);
  const previousWeek = previousIsoWeekLabel(at);
  if (!kvConfigured()) {
    return {
      storeReady: false,
      week,
      previousWeek,
      latest: null,
      previous: null,
    };
  }
  const [latest, previous] = await Promise.all([
    getKpiWeek(week),
    getKpiWeek(previousWeek),
  ]);
  return { storeReady: true, week, previousWeek, latest, previous };
}
