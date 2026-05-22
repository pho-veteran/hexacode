# Admin Features Audit — Hexacode Platform

**Date:** 2026-05-19  
**Scope:** Problem creation/editing, permissions & roles, problem publishing lifecycle, user/account management  
**Verdict:** Not production-ready. Multiple critical bugs, security gaps, scalability blockers, and UX issues.

---

## Executive Summary

The admin/dashboard features work for a single developer in local development but will break under real production load. The most critical issues are:

1. **Broken endpoint** — DELETE problem crashes at runtime (missing import)
2. **No pagination** — all list endpoints return unbounded result sets
3. **Synchronous DB in async handlers** — blocks the event loop, kills concurrency
4. **No audit logging** — role changes and lifecycle transitions are untraceable
5. **No optimistic locking** — concurrent edits silently overwrite each other
6. **Zip bomb vulnerability** — testset archive extraction has no decompressed size limit

---

## Critical Bugs

| # | Location | Issue |
|---|----------|-------|
| 1 | `problem-service/app/main.py` ~line 2906 | `PERM_PROBLEM_DELETE_OWN_DRAFT` is used but **never imported**. The delete endpoint will raise `NameError` at runtime for non-admin users. |
| 2 | `problem-service/app/main.py` create flow | TOCTOU race: `problem_slug_exists(slug)` checked outside the transaction, then again inside. The outer check opens a separate connection and is redundant. |
| 3 | `identity-service` user disable | `update_local_user_status` doesn't verify the target user exists before UPDATE — returns 0 rows silently, then the subsequent GET returns 404 (confusing error path). |

---

## Backend — Problem Service

### Architecture

- **Single 4,600-line file** containing 100+ functions: route handlers, business logic, data access, file I/O, validation, and constants all mixed together.
- `create_problem_row` (~300 lines) and `update_problem_row` (~400 lines) share ~70% duplicated logic.
- No service/repository layer, no Pydantic request/response models.

### Input Validation Gaps

| Field | Issue |
|-------|-------|
| `slug` | Regex-validated format but no max length — could be thousands of chars |
| `title` | Only checked for non-empty, no max length |
| `statement_md` (JSON path) | No size cap — multipart caps at 2MB but JSON body is unbounded |
| `statement_assets` | No limit on number of files per request |
| `testset archive` | No cap on number of extracted test cases or total decompressed size |
| `time_limit_ms`, `memory_limit_kb` | Accept any positive integer (no upper bound) |
| `problem_id` path params | Not validated as UUID — produces raw Postgres errors instead of 400 |

### Security Issues

| Issue | Severity |
|-------|----------|
| No zip bomb protection — archive decompresses fully into memory | High |
| No content-type validation on uploaded checker source files | Medium |
| No request body size limit for JSON payloads (DoS vector) | Medium |
| No file virus/malware scanning on uploads | Medium |
| No rate limiting on problem creation (expensive S3 uploads) | Medium |
| No idempotency keys — network retries create duplicate problems | Low |

### Scalability Issues

| Issue | Impact |
|-------|--------|
| `list_problem_rows()` and `list_dashboard_problem_rows()` have no LIMIT/OFFSET | All problems returned in one response |
| Synchronous `psycopg.connect()` in async FastAPI handlers | Blocks event loop — one slow query blocks all requests |
| No connection pooling — new connection per function call | Connection exhaustion under load |
| Cache invalidation is fire-and-forget — failures silently ignored | Stale data persists indefinitely |

### Missing Production Features

- No optimistic concurrency control (no version/updated_at check on updates)
- No soft-delete (hard DELETE with CASCADE, no recovery)
- No audit trail for lifecycle transitions (who published/rejected what, when)
- No rejection reason field on the "reject" action
- No bulk operations (batch publish, batch archive)
- No webhook/event system for cross-service reactions
- No response schema validation (all endpoints return `dict[str, Any]`)

---

## Backend — Identity Service

### Architecture

