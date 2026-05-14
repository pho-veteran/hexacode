# W5 Evidence Pack — Hexacode

## 1. Cover

- **Project:** Hexacode
- **Week:** W5 — The Network Fortress
- **Repository:** To be added before Friday presentation
- **Prior evidence pack:** To be added before Friday presentation
- **Target production region:** us-west-2
- **Architecture path:** Path C — Justified Single-VPC

## 2. MH1 — Multi-VPC Connectivity: Justified Single-VPC

### Decision

Hexacode chooses **Path C — Justified Single-VPC** for W5.

### Production rationale

Hexacode is one tightly coupled production application boundary: frontend delivery, API Gateway, internal ALB, ECS application services, asynchronous judge workers, chat Lambda API surface, RDS Proxy/RDS, Redis, queueing, and EFS-backed submission artifacts all serve the same product, users, and deployment lifecycle.

A multi-VPC design would be justified if Hexacode had separate trust domains, separate compliance boundaries, or independently owned platform domains. It does not today. Splitting the current production system across multiple VPCs would add Transit Gateway or peering, duplicated route tables, cross-VPC DNS, cross-VPC service discovery, private integration complexity, and harder incident response without creating a meaningful isolation boundary.

The production hardening therefore happens inside one well-designed VPC: WAF at the public edge, API Gateway authentication and throttling, least-privilege security groups, private app and data subnet tiers, Network Firewall egress inspection, Regional NAT, VPC Flow Logs to CloudWatch, and AWS Backup for stateful resources.

### Why not Multi-VPC now

- The app does not have independently owned product domains.
- The judge, submission, problem, identity, storage, and chat paths are part of one production system.
- RDS Proxy, Redis, EFS, internal ALB, and ECS services are already designed around single-VPC private connectivity.
- Multi-VPC would increase operational failure modes before it creates a real isolation boundary.
- W5 security and observability requirements are better satisfied by hardening the existing VPC path than by introducing unnecessary routing complexity.

### Future triggers for Multi-VPC

Hexacode should revisit Multi-VPC if one of these events occurs:

1. Hexacode splits into independently owned product domains.
2. A separate compliance boundary is required between workloads.
3. The judge or runtime execution tier must be isolated from core app and data services as an untrusted workload boundary.
4. A shared-services or centralized-inspection network hub is introduced.
5. The deployment moves to a multi-account landing zone where network, application, and data accounts have separate ownership.

### Evidence to attach

- VPC subnet and route table screenshots: <evidence to add after deploy>
- VPC Flow Logs sample entries from CloudWatch: <evidence to add after deploy>
- Mapping between subnet tiers and Terraform resources: <evidence to add after deploy>

## 3. MH2 — Network Firewall Hardening

### Path selected

Path A — Deploy AWS Network Firewall.

### Rationale

Hexacode has private workload egress through NAT Gateway, so W5 Path B is not valid. Network Firewall provides production egress inspection, domain and rule evidence, and auditable traffic controls before Regional NAT.

### Evidence to attach

- Firewall policy and rule group screenshots: <evidence to add after deploy>
- Firewall alert log for one blocked request: <evidence to add after deploy>
- Flow Log sample for one allowed request: <evidence to add after deploy>
- Route table screenshot showing private egress through firewall endpoints: <evidence to add after deploy>

## 4. MH3 — EFS File Storage + AWS Backup Plan

### File storage decision

The approved W5 target is for EFS to become the source of truth for durable submission source, stdout, stderr, and compile-log artifacts. After implementation, Postgres should store metadata and short previews only.

### Backup and restore validation

AWS Backup will protect RDS and EFS with a daily plan, retention policy, completed recovery points, restore testing, and failure-alarm coverage. Restore execution steps are documented in `/docs/restore-procedure.md`; deployment evidence must be captured after the resources exist.

### Evidence to attach

- EFS filesystem and mount target screenshots: <evidence to add after deploy>
- File written and read from a private application tier path: <evidence to add after deploy>
- Backup vault and backup plan screenshots: <evidence to add after deploy>
- Restore job completion screenshot: <evidence to add after deploy>
- Readable restored data screenshot: <evidence to add after deploy>

## 5. MH4 — API Gateway in Front of Lambda

### Decision

The approved W5 target is for chat to use API Gateway HTTP API with Cognito/JWT authentication before Lambda invocation.

### Evidence to attach

- API Gateway route and authorizer screenshot: <evidence to add after deploy>
- Authenticated curl returning 200: <evidence to add after deploy>
- Unauthenticated curl returning 401 or 403: <evidence to add after deploy>
- Lambda invocation metric proving rejected unauthenticated requests do not invoke Lambda: <evidence to add after deploy>

## 6. MH5 — Serverless Scaling Pattern

### Pattern selected

Reserved Concurrency for the existing chat Lambda, plus API Gateway throttling and WAF rate limiting.

### Rationale

This keeps the current serverless chat path, scales with demand, and caps runaway concurrency and Bedrock spend without introducing a second compute platform just for W5 evidence.

### Evidence to attach

- Lambda Reserved Concurrency screenshot: <evidence to add after deploy>
- CloudWatch throttles or TooManyRequests evidence: <evidence to add after deploy>
- API Gateway throttling settings: <evidence to add after deploy>
- WAF rate-based rule evidence: <evidence to add after deploy>

## 7. Application Carry-Forward Verification

- End-to-end submission execution: <evidence to add after deploy>
- Bedrock or chat retrieval: <evidence to add after deploy>
- Database query or admin operation: <evidence to add after deploy>

## 8. Negative Security Tests

- Unauthenticated chat request rejected before Lambda: <evidence to add after deploy>
- Network Firewall blocked request: <evidence to add after deploy>
- Backup or restore validation result: <evidence to add after deploy>
- EFS access restricted to app and worker security groups: <evidence to add after deploy>
