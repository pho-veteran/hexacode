---
week: 6
title: "W6: Operations Hardening & Cost-Aware Cloud"
audience: students
release: "Monday 2026-05-18 morning"
deadline: "Friday 2026-05-22, group presentation"
---

# W6: Operations Hardening & Cost-Aware Cloud

> May 18-22, 2026

---

## The Challenge

Five weeks ago you proposed a 3-tier architecture (W1). You laid down storage and identity — S3, IAM, EBS (W2). You added a database backbone and AI knowledge layer — RDS or DynamoDB, Bedrock Knowledge Base, Lambda (W3). You taught the system to reason and act on its own — multi-level retrieval, agent tools, memory (W4). You hardened the network — multi-VPC topology, firewall enforcement, API Gateway in front of Lambda, scaling patterns, backup with restore test (W5). Each week added a new capability layer to the SAME application.

W6 does not add a sixth capability layer. W6 takes the application your team redeploys on Monday — the same architecture, the same business domain, the same design decisions carried forward from W1 through W5 — and asks: can you OPERATE it? You are not re-graded on those weeks. Take what you built — the architecture, the business domain, the code — and apply the W6 operational lens to it.

Real systems fail in predictable ways that have nothing to do with the network. An alarm fires but it is stuck in INSUFFICIENT_DATA because the application never generated a single data point before Friday. Tags exist on three resources and not on ten others, so Cost Explorer shows the account total but cannot attribute a single dollar to your workload. Trusted Advisor flags two idle EC2 instances from a Monday redeployment experiment — and the team documents them as "interesting" but terminates nothing, changes nothing, keeps spending. A gp2 EBS volume is running at burst-credit exhaustion and nobody has migrated it to gp3 because nobody looked at the IOPS baseline. A security alarm exists but no one has ever triggered the violation to confirm the auto-remediation actually fixes it.

Each of these is a gap between "deployed" and "production-ready." None of them shows up in a network diagram. They show up at 2am when something breaks — or at month-end when the bill arrives.

W6 closes these gaps — on the application your team redeploys on Monday using the same design your group has been evolving since W1. Four operational layers must be demonstrably in place by Friday. Not documented. Demonstrable. You will walk a trainer through each one live.

The principle for this week: **demonstrable, not documented.** A tag is not a cost allocation until it is activated in the Billing console. A cost guard is not control until automation has actually stopped a resource. A CloudWatch alarm is not an alarm until it has data to evaluate. A security guard is not self-healing until you have triggered a violation and watched it auto-remediate. Build, verify, and show.

---

## What Carries Forward — Architecture, Concept, Code

The workshop account resets each week. What carries forward is your **architecture diagram**, your **business domain**, your **design decisions**, and your **code repository**. Use your W5 Evidence Pack as a starting reference — open it Monday morning when you sit down with the fresh account.

Redeploy whatever subset of your application you need to demonstrate the four W6 must-haves. You do not need to re-prove every feature from W1-W5 — that work was already evaluated in those weeks. W6 grading focuses on the 4 W6 MHs — Cost Visibility & Attribution, Cost Control & Action, Monitoring, Self-Healing Security Guard — applied to whatever you redeployed this week.

**Friday Part 1 expectation (light) — project recap only:**
- A short verbal/slide recap of the project: what the application is, its business domain, and the key architecture and design decisions carried forward from W1-W5 — enough to frame the W6 operational work
- Brief mention of any W5 feedback you addressed (optional, not graded — but if you cite something specific, it can support Criterion I)

That's it. Part 1 is purely a recap that sets context. No live app action is required in Part 1, no architecture-diagram update is required in Part 1, no per-week verification list, and no full W1-W5 stack audit on Friday morning. (You will still walk through your W6 architecture and run the live MH evidence in Parts 2 and 4.)

---

## Hard Rule — $150 Cost Cap (read before anything else)

**Every group has a hard cost ceiling of USD 150 for this week. If your group's account total exceeds $150, the entire W6 assignment fails for that group.** No "but we built a lot" exceptions.

Last week a group left resources running idle and burned over a thousand dollars on an account used only for the workshop. That stops this week. A complete 3-tier workshop stack never needs anywhere near $150 — this ceiling is generous. Exceeding it means an expensive resource was left running 24/7 unused, not that the group built more.

![Actual W5 AWS cost — a workshop-only account that burned over a thousand dollars on idle resources, which is why the $150 cap now exists](../assets/cost-w5.png)

