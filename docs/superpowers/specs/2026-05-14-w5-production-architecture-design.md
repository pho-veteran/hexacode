# W5 Production Architecture Design

## Goal

Implement the W5 hardening requirements as production architecture for Hexacode, not as demo-only infrastructure. The design keeps Hexacode in a justified single VPC, hardens the public API and network boundary, moves submission artifacts to EFS as the source of truth, adds backup and restore validation, and produces an evidence pack that explains and verifies each decision.

## Approved Decisions

- Use W5 Path C: Justified Single-VPC.
- Keep chat Lambda outside the VPC because it only needs API Gateway and Bedrock access for now.
- Enforce chat authentication at API Gateway before Lambda invocation using a Cognito/JWT authorizer.
- Enforce chat rate limits before Lambda using API Gateway route/stage throttling, WAF rate rules, and Lambda reserved concurrency.
- Add WAF for L7 protection on public edges where supported by the current API type and CloudFront distribution.
- Keep Security Groups as workload-level least-privilege controls.
- Add AWS Network Firewall for egress filtering, IPS/domain controls, and audit visibility.
- Use Regional NAT with same-AZ firewall/NAT egress routing for production availability.
- Use EFS as the source of truth for submission artifacts.
- Use AWS Backup for RDS and EFS, including a backup vault, daily backup plan, retention, restore testing, documented restore procedure, and failure alarm.
- Enable VPC Flow Logs to CloudWatch Logs for now; S3 archival can be considered later.

## Single-VPC Rationale

Hexacode should remain a single-VPC production architecture for W5 because the application is one tightly coupled product boundary. The frontend, API Gateway, internal ALB, ECS services, judge worker, chat Lambda API surface, RDS Proxy/RDS, Redis, queue, and EFS-backed submission artifacts all serve the same application, the same users, and the same deployment lifecycle.

A multi-VPC design would be justified if Hexacode had separate trust domains or ownership boundaries. It does not today. Splitting the current system across multiple VPCs would introduce Transit Gateway or peering, duplicate route tables, cross-VPC DNS, cross-VPC service discovery, private integration complexity, and harder incident response without creating a meaningful production isolation boundary.

The production hardening should instead happen inside the single VPC:

- Public edge: CloudFront, API Gateway, and WAF.
- Private app tier: ECS services, worker, and EFS clients.
- Private data tier: RDS Proxy/RDS, Redis, and EFS mount targets.
- Firewall tier: Network Firewall endpoints in dedicated firewall subnets.
- Observability: VPC Flow Logs to CloudWatch Logs and firewall logs.

Future triggers for moving to multi-VPC are explicit:

- Hexacode splits into independently owned product domains.
- A separate compliance boundary is required between workloads.
- The judge/runtime execution tier must be isolated from core app and data services as an untrusted workload boundary.
- A shared-services or centralized-inspection network hub is introduced.
- The deployment moves to a multi-account landing zone where network, application, and data accounts have separate ownership.

Until one of those events occurs, a hardened single VPC is the more reliable and operable production design.

## Chat Lambda API Surface, Auth, and Scaling

The chat flow should remain:

```text
Frontend -> API Gateway HTTP API -> Chat Lambda -> Bedrock Agent Runtime
```

API Gateway must enforce authentication before Lambda is invoked. Since the current Terraform uses API Gateway v2 / HTTP API, the implementation should use a JWT authorizer configured with the Cognito issuer and allowed client audience. The frontend must send `Authorization: Bearer <token>` for `POST /api/chat/messages`.

Expected behavior:

- Missing, expired, malformed, or wrong-audience token: API Gateway rejects the request and Lambda is not invoked.
- Valid Cognito token: API Gateway invokes chat Lambda.
- Lambda can read claims from the API Gateway event if application-level personalization is needed later.

Rate limiting and scaling controls should be layered:

```text
WAF rate rule -> API Gateway JWT authorizer -> API Gateway route throttle -> Lambda reserved concurrency -> Bedrock call
```

Required controls:

- API Gateway throttling for the chat route or stage.
- WAF rate-based rule for public abuse protection.
- Lambda reserved concurrency to cap runaway traffic and Bedrock cost.
- CloudWatch alarms for Lambda errors, throttles, duration, and API Gateway 4xx/5xx.

Provisioned concurrency is not required now. It should only be added if measured production latency shows cold starts are violating the chat latency target.

The implementation must reconcile the two chat Lambda code paths before relying on behavior:

- Terraform-deployed Lambda code: `terraform/modules/bedrock-chat/index.py`.
- Richer backend Lambda code: `hexacode-backend/services/chat-lambda/handler.py`.

Production should have one clearly deployed handler contract.

## WAF, Security Groups, Network Firewall, and Regional NAT

Network security should be layered because each control operates at a different level:

```text
CloudFront/API Gateway WAF -> API Gateway auth/throttling -> internal ALB -> ECS Security Groups -> Network Firewall egress path -> Regional NAT -> Internet
```

WAF responsibilities:

- L7 HTTP protection at public edges.
- Managed rule groups for common threats.
- Rate-based rule for abusive public clients.
- Association with CloudFront and, where supported cleanly by the current API type/stage, API Gateway.

Security Group responsibilities:

- API services accept only internal ALB traffic.
- RDS Proxy/RDS accepts only from services that need database access.
- Redis accepts only from services that need cache access.
- EFS accepts NFS only from app/worker security groups that need artifact access.
- Broad outbound rules should be narrowed where feasible and routed through Network Firewall for inspected internet egress.

Network Firewall responsibilities:

