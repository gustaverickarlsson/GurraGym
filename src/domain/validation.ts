import type { GurraGymData, WorkoutLog } from './types';

export function sanitizeDataShape(value: unknown): GurraGymData {
  if (!value || typeof value !== 'object') {
    return { phases: [], logs: [], gyms: [] };
  }
  const candidate = value as Partial<GurraGymData>;
  return {
    ...candidate,
    phases: Array.isArray(candidate.phases) ? candidate.phases : [],
    logs: Array.isArray(candidate.logs) ? candidate.logs : [],
    gyms: Array.isArray(candidate.gyms) ? candidate.gyms : []
  };
}

export function normalizeLogEntry(log: unknown): WorkoutLog | null {
  if (!log || typeof log !== 'object') return null;
  const entry = log as Partial<WorkoutLog>;
  const week = Number(entry.week);
  if (!entry.phaseId || !entry.day || !Number.isFinite(week)) return null;
  return {
    id: typeof entry.id === 'string' ? entry.id : '',
    phaseId: entry.phaseId,
    week,
    day: String(entry.day),
    date: entry.date || '',
    gym: entry.gym || '',
    exercises: Array.isArray(entry.exercises) ? entry.exercises : []
  };
}
