# Evidence Drift / Follow-up Notes

This file tracks AWS drift, evidence gaps, and template caveats discovered while preparing `W6_evidence_G6.md`.

> Scope: notes for later cleanup and evidence collection.
> This file is intentionally temporary and separate from the main evidence pack.

---

## 1. Tagging drift still exists live

Observed from `docs/aws-console-drift-audit.md`:
- Tagging is not fully standardized.
- `Environment` appears in both `prod` and `production`.
- `CostGuardLambda` currently has no tags.
- Some resources may still use older tag keys like `Project` instead of the W6-required `Application`.

Impact on evidence:
- Section 2 screenshots can fail MH-COST-V if we capture resources before tag normalization.
- Lambda screenshot for tagging must not use an untagged function as evidence.

Follow-up:
- Standardize tags before final screenshots.
- Prefer a small curated set of resources that definitely have all 4 required keys.

---

## 2. Cost allocation tag activation is still unverified by CLI

Observed from audit:
- `ce list-cost-allocation-tags` returned `AccessDenied` in the read-only audit session.

Impact on evidence:
- We cannot infer activation from resource tags alone.
- Billing Console screenshot is required as primary evidence.

Follow-up:
- Open Billing Console → Cost allocation tags.
- Confirm `Owner` and `Application` are actually activated.
- Capture screenshot only after status is clearly Active.

---

## 3. Live budget implementation differs from evidence-pack narrative

Observed from audit:
- Live AWS currently shows budget `prod` as a daily COST budget with limit `$150/day`.

User decision:
- Keep the workshop evidence wording as `$150/week` in `W6_evidence_G6.md`.

Impact on evidence:
- The main evidence pack keeps workshop wording intentionally.
- We should avoid mixing contradictory wording during presentation unless asked directly.

Follow-up:
- If trainer asks, explain that the evidence narrative follows the workshop requirement wording.
- Keep the screenshot focused on thresholding, alerts, and automation chain.

---

## 4. Budget-to-SNS-to-Lambda path exists, but native Budget Actions were not found

Observed from audit:
- SNS topic `cost-guard-budget-alerts` exists.
- Lambda `CostGuardLambda` exists.
- Wiring from budget alerts to SNS/Lambda exists live.
- Native AWS Budget Actions were not found.

Impact on evidence:
- Evidence should describe `Budgets -> SNS -> Lambda`.
- Do not overclaim native Budget Actions unless console evidence appears later.

Follow-up:
- Capture the SNS-based automation chain as the primary proof.
- If native Budget Actions are later added, update evidence separately.

---

## 5. CloudWatch observability evidence is not fully pre-existing

Observed from audit:
- API access logs are enabled live.
- Backup failure logging exists live.
- The audit does not confirm a ready-made W6 dashboard with custom metric + alarm + saved Log Insights query.

Impact on evidence:
- Section 4 is still an implementation/evidence gap, not just a screenshot task.
- Placeholder code snippets are not sufficient without real datapoints.

Follow-up:
- Verify an actual custom metric is being published.
- Ensure at least one alarm is in OK or ALARM, not INSUFFICIENT_DATA.
- Save a real Logs Insights query against a real log group and capture results.

---

## 6. Security guard path should be narrowed to one demo path

Current template supports multiple options:
- S3 public bucket -> `PutPublicAccessBlock`
- Security Group open SSH/RDP -> `RevokeSecurityGroupIngress`
- Supporting control paths A/B/C

Impact on evidence:
- Leaving all options in the final pack will make it look unfinished.
- W6 demo will be stronger if one deterministic remediation path is chosen.

Recommended follow-up:
- Pick exactly one primary remediation path.
- Pick exactly one supporting preventive control path.
- Remove unused branches from the final evidence pack.

---

## 7. KMS path may be heavier than S3 BPA / Access Analyzer path

Observed from audit and template review:
- KMS evidence requires more than key creation.
- We also need proof that a real service is actively using the CMK via CloudTrail (`GenerateDataKey` / `Decrypt`).

Impact on evidence:
- Path A is valid but harder to close cleanly.
- Path B or Path C may be faster if time is limited.

Follow-up:
- Prefer Path B (account-level S3 BPA + deny policy) if the goal is fast, clean evidence.
- Use Path A only if the service binding and CloudTrail usage evidence already exist.

---

## 8. Management VPC drift remains high-risk, but not all of it belongs in W6 evidence

Observed from audit:
- Terraform still plans to destroy Management VPC-related resources.
- Live Management VPC, peering, and bastion are real and active.

Impact on evidence:
- Important operationally, but not every drift item needs to appear in W6 evidence screenshots.
- This is mainly a follow-up for infrastructure source-of-truth reconciliation.

Follow-up:
- Keep this in ops/drift tracking, not necessarily in the student-facing evidence narrative.

---