- Cleaner than problem-service (~300 lines) but same patterns: synchronous DB, no connection pooling, no Pydantic models.
- `list_local_user_rows()` uses lateral subqueries for problem_count and submission_count — O(n) full scans per user.

### Security Issues

| Issue | Severity |
|-------|----------|
| No self-action prevention — admin can revoke own admin role | High |
| No last-admin protection — possible to lock out all administrators | High |
| Moderator can grant moderator role to anyone (same-tier escalation) | Medium |
| `sync_default_role_assignments` is additive-only — Cognito group removal never reflected locally | Medium |
| Disabled user's username still updated on every access attempt (before 403) | Low |

### Scalability Issues

- `GET /api/dashboard/users` returns ALL users with no pagination, search, or filter
- No index on `users(username)` — username search would be full table scan
- `username` column has no uniqueness constraint — duplicates possible

### Missing Features

- No audit log for role grants/revokes/status changes
- No user search by username or email
- No single-user detail endpoint exposed via API
- No endpoint to list available roles
- No last-login tracking
- No role assignment expiry (temporary roles)
- No email stored in local user table

---

## Backend — Authorization (authz.py)

### Design

- 5 roles: contestant, author, reviewer, moderator, admin
- ~30 permissions mapped to roles via SQL seed data
- `admin.full` is a god-mode bypass — any permission check passes

### Issues

- No role hierarchy — admin doesn't inherit moderator/reviewer permissions explicitly (relies entirely on `admin.full` bypass)
- Permission-to-role mapping lives only in SQL seed data — no code-level enforcement or documentation
- No permission caching — every request hits DB for role/permission load
- `contestant` role is always assigned — cannot create a user without it

---

## Frontend — Problem Editor

### UX Issues

- No markdown preview/split-pane editor
- `window.confirm()` for testset replacement warning — not accessible, not themed
- Reset button has no confirmation — one click discards all work
- No upload progress success state
- Autosave only saves text fields, not file selections

### Validation Gaps

- Slug validation only runs on submit (no real-time feedback)
- No max-length enforcement on title/summary/statement
- Numeric limit fields accept any text — only validated on submit
- Tag input is free-text — typos silently create invalid references

### Accessibility

- File inputs lack associated labels (`htmlFor`/`id`)
- Tag toggle buttons lack `aria-pressed`
- No `aria-live` region for error/success messages
- Progress bar missing `role="progressbar"` and `aria-valuenow`

---

## Frontend — Problem List (dashboard-problems)

### UX Issues

- `window.confirm()` for ALL destructive actions (delete, lifecycle transitions)
- No optimistic UI — waits for server round-trip
- `mutAction.isPending` disables ALL action buttons globally (not per-problem)
- Toast messages are generic — don't include problem title

### Missing Production Features

- **No search or filter** — flat list of all problems
- **No pagination** — will degrade with hundreds of problems
- **No sorting** (by date, status, difficulty)
- **No bulk actions** (batch publish, batch archive)
- No status filter tabs

### Accessibility

- Action buttons lack `aria-label` with problem context
- No `aria-busy` on list during loading
- Scope toggle buttons lack `role="tablist"` semantics

---

## Frontend — User Management (dashboard-users)

### UX Issues

- Role grant/revoke has **NO confirmation at all** — single click immediately fires
- No visual distinction between granting "author" vs "admin" (admin is high-risk but looks identical)
- No undo for role changes

### Missing Production Features

- **No search/filter** by username, role, or status
- **No pagination**
- Cannot see when roles were assigned or by whom
- No user detail/profile view

### Security UX

- Admin can revoke their own admin role with no warning
- No confirmation for granting admin (highest privilege escalation)

---

## Frontend — Dashboard Shell & Auth

### DashboardShell

- Collapsed sidebar icons have no tooltips or `aria-label` — screen readers get nothing
- No mobile responsive behavior (no hamburger menu)
- No skip-to-content link
- No breadcrumbs for nested routes

### AuthProvider

