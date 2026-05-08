import { describe, expect, it } from 'vitest';
import { getIsoWeek } from '../../src/domain/date';

describe('iso week', () => {
  it('handles year boundary correctly', () => {
    expect(getIsoWeek(new Date('2024-12-30'))).toBe(1);
    expect(getIsoWeek(new Date('2025-01-02'))).toBe(1);
  });
});
