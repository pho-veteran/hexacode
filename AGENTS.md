# Repository Guidelines

## Project Structure & Module Organization

- `hexacode-frontend/` is the active frontend application. Main source lives in `hexacode-frontend/src/`, with route modules in `src/routes/`, app composition in `src/app/`, and shared styles/tokens in `src/styles/`.
- `hexacode-backend/` is the backend workspace. Keep shared backend code in `hexacode-backend/backend_common/`, service code in `hexacode-backend/services/`, contracts in `hexacode-backend/contracts/`, and database artifacts in `hexacode-backend/db/`.
- `docs/` contains the kept architecture notes. Treat `docs/plan.md` as the high-level app architecture note and `docs/cloud-deployment.md` as the future cloud target.
- `hexacode-reactjs/` is not part of the active application path and should not be treated as current product code.

## Build, Test, and Development Commands

Run frontend commands from the repo root with `npm --prefix hexacode-frontend ...` or `cd hexacode-frontend` first. Run backend commands from `hexacode-backend/`.

- `npm --prefix hexacode-frontend install` installs frontend dependencies.
- `npm --prefix hexacode-frontend run dev` starts the Vite dev server.
- `npm --prefix hexacode-frontend run build` creates the production build.
- `npm --prefix hexacode-frontend run preview` serves the built app locally.
- `npm --prefix hexacode-frontend run lint` runs ESLint checks.
- `docker compose -f docker-compose.local.yml config` validates the local stack.
- `docker compose -f docker-compose.local.yml up --build` boots the frontend, backend services, Postgres, MinIO, Redis, and ElasticMQ.

## Coding Style & Naming Conventions

- Use TypeScript with `strict` mode expectations; prefer explicit types at boundaries.
- Follow existing formatting: 2-space indentation, semicolons, double quotes in TS/TSX.
- Use `PascalCase` for React components, `camelCase` for functions/variables, and kebab-case for Markdown doc filenames.
- Keep route modules small and colocated under `src/routes/`. Use the project path alias convention (`@/*`) for imports from `src/`.

## Testing Guidelines

- No dedicated test runner is configured yet. Until one is added, `typecheck` and `build` are the minimum pre-PR checks.
- If you add tests, place unit/component tests as `*.test.ts(x)` near the source file and keep any future end-to-end specs in a top-level `tests/` folder inside `hexacode-frontend/`.

## Commit & Pull Request Guidelines

- Current Git history is minimal (`Initial commit from create-react-router`), so use short, imperative commit subjects. Prefer scoped messages such as `frontend: add problem route shell`.
- PRs should include: purpose, affected paths, manual verification steps, related docs/schema updates, and screenshots for UI changes.
- Keep PRs focused. If code changes alter contracts, update `docs/plan.md`, `docs/cloud-deployment.md`, or `hexacode-backend/db/` in the same PR.

## Security & Configuration Tips

- Never commit secrets, Cognito credentials, or `.env` files.
- Keep local/cloud behavior aligned with `docs/plan.md` and `docs/cloud-deployment.md`: Cognito for auth, MinIO/S3-compatible storage, and a thin gateway contract.