How to choose resources to stay under $150 (Single-AZ, smallest instance that works, serverless where possible, shut down anything not needed overnight, no Bedrock Provisioned Throughput / OpenSearch multi-node / EKS) is in the mandatory companion memo, shared alongside this announcement. Keeping cost ≤ $150 and proving you actively controlled spend **is MH-COST-V + MH-COST-A** — it is not extra work.

---

## What You Must Deliver (The Four Core Must-Haves)

All four must-haves must be demonstrable on Friday. Two of them are cost must-haves: **MH-COST-V** (cost visibility & attribution) and **MH-COST-A** (cost control & action). The other two are **MH-OBS** (monitoring) and **MH-SEC** (Self-Healing Security Guard). These map to what you are learning this week: cost visibility on Monday, CloudWatch + cost tools on Tuesday, security automation on Wednesday. Build as you learn — the Evidence Pack screenshot from Tuesday is always more credible than one reconstructed on Thursday night.

**Cost gate:** In addition to the four must-haves below, an account total ≤ $150 is a prerequisite — exceed the ceiling and the W6 assignment fails even if all four MHs are done well (see the Hard Rule above).

---

### 1. MH-COST-V — Cost Visibility & Attribution

The "I know what I'm spending and on what" must-have. Before any cost tool matters, tags matter.

All four components are required:

**Component 1 — Tagging discipline.** Apply consistent tags to every billable resource your team redeploys: EC2 instances, RDS instances, Lambda functions, S3 buckets, EFS file systems, API Gateways. Minimum four keys:

| Tag key | Example value | Rule |
|---------|--------------|------|
| `Owner` | `teamlead@email.com` | One person accountable — consistent capitalization. No `Owner` vs `owner` mismatches. |
| `Environment` | `dev` | Never mix values — "dev" and "Dev" are different in Cost Explorer |
| `CostCenter` | `G7` | Your group ID |
| `Application` | `HealthBot` | Consistent — "HealthBot" and "healthbot" are different tag values |

Write a 1-page tagging strategy document: what keys you use, what values are allowed, and how you would enforce compliance in a real account.

**Component 2 — Cost allocation tags activated.** Go to AWS Billing console → Cost allocation tags → find your `Owner` and `Application` keys → Activate. This is a separate step from creating the tag. Skip it and your tags will not appear as filter dimensions in Cost Explorer — two-step process, both steps required.

**Component 3 — At least one cost monitoring tool configured.** Choose from:

| Tool | What it tells you |
|------|------------------|
| **Cost Explorer** | Trends by service, tag, and time period — filter to your workload, identify top cost drivers |
| **AWS Budgets** | Proactive alert before a threshold is breached — set it before Friday, not after |
| **Cost Anomaly Detection** | ML-detected unusual spend — fires when something spikes unexpectedly |

Strong groups configure two or more.

**Component 4 — Baseline cost breakdown.** Take a screenshot showing cost by your tag dimension after at least 24 hours of redeployment data. Write a 1-paragraph observation: name the top 3 cost drivers and call out anything that looks surprising or higher than expected.

**Pass condition:** All four tag keys on all billable resources. Cost allocation tags activated. At least one tool configured and demonstrable. Baseline cost screenshot with written observation. Tagging strategy document in the Evidence Pack. **Account total ≤ $150** — exceeding the ceiling fails the entire W6 assignment (see the Hard Rule at the top of this document).

**Pitfall to avoid:** Tagging your resources without activating cost allocation tags in the Billing console. The tags exist on the resources but do not appear as filter dimensions in Cost Explorer until you activate them. Screenshot both: the tag on the resource AND the activated tag in the Billing console.

---

### 2. MH-COST-A — Cost Control & Action

The "I have built automation that ACTS on cost, not just watches it" must-have. This is what separates W6 from generic cost theater. The single deliverable is the **Automated Cost Guard** — an automated mechanism that detects a cost/usage condition and *acts* by shutting resources down, not just notifying.

All four components are required:

**Component (a) — Stop Lambda.** A **Lambda function** that, when invoked, stops (or terminates) billable compute that should not keep running — e.g., EC2/RDS instances NOT tagged `keep=true` (or all `Environment=dev` compute). Least-privilege IAM role.

**Component (b) — Daily scheduled trigger.** An **EventBridge Scheduler / EventBridge rule on a daily cron** that invokes the Lambda. (For the demo you may set a short interval or invoke manually — see the 48h note below.)

**Component (c) — Demonstrated action.** At least one real EC2 or RDS instance goes running → stopped *because the Lambda ran*, with CloudTrail (`StopInstances` / `StopDBInstance`) evidence — before/after screenshots.