- Token refresh failure silently logs user out — no "session expired" notification
- `fallbackRoles` from Cognito groups briefly show UI elements user may not actually have access to (race condition)
- No periodic token refresh — only refreshes on mount or storage event

---

## Cross-Cutting Issues

| Category | Issue | Affects |
|----------|-------|---------|
| Pagination | None anywhere | All list endpoints and UI |
| Confirmation dialogs | `window.confirm()` everywhere | Accessibility, UX consistency |
| Error handling | Errors shown via ephemeral toast only | No persistent error state |
| Loading states | Generic `<Skeleton>` with no contextual messaging | UX clarity |
| Optimistic updates | None — all mutations wait for server | Perceived performance |
| Audit logging | None | Compliance, debugging, accountability |
| Connection pooling | None — new connection per call | Scalability |
| Async/sync mismatch | Sync DB calls in async handlers | Concurrency |
| Input validation | Manual/imperative, incomplete | Security, data integrity |
| API documentation | No Pydantic models → incomplete OpenAPI docs | Developer experience |

---

## Prioritized Recommendations

### P0 — Fix Before Any Production Use

1. **Fix broken delete endpoint** — add missing `PERM_PROBLEM_DELETE_OWN_DRAFT` import
2. **Add zip bomb protection** — cap total decompressed size (e.g., 256MB) and file count (e.g., 10,000)
3. **Add pagination** to all list endpoints (problems, users) — both backend and frontend
4. **Switch to async DB driver** (`psycopg_pool` or `asyncpg`) or run sync DB calls in thread pool
5. **Add request body size limits** — configure FastAPI/Starlette max body size
6. **Add last-admin protection** — prevent revoking admin from the last admin user

### P1 — Required for Production Quality

7. **Add optimistic locking** — version column on problems, reject stale updates with 409
8. **Add audit logging** — record who did what, when (role changes, lifecycle transitions, deletions)
9. **Validate UUID path parameters** — return 400 for malformed IDs before hitting DB
10. **Add input length limits** — slug (128), title (256), statement (1MB), summary (10KB)
11. **Replace `window.confirm()`** with accessible modal dialogs (especially for admin grant and delete)
12. **Add search/filter** to problem list and user directory
13. **Add connection pooling** — use `psycopg_pool.ConnectionPool` or equivalent
14. **Split problem-service main.py** — extract into routers, services, repositories modules

### P2 — Production Polish

15. Add soft-delete for problems (archive with recovery period)
16. Add rejection reason field to the reject lifecycle action
17. Add markdown preview to ProblemEditor
18. Add mobile responsive dashboard layout
19. Add breadcrumb navigation
20. Add bulk operations (batch publish, batch archive, batch role assignment)
21. Add `aria-live` regions and proper ARIA attributes throughout dashboard
22. Add rate limiting on expensive endpoints (problem creation, file uploads)
23. Add idempotency keys for POST endpoints
24. Add Pydantic request/response models for full OpenAPI documentation

---

---

## Admin Route UI/UX Issues

### Information Architecture

**Problem: Flat navigation with no grouping**

The sidebar has 7 top-level items (Overview, Problems, New problem, Tags, Users, Operations, Storage) all at the same level. No visual grouping or hierarchy.

**Recommendations:**
- Group into sections: Content (Problems, Tags), People (Users), System (Operations, Storage)
- Remove "New problem" from nav — it's an action, not a destination. It already exists as a button inside the Problems page.

### Dashboard Home (Overview)

**Problems:**
- Shows 3 stat cards (Authored, Drafts, Published) that only reflect "mine" scope — useless for reviewers/moderators
- Shows only 5 recent problems with no "load more"
- No role-specific content — a reviewer sees the same generic page as an author
- No actionable items (e.g., "3 problems awaiting your review")

**Recommendations:**
- Show role-specific widgets: reviewer sees pending review count, moderator sees new users, ops sees queue health
- Add "Recent activity" feed showing lifecycle transitions
- Add "Needs attention" section (problems stuck in review, disabled users, failing workers)

