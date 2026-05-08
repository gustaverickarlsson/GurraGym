import type { GurraGymData, WorkoutLog } from './types';
import { normalizeLogEntry } from './validation';

function fallbackLogKey(log: WorkoutLog): string {
  return `${log.phaseId}_${log.week}_${log.day}_${log.gym}_${JSON.stringify(log.exercises)}`;
}

function ensureLogId(log: WorkoutLog): string {
  if (log.id) return log.id;
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function mergeData(local: GurraGymData, imported: GurraGymData): GurraGymData {
  const mergedGyms = [...new Set([...(local.gyms || []), ...(imported.gyms || [])])];
  const localPhasesById = new Map((local.phases || []).map((phase) => [phase.id, phase]));
  const mergedPhases = [...(local.phases || [])];
  const importedModified = imported.lastModified || imported._exported || '';
  const localModified = local.lastModified || '';

  for (const importedPhase of imported.phases || []) {
    const existing = localPhasesById.get(importedPhase.id);
    if (!existing) {
      mergedPhases.push(importedPhase);
      continue;
    }
    if (importedModified > localModified) {
      const idx = mergedPhases.findIndex((phase) => phase.id === importedPhase.id);
      if (idx >= 0) mergedPhases[idx] = importedPhase;
    }
  }

  const logsByKey = new Map<string, WorkoutLog>();
  const ingest = (candidate: unknown) => {
    const log = normalizeLogEntry(candidate);
    if (!log) return;
    const key = log.id ? `id:${log.id}` : `fallback:${fallbackLogKey(log)}`;
    const existing = logsByKey.get(key);
    if (!existing || (log.date || '') >= (existing.date || '')) {
      logsByKey.set(key, log);
    }
  };

  for (const log of local.logs || []) ingest(log);
  for (const log of imported.logs || []) ingest(log);

  return {
    phases: mergedPhases,
    logs: Array.from(logsByKey.values()).map((log) => ({ ...log, id: ensureLogId(log) })),
    gyms: mergedGyms,
    lastModified: new Date().toISOString()
  };
}