**Component (d) — Cost-driven path (wire it, demo the chain).** Also wire an AWS Budgets DAILY budget at $150 → SNS → the same Lambda (or a Budgets Action that stops EC2/RDS). Because AWS cost data lags ~8–24h, the real cost-driven trigger will likely NOT fire inside a 48h account — that is expected and **not** penalized. Full credit = the wiring exists + you demonstrate the chain by publishing a test message to the SNS topic (or manually triggering the Budgets Action) so the Lambda stops a resource, PLUS a short ADR noting the cost-data latency and production behavior. A missing scheduled mechanism, no demonstrated stop, or a missing ADR **IS** penalized.

**Pass condition:** Lambda deployed (least-privilege role) + daily EventBridge schedule configured + ≥1 resource demonstrably stopped by the Lambda with CloudTrail before/after evidence + Budgets $150→SNS/Action→Lambda wired with latency ADR.

**Pitfall to avoid:** A budget that only emails. MH-COST-A is graded on a resource actually being turned off by automation, never a notification. An un-fired cost-driven Budgets trigger in a 48h account is expected; a missing scheduled mechanism, no demonstrated stop, or a missing latency ADR is not.

---

### 3. MH-OBS — Monitoring: Know Before the User Does

A deployed application that you cannot observe is an application you are managing by hope. Three components are required — all three, not alternatives.

**Apply this to your redeployed application — MH-OBS watches:**
- Your AI inference layer once redeployed (custom metric: agent latency, token count, retrieval accuracy)
- Your database layer once redeployed (alarms on RDS connections, DynamoDB consumed capacity)
- Your API Gateway once redeployed (Log Insights query on 4xx/5xx patterns, throttle counts, top slowest endpoints)
- Your Lambda functions once redeployed (error rate, cold start duration)

**Component A — CloudWatch dashboard with a custom metric.** AWS already gives you default metrics for free: EC2 CPU, ALB request count, Lambda duration and errors. The requirement is a custom metric — something your application explicitly measures and publishes using the `PutMetricData` API. Think about what your application does at the business logic layer. What operation matters most to your users? That is what you instrument.

```python
import boto3
cloudwatch = boto3.client('cloudwatch')
cloudwatch.put_metric_data(
    Namespace='AppName/Operations',
    MetricData=[{
        'MetricName': 'InferenceLatencyMs',
        'Value': latency_ms,
        'Unit': 'Milliseconds'
    }]
)
```

Replace `InferenceLatencyMs` with what your application actually does: Bedrock call latency, RDS query duration, pipeline job completion count, failed authentication attempts, items processed per minute. The dashboard widget for this metric goes alongside at least two standard infrastructure metrics.

**Component B — At least one CloudWatch alarm in OK or ALARM state.** The alarm must be in OK or ALARM state on Friday — not INSUFFICIENT_DATA. INSUFFICIENT_DATA means the metric has never received a data point. Trigger your application Thursday to generate data before Friday arrives. A Lambda Errors alarm set to 5 errors in 5 minutes is a reasonable baseline — invoke the Lambda with bad input 6 times to trigger it, capture the state transition, and show it in your demo.

**Component C — Log Insights query saved against a real log group.** The query must run against a real log group in your account (Lambda logs, VPC Flow Logs, CloudTrail — whichever your application generates). Save it under Logs Insights > Saved Queries. The query must do more than `filter @timestamp > ago(1h)` — use `stats`, `sort`, `parse`, or regex to extract something meaningful.

Three query patterns for reference:

```
# Lambda error spikes by 5-minute window
fields @timestamp, @message
| filter @message like /ERROR/
| stats count(*) as error_count by bin(5m)
| sort @timestamp desc
```

```
# Top rejected IPs from VPC Flow Logs
filter action="REJECT"
| stats count(*) by srcAddr
| sort count desc | limit 10
```

```
# IAM AccessDenied events by principal
filter errorCode="AccessDenied"
| stats count(*) by userIdentity.arn
| sort count desc
```

**Pass condition:** Dashboard with custom metric widget + two standard metric widgets. At least one alarm in OK or ALARM state with a configured action. At least one Log Insights query saved against a real log group with visible results.

**Pitfall to avoid:** INSUFFICIENT_DATA alarm state on Friday. Trigger your application Thursday afternoon so the metric has data points before the demo.

---

### 4. MH-SEC — Self-Healing Security Guard: Prove Your Infrastructure Fixes Its Own Violations

IAM policies and Security Groups were W2 and W5 territory. W6 goes a layer deeper: a detect→auto-fix loop that catches one security misconfiguration on your redeployed stack and remediates it automatically. This deliberately reuses the EventBridge→Lambda pattern you already build for the MH-COST-A Cost Guard.