### Problem List (dashboard-problems)

**Problems:**
- Wall of buttons: each problem card shows up to 8 action buttons inline (Edit, Testsets, Public, Request review, Approve, Reject, Publish, Unpublish, Archive, Delete). With 20 problems visible, that's 100+ buttons on screen.
- No search, no filter, no sort, no pagination
- Only two scopes: "Mine" and "Review" — no way to see all problems (for admins)
- Status is shown as a tiny chip — not scannable at a glance
- No way to tell which problems are "ready" (have testsets + checker) vs incomplete

**Recommendations:**
- Show only the primary action inline; move secondary actions to a `⋯` overflow dropdown menu
- Add status filter tabs: All | Draft | Pending Review | Approved | Published | Archived
- Add search bar (client-side filter is fine for <500 problems)
- Add sort options (newest, oldest, recently updated, alphabetical)
- Add a "completeness" indicator per problem (✓ statement, ✓ testset, ✗ checker)
- Consider a Kanban board view for the review workflow

### User Management (dashboard-users)

**Problems:**
- Dense table with too much info per row: username, cognito_sub, UUID, status, roles, role toggle buttons, problem count, submission count, join date, enable/disable
- Role toggle buttons are tiny (11px) and packed together — easy to misclick
- "Add admin" looks identical to "Add author" — no visual distinction for high-risk action
- No confirmation for role grant/revoke (only disable has `window.confirm`)
- No search, no filter, no pagination

**Recommendations:**
- Hide cognito_sub and UUID by default (show on row expand or detail panel)
- Move role management to a slide-out panel per user
- Make "Add admin" visually distinct (warning color, extra confirmation step)
- Add search bar and role filter tabs (All, Authors, Reviewers, Moderators, Admins)
- Add confirmation dialog for all role changes, especially admin grant

### Tags Management (dashboard-tags)

**Relatively well-implemented** — uses a proper Dialog component for create/edit, has auto-slug generation, shows problem count per tag.

**Minor issues:**
- No search/filter for large tag lists
- Delete uses `window.confirm()` instead of custom dialog
- No drag-and-drop reordering
- Color field accepts free text with no preview

### Operations Dashboard

**Relatively well-implemented** — auto-refreshes every 15s, shows workers/jobs/runs/outbox/metrics in clear tables.

**Minor issues:**
- No time range filter (always shows "recent")
- No way to retry failed jobs
- No alerting thresholds (e.g., highlight when queue depth > N)

### Storage (Orphaned Objects)

**Functional but dangerous** — the "Clean up" button permanently deletes objects with only a `window.confirm()`.

**Issues:**
- No preview of what will be deleted before clicking
- No dry-run mode
- No undo/recovery
- Should require typing "DELETE" or similar for bulk destructive action

### Dashboard Shell (Sidebar + Header)

**Problems:**
- Collapsed sidebar icons have no tooltips — unusable without memorizing icons
- No mobile responsive behavior (no hamburger menu, sidebar always visible)
- No breadcrumbs for nested routes (problems → edit → testsets)
- "Back to site" link is small and easy to miss
- Header shows raw pathname (`/dashboard/problems/abc123/edit`) — not human-readable
- User card at bottom uses `position: absolute` — can overlap nav links with many items

**Recommendations:**
- Add tooltips on collapsed icons
- Add breadcrumbs: Dashboard > Problems > "Two Sum" > Edit
- Add responsive sidebar (collapse to hamburger on mobile)
- Show human-readable page title in header instead of raw path

### Cross-Cutting UI/UX Issues

