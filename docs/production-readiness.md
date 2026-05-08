# Production Readiness Checklist

## Status After This Pass
- **Data safety:** improved import merge behavior and storage parse resilience.
- **Security baseline:** reduced unsafe HTML interpolation in critical flows and added CSP.
- **Accessibility baseline:** added labels for key controls and visible focus styles.
- **PWA behavior:** improved update strategy to avoid stale app lock-in.
- **Testing:** unit tests added for merge/validation/date logic.
- **CI:** workflow now runs lint and tests before deploy.

## Remaining Gaps Before Strong Production Grade
- Expand sanitization to all render paths still using template HTML with user values.
- Add integration/E2E tests for end-to-end logging/import flows.
- Add error telemetry and release tagging/changelog process.
- Remove personal data/export artifacts from repo history and enforce ignore rules.
