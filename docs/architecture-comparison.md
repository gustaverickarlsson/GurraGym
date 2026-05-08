# Architecture Comparison

## Old Architecture (Current Production)
- **Stack:** vanilla HTML/CSS/JS in root files.
- **Strengths:** minimal tooling, easy static hosting, fast startup.
- **Weaknesses:** large monolith (`app.js`), difficult testing, higher regression risk, limited quality gates.

## New Architecture Foundation
- **Stack:** React + TypeScript + Vite scaffold with domain modules.
- **Strengths:** typed domain boundaries, modular growth path, better testability and CI integration.
- **Tradeoff:** introduces build tooling and migration complexity.

## What Each Offers That Is Good
- **Old offers:** simplicity and low operational overhead.
- **New offers:** maintainability, test coverage, and safer feature iteration.

## Migration Principle
- Keep current app functioning while moving logic into typed domain modules.
- Port feature-by-feature instead of risky full rewrite.