| Issue | Impact | Fix |
|-------|--------|-----|
| `window.confirm()` for all destructive actions | Accessibility, consistency | Custom `<ConfirmDialog>` component |
| Generic toast messages ("Problem updated") | Unclear what happened | Include entity name: "Two Sum moved to Published" |
| No loading indicators per-action | User doesn't know which action is processing | Show spinner on the specific button clicked |
| No empty state guidance | New users don't know what to do | Add contextual help text and "getting started" flows |
| No keyboard shortcuts | Power users can't work efficiently | Add Cmd+S to save, Cmd+Enter to submit |
| No dark/light mode awareness in chips | Status chips may be hard to read in dark mode | Test and adjust chip contrast |

---

## Problem Editor Form — Detailed UX Audit

### Overview

The ProblemEditor is an 860-line monolithic component that handles problem creation AND editing. It renders as a single long scrollable form with 6 card sections (Basic info, Statement, Limits, Tags, Testset, Checker) plus a sidebar. The form tries to do everything at once — metadata, content authoring, file uploads, testset management, and checker configuration — in one submission.

### Structural Problems

**1. Everything-at-once form design**

The form requires filling in ALL of the following before first submission:
- Slug + title + summary
- Full problem statement (markdown or file)
- Difficulty, type, visibility, scoring, status (5 dropdowns in one row)
- Time/memory/output limits
- Tags
- Testset archive (zip file)
- Checker type + config

This is overwhelming for a new author. Most competitive programming judges let you create a problem with just a title, then add statement/testsets/checker incrementally.

**Recommendation:** Split into a multi-step wizard OR allow incremental saves:
- Step 1: Basic info (slug, title, difficulty) → creates the problem as draft
- Step 2: Statement (edit anytime)
- Step 3: Testset (upload/manage separately — already has a separate testsets page)
- Step 4: Checker (configure separately)
- Each step saves independently

**2. Five dropdowns in one row**

The metadata section crams Difficulty, Type, Visibility, Scoring, and Status into a single 5-column grid. On smaller screens this wraps awkwardly. Most of these have only 1-2 options (Type: only "traditional"; Status: only "draft" or "pending_review").

**Recommendation:**
- Remove Status dropdown — status should be controlled by lifecycle actions (Save Draft / Request Review buttons), not a manual dropdown
- Remove Visibility dropdown — visibility should be automatic (private until published)
- Remove Type dropdown if there's only one option (or hide until more types exist)
- This leaves only Difficulty and Scoring as meaningful choices

**3. Statement editing is a plain textarea**

The inline markdown editor is a raw `<Textarea>` with 18 rows and monospace font. No preview, no toolbar, no syntax highlighting. For a platform centered on problem statements, this is the most critical authoring surface and it's the most basic possible implementation.

**Recommendation:**
- Add a split-pane editor: markdown on left, rendered preview on right
- Or at minimum, add a "Preview" tab that renders the markdown
- Add a basic toolbar (bold, italic, code block, heading, link, image)
- Add syntax highlighting for the markdown source

**4. Tag input is a comma-separated text field**

Users type tag slugs manually into a text input. There's a clickable tag list below, but the primary input is still free-text. Typos create invalid references that fail silently on the server.

**Recommendation:**
- Replace with a multi-select/combobox component (search + click to add)
- Remove the free-text input entirely
- Show selected tags as removable chips above the selector

**5. Testset upload is coupled to problem save**

Uploading a testset archive is part of the main form submission. This means:
- You can't upload testsets without re-saving all problem metadata
- A large zip upload blocks the entire form submission
- If the zip extraction fails, the entire save fails (including metadata changes)

**Recommendation:**
- Decouple testset upload from the main form (the separate `/testsets` page already exists — make it the primary path)
- In the editor, show testset status as read-only info with a link to manage
- Or add a separate "Upload testset" button that submits independently

**6. Checker configuration is buried at the bottom**

The checker section is the last card in a long form. For "diff" checker (the default), it still shows a "Note" textarea that's rarely needed. For "custom" checker, it requires runtime selection + entrypoint + source file upload — all inline in the same form.

**Recommendation:**
- For "diff" checker: collapse to a single line ("Checker: diff ✓") with an expand option
- For "custom" checker: open a dedicated dialog/panel for configuration
- Show checker status prominently (configured vs not configured)