## 9. ECS scheduled scaling exists live but is not yet modeled locally

Observed from audit:
- 8 ECS scheduled scaling actions exist live.
- Local Terraform does not model them yet.
- Live services may sit at desired/running = 0 off-hours.

Impact on evidence:
- This can affect cost screenshots and narrative around cost control.
- Compute cost may look lower than expected depending on capture time.

Follow-up:
- When writing cost observations, consider capture time and off-hours scaling behavior.
- If used in presentation, present it as live cost control already in effect.

---

## 10. Some template placeholders are still implementation placeholders, not evidence placeholders

Examples:
- Custom metric code snippet
- Security Lambda code snippet
- Top-3 cost-driver paragraph
- Security threat and cost-tradeoff statements

Impact on evidence:
- These parts still need final human-curated content even after screenshots are collected.

Follow-up:
- Replace placeholders with actual HexaCode-specific content before final submission.
- Remove all `Temporary guide` blocks after evidence is collected.

---

## 11. W5 mentor feedback items that are still unresolved or only partially closed

### 11.1 Backup selection: local Terraform is clearer, but AWS Console proof may still be weak

What changed locally:
- Terraform backup selection now uses explicit resource ARNs rather than vague prefix-based narrative.
- Source: `terraform/modules/backup/main.tf` and `terraform/main.tf`.

What is still unresolved:
- The W5 mentor asked for **>=3 explicit real resources** in backup assignment.
- Current code path clearly includes 1 RDS + 1 EFS by default, plus optional extra EFS ARNs only if provided.
- The W5 evidence text still says "Assign-by-ARN-prefix", which is outdated.
- The AWS drift audit confirms backup resources and backup-failure monitoring exist live, but it does **not** confirm that the AWS Backup selection currently shows >=3 explicitly assigned resources in console.

Action later:
- Check AWS Backup console selection directly.
- If only 2 resources are assigned, do not claim this W5 feedback is fully closed.

### 11.2 Throttling: old W5 doc is stale, but per-user throttling is still not implemented

What changed locally:
- The old W5 evidence says `1 request/giây`, but Terraform now configures much more realistic limits:
  - default routes: 200 burst / 100 rate
  - chat route: 20 burst / 10 rate
- Live AWS audit confirms throttling is configured and JWT auth is wired for `POST /api/chat/messages`.

What is still unresolved:
- Mentor suggestion to "consider throttle theo user" is still only partially addressed.
- Current implementation is route/stage throttling, not true per-user quota/throttling logic.

Action later:
- In presentation, claim that unrealistic 1 RPS was fixed.
- Do not claim user-specific throttling unless there is new evidence.

### 11.3 Provisioned Concurrency / warm-start explanation is still weak in evidence

What changed locally:
- Terraform clearly defines both reserved concurrency and provisioned concurrency for the chat Lambda.

What is still unresolved:
- The W5 evidence compares logs in a way that mixes execution duration with warm-start benefit.
- Absence of `Init Duration` in one log line alone is not a strong enough explanation unless paired with a clear before/after trace narrative.
- The AWS drift audit confirms edge/auth/throttling live state, but does **not** verify a clean provisioned-concurrency evidence set.

Action later:
- Rewrite the explanation using cold-start vs init-duration framing, not raw request duration framing.
- Only claim this feedback is fully closed when the evidence is rewritten or recollected.

### 11.4 Bonus Terraform section is now aligned in the W6 evidence pack, but screenshot quality still matters

What changed:
- The W6 bonus section no longer labels the artifact as **CloudFormation**.
- The bonus guide now points to the real Terraform sources (`terraform/main.tf`, `terraform/modules/cost-controls/main.tf`, and the reused observability pattern in `terraform/modules/backup/alarms.tf`) via GitHub links.
- The narrative now includes the missing plan + measurement + reflection loop instead of only a placeholder snippet.

What is still unresolved:
- Final bonus quality still depends on attaching a clean Terraform-specific artifact such as targeted `terraform plan` / import output for `module.cost_controls`.

Action later:
- Keep the final screenshot/terminal capture Terraform-specific and do not regress back to CloudFormation wording.
- If W5 itself is revised later, sync that artifact separately rather than reopening the W6 wording fix.

---

## 12. Live verification snapshot to avoid duplicate work

> Verified by read-only AWS CLI on 2026-05-21 against the currently active HexaCode AWS account in `us-west-2`.
> Purpose: prevent future agents from re-checking items that are already known live.

### 12.1 Already verified live / ready to capture

These items do **not** need another existence-check pass unless the environment changes.

- **Budgets / SNS / Lambda / Scheduler / Anomaly Monitor are live**
  - Budget `prod` exists.
  - SNS topic `cost-guard-budget-alerts` exists.
  - Lambda `CostGuardLambda` exists.
  - Scheduler `daily-cost-guard` exists and targets `CostGuardLambda`.
  - Cost Anomaly Monitor `Monitor-Hexacode` and subscription `Finance Team` exist.

