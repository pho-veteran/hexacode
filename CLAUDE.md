# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hexacode is an online coding judge platform with a React frontend, FastAPI microservice backend, and asynchronous judge workers. Local infrastructure uses Docker Compose with PostgreSQL, MinIO, Redis, and ElasticMQ (SQS-compatible queue).

## Quick Start

```powershell
# Start local stack
docker compose -f docker-compose.local.yml up -d --build

# Frontend dev server
npm --prefix hexacode-frontend run dev

# Frontend build
npm --prefix hexacode-frontend run build

# Frontend lint
npm --prefix hexacode-frontend run lint
```

## Architecture

```
frontend (Vite+React) --> gateway (8080) --> identity-service / problem-service / submission-service
                                                        |                        |
                                                      PostgreSQL              PostgreSQL
                                                         |                        |
                                                       MinIO                   MinIO
                                                         |                        |
                                                      Redis                   ElasticMQ (queue)
                                                                                 |
                                                                               worker
```

- **gateway**: thin public entrypoint, routes to backend services, simulates AWS API Gateway for chat
- **identity-service**: auth context, user-role management via `/api/auth/me`
- **problem-service**: problem catalog, authoring, tags, testsets, checkers; caches reads in Redis
- **submission-service**: submissions, judge job dispatch via SQS, results
- **worker**: consumes queue, compiles and executes code, posts results back

## Key Commands

```powershell
# Check service status
docker compose -f docker-compose.local.yml ps

# Import problem catalog (after stack is up)
docker compose -f docker-compose.local.yml exec -T problem-service python scripts/import_problem_catalog.py --catalog-dir /workspace/data/problems --skip-env-file --reset-existing

# Grant admin role to a user
docker compose -f docker-compose.local.yml exec -T postgres psql -U hexacode -d hexacode -c "insert into app_identity.user_role_assignments (user_id, role_code) select id, 'admin' from app_identity.users where username = '<username>' on conflict (user_id, role_code) do nothing;"

# Full fresh start (reset volumes + import catalog)
docker compose -f docker-compose.local.yml down
docker volume rm hexacode-backend_postgres-data hexacode-backend_minio-data
docker compose -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.local.yml exec -T problem-service python scripts/import_problem_catalog.py --catalog-dir /workspace/data/problems --skip-env-file --reset-existing
```

## Codebase Structure

- `hexacode-frontend/src/app/` — routing, layout, auth integration
- `hexacode-frontend/src/features/` — feature modules (problem solving, dashboard, etc.)
- `hexacode-frontend/src/components/` — shared UI components
- `hexacode-frontend/src/lib/` — API client, utilities
- `hexacode-frontend/src/stores/` — Zustand stores
- `hexacode-backend/services/api-gateway/app/main.py` — gateway entrypoint
- `hexacode-backend/services/identity-service/app/main.py` — identity service
- `hexacode-backend/services/problem-service/app/main.py` — problem service
- `hexacode-backend/services/submission-service/app/main.py` — submission service
- `hexacode-backend/services/worker/app/main.py` — judge worker
- `hexacode-backend/db/new-app-schema.sql` — authoritative schema (app_identity, problem, submission, storage schemas)
- `hexacode-backend/scripts/import_problem_catalog.py` — catalog import script
- `data/problems/` — curated seed problem catalog (source of truth for imports)

## Semantic Code Search

This project uses **CocoIndex Code (ccc)** for semantic search.

```powershell
# Search the codebase
ccc search <query>

# Examples
ccc search database connection pooling
ccc search user authentication flow
ccc search error handling retry logic

# Filter by language
ccc search --lang python --lang markdown database schema

# Filter by path
ccc search --path 'src/api/*' request validation
```

The index is already built (122 files, 1748 chunks). Re-index with `ccc index` after adding or renaming significant files.

## Data Ownership

- `app_identity` schema: users, roles, permissions (identity-service owner)
- `problem` schema: problems, tags, testsets, testcases, checkers (problem-service owner)
- `submission` schema: runtimes, submissions, jobs, runs, results (submission-service owner)
- `storage` schema: object metadata shared across services

Services must not share table ownership. Cross-service joins are minimized.

## Auth Model

- Cognito handles sign-in and token issuance in the browser
- Local app authorization is role/capability based in PostgreSQL
- User rows are created locally after first authenticated sign-in
- Role assignments live in Postgres, independent from Cognito groups

## MinIO Console

- URL: `http://127.0.0.1:19001`
- Credentials: `minioadmin` / `minioadmin`

## Cloud Deployment

Deployment documentation:
- `docs/aws.md` — AWS architecture and resource sizing reference
- `docs/aws-deployment-walkthrough.md` — step-by-step AWS deployment runbook
- `docs/ecr.md` — how to push Docker images to ECR
- `docs/plan.md` — master architecture plan

Local and cloud differ by adapters (MinIO→S3, ElasticMQ→SQS), not by route or payload design. The goal is adapter swap, not contract rewrite.

## Commit Rules

- **Never commit changes unless the user explicitly asks.**
- Never run `git commit` proactively.
- After completing a task, you may propose a commit message if asked, but do not create commits without user request.