**7. No inline validation**

All validation runs only on submit. The user fills out the entire form, clicks submit, and then sees a single error banner at the bottom (e.g., "Slug may only contain lowercase letters, numbers, and hyphens"). They have to scroll up to find and fix the field.

**Recommendation:**
- Validate slug format on blur (already has `onBlur` for slugify, add error display)
- Validate numeric fields on blur
- Show field-level error messages inline below each input
- Highlight invalid fields with red border

**8. Three submit buttons with unclear semantics**

The form has three buttons at the bottom:
- "Create problem" (or "Save") — submits with current status/visibility values
- "Save draft" — forces status=draft, visibility=private
- "Request review" — forces status=pending_review, visibility=private

The difference between button 1 and button 2 is confusing. If the status dropdown is already "draft", they do the same thing. If the user changed the status dropdown to "pending_review" and clicks "Save draft", the dropdown value is ignored.

**Recommendation:**
- Remove the Status dropdown entirely
- Have only two buttons: "Save draft" and "Submit for review"
- In edit mode for already-reviewed problems, show just "Save changes"

**9. Sidebar is mostly wasted space**

The right sidebar (320px) shows:
- Draft status (saved/unsaved + autosave time)
- Reset + Clear autosave buttons
- Runtime catalog (list of all available runtimes)
- Links to other pages

The runtime catalog is reference info that doesn't need permanent screen space. The draft status could be a sticky bar.

**Recommendation:**
- Move draft status to a sticky top bar or floating indicator
- Remove runtime catalog from sidebar (show inline in checker section only when relevant)
- Use sidebar for: problem completeness checklist, preview panel, or remove it entirely on this page

**10. No progress/completeness indicator**

There's no way to see at a glance whether a problem is "ready" for review. A problem needs: title ✓, statement ✓, testset ✓, checker ✓. The form doesn't surface this.

**Recommendation:**
- Add a completeness checklist in the sidebar or header:
  - ✓ Basic info (slug + title)
  - ✓ Statement (has content)
  - ✗ Testset (no archive uploaded)
  - ✓ Checker (diff configured)
- Gray out "Submit for review" until all required sections are complete

### Quick Wins for Problem Form

| Change | Effort | Impact |
|--------|--------|--------|
| Remove Status/Visibility/Type dropdowns | 30 min | Reduces cognitive load |
| Add field-level validation on blur | 2 hrs | Prevents submit-then-scroll-up cycle |
| Add markdown preview tab | 3 hrs | Critical for statement authoring |
| Replace tag text input with multi-select chips | 2 hrs | Eliminates typo errors |
| Add completeness checklist | 1.5 hrs | Guides authors to "ready for review" |
| Collapse checker section when type=diff | 30 min | Reduces visual noise |
| Show testset status as read-only with link | 1 hr | Decouples concerns |
| Reduce to 2 submit buttons (Save draft / Submit for review) | 1 hr | Clearer intent |

---

## Appendix: Files Reviewed

**Backend:**
- `hexacode-backend/services/problem-service/app/main.py` (4,600 lines)
- `hexacode-backend/services/identity-service/app/main.py` (~300 lines)
- `hexacode-backend/backend_common/authz.py`
- `hexacode-backend/backend_common/identity.py`
- `hexacode-backend/db/new-app-schema.sql`

**Frontend:**
- `hexacode-frontend/src/features/problem-editor/ProblemEditor.tsx` (~860 lines)
- `hexacode-frontend/src/routes/problem-new.tsx`
- `hexacode-frontend/src/routes/dashboard-problems.tsx`
- `hexacode-frontend/src/routes/dashboard-users.tsx`
- `hexacode-frontend/src/routes/dashboard-home.tsx`
- `hexacode-frontend/src/components/shell/DashboardShell.tsx`
- `hexacode-frontend/src/lib/auth/AuthProvider.tsx`
- `hexacode-frontend/src/lib/api/types.ts`
