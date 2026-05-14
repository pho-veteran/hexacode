# Hexacode Todo Tracker

Use this document to track app fixes, production gaps, and follow-up work for easier subagent dispatch.

## Priority Legend

- **P0**: Blocks production or causes data loss/security risk
- **P1**: Important production-readiness or correctness issue
- **P2**: Improvement, cleanup, or quality-of-life fix

## Open Todos

### P1 — Add Management VPC and SSM operator host

**Status:** Done — implemented and locally validated; Terraform not applied.

**Problem:** Seed/admin/repair operations should not depend on runtime ECS service images containing one-off scripts.

**Desired behavior:** Terraform can optionally create a separate Management VPC with an SSM-managed operator host and VPC peering to the main application VPC.

**Likely files to inspect/change:**

- `terraform/modules/management-vpc/`
- `terraform/main.tf`
- `terraform/variables.tf`
- `terraform/outputs.tf`
- `terraform/terraform-dev.tfvars.example`

**Notes:** Keep this gated by `management_vpc_enabled` so existing environments do not create management resources unless explicitly enabled.

---

### P1 — Restrict management access to least-privilege paths

**Status:** Done — Terraform plan adds narrow management routes and app-side ingress only for RDS Proxy, internal ALB, and EFS; worker ingress stays closed.

**Problem:** A management access plane is only safe if it cannot broadly reach the application VPC.

**Desired behavior:** Peering routes and security groups allow only required operator paths, such as RDS Proxy, internal ALB smoke checks, and optional EFS inspection. Worker ingress stays closed.

**Likely files to inspect/change:**

- `terraform/modules/management-vpc/main.tf`
- `terraform/main.tf`
- `terraform/modules/security-groups/main.tf`

**Notes:** Prefer security group references where AWS allows them across peered VPCs; otherwise fall back to narrow CIDR-based rules for the management CIDR and exact ports.

---

### P1 — Remove one-off scripts from runtime images

**Status:** Done — Docker builds pass and image inspection confirms seed/admin scripts plus `data/problems` are absent.

**Problem:** Runtime service images currently include operator-only seed/admin scripts and catalog data.

**Desired behavior:** Runtime service images include only app runtime code. Seed/admin scripts remain in the repo and are executed later from an ops bundle on the SSM-managed operator host.

**Likely files to inspect/change:**

- `hexacode-backend/services/problem-service/Dockerfile`
- `hexacode-backend/services/identity-service/Dockerfile`
- `hexacode-backend/scripts/import_problem_catalog.py`
- `hexacode-backend/scripts/promote_admin.py`

**Notes:** Validate Docker builds after removing script copies.

---

### P1 — Update W5 evidence and operator docs

**Status:** Done — evidence pack and operator guide now document the Management VPC/SSM ops-bundle workflow.

**Problem:** Current documentation still describes seed/admin as one-off ECS Fargate tasks and the W5 network rationale as a single application VPC only.

**Desired behavior:** Documentation describes the single application VPC plus separate management access plane, SSM Session Manager workflow, ops bundle execution, and evidence to collect.

**Likely files to inspect/change:**

- `docs/weekly-requirements/W5-Evidence-Pack.md`
- `docs/aws-production-operator-guide.md`

**Notes:** Do not paste secrets, tokens, or database passwords into docs.

---

### P1 — Validate Terraform and Docker changes

**Status:** Done — Terraform fmt/validate passed, dev plans were generated and scanned, and Docker builds passed; Terraform not applied.

**Problem:** Management networking and runtime-image cleanup need validation before any AWS mutation.

**Desired behavior:** Terraform formatting/validation, reviewed dev plan, forbidden-prod-reference check, and Docker builds all pass before apply.

**Likely files to inspect/change:**

- `terraform/`
- `hexacode-backend/services/*/Dockerfile`

**Notes:** Do not run `terraform apply` unless explicitly approved.

---

## Backlog

Add new items below using this format:

```markdown
### P1 — Short title

**Status:** Open

**Problem:** What is broken or missing?

**Desired behavior:** What should happen instead?

**Likely files to inspect/change:**

- `path/to/file`

**Notes:** Extra context, risks, or decisions needed.
```
