# Hexacode Architecture

This is the kept high-level architecture note for the active Hexacode codebase.

## Purpose

Hexacode is an online coding judge platform with:

- a React frontend
- a FastAPI microservice backend
- asynchronous judge workers
- PostgreSQL, MinIO, Redis, and an SQS-compatible queue for local development

## Active Components

- `hexacode-frontend/`
  - public app
  - dashboard
  - problem solving workspace
- `hexacode-backend/services/api-gateway`
  - public backend entrypoint
- `hexacode-backend/services/identity-service`
  - `/api/auth/me`
  - user status
  - app roles and permissions
- `hexacode-backend/services/problem-service`
  - problems
  - tags
  - testsets
  - checker metadata
- `hexacode-backend/services/submission-service`
  - runtimes
  - submissions
  - judge jobs
  - results
- `hexacode-backend/services/worker`
  - queue consumer for judge execution

## Local Infrastructure

- PostgreSQL
  - shared database, service-owned schemas
- MinIO
  - problem and submission object storage
- Redis
  - cache and fast invalidation support
- ElasticMQ
  - local SQS-compatible judge queue

## Auth And Authorization

- Cognito is the identity provider
- local app authorization is role/capability based
- identity-service is the app boundary for auth context and user-role management

## Data Ownership

- `app_identity`
  - users, roles, permissions
- `problem`
  - problems, tags, testsets, testcases, checkers
- `submission`
  - runtimes, submissions, jobs, runs, results
- `storage`
  - object records

The schema source of truth is `hexacode-backend/db/new-app-schema.sql`.

## Request Flow

1. Frontend calls the gateway.
2. Gateway routes to the correct backend service.
3. Services read/write PostgreSQL and object storage as needed.
4. Submission-service enqueues judge jobs.
5. Worker consumes queue messages and posts results back to submission-service.

## Problem Data Flow

Problem content is curated in `data/problems/`.

Import flow:

1. statements and testcase assets are read from `data/problems/`
2. `scripts/import_problem_catalog.py` imports them
3. problem metadata is written to PostgreSQL
4. assets are uploaded to MinIO

## Development Rules

- keep the gateway thin
- keep domain logic in services
- keep worker execution isolated from HTTP request handling
- keep local contracts aligned with future cloud deployment

For the future cloud target, see `docs/cloud-deployment.md`.

- problems
- tags
- statements
- problem assets
- testsets
- testcases
- checkers
- public problem reads

### Submission Service

Owns:

- runtimes
- submissions
- judge jobs
- judge runs
- results
- run metrics
- outbox events

### Worker

Owns:

- code execution
- sandbox orchestration
- downloading required execution assets
- compile/run lifecycle
- result publication back to submission service

Rule:

- worker is execution-only, not a state owner

## Data Ownership

Current database ownership shape is already reflected in `hexacode-backend/db/new-app-schema.sql`.

Use:

- `app_identity.users` for minimal Cognito identity mapping
- `storage.objects` for shared object metadata
- `problem.*` for problem-service state
- `submission.*` for submission-service state

Rules:

- services may share one PostgreSQL cluster at first
- services must not share table ownership logically
- each service keeps its own schema bootstrap ownership
- cross-service joins are tolerated only during the initial single-cluster period and should be minimized

## Auth Contract

Required auth contract from day one:

- Cognito issuer
- audience
- JWKS validation
- normalized user context
- claim or group mapping policy

Rules:

- frontend authenticates through Cognito
- services validate Cognito JWTs reliably
- local gateway may do thin boundary verification, but auth trust lives at the service boundary

## Gateway Strategy

### Local

Use:

- one thin gateway or reverse-proxy container

It should do only:

- path routing
- CORS
- correlation ids
- optional thin JWT verification
- proxying to legacy or new services

It should not become permanent platform code.

### Cloud

Use:

- AWS API Gateway HTTP API as the public backend entrypoint
- VPC Link to internal ALB or equivalent routing layer

Rules:

- keep route definitions in one manifest or OpenAPI source
- generate local gateway rules and cloud gateway rules from the same source
- replacing the local gateway with AWS API Gateway must be a deployment concern, not an app rewrite

## Storage Strategy

Use one S3-compatible storage contract in every environment.

Local:

- MinIO

Cloud:

- S3

Store in PostgreSQL only:

- `bucket`
- `object_key`
- `content_type`
- `size`
- `checksum`
- `original_filename`

Do not store:

- absolute machine paths
- Windows-specific paths
- binary blobs in PostgreSQL

Recommended object key patterns:

- `problem/{problem_id}/statement/{asset_id}.md`
- `problem/{problem_id}/media/{asset_id}.pdf`
- `testset/{testset_id}/archive/{asset_id}.zip`
- `testset/{testset_id}/cases/{ordinal}/input.inp`
- `testset/{testset_id}/cases/{ordinal}/output.out`
- `submission/{submission_id}/source/{asset_id}.cpp`
- `submission/{submission_id}/artifacts/{asset_id}.log`