> AWS Config configuration recorder, managed Config rules, SSM Automation runbooks, and an AutomationAssumeRole are **NOT REQUIRED** for MH-SEC — they are the fragile pieces and often cannot be enabled inside the 48h sandbox account. AWS Config may be mentioned only as an OPTIONAL alternative detection source — never required. No Config compliance dashboard is required.

**Required for every group — the detect→auto-fix loop:**

- [ ] A **Lambda** that detects ONE security misconfiguration on the redeployed stack and auto-fixes it via boto3. Choose one (the two cleanest, recommended):
  - Security Group ingress open to `0.0.0.0/0` on port 22/3389 → `RevokeSecurityGroupIngress`; OR
  - S3 bucket made public → `PutPublicAccessBlock` (enable Block Public Access on the bucket).
  - (An unencrypted-EBS/RDS detector is acceptable, but the SG / S3-public fixes are the cleanest deterministic remediations.)
- [ ] A **trigger** with a least-privilege IAM role: either an EventBridge rule on the CloudTrail/API event (`AuthorizeSecurityGroupIngress`, `PutBucketPolicy`/`PutBucketAcl`) for near-real-time remediation, OR an EventBridge Scheduler daily cron (the same reliable mechanism as the Cost Guard) as a fallback.
- [ ] A **demonstrated loop**: intentionally create the violation → Lambda detects + fixes it → evidence = a before (insecure) screenshot + an after (remediated) screenshot + the CloudTrail event of the fix API call (`RevokeSecurityGroupIngress` / `PutPublicAccessBlock`).

**Plus ONE supporting preventive control (choose one):**

**Path A — KMS Customer Managed Key on a data store**

| Step | What to do |
|------|-----------|
| Create CMK | KMS console → Customer managed keys → Create (Symmetric, Encrypt and decrypt). Set alias: `alias/appname-rds-prod` or equivalent. |
| Enable rotation | Key configuration → Automatic key rotation → Enabled |
| Apply to your data store | Modify a redeployed RDS / S3 / EBS / EFS / DynamoDB to use the CMK (not `aws/s3` or `aws/rds` — those are AWS-managed, you do not control them) |
| Verify via CloudTrail | CloudTrail → Event history → filter `kms:GenerateDataKey` or `kms:Decrypt` — events from `rds.amazonaws.com` or `s3.amazonaws.com` confirm the CMK is in active use |

**Path B — Account-level S3 Block Public Access + deny policy**

| Step | What to do |
|------|-----------|
| Account BPA | S3 console → Block Public Access settings for this account → all four settings ON |
| Deny policy | Add a bucket policy that denies unencrypted PutObject (`s3:x-amz-server-side-encryption` missing) OR non-TLS PutObject (`aws:SecureTransport=false`) |
| Prove it | Show the policy + a denied test call (an attempt that is rejected by the policy) |

**Path C — IAM Access Analyzer**

| Step | What to do |
|------|-----------|
| Enable | Enable IAM Access Analyzer in your account |
| Triage | Surface ≥1 external-access finding and triage it: what it is, whether it is intended, the production remediation |

**Security-cost trade-off (required — all paths):** Your Evidence Pack must include 1-2 sentences explaining what the chosen control costs and why that cost is justified. "It's more secure" is not an acceptable answer — name the cost and the justification.

**Pass condition:** Lambda + trigger deployed (least-privilege); a demonstrated detect→fix loop with before/after screenshots + CloudTrail of the remediation API call; one supporting preventive control with evidence; security-cost statement. No Config recorder / managed Config rule / SSM Automation / AutomationAssumeRole is required.

**Pitfall to avoid:** A security control that only detects, logs, or alerts but does not fix. MH-SEC is graded on the demonstrated automated remediation (the CloudTrail event of the fix API call), not a finding or an alarm.

---

## Worked Examples: Applying W6 to Your Existing Stack

Three application types — find the one closest to yours and use it as your anchor.

### HealthBot (medical Q&A with RAG)

W3 design: RDS PostgreSQL. W4: Bedrock KB, Lambda agent tools. W5: API Gateway + L2 multi-source retrieval. W6: the application redeployed (whatever subset is needed for the W6 demo).

**MH-COST-V:** Tag every redeployed resource: `Application=HealthBot`, `Owner=<lead>`, `Environment=dev`, `CostCenter=G<N>`. Activate tags in Billing console. Cost Explorer filtered to `Application=HealthBot` after 24h shows: EC2 $2.40, RDS $1.80, Lambda $0.02, Data Transfer $0.40. Observation: "RDS is running Multi-AZ in a dev account — disabling Multi-AZ in dev would cut the RDS line by ~50%."

