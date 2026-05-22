# Changelog — 2026-05-19 Admin & Infrastructure Improvements

## Summary

Major overhaul of admin/dashboard features (frontend + backend) and addition of Lambda provisioned concurrency + API Gateway default throttling to the Terraform infrastructure.

---

## Backend Changes

### Critical Bug Fixes
- **Fixed broken delete endpoint** — added missing `PERM_PROBLEM_DELETE_OWN_DRAFT` import in problem-service
- **Fixed TOCTOU race** — removed redundant pre-transaction slug uniqueness check in `create_problem_row`

### Security Hardening
- **Zip bomb protection** — testset archive extraction now enforces max 256MB decompressed size and max 10,000 files
- **Input validation limits** — slug ≤128, title ≤256, summary ≤10KB, statement ≤1MB, assets ≤20 files, time ≤30s, memory ≤1GB, output ≤256MB
- **UUID path param validation** — returns 400 for malformed UUIDs instead of raw Postgres errors
- **Last-admin protection** — cannot revoke the last admin role (409 response)
- **Self-action prevention** — cannot disable yourself or revoke your own admin role (409 response)

### Pagination & Search (Backend APIs)
- `GET /api/problems` — added `limit`, `offset`, `search`, `status`, `sort` params; response includes `total` in meta
- `GET /api/dashboard/problems` — same pagination params + `scope` filter
- `GET /api/dashboard/users` — added `limit`, `offset`, `search`, `role`, `status` params; response includes `total` in meta

### Database Migrations
- `001_add_indexes.sql` — pg_trgm extension + indexes on username, status, problems(status, created_by, slug, title trigram)
- `002_audit_log.sql` — `app_identity.audit_log` table for tracking role/lifecycle/delete actions
- `003_problem_version.sql` — `version` column on problems for optimistic locking
- `004_rejection_reason.sql` — `rejection_reason` column on problems

### Audit Logging
- New `hexacode-backend/backend_common/audit.py` with `record_audit_event()` helper
- Logged events: `role.grant`, `role.revoke`, `user.enable`, `user.disable`, `problem.lifecycle.*`, `problem.delete`

### Optimistic Locking
- Problem updates now require `version` field; stale updates return 409

### Rejection Reason
- `POST /api/dashboard/problems/{id}/actions/reject` accepts optional JSON body with `reason` field
- `request-review` action clears previous rejection reason
- Rejection reason included in problem detail responses

---

## Frontend Changes

### New Shared UI Components (`src/components/ui/`)
- `ConfirmDialog.tsx` — accessible modal replacing `window.confirm()`, supports danger/default variants
- `SearchInput.tsx` — debounced search input with clear button
- `Tooltip.tsx` — Radix UI tooltip wrapper for sidebar icons
- `DropdownMenu.tsx` — Radix UI dropdown for action overflow menus
- `Breadcrumbs.tsx` — route-aware breadcrumb navigation
- `MarkdownPreview.tsx` — react-markdown renderer with GFM, math, and KaTeX support
- `index.ts` — barrel export file

