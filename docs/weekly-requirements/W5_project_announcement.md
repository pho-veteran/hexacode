---
week: 5
title: "W5: The Network Fortress"
audience: students
release: "Monday 2026-05-11 morning"
deadline: "Friday 2026-05-15, group presentation"
---

# W5: The Network Fortress

> May 11-15, 2026

---

## The Challenge

By now your application reasons over documents, calls tools, and answers questions — not just infrastructure that stores and processes data. The architecture you have been evolving since W1 is functional. It stays functional, and it grows this week.

What changes this week is **what surrounds it**. W5 is about hardening: making the network observable, making the security controls enforceable at the boundary, making the file layer shareable, making the API surface proper, and making sure that every stateful resource in your application has a verified backup that you have actually tested restoring.

Real cloud applications fail in predictable ways. Misrouted traffic bypasses firewalls. A backup plan that was never restored is a backup plan that doesn't work. A Lambda endpoint with no throttling gets hammered and takes down everything else. A shared file that lives only on one EC2 becomes a single point of failure the moment you scale. This week you close those gaps — on your own application.

The workshop AWS account resets each week, so you redeploy your application stack fresh on a clean account. What stays the same is your **architecture, your business domain, and your design decisions** — keep building the same 3-tier application you proposed in W1 and have been deepening every week since. Do not pivot to a different application. Do not change your core stack choices (database engine, AI integration approach) just for W5 convenience.

---

## What Carries Forward from Prior Weeks (Mandatory)

Before you add W5 content, the following must be deployed and working on Friday — trainers will verify all of these in Friday Part 1 alongside your new must-haves:

**Mandatory:**
- [ ] **Your application is deployed and end-to-end functional.** Run 1-2 representative actions on the live deployment that prove the app works as you designed it — a request through your API, a downstream operation, an admin action, whatever best demonstrates your system is alive.
- [ ] **Your architecture diagram matches what's actually deployed.** No fictional layers, no missing layers. The diagram you present in Part 1 reflects what trainers can see in your AWS console.
- [ ] **Trainer feedback from a prior presentation is addressed in Part 1.** Name one specific feedback item and show how W5 builds on or fixes it.

How your app is built internally — what stack, what services, how AI is integrated, whether you have a data pipeline — is your team's design choice. W5 doesn't prescribe that. What W5 prescribes is the hardening layer (the 5 must-haves below) that wraps around your app.

If any of the mandatory items above are broken when Friday arrives, it counts against W5 Criterion II (AWS Architecture).

---

## What You Must Deliver (The Five Core Must-Haves)

These map directly to what you are learning this week: networking on Monday, file storage and backup on Tuesday, serverless and API Gateway on Wednesday. Build as you learn.

---

### 1. Multi-VPC Connectivity — Make the Network Observable

Look at your current VPC setup. Make a deliberate decision about connectivity and document it.

Three paths are valid:

**Path A — VPC Peering:** You have two or three VPCs with non-overlapping CIDR ranges and need direct point-to-point traffic. Create the peering connection, update route tables on both sides, and test cross-VPC connectivity with curl or ping.

**Path B — AWS Transit Gateway:** You have three or more VPCs, or you need transitive routing, or you are planning to add a VPN or Direct Connect connection in the future. Create the TGW, attach your VPCs, configure TGW route tables, and test that traffic flows through the hub.

**Path C — Justified Single-VPC:** Your application genuinely runs correctly in one well-designed VPC and there is no business case for splitting it. This path requires a written justification specific to your application (not generic), plus adding a second AZ to every subnet tier that isn't already multi-AZ, plus writing down what architectural event would trigger adding a second VPC in the future.

Defaulting to single-VPC without a written justification does not qualify for Path C.

**Non-negotiable regardless of path:** Enable VPC Flow Logs on all your VPCs and publish them to CloudWatch Logs or S3. Show sample log entries in your Evidence Pack. Flow Logs are how you prove traffic is actually flowing where you think it is.

---

### 2. Network Firewall Hardening — Enforce at the Boundary

Security Groups and NACLs protect individual resources. Network Firewall enforces stateful rules and intrusion detection at the VPC boundary. Two paths are valid:

**Path A — Deploy AWS Network Firewall:** Your Lambda or EC2 instances reach the internet via NAT Gateway for any reason. Deploy a firewall endpoint in a dedicated firewall subnet, create at least one stateful rule group (a domain-based egress allowlist or an IPS signature), enable Alert Logs, and update your route tables so traffic goes through the firewall before the NAT Gateway.