**MH-COST-A:** Stop Lambda iterates EC2/RDS not tagged `keep=true` and stops them; least-privilege role limited to `ec2:StopInstances` / `rds:StopDBInstance`. Daily EventBridge Scheduler cron at 20:00. Demo: a leftover redeployment EC2 instance goes running → stopped because the Lambda ran, CloudTrail shows `StopInstances`. Budgets daily $150 → SNS → same Lambda wired; test SNS publish drives a stop; latency ADR notes cost data lags ~8–24h so the cost-driven path won't fire in a 48h account.

**MH-OBS:** Custom metric `bedrock_query_latency_ms` published from the redeployed retrieval Lambda. Alarm on RDS `DatabaseConnections` (threshold: >20, action: SNS to group email). Log Insights query against the redeployed API Gateway logs showing the top 10 slowest endpoint calls. CloudWatch dashboard: Bedrock latency (custom), RDS connections (standard), Lambda error rate (standard).

**MH-SEC:** Self-Healing Security Guard — a Lambda that detects the KB-source S3 bucket being made public and calls `PutPublicAccessBlock` to re-enable Block Public Access; least-privilege role limited to `s3:PutPublicAccessBlock` / `s3:GetBucketPolicyStatus`. Trigger: EventBridge rule on the `PutBucketPolicy`/`PutBucketAcl` CloudTrail event. Demo loop: intentionally make the bucket public → before screenshot (public) → Lambda fixes it → after screenshot (Block Public Access on) → CloudTrail shows `PutPublicAccessBlock`. Supporting control: KMS CMK `alias/healthbot-rds-prod` applied to the redeployed RDS instance; CloudTrail shows `kms:GenerateDataKey` from `rds.amazonaws.com` — active use confirmed. Security-cost statement: "CMK costs $1/month. Justified by the audit trail requirement — every decrypt event is logged with the IAM principal who accessed patient-related data."

---

### FinTech Analyzer (transaction classification + anomaly detection)

W3 design: DynamoDB transactions table, Lambda CRUD handlers. W4: Glue ETL, Step Functions, Bedrock L2. W5: API Gateway with Lambda authorizer, app-tier EC2. W6: the application redeployed (whatever subset is needed for the W6 demo).

**MH-COST-V:** All redeployed resources tagged including the Glue job, Step Functions state machine, S3 analytics bucket, EFS mount. Cost Explorer filtered by `Application=FinTechAnalyzer` shows S3 and EC2 as top cost drivers. Budget alert set at 110% of first-week spend. Observation: "S3 analytics bucket has 4 GB accumulated with no lifecycle rule — Standard storage at full price for cold data."

**MH-COST-A:** Stop Lambda targets all `Environment=dev` EC2/RDS; least-privilege role. Daily EventBridge rule on a cron. Demo: app-tier EC2 left from a Monday experiment goes running → stopped because the Lambda ran, CloudTrail `StopInstances` before/after. Budgets daily $150 → SNS → Lambda wired; manual SNS test publish stops a resource; latency ADR documents the ~8–24h cost-data lag and the production behavior of the cost-driven path.

**MH-OBS:** Custom metric `dynamodb_write_latency_ms` from the redeployed CRUD Lambda. Alarm on `ConsumedWriteCapacityUnits` for the redeployed DynamoDB table. Log Insights query against API Gateway logs: `filter status = 429 | stats count(*) by bin(5m)` — surfaces throttling patterns. Dashboard shows all three.

**MH-SEC:** Self-Healing Security Guard — a Lambda that detects a Security Group ingress rule opened to `0.0.0.0/0` on port 22 and calls `RevokeSecurityGroupIngress`; least-privilege role limited to `ec2:RevokeSecurityGroupIngress` / `ec2:DescribeSecurityGroups`. Trigger: EventBridge rule on the `AuthorizeSecurityGroupIngress` CloudTrail event. Demo loop: intentionally add an open-SSH rule → before screenshot (0.0.0.0/0 on 22) → Lambda revokes it → after screenshot (rule gone) → CloudTrail shows `RevokeSecurityGroupIngress`. Supporting control: account-level S3 Block Public Access ON + a bucket policy denying non-TLS PutObject (`aws:SecureTransport=false`), shown with a denied test call. Security-cost statement: "Account-level S3 Block Public Access and the deny policy cost nothing — they only constrain misconfigurations, and the avoided blast radius of a public financial-data bucket far outweighs the zero spend."

---

### Legal Doc Q&A Bot (multi-document RAG + citation)

W3 design: Aurora PostgreSQL with pgvector, Bedrock KB. W4: Bedrock Agent with L3 tools, orchestrator Lambda. W5: API Gateway REST API. W6: the application redeployed (whatever subset is needed for the W6 demo).