- **API Gateway throttling + JWT auth for chat are live**
  - HTTP API `5l48bwt6ck` exists.
  - Route `POST /api/chat/messages` uses JWT auth.
  - Stage default throttling is live at `burst=200 / rate=100`.
  - Chat route override is live at `burst=20 / rate=10`.

- **Backup failure monitoring path is live**
  - EventBridge rule `hexacode-prod-backup-job-failures` exists.
  - Target log group `/aws/events/hexacode-prod-backup-failures` exists.
  - Backup failure alarm exists.

- **Chat Lambda concurrency controls are live**
  - Function `hexacode-prod-chat` has reserved concurrency `5`.
  - Alias `live` has provisioned concurrency `2` with status `READY`.

- **Management VPC exists live**
  - Management VPC, app VPC, and the related management path are present in AWS.

- **ECS scheduled scaling exists live**
  - Morning/night scheduled scaling actions exist for identity, problem, submission, and worker services.

### 12.2 Partially verified / needs console evidence or better final packaging

These items have enough live evidence that we should **not** re-audit their existence from scratch, but they are not yet polished enough to claim final closure.

- **CloudWatch observability is largely capture-ready**
  - Dashboard `HexaCode-Production-Observability` exists and now includes backup metric/alarm widgets.
  - Saved Logs Insights query `hexacode-prod-backup-failure-events` now exists for `/aws/events/hexacode-prod-backup-failures`.
  - The EventBridge rule and metric filter were corrected so restore failures are now captured end-to-end.
  - Real failed restore jobs (`97c1a1c0-9775-4016-a467-eb2caaf390d4` and `4dd50a09-9339-4781-b1c9-29b05b741923`) produced CloudWatch Logs rows, a `HexacodeBackupFailures` datapoint, and alarm `hexacode-prod-backup-failures` in `ALARM`.

- **Provisioned concurrency evidence is partially ready**
  - Live config is confirmed.
  - But the warm-start explanation is still weak unless the narrative/log evidence is rewritten properly.

### 12.3 Still open / real work remains

These items are still unresolved and should remain in the active cleanup queue.

- **Access Analyzer path is not ready in this region**
  - No analyzer was found in `us-west-2` in the verification pass.

- **Cost Anomaly execution evidence is blocked by AWS-owned source authorization**
  - The live wiring now exists: EventBridge rule `hexacode-prod-cost-anomaly-cost-guard`, target log group `/aws/events/hexacode-prod-cost-anomaly`, metric `HexacodeCostAnomalyEvents`, and alarm `hexacode-prod-cost-anomaly-events`.
  - A synthetic `aws events put-events` test with `Source=aws.ce` failed with `NotAuthorizedForSourceException`, so we could not spoof a fake Cost Explorer anomaly event.
  - Follow-up checks showed no log events in the anomaly log group during the test window and no datapoints for `HexacodeCostAnomalyEvents`.
  - Treat this as an **honest blocker evidence** item, not as missing Terraform wiring.

- **Local Terraform/source-of-truth parity is still open**
  - Live evidence closure now includes changes that are not yet modeled locally.
  - Capture those in the separate follow-up spec instead of mixing local Terraform edits into the evidence pass.

### 12.3 Closed in the live evidence pass on 2026-05-22

- **Curated W6 tag normalization is closed for the chosen evidence set**
  - The selected evidence resources were normalized to the four W6 keys: `Owner`, `Environment=prod`, `CostCenter=G6`, and `Application=HexaCode`.
  - Treat this as capture-ready for the curated screenshot set, not as proof that the whole estate is globally standardized.

- **`CostGuardLambda` is no longer an open tagging blocker**
  - It should no longer be treated as an untagged counterexample in W6 evidence packaging.

- **Backup selection now protects `>=3` explicit real resources**
  - Live selection was recreated to include the existing EFS filesystem, the RDS instance, and `arn:aws:s3:::hexacode-prod-problem-assets`.
  - The third resource choice is intentional because `problem-assets` stores problem statements and chatbot knowledge-base content that are user-facing and operationally meaningful.
  - This S3 bucket belongs to the backup evidence path, not the MH-SEC security demo path.

- **Security evidence now has one deterministic S3 detect→fix path**
  - Lambda `hexacode-prod-security-guard` was created with least-privilege S3 BPA remediation permissions for the chosen bucket.
  - A before/after demo was completed against `hexacode-prod-submission-artifacts`.
  - CloudTrail captured the successful `PutBucketPublicAccessBlock` remediation event from the Lambda execution role.
  - This S3 bucket belongs to the MH-SEC security demo path, not the backup selection path.