Show one allowed request passing through (visible in Flow Logs) and one blocked request (visible in Alert Logs).

**Path B — Hardened SG + NACL:** Your topology is genuinely internet-isolated — all AWS service access is via VPC endpoints, no NAT Gateway, no outbound internet path from any instance or Lambda. Write a justification explaining (a) why egress firewall is unnecessary for your topology and (b) what traffic would require deploying it in production. Then: remove any 0.0.0.0/0 inbound rules on port 22 or 3389 from all Security Groups, add at least one explicit NACL DENY rule, and show a negative test (a denied connection attempt with screenshot).

If any EC2 or Lambda in your stack reaches the internet via NAT Gateway, Path A is required.

---

### 3. File Storage Layer + Backup Plan — Share the Data, Protect the State

**File storage:** Add a shared file layer to your application tier. Most groups will use **Amazon EFS** — mount it on one or more EC2 instances or Lambda functions in your private application subnet. The file system must serve real application content: shared uploaded files, session tokens, model artifacts, shared configuration — whatever makes sense for your application. The mount target Security Group must restrict to your application-tier SG only (not 0.0.0.0/0).

Show a file written and read back from the mounted path. This must be on a private-subnet instance, not a public EC2 or a standalone test.

**Backup plan:** Create a backup plan in AWS Backup covering at least three resource types from your stack: the file system (EFS/FSx), your W3 database (RDS/DynamoDB/Aurora), and your W2 EBS volumes. The plan must specify a schedule (daily minimum), a retention period (7 days minimum), and a backup vault.

**The restore test is mandatory.** Trigger a restore job from one of your recovery points. Wait for it to complete. Connect to the restored resource. Read back known data and confirm it is there. A backup plan that was never restored is not a recovery plan — it is a hope.

Include the restore job completion screenshot AND a screenshot of readable data from the restored resource in your Evidence Pack.

---

### 4. API Gateway in Front of Lambda — Build a Proper API Surface

Your Lambda functions are currently called directly — from application code using the SDK, or from ALB, or from event triggers. That is not a proper API surface: no throttling, no authentication at the API layer, no URL that your frontend can call safely.

Pick one existing Lambda function in your application — the one that handles Bedrock queries, or database lookups, or pipeline triggers — and put API Gateway in front of it.