**MH-COST-V:** S3 corpus bucket is the biggest cost driver ($0.80 over 7 days). Aurora ($2.20). Lambda ($0.03). Observation: "S3 corpus bucket has no lifecycle rule — documents ingested in W2 are in Standard storage. Adding Standard → Standard-IA after 30 days → Glacier after 90 days would cut S3 storage costs by an estimated 60% for documents older than a month." Cost Anomaly Detection monitor scoped to `Application=LegalBot` — alert subscription confirmed.

**MH-COST-A:** Stop Lambda stops EC2/RDS not tagged `keep=true`; least-privilege role. Daily EventBridge Scheduler cron. Demo: a leftover EC2 from a failed redeployment attempt goes running → stopped because the Lambda ran, CloudTrail `StopInstances` before/after. Budgets daily $150 → SNS → same Lambda wired; test SNS publish drives the stop; latency ADR notes the ~8–24h cost-data lag so the cost-driven trigger won't fire in the 48h account — expected, not penalized.

**MH-OBS:** Custom metric `bedrock_agent_invocation_count` and `bedrock_agent_latency_ms` from the redeployed orchestrator Lambda. Alarm on Aurora ACU Utilization — auto-scales; alarm fires when ACU > 8. Log Insights against the agent Lambda: `filter @message like /CITATION/ | stats count(*) as citation_count by bin(1h)` — tracks retrieval quality.

**MH-SEC:** Self-Healing Security Guard — a Lambda that detects the corpus S3 bucket being made public and calls `PutPublicAccessBlock`; least-privilege role limited to `s3:PutPublicAccessBlock` / `s3:GetBucketPolicyStatus`. Trigger: EventBridge Scheduler daily cron (same reliable mechanism as the Cost Guard) as the fallback path. Demo loop: intentionally make the corpus bucket public → before screenshot (public) → scheduled Lambda fixes it → after screenshot (Block Public Access on) → CloudTrail shows `PutPublicAccessBlock`. Supporting control: KMS CMK `alias/legalbot-aurora-prod` applied to the Aurora PostgreSQL instance; CloudTrail `kms:GenerateDataKey` from `rds.amazonaws.com` confirms active encryption of the embedding store. Security-cost statement: "SSE-KMS with CMK costs $1/month per key. Justified because legal document contents require an auditable access trail — knowing which IAM principal triggered a decrypt is a compliance requirement, not a preference."

---

## The Evidence Pack (Mandatory)

Everything above must be documented in a single markdown file: `docs/W6_evidence.md` committed to your group repo. Your Friday slides are derived from this file — build the markdown first, then pull the key screenshots and decisions into slides. Do not write slides first and reconstruct the markdown after.

Build the Evidence Pack as you go, not on Thursday night. Screenshots taken during the build are always more credible than screenshots reconstructed before Friday.

Your slides must link to `docs/W6_evidence.md` (repo link or commit hash). Post the commit link to the trainer Slack channel before your Friday slot. No link = Criterion IV capped at 3 before the demo starts.

**Section by section — what goes where:**

**Section 1 — Cover:** Group ID, member names, repo link, link to your W5 Evidence Pack (as reference). If you addressed any W5 feedback, mention it briefly — optional, not graded separately.

**Section 2 — MH-COST-V — Cost Visibility & Attribution:** Tags screenshot showing all four required keys on at least three different resource types. Cost allocation tags activated screenshot from the Billing console. Cost tool view scoped to your project workload (filtered by tag) + baseline cost breakdown screenshot + 1-paragraph written observation naming the top 3 cost drivers. Tagging strategy document (1 page).

**Section 3 — MH-COST-A — Cost Control & Action:** Automated Cost Guard: Lambda code/config screenshot + least-privilege IAM role + EventBridge daily schedule screenshot + before/after instance state showing a real EC2/RDS stopped by the Lambda + CloudTrail `StopInstances`/`StopDBInstance` event + Budgets daily $150→SNS→Lambda wiring + test-SNS-publish demonstration of the chain + latency ADR.

**Section 4 — MH-OBS — CloudWatch Observability:** Dashboard screenshot with all three widget types labeled (custom metric widget title called out explicitly). The `PutMetricData` code snippet from your application. Alarm configuration screenshot (metric name, threshold, evaluation period, action destination). Log Insights query screenshot showing the query text + the log group it runs against + at least 5 result rows. Saved query name visible in the Saved Queries list.