## Queue Strategy

Use the final async shape from the beginning.

Local:

- SQS-compatible emulator such as LocalStack SQS or ElasticMQ

Cloud:

- SQS with DLQ

Rules:

- submission service owns dispatch state
- outbox exists from day one
- worker consumes final-shaped messages from day one
- result-ingest payload shape is final from day one

Do not:

- start with DB polling if the target architecture is queue-based

## Cache Strategy

Use:

- Redis locally
- ElastiCache Redis in cloud

Cache first:

- public problem list
- public problem detail

Invalidate on:

- problem metadata change
- statement change
- testset change
- tags change
- visibility change
- publish state change

## Environment Shape

### Local

Default local topology:

- `frontend -> Cognito + thin gateway -> problem/submission/legacy backend`
- `worker -> queue emulator -> submission-service contracts`
- PostgreSQL
- MinIO
- Redis

### Cloud

Default cloud topology:

- frontend hosting
- Cognito
- optional CloudFront
- optional WAF
- AWS API Gateway HTTP API
- VPC Link
- internal ALB or equivalent private routing layer
- problem service
- submission service
- worker
- legacy backend still reachable during cutover
- RDS PostgreSQL
- S3
- ElastiCache Redis
- SQS + DLQ

## Final-First Implementation Order

### 1. Freeze Shared Contracts

Define and version:

- route manifest or OpenAPI
- auth identity contract
- normalized user context
- storage object model
- queue payloads
- worker result payloads
- error envelope
- health-check contract

### 2. Build Final Local Platform Primitives

Implement:

- thin local gateway
- Cognito integration
- PostgreSQL
- MinIO
- Redis
- queue emulator
- shared config and secret conventions
- logging and tracing baseline

### 3. Create Final Service Skeletons

Create:

- `api-gateway`
- `problem-service`
- `submission-service`
- `worker`

Each service should have:

- FastAPI structure
- health endpoint
- config loading
- auth dependency layer
- OpenAPI
- schema setup
- structured logging

### 4. Implement Submission Pipeline In Final Shape

Build in this order:

1. runtime catalog
2. submission create flow
3. outbox publishing
4. queue dispatch
5. worker consumption
6. result ingest
7. submission status and result reads

This comes before broad feature work because it locks the hardest final-state backend contracts.

### 5. Implement Problem Service In Final Shape

Build:

- problem CRUD
- tags
- statement storage
- problem assets
- testsets
- testcases
- checker configuration
- public reads
- cache-backed public reads

### 6. Implement Frontend Against Final Contracts

Build:

1. auth routes and callback
2. problem library
3. problem detail
4. solve workspace
5. problem authoring

Rule:

- frontend uses only gateway routes

### 7. Promote To Cloud

Promote by adapter swap, not contract rewrite:

1. keep the same route manifest
2. replace local gateway with AWS API Gateway HTTP API
3. replace MinIO with S3
4. replace queue emulator with SQS
5. keep service contracts unchanged

## Required Decisions Before Coding Deeply

Lock these before major implementation starts:

- route manifest format
- AWS API Gateway promotion model
- Cognito app-client and claim model
- storage bucket and key policy
- queue payload schema and versioning policy
- service-to-service auth approach
- schema ownership per service
- observability baseline
- CI/CD deployment model

## CI/CD Proposal

Use CI/CD that matches the final architecture from the beginning.

### CI

On pull request:

- lint
- typecheck
- backend tests
- frontend tests
- contract checks
- schema bootstrap checks
- build service images

Required smoke tests:

- gateway + service route smoke test
- Cognito token-validation smoke test
- problem asset upload smoke test
- submission queue-to-worker smoke test

Implement the local/CI smoke harness once and reuse it in both places, instead of maintaining separate ad hoc scripts.

### CD

Use:

- container registry such as ECR
- IaC-managed environments
- environment promotion through dev -> staging -> production

Deployment rules:

- deploy behind reversible routing where possible
- keep previous images available
- keep schema changes backward-compatible during rollout
- never couple route cutover, queue redesign, and schema breakage in one deploy

## What To Avoid

Do not start with:

- frontend-first development
- contest extraction
- class or semester extraction
- report or notification systems
- heavy custom gateway logic
- local filesystem-only storage logic
- direct worker writes into submission state tables
- temporary transport or storage designs that will be replaced immediately after

## Deferred Scope

Defer until the core platform is stable:

- contest extraction
- class management
- semester management
- subject management
- reports
- notifications
- discussions and editorials
- gamification and secondary platform features

## Success Criteria

The docs are aligned for execution if:

- there is one master plan only
- backend service docs follow the same architecture
- frontend plan assumes the same backend contracts
- local and cloud differ by adapters, not by route or payload design
- gateway replacement with AWS API Gateway is straightforward
- worker stays execution-only
- queue and storage contracts do not need redesign later
