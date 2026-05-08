# Improvement Roadmap

## Next 2 Weeks
- Expand XSS hardening to every dynamic rendering path.
- Add integration tests for autosave/import/export conflict handling.
- Add smoke E2E in CI for critical tab flows.

## Next 4-6 Weeks
- Start UI migration to React feature slices:
  - `log` first (highest business value)
  - then `program` and `history`
  - then `phases` admin
- Move legacy data logic into `src/domain` and `src/data` repositories.

## Next 2-3 Months
- Add migration layer for persisted data versions.
- Add release management: semantic tags, changelog, rollback playbook.
- Add privacy-aware telemetry for crash/error diagnostics.