**Section 5 — MH-SEC — Self-Healing Security Guard:** Lambda code/config screenshot + least-privilege IAM role + the trigger (EventBridge rule on the CloudTrail/API event OR EventBridge Scheduler daily cron). Demonstrated detect→fix loop: before (insecure) screenshot + after (remediated) screenshot + the CloudTrail event of the fix API call (`RevokeSecurityGroupIngress` / `PutPublicAccessBlock`). Supporting preventive control chosen (KMS CMK, account-level S3 Block Public Access + deny policy, or IAM Access Analyzer) + option-specific evidence. Security threat paragraph: what misconfiguration the guard fixes and what the blast radius is if it is left unremediated. Security-cost trade-off statement.

**Section 6 — Project Recap:** A short written recap of the project — what the application is, its business domain, and the key architecture and design decisions carried forward from W1-W5. This is the context for your W6 operational work; it is not an app-action proof or a diagram-update requirement. If you addressed any W5 feedback, note it briefly — optional, not separately scored.

**Bonus section** (optional): Pre/post screenshots, measurements, and a 2-3 sentence reflection for any completed bonus item.

---

## What "Done" Looks Like on Friday

By the end of your presentation, trainers should be able to verify all of the following. The focus is the 4 W6 MHs — not a re-audit of prior weeks.

**MH-COST-V — Cost Visibility:** Trainer filters Cost Explorer by your tag set and sees all costs broken down by service. Trainer opens Billing console and confirms cost allocation tags are activated. Trainer reads your baseline cost breakdown and your top-3-cost-drivers observation.

**MH-COST-A — Cost Control & Action:** Trainer sees a real resource that was stopped by the automated cost guard (Lambda on a daily EventBridge schedule, Budgets daily $150→SNS wired) with the CloudTrail `StopInstances`/`StopDBInstance` event before/after, the demonstrated SNS-publish chain, and the cost-data latency ADR.

**MH-OBS — CloudWatch:** Trainer opens your CloudWatch dashboard and sees your application-layer custom metric with real data points (not empty widgets). Alarm is in OK or ALARM state, not INSUFFICIENT_DATA. Log Insights query returns real results from your redeployed API Gateway or Lambda log group.

**MH-SEC — Self-Healing Security Guard:** Trainer watches (or reviews evidence of) the loop: a violation is created on the redeployed stack, the Lambda detects and fixes it, and the CloudTrail event of the fix API call (`RevokeSecurityGroupIngress` / `PutPublicAccessBlock`) confirms the remediation ran — with before/after screenshots. For the KMS supporting control: trainer finds `kms:GenerateDataKey` or `kms:Decrypt` events from your application's redeployed data store. For the S3 Block Public Access path: trainer sees account-level BPA on and the denied test call. For the IAM Access Analyzer path: trainer reads the external-access finding and your triage decision.

That is what "done" means. Your Evidence Pack makes all of it verifiable after you leave the room.

---

## Optional Stretch Goals

For groups that complete all four must-haves and the Evidence Pack before Thursday afternoon. One done well with full Evidence Pack documentation is worth more than three done halfway. Each bonus item below is worth approximately +0.25; total bonus credit is capped at +0.5 regardless of how many you complete.

- **gp2 → gp3 EBS migration (+0.25)** — Migrate at least one EBS volume in your redeployed stack from gp2 to gp3. Document before-migration IOPS/throughput (CloudWatch `VolumeReadOps`, `VolumeWriteOps`, `BurstBalance`), after-migration IOPS/throughput and configured settings, and the cost delta. Migration via Elastic Volumes requires no downtime. If you were already on gp3 from your W5 design, document the explicit IOPS/throughput configuration choice and why it matches your workload profile.

- **Trusted Advisor remediations (+0.25)** — At least 2 **config-based** Trusted Advisor findings actually remediated with before/after evidence (finding → action taken → before/after). Use config-based findings only: unattached EBS volume deleted, unassociated Elastic IP released, S3 bucket without lifecycle policy fixed, S3 public-access closed, open security group tightened, EBS volume without a snapshot snapshotted. (Utilization checks such as "Low Utilization EC2" / "Idle RDS" need ~14 days of data and will not appear in a 48h account — do not chase them. Config-based findings fire immediately.)

- **RI / Savings Plans break-even analysis (+0.25)** — From the Cloud Economics SimuLearn and the CFM FinOps courses this week (FinOps Fundamentals & Strategies Part 2 + Cost Optimization Solutions for FinOps Part 1, both free on Skill Builder), run a break-even analysis on your redeployed compute footprint with numbers — or a justified deferral with numbers (e.g., "break-even for a 1-year Savings Plan is 8 months; our workshop lifecycle is 1 week; we would buy at sustained on-demand spend above $X/month for 3+ months").