What you must configure:
- An API Gateway REST API or HTTP API (choose based on your auth method — see Wednesday's courses for the trade-offs)
- At least one route integrated with your Lambda via Lambda Proxy Integration
- Throttling: a usage plan with a rate limit (requests/second) and burst limit
- Authentication: API Key, Lambda Authorizer, or Cognito User Pool Authorizer — one must be configured and working

Update your application code so it calls the API Gateway URL instead of invoking Lambda directly.

Show two curl tests: an authenticated call returning 200, and an unauthenticated call returning 403. Both must be in your Evidence Pack.

---

### 5. Serverless Scaling Pattern — Handle Load Correctly

Lambda's default behavior — unlimited concurrency up to the account limit, synchronous calls only — works for development. It breaks in production in predictable ways. Pick one scaling pattern and apply it to an existing Lambda function in your application.

Four valid patterns:

**Reserved Concurrency:** Set a maximum concurrency on a function that could otherwise exhaust the account limit (e.g., a batch processor triggered by S3 events during a large data import). Show the throttle behavior: invoke more concurrently than the limit, screenshot the `Throttles` metric in CloudWatch or the `TooManyRequestsException` response.

**Provisioned Concurrency:** Pre-warm your MH4 API Gateway Lambda function to eliminate cold starts. Compare CloudWatch traces before (init duration visible) and after (init duration 0ms). Note the cost of your provisioned concurrency setting in the Evidence Pack.

**Async Invocation + Dead Letter Queue:** Configure at least one Lambda invocation path to use Event (async) invocation type, attach a DLQ (SQS or SNS), and demonstrate a failed invocation landing in the DLQ — show the DLQ message with the error details.

**S3-Event-Triggered Lambda Pattern:** A simple variant works for any group regardless of whether you built a W4 pipeline. Configure an S3 PutObject event notification on a prefix (e.g., the Bedrock KB source bucket, or any S3 location your app writes to) to trigger a Lambda that reads the new file, extracts key fields, and writes to DynamoDB. Groups with a W4 batch pipeline can extend this further into a near-real-time analytics layer with Athena. Show the end-to-end flow: drop a file, show the Lambda CloudWatch log, show the output row in DynamoDB.

The pattern must be applied to a real function in your existing application — not a new function created just for this deliverable.

---

## The Evidence Pack (Mandatory — Sixth Deliverable)

Everything above must be documented in a single markdown file: `docs/W5_evidence.md` committed to your group repo.

Your Evidence Pack must have these sections:

1. Cover: group ID, members, repo link, link to the prior week's evidence pack
2. MH1 — Multi-VPC Connectivity: choice + rationale, route table screenshots, Flow Logs sample
3. MH2 — Firewall / Hardened SG+NACL: path chosen + rationale, relevant screenshots, negative test
4. MH3 — File Storage + Backup Plan: mount evidence, backup plan, recovery point, restore test result with data
5. MH4 — API Gateway: resource tree, auth config, curl test (200 + 403)
6. MH5 — Scaling Pattern: pattern chosen, evidence per the criteria above
7. Application Carry-Forward Verification: pipeline execution, Bedrock retrieval, database query — one screenshot each
8. Negative Security Tests: at least one per W5 addition

Build the Evidence Pack as you go — not on Thursday night. Screenshots taken during the build process are always more credible than screenshots reconstructed before Friday.

Your Friday slides must link back to the Evidence Pack markdown. Trainers open it during evaluation to verify every claim you make in the presentation.

---

## Friday Presentation Format

Same four-part format. Target 10–12 minutes total.

**Part 1 — Application Recap and Reflection (~1.5 min):** Show your current application architecture diagram. Run 1-2 representative actions that prove your app works as designed (you choose what's most representative). Cite one specific feedback item from a prior presentation and show how W5 addresses it.

**Part 2 — W5 Architecture (~3 min):** Show the updated diagram with all five MH additions labeled: VPC connectivity layer, firewall/security controls, EFS/FSx mount in the application tier, API Gateway in front of Lambda, and the scaling pattern applied to a specific function.

**Part 3 — QnA (~3 min):** Individual questions from trainers. You will be evaluated on quality and depth of understanding. No details shared here.

**Part 4 — Deployment Demo (~3–4 min):** Walk through the live evidence: cross-VPC connectivity or Flow Logs, one blocked and one allowed request, EFS/FSx mount with a file read, backup restore test result, API Gateway 200 and 403, scaling pattern output, plus the application end-to-end action from your carry-forward verification.

---

## Optional Stretch Goals

For groups that finish all five must-haves and the Evidence Pack before Thursday afternoon:

- **VPC Reachability Analyzer:** use it to verify a connectivity path, then intentionally break a route table entry and re-run to confirm the tool detects the failure
- **Backup Vault Lock:** configure Vault Lock in Compliance Mode — once set, no IAM principal can delete the recovery points before the retention period expires, not even root
- **Lambda Power Tuning:** run the AWS Lambda Power Tuning tool across memory sizes on your MH4 function and find the cost-performance optimum
- **API Gateway custom domain:** attach a custom domain with an ACM certificate to your API Gateway stage
- **CloudFormation template for one W5 resource:** write and validate a CFN template for Network Firewall, API Gateway, or EFS

Stretch goals earn up to +0.5 on the weekly score but are never required. One done properly with full Evidence Pack documentation is worth more than three done halfway.

---

## What "Done" Looks Like on Friday

By the end of Friday's presentation, trainers should be able to:

- See your application running end-to-end on the live deployment (whichever actions best prove it works)
- Read your VPC topology and understand where traffic goes and why
- Observe one blocked and one allowed request in firewall or NACL logs
- Mount your EFS/FSx path on a test instance and read real application data
- Confirm your backup vault has a completed recovery point and your restore test produced a readable resource
- Call your API Gateway endpoint with valid auth (200) and without auth (403) from the command line
- See your Lambda scaling pattern configured and producing observable behavior

That is what "done" means. Your Evidence Pack makes all of it verifiable after you leave the room.

This is not about building something new from scratch — it is about making what you already built production-grade. The difference between a prototype and a real system is observable networking, enforced security controls, a file layer that survives scaling, backups you have actually tested, and an API surface that protects the Lambda underneath. Build that this week.
