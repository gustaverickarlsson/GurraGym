import { describe, expect, it } from 'vitest';
import { normalizeLogEntry, sanitizeDataShape } from '../../src/domain/validation';

describe('domain validation', () => {
  it('returns safe empty shape for invalid input', () => {
    expect(sanitizeDataShape(null)).toEqual({ phases: [], logs: [], gyms: [] });
  });

  it('normalizes valid logs and rejects malformed logs', () => {
    const valid = normalizeLogEntry({
      id: 'x1',
      phaseId: 'p1',
      week: '2',
      day: 'Tisdag',
      exercises: []
    });
    expect(valid?.week).toBe(2);
    expect(normalizeLogEntry({ phaseId: 'p1' })).toBeNull();
  });
});
