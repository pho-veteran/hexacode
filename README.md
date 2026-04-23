# Hexacode

Hexacode is an online coding judge platform with a React frontend, a FastAPI microservice backend, PostgreSQL, MinIO, Redis, and an SQS-compatible judge queue.

## Repository Layout

- `hexacode-frontend/` active frontend
- `hexacode-backend/` backend services, shared backend code, contracts, and schema
- `data/problems/` curated problem catalog used for fresh imports
- `scripts/` utility scripts, including catalog import and smoke flows
- `docs/plan.md` high-level app architecture
- `docs/cloud-deployment.md` future cloud deployment shape

## Local Requirements

- Node.js 20+
- Python 3.12+
- Docker Desktop with Compose

## Installation

Frontend:

```powershell
npm --prefix hexacode-frontend install
```

Backend local Python usage is optional if you use Docker for services. If you want to run backend scripts from the host, create a virtual environment and install the service dependencies you need from `hexacode-backend/services/*/pyproject.toml`.

## Start The Local Stack

```powershell
docker compose -f docker-compose.local.yml up -d --build
```

Main local endpoints:

- Frontend: `http://127.0.0.1:3000`
- Gateway: `http://127.0.0.1:8080`
- Gateway docs: `http://127.0.0.1:8080/docs`

Local service ports from Compose:

- `frontend` -> `3000`
- `gateway` -> `8080`
- `identity-service` -> `8003`
- `problem-service` -> `8001`
- `submission-service` -> `8002`
- `postgres` -> `15432`
- `minio api` -> `19000`
- `minio console` -> `19001`
- `redis` -> `16379`
- `elasticmq` -> `19324`

## Architecture Summary

- `frontend`
  - Vite + React application
  - talks only to the gateway
  - handles Cognito sign-in in the browser
- `gateway`
  - single public API entrypoint
  - routes requests to backend services
  - keeps the frontend isolated from internal service URLs
- `identity-service`
  - local user bootstrap into `app_identity.users`
  - role and permission management
  - `/api/auth/me` and dashboard user administration
- `problem-service`
  - public problem catalog and problem detail APIs
  - dashboard authoring flows for problems, tags, testsets, and checker metadata
  - catalog import target for `data/problems`
- `submission-service`
  - runtime profiles, submission creation, judge job dispatch, results, and submission history
- `chat-lambda`
  - AWS Lambda handler for Bedrock-backed chat
  - intended to sit behind API Gateway in cloud
- `worker`
  - consumes queued judge jobs
  - compiles code and executes sample runs or full submissions

Shared infrastructure:

- PostgreSQL
  - primary relational database
  - stores users, roles, problems, tags, testsets, testcases, submissions, judge jobs, results, and storage metadata
- MinIO
  - S3-compatible object storage
  - stores statement files, testcase archives, testcase input/output files, checker source/binaries, and submission artifacts
- Redis
  - cache layer only
  - currently used for fast-read data such as public problem catalog responses and cache-version invalidation
  - Redis can be wiped without losing source-of-truth data because Postgres and MinIO remain authoritative
- ElasticMQ
  - local SQS-compatible queue emulator
  - used by `submission-service` and `worker` for judge-job delivery in local development

## Fresh Database Setup

In this repository, "fresh database setup" means:

1. create a brand new local Postgres data volume
2. let the services bootstrap the schema from `hexacode-backend/db/new-app-schema.sql`
3. import the curated problem catalog from the root `data/problems/` folder

This is a full local reset. It removes existing Postgres data and MinIO object data.

The services bootstrap the shared schema from `hexacode-backend/db/new-app-schema.sql` on startup.

For a clean local reset:

1. Stop the stack

```powershell
docker compose -f docker-compose.local.yml down
```

2. Remove persisted local database and object-storage volumes

```powershell
docker volume rm hexacode-backend_postgres-data hexacode-backend_minio-data
```

3. Start the stack again so the empty database is recreated and schema bootstrap runs

```powershell
docker compose -f docker-compose.local.yml up -d --build
```

This recreates:

- a new `hexacode` Postgres database
- all schemas and tables from `new-app-schema.sql`
- MinIO buckets required by the backend
- Redis and ElasticMQ dependencies

At this point the database is structurally ready, but it does not yet contain your curated problem catalog.

## Fresh Problem Data Import

The curated catalog lives in the root `data/problems/` folder.

Important detail: the local Compose file mounts that folder into `problem-service` as:

- host: `./data`
- container: `/workspace/data`

So the import command reads from `/workspace/data/problems` inside the container, which is the same content as the root `data/problems/` folder in this repo.

To load the curated catalog into the fresh database:

```powershell
docker compose -f docker-compose.local.yml exec -T problem-service python scripts/import_problem_catalog.py --catalog-dir /workspace/data/problems --skip-env-file --reset-existing
```

What this does:

- bootstraps schema/buckets if needed unless explicitly skipped
- reads `data/problems/catalog.json`
- reads each problem statement and testcase directory under `data/problems/`
- uploads statement assets and testcase archives to MinIO
- writes tags, problems, testsets, testcases, and checker metadata into PostgreSQL
- when `--reset-existing` is used, clears existing imported catalog data first

After import, the local stack should have:

- real problems available in the public catalog
- testcase assets present in MinIO
- problem metadata and ownership rows in Postgres

Recommended full fresh-start sequence:

```powershell
docker compose -f docker-compose.local.yml down
docker volume rm hexacode-backend_postgres-data hexacode-backend_minio-data
docker compose -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.local.yml exec -T problem-service python scripts/import_problem_catalog.py --catalog-dir /workspace/data/problems --skip-env-file --reset-existing
```

## Runtime Data Notes

What survives in each local dependency:

- Postgres volume
  - users, roles, problems, submissions, judge records
- MinIO volume
  - uploaded objects and testcase archives
- Redis
  - only cache data, safe to flush
- ElasticMQ
  - queue state for local judge jobs

If you want a truly fresh local environment, reset Postgres and MinIO first, then rerun the catalog import.

## Useful Commands

Frontend build:

```powershell
npm --prefix hexacode-frontend run build
```

Frontend lint:

```powershell
npm --prefix hexacode-frontend run lint
```

Check local service status:

```powershell
docker compose -f docker-compose.local.yml ps
```

Re-import the catalog without recreating volumes:

```powershell
docker compose -f docker-compose.local.yml exec -T problem-service python scripts/import_problem_catalog.py --catalog-dir /workspace/data/problems --skip-env-file --reset-existing
```

Open the MinIO console:

- `http://127.0.0.1:19001`
- default local credentials from Compose:
  - username: `minioadmin`
  - password: `minioadmin`

## Current Auth Model

- Cognito handles sign-in and token issuance
- app authorization is role/capability based in the local database
- user rows are created locally in `app_identity.users` after authenticated access
- role assignments live in Postgres and are independent from raw Cognito groups

## Deployment Direction

Local development uses Docker Compose.

Future cloud deployment targets are documented in `docs/cloud-deployment.md`.