- W5 Path A egress inspection because the app has NAT-based outbound internet.
- Dedicated firewall subnets per AZ.
- Stateful egress rule group for allow/block evidence.
- Alert and flow logging to CloudWatch Logs.
- Route table changes that send private app egress through same-AZ firewall endpoint before same-AZ NAT Gateway.

Regional NAT responsibilities:

- NAT Gateway per AZ for availability.
- Same-AZ routing to avoid cross-AZ egress dependency where possible.
- Predictable egress path for Flow Log and firewall evidence.

Network Firewall does not replace WAF, API Gateway auth, or security groups.

## EFS Submission Artifact Source of Truth

EFS becomes the source of truth for durable submission artifacts. Postgres stores metadata and short previews only.

Current behavior to replace:

- Submitted source is stored inline in `submission.submissions.source_code`.
- Compile/test output is stored as previews in `submission.results` fields.
- Existing object ID fields are usually null.

Required artifact layout:

```text
/submissions/{submission_id}/source/source.txt
/submissions/{submission_id}/runs/{judge_run_id}/compile.log
/submissions/{submission_id}/results/{result_id}/stdout.txt
/submissions/{submission_id}/results/{result_id}/stderr.txt
```

Infrastructure requirements:

- Encrypted EFS filesystem.
- Mount targets in private data subnets.
- EFS access point for controlled POSIX path and permissions.
- ECS mounts for submission-service and worker.
- EFS security group allows NFS only from the required app/worker security groups.
- EFS is included in AWS Backup.

Application requirements:

- Submission-service writes source artifacts to EFS during submit.
- Submission-service creates artifact metadata in Postgres.
- Submission row stores `source_object_id` or equivalent artifact reference.
- Worker reads source from EFS through metadata.
- Worker writes compile logs, stdout, and stderr to EFS.
- Worker sends artifact IDs back in the completion payload.
- Submission-service stores compile log, stdout, and stderr artifact IDs in the existing submission result/run fields.
- Frontend downloads artifacts through authenticated submission-service endpoints and never receives raw EFS paths.

Schema approach:

- Prefer minimal schema churn by extending `storage.objects` for filesystem-backed artifacts if practical.
- Add fields such as `storage_driver`, `filesystem_path`, and `artifact_kind` if needed.
- Preserve enough compatibility for existing S3-backed problem assets and existing download code.

Operational requirements:

- Large artifact downloads must stream or be bounded to avoid memory spikes.
- Short previews remain in Postgres for fast UI rendering.
- Cleanup policy must exist for old artifacts.

## AWS Backup, Restore Testing, Flow Logs, and CloudWatch Evidence

Backup must be implemented as a recoverability control, not just a retention setting.

Required backup controls:

- AWS Backup vault.
- Daily backup plan.
- Retention period of at least W5 minimum; production retention may be longer.
- Backup selections covering RDS and EFS, and W2 EBS volumes if they still exist in the deployed stack.
- EventBridge/CloudWatch alarm path for backup failure.
- Restore testing plan for at least one covered resource.
- Documented restore procedure.

RDS production safety settings should be updated with the backup work:

- `deletion_protection = true` for production.
- `skip_final_snapshot = false` for production.
- Final snapshot naming for teardown safety.

Restore evidence requirements:

- Completed restore job.
- Connection to restored resource.
- Known data read successfully from restored RDS or EFS resource.
- Evidence-pack screenshot placeholders for restore completion and readable data.

Flow Logs requirements:

- VPC Flow Logs to CloudWatch Logs.
- Retention policy on the log group.
- Custom or default format sufficient to show source, destination, action, ports, protocol, and timestamps.
- Evidence-pack sample entries showing expected traffic path.

CloudWatch alarms/logging requirements:

- Backup failure alarm.
- Lambda chat errors/throttles/duration alarms.
- API Gateway 4xx/5xx alarms.
- Network Firewall alert logs.
- VPC Flow Log sample queries or captured entries.

## Evidence Pack Structure

Create `docs/weekly-requirements/W5-Evidence-Pack.md` with sections ready to be expanded as resources are implemented and screenshots are collected.

Required initial structure:

1. Cover
2. MH1 — Multi-VPC Connectivity: Justified Single-VPC
3. MH2 — Network Firewall Hardening
4. MH3 — EFS File Storage + AWS Backup Plan
5. MH4 — API Gateway in Front of Lambda
6. MH5 — Serverless Scaling Pattern
7. Application Carry-Forward Verification
8. Negative Security Tests

The first substantive content should be the Single-VPC rationale from this design, because the user explicitly requested a strong explanation for choosing single VPC over multi-VPC.

## Implementation Sequencing

1. Add evidence-pack scaffold and Single-VPC rationale.
2. Add Terraform foundation for EFS, Flow Logs, Backup, WAF, Network Firewall, Regional NAT, and RDS safety settings.
3. Add chat API Gateway auth/throttling/concurrency controls.
4. Migrate submission artifact persistence to EFS.
5. Add/adjust frontend download behavior only if backend artifact response shape changes.
6. Add restore procedure documentation and evidence placeholders.
7. Run formatting, validation, and targeted tests.

## Success Criteria

- W5 Evidence Pack explains the single-VPC decision with Hexacode-specific production reasoning and future multi-VPC triggers.
- API Gateway rejects unauthenticated chat requests before Lambda invocation.
- Chat Lambda has rate/concurrency controls and observable alarms.
- Public edges have WAF protection where supported.
- Private app egress routes through Network Firewall and Regional NAT.
- VPC Flow Logs publish to CloudWatch.
- Submission source/stdout/stderr/compile logs are durable EFS-backed artifacts, not large inline Postgres blobs.
- AWS Backup covers RDS and EFS with restore testing and failure alarms.
- Terraform validates and app tests cover artifact persistence/download behavior.
