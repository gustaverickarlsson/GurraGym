import { describe, expect, it } from 'vitest';
import { mergeData } from '../../src/domain/merge';
import { sanitizeDataShape } from '../../src/domain/validation';

describe('domain merge', () => {
  it('keeps distinct logs for same day when ids differ', () => {
    const local = sanitizeDataShape({
      phases: [{ id: 'p1', name: 'Phase 1', weeks: [1], days: [] }],
      gyms: [],
      logs: [
        { id: 'l1', phaseId: 'p1', week: 1, day: 'Måndag', date: '2026-05-01', gym: 'Gym A', exercises: [] }
      ]
    });
    const imported = sanitizeDataShape({
      phases: [{ id: 'p1', name: 'Phase 1', weeks: [1], days: [] }],
      gyms: [],
      logs: [
        { id: 'l2', phaseId: 'p1', week: 1, day: 'Måndag', date: '2026-05-02', gym: 'Gym B', exercises: [] }
      ]
    });
    const merged = mergeData(local, imported);
    expect(merged.logs).toHaveLength(2);
  });

  it('preserves local phases when imported is older', () => {
    const local = sanitizeDataShape({
      phases: [{ id: 'p1', name: 'New Local', weeks: [1], days: [] }],
      logs: [],
      gyms: [],
      lastModified: '2026-05-10T12:00:00.000Z'
    });
    const imported = sanitizeDataShape({
      phases: [{ id: 'p1', name: 'Old Imported', weeks: [1], days: [] }],
      logs: [],
      gyms: [],
      lastModified: '2026-05-01T12:00:00.000Z'
    });
    const merged = mergeData(local, imported);
    expect(merged.phases[0].name).toBe('New Local');
  });

  it('deduplicates id-less legacy logs by fallback key', () => {
    const local = sanitizeDataShape({
      phases: [{ id: 'p1', name: 'Phase 1', weeks: [1], days: [] }],
      gyms: [],
      logs: [
        { phaseId: 'p1', week: 1, day: 'Måndag', date: '2026-05-01', gym: 'Gym A', exercises: [] }
      ]
    });
    const imported = sanitizeDataShape({
      phases: [{ id: 'p1', name: 'Phase 1', weeks: [1], days: [] }],
      gyms: [],
      logs: [
        { phaseId: 'p1', week: 1, day: 'Måndag', date: '2026-05-02', gym: 'Gym A', exercises: [] }
      ]
    });

    const merged = mergeData(local, imported);
    expect(merged.logs).toHaveLength(1);
    expect(merged.logs[0].id).toBeTruthy();
    expect(merged.logs[0].date).toBe('2026-05-02');
  });
});