### Dashboard Shell (`DashboardShell.tsx`)
- Sidebar tooltips on collapsed icons
- Nav items grouped into sections (Content, People, System)
- Removed "New problem" from nav (it's a button in the Problems page)
- Responsive hamburger menu on mobile
- Breadcrumbs replace raw pathname in header
- Fixed user card positioning (flex layout instead of absolute)

### Problem List (`dashboard-problems.tsx`) — Full Rewrite
- SearchInput with debounced API search
- Status filter tabs (All, Draft, Pending Review, Approved, Published, Archived)
- Sort dropdown (Newest, Recently updated, Title A-Z)
- Pagination controls (Previous/Next + page indicator)
- Action overflow DropdownMenu per problem (secondary actions hidden behind ⋯)
- ConfirmDialog for all destructive actions
- Toast messages include problem title
- Completeness indicators (testset ✓/✗, checker ✓/✗)
- Admin "All" scope tab

### User Management (`dashboard-users.tsx`) — Full Rewrite
- SearchInput for username search
- Role filter tabs (All, Authors, Reviewers, Moderators, Admins)
- Pagination controls
- Simplified table (hidden cognito_sub/UUID by default)
- Expandable user detail panel
- ConfirmDialog for all role changes (danger variant for admin grant)
- Visual distinction for "Grant admin" button
- Better toast messages with username and role

### Problem Editor (`ProblemEditor.tsx`) — Major Refactor
- Removed Status, Visibility, Type dropdowns (derived from submit intent)
- Split-pane Monaco markdown editor with live MarkdownPreview
- Tag chip selector (click-to-toggle, no free-text input)
- Inline field validation on blur (slug format/length, title, numeric bounds)
- Completeness checklist in sidebar (Basic info, Statement, Testset, Checker)
- Decoupled testset section (read-only status with link to testsets page)
- Simplified to 2 submit buttons: "Save draft" / "Submit for review"
- Collapsible checker section (collapsed when type=diff)

### Dashboard Home (`dashboard-home.tsx`)
- Role-specific widgets (reviewer: pending review count, moderator: user count)
- "Awaiting your review" section for reviewers
- Responsive stat card grid

---

## Terraform / Infrastructure Changes

### Lambda Provisioned Concurrency (`terraform/modules/bedrock-chat/`)
- Added `publish = true` to chat Lambda (enables versioning)
- Added `aws_lambda_alias.chat_live` — "live" alias for provisioned concurrency target
- Added `aws_lambda_provisioned_concurrency_config.chat` — default 2 warm instances
- New variable: `provisioned_concurrent_executions` (default: 2, set 0 to disable)
- New output: `chat_lambda_invoke_arn` — returns alias ARN when provisioned concurrency is active
- All resources gated by `var.provisioned_concurrent_executions > 0`

### API Gateway Default Throttling (`terraform/modules/api-gateway/`)
- Added `default_route_settings` block to the `$default` stage
- New variable: `default_throttle_burst_limit` (default: 200 req/s)
- New variable: `default_throttle_rate_limit` (default: 100 req/s)
- Throttling hierarchy: default 200/100 for all routes, chat route override 20/10

---

## Files Modified

### Backend
- `hexacode-backend/services/problem-service/app/main.py`
- `hexacode-backend/services/identity-service/app/main.py`
- `hexacode-backend/backend_common/audit.py` (new)
- `hexacode-backend/db/new-app-schema.sql`
- `hexacode-backend/db/migrations/001_add_indexes.sql` (new)
- `hexacode-backend/db/migrations/002_audit_log.sql` (new)
- `hexacode-backend/db/migrations/003_problem_version.sql` (new)
- `hexacode-backend/db/migrations/004_rejection_reason.sql` (new)

### Frontend
- `hexacode-frontend/src/components/ui/ConfirmDialog.tsx` (new)
- `hexacode-frontend/src/components/ui/SearchInput.tsx` (new)
- `hexacode-frontend/src/components/ui/Tooltip.tsx` (new)
- `hexacode-frontend/src/components/ui/DropdownMenu.tsx` (new)
- `hexacode-frontend/src/components/ui/Breadcrumbs.tsx` (new)
- `hexacode-frontend/src/components/ui/MarkdownPreview.tsx` (new)
- `hexacode-frontend/src/components/ui/index.ts` (new)
- `hexacode-frontend/src/components/shell/DashboardShell.tsx`
- `hexacode-frontend/src/routes/dashboard-problems.tsx`
- `hexacode-frontend/src/routes/dashboard-users.tsx`
- `hexacode-frontend/src/routes/dashboard-home.tsx`
- `hexacode-frontend/src/features/problem-editor/ProblemEditor.tsx`
- `hexacode-frontend/src/lib/api/` (pagination types + updated client functions)

### Terraform
- `terraform/modules/bedrock-chat/main.tf`
- `terraform/modules/bedrock-chat/variables.tf`
- `terraform/modules/bedrock-chat/outputs.tf`
- `terraform/modules/api-gateway/main.tf`
- `terraform/modules/api-gateway/variables.tf`

### Documentation
- `docs/admin-features-audit.md` (new)
- `docs/admin-improvements-plan.md` (new)
- `docs/changelog-2026-05-19.md` (this file)