- **"Wasteful → changed" reflection (+0.25)** — Write 100-150 words: what your group found wasteful in the redeployed stack, what you changed, and the cost or performance delta. Use real numbers — dollar amounts, IOPS, instance sizes. Not aspirational statements about production.

- **Cost Anomaly Automation (+0.25)** — Configure a Cost Anomaly Detection monitor scoped to your project tag. Wire an EventBridge rule on the `aws.costanomalydetection` event source to an SNS topic with email subscription. Demo: trigger a fake anomaly via AWS CLI or simulated spike, show the SNS notification received. This pairs MH-COST-V visibility with proactive alerting.

- **Config Conformance Pack (+0.25)** — Deploy a pre-built conformance pack at the account level (e.g., AWS Foundational or Operational Best Practices for Amazon S3). Show the compliance dashboard with multiple rule evaluations across your account resources. Write 2-3 sentences: which rules are most relevant to your production workload and why.

- **CloudWatch Synthetics canary** — Deploy a canary that runs automated tests against your API Gateway endpoint on a schedule and fires an alarm when availability drops. Proves proactive availability monitoring.

- **Composite CloudWatch alarm** — Combine two alarms with AND logic so the composite fires only when both conditions are simultaneously true (e.g., high error rate AND high latency). Proves you understand alarm fatigue.

- **GuardDuty sample findings investigation** — Generate sample findings using `CreateSampleFindings` API and walk through the full EventBridge → SNS → Lambda response chain.

- **CloudFormation template for one W6 resource** — Write a CFN template provisioning your Self-Healing Security Guard (the Lambda + its EventBridge trigger + the least-privilege IAM role). Pass `aws cloudformation validate-template`. Proves infrastructure-as-code discipline for W7.

---

## Friday Presentation Format

Same four-part format. Target 10-12 minutes total.

**Before you present:** post your `docs/W6_evidence.md` commit link in the trainer Slack channel. No link posted = Criterion IV pre-flagged at cap 3 before you start.

**Part 1 — Project Recap (~1.5 min):** Give a short verbal/slide recap of the project — what the application is, its business domain, and the key architecture and design decisions carried forward from W1-W5 — to frame the W6 operational work. No diagram update and no live app action are required here. Briefly mention any W5 feedback you addressed (optional).

**Part 2 — W6 Architecture (~3 min):** Show your updated application diagram with the four W6 operational additions overlaid. Walk through:
- **Cost visibility layer (MH-COST-V):** tags applied to redeployed resources, Cost Explorer view filtered by tag, baseline breakdown, top-3-cost-drivers observation
- **Cost control layer (MH-COST-A):** automated cost guard demo (Lambda + daily EventBridge schedule + Budgets daily $150→SNS, a real resource stopped with CloudTrail evidence)
- **Monitoring layer:** CloudWatch dashboard with custom metric + alarm + saved Log Insights query
- **Security layer (MH-SEC):** Self-Healing Security Guard — Lambda + trigger, the demonstrated detect→fix loop with the CloudTrail event of the fix API call (`RevokeSecurityGroupIngress` / `PutPublicAccessBlock`) and before/after screenshots, plus the chosen supporting preventive control

**Part 3 — Individual QnA (~3 min):** Trainers will ask individual questions about your architecture and decisions. These are questions about what you built, why you chose each path, and what you would do differently in production. If you understand your own work, you will handle them confidently.

**Part 4 — Deployment Demo (~3-4 min):** Walk through the live evidence per MH: Cost Explorer filtered to your project with baseline breakdown (MH-COST-V); the automated cost guard demo — Lambda + daily EventBridge schedule + Budgets daily $150→SNS, a real resource stopped with CloudTrail evidence (MH-COST-A); CloudWatch dashboard with custom metric and alarm state; the Self-Healing Security Guard detect→fix loop with the CloudTrail event of the fix API call (`RevokeSecurityGroupIngress` / `PutPublicAccessBlock`) plus the chosen supporting preventive control evidence (MH-SEC); application end-to-end action. If a live demo step fails, the Evidence Pack screenshot for that step is an acceptable substitute with no penalty — but missing both live and screenshot for a claim caps that MH's score.

---

## Why This Week Matters

W6 is the last week before the W7 capstone. Every operational layer you build this week is something you carry into final integration week. A group that finishes W6 with all four layers working, documented, and tested — and can explain what their application costs, what optimization actions they took, how their infrastructure enforces its own compliance, and exactly what they would do differently at production scale — is a group that is ready to hand off their application to a real operations team.

That is the bar W7 will hold you to. Build toward it this week.

Good luck. By Friday, your application will be production-ready.
