# Future Cloud Deployment

This document keeps only the target cloud shape for Hexacode. It is intentionally high level.

## Target Platform

- Frontend: static build served through CDN/object storage
- Public API entrypoint: AWS API Gateway
- Auth: AWS Cognito
- Chat inference: AWS Lambda calling Amazon Bedrock
- Services: containerized FastAPI services
- Database: PostgreSQL
- Object storage: S3
- Cache: Redis / ElastiCache
- Queue: SQS
- Judge workers: isolated worker containers

## Service Mapping

- `identity-service`
  - role and user-management APIs
  - Cognito token verification
- `problem-service`
  - problem catalog
  - authoring/testset/checker management
- `submission-service`
  - submissions
  - judge jobs and results

For chat, local development may simulate API Gateway by invoking Lambda directly, while cloud deployment should use the real public AWS API Gateway -> Lambda/Bedrock route.
- `worker`
  - asynchronous judge execution only

## Cloud Principles

- keep the gateway thin
- keep business logic inside services
- keep shared contracts stable across local and cloud
- keep worker execution isolated from public traffic
- keep storage and queue integrations compatible with local MinIO and ElasticMQ behavior

## Deployment Expectations

- frontend build promoted independently from backend services
- services deployed as separate containers
- schema applied from `hexacode-backend/db/new-app-schema.sql`
- problem catalog import remains script-driven, not baked into deployment

## Data And Secrets

- never store secrets in the repo
- use managed secrets/config for Cognito, database, S3, and queue credentials
- use separate cloud buckets for problem assets and submission artifacts

## Minimum Production Observability

- per-request correlation IDs
- structured logs for gateway, services, and worker
- queue/job failure visibility
- health endpoints for all public services