- **CloudWatch backup-failure evidence path is now closed live**
  - The EventBridge rule was corrected so restore failures match on `detail.status = FAILED` while backup/copy failures continue to match on `detail.state = FAILED`.
  - The CloudWatch Logs resource policy was broadened to the AWS-documented `/aws/events/*:*` pattern.
  - The metric filter was corrected to match both failed-state and failed-status event shapes.
  - Real failed restore jobs now produce log rows in `/aws/events/hexacode-prod-backup-failures`, datapoints in `Hexacode/Backup:HexacodeBackupFailures`, and alarm transitions for `hexacode-prod-backup-failures`.

### 12.4 Not verifiable by CLI in this session

These should not be re-assigned to a CLI-only agent unless the access model changes.

- **Billing-side cost allocation tag activation**
  - Still requires Billing Console confirmation.

- **Secret ownership mismatch interpretation**
  - CLI can show live secret state, but not resolve the source-of-truth decision by itself.

- **Restore-job evidence**
  - No restore jobs were present to prove restore success in this session.

### 12.5 Practical rule for future agents

- Do **not** spend another audit pass re-checking whether the budget/SNS/Lambda/scheduler/anomaly-monitor chain exists.
- Do **not** spend another audit pass re-checking whether API Gateway throttling and JWT chat auth exist.
- Do **not** spend another audit pass re-checking whether backup-failure EventBridge/logging exists.
- Do **not** spend another audit pass re-checking whether chat Lambda reserved/provisioned concurrency exists.
- Focus new effort on the items in **12.3 Still open** and the console-only items in **12.4**.

---

## Suggested next cleanup order

1. Fix the items in **12.3 Still open** that directly block screenshot quality.
   - Normalize the chosen W6 evidence tags.
   - Do not use untagged `CostGuardLambda` as tagging evidence.
   - Resolve the backup-assignment `>=3 explicit resources` gap if that claim will be kept.

2. Complete the console-only checks in **12.4 Not verifiable by CLI in this session**.
   - Billing cost allocation tags: confirm `Owner` and `Application` are **Active**.
   - Any screenshot-only proof that cannot be established from CLI alone.

3. Capture evidence for the items already marked in **12.1 Already verified live / ready to capture**.
   - Budget / SNS / Lambda / Scheduler / Anomaly Monitor.
   - API Gateway throttling + JWT chat auth.
   - Backup-failure monitoring.
   - Chat Lambda reserved/provisioned concurrency.

4. Finish the partially ready items in **12.2 Partially verified / needs console evidence or better final packaging**.
   - CloudWatch dashboard / alarms / Logs Insights packaging.
   - Tagging consistency on the final chosen resources.
   - Provisioned-concurrency evidence wording.
   - Chosen security path packaging.

5. Replace all remaining placeholders in `W6_evidence_G6.md` with final HexaCode-specific content.
   - Top 3 cost drivers.
   - Security threat statement.
   - Security-cost trade-off statement.
   - Any remaining generic example text.

6. Reconcile known workshop-vs-live wording mismatches.
   - Keep intentional workshop wording such as `$150/tuần`.
   - Avoid mixing live `$150/day` wording into captions without explanation.

7. Remove all `Temporary guide` blocks only after screenshots and final text are complete.

8. Do a final submission hygiene pass.
   - Check for duplicate sections, stale captions, contradictions, and leftover TODO text.

9. After the evidence pack is stable, handle the heavier infrastructure/source-of-truth drift separately.
   - Management VPC drift.
   - ECS scheduled scaling not modeled locally.
   - Secret ownership-path mismatch.
   - OpenSearch-blocked Terraform reconciliation.

10. If W5 itself will be revised later, do that as a separate cleanup stream.
   - Warm-start explanation rewrite.
   - CloudFormation-vs-Terraform wording fix.
   - Plan output + measurement + reflection additions.

11. Before assigning any new audit task, re-check section **12** first so future agents do not repeat completed verification work.

12. If the live environment changes materially, update section **12** before reopening previously closed verification items.

13. Prefer new effort on unresolved evidence work, not another existence-check pass for items already confirmed live.

14. Only reopen an item from **12.1** if there is a concrete reason to believe the AWS state has changed since the 2026-05-21 verification snapshot.

15. Keep the evidence-pack cleanup track separate from the broader Terraform/live-AWS reconciliation track.

16. Do not convert a console-only verification problem into a CLI re-audit task unless account permissions change.

17. When in doubt, treat section **12** as the source of truth for `already checked vs still open`.

18. Update this file whenever a currently open item moves from `12.3` or `12.4` into a resolved state, so future agents inherit the new baseline.

19. Do not claim final closure for any item that still depends on narrative rewriting or screenshot collection, even if the underlying AWS resource already exists.

20. Keep this ordering lightweight-first for evidence work, heavyweight-last for infrastructure reconciliation.
