# Admin Features Improvement Plan

**Based on:** `docs/admin-features-audit.md`  
**Goal:** Fix critical bugs, improve security, add missing production features, and overhaul admin UI/UX  
**Approach:** Phased implementation, backend-first for data/API changes, then frontend  
**Status:** ✅ ALL PHASES COMPLETE (2026-05-19)

---

## Available Libraries (already in package.json, underutilized)

- `@monaco-editor/react` — for markdown editing (currently only used in solve workspace)
- `react-markdown` + `remark-gfm` + `rehype-katex` — for markdown preview
- `react-hook-form` + `zod` — for form validation (not used in ProblemEditor)
- `@radix-ui/react-tooltip` — for sidebar tooltips
- `@radix-ui/react-popover` — for dropdown menus
- `@tanstack/react-table` — for sortable/filterable tables
- `react-dropzone` — for drag-and-drop file uploads
- `react-resizable-panels` — for split-pane editor

---

## Phase 1: Critical Bug Fixes & Security (Backend)

Minimal changes, maximum safety impact. No UI changes needed.

### 1.1 Fix broken delete endpoint
- **File:** `hexacode-backend/services/problem-service/app/main.py`
- **Change:** Add `PERM_PROBLEM_DELETE_OWN_DRAFT` to the import from `backend_common.authz`

### 1.2 Add zip bomb protection
- **File:** `hexacode-backend/services/problem-service/app/main.py`
- **Change:** In `extract_testcases_from_archive`, add:
  - Max total decompressed size: 256MB
  - Max file count: 10,000
  - Track cumulative size during extraction, abort with 400 if exceeded

### 1.3 Add input validation limits
- **File:** `hexacode-backend/services/problem-service/app/main.py`
- **Changes:**
  - Slug max length: 128 chars
  - Title max length: 256 chars
  - Summary max length: 10KB
  - Statement (JSON path) max length: 1MB
  - Statement assets max count: 20 per request
  - Time limit max: 30000ms, Memory limit max: 1048576KB (1GB), Output limit max: 262144KB
  - Validate UUID format on path params (add helper, return 400)

### 1.4 Add last-admin protection
- **File:** `hexacode-backend/services/identity-service/app/main.py`
- **Change:** Before revoking `admin` role, count remaining admins. If count <= 1, return 409.

### 1.5 Add self-action prevention
- **File:** `hexacode-backend/services/identity-service/app/main.py`
- **Changes:**
  - Prevent user from disabling themselves
  - Prevent user from revoking their own admin role
  - Return 409 with clear message

### 1.6 Fix TOCTOU race in create
- **File:** `hexacode-backend/services/problem-service/app/main.py`
- **Change:** Remove the redundant `problem_slug_exists(slug)` check outside the transaction. The in-transaction check is sufficient.

---

## Phase 2: Backend Pagination & Search

### 2.1 Add pagination to problem list endpoints
- **File:** `hexacode-backend/services/problem-service/app/main.py`
- **Changes:**
  - Add `limit` (default 25, max 100) and `offset` query params to `GET /api/problems` and `GET /api/dashboard/problems`
  - Add `total` count to response meta
  - Add `search` query param (ILIKE on title and slug)
  - Add `status` filter param
  - Add `sort` param (newest, oldest, updated, title)

### 2.2 Add pagination to user list endpoint
- **File:** `hexacode-backend/services/identity-service/app/main.py`
- **Changes:**
  - Add `limit` (default 25, max 100) and `offset` query params to `GET /api/dashboard/users`
  - Add `total` count to response meta
  - Add `search` query param (ILIKE on username)
  - Add `role` filter param
  - Add `status` filter param

### 2.3 Add database indexes
- **File:** `hexacode-backend/db/new-app-schema.sql` (and a migration script)
- **Changes:**
  - Add index on `app_identity.users(username)`
  - Add index on `app_identity.users(status_code)`
  - Add index on `problem.problems(status_code)`
  - Add index on `problem.problems(created_by_user_id)`

---

## Phase 3: Backend Quality (Audit Log, Optimistic Locking, Rejection Reason)

### 3.1 Add audit log table
- **Schema change:** Create `app_identity.audit_log` table:
  ```sql
  CREATE TABLE app_identity.audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES app_identity.users(id),
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    details jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX idx_audit_log_target ON app_identity.audit_log(target_type, target_id);
  CREATE INDEX idx_audit_log_actor ON app_identity.audit_log(actor_user_id);
  CREATE INDEX idx_audit_log_created ON app_identity.audit_log(created_at DESC);
  ```
- **Backend changes:** Log role grant/revoke, user enable/disable, problem lifecycle transitions, problem delete

### 3.2 Add optimistic locking to problems
- **Schema change:** Add `version integer NOT NULL DEFAULT 1` to `problem.problems`
- **Backend changes:**
  - Return `version` in problem responses
  - Require `version` in update requests
  - `UPDATE ... WHERE id = %s AND version = %s`, increment version
  - Return 409 if no row updated (stale version)

### 3.3 Add rejection reason
- **Schema change:** Add `rejection_reason text` to `problem.problems`
- **Backend changes:**
  - Accept optional `reason` body on `POST /api/dashboard/problems/{id}/actions/reject`
  - Store in `rejection_reason` column
  - Return in problem detail responses
  - Clear on re-submission to review

---

## Phase 4: Frontend — Shared UI Components

Build reusable components before touching individual pages.

### 4.1 ConfirmDialog component
- **File:** `hexacode-frontend/src/components/ui/ConfirmDialog.tsx`
- Wraps existing `Dialog` component
- Props: `title`, `description`, `confirmLabel`, `confirmVariant` (danger/default), `onConfirm`, `onCancel`
- Optional: `requireTyping` prop for high-risk actions (type "DELETE" to confirm)

### 4.2 SearchInput component
- **File:** `hexacode-frontend/src/components/ui/SearchInput.tsx`
- Debounced text input with search icon
- Props: `value`, `onChange`, `placeholder`, `debounceMs`

### 4.3 Tooltip wrapper
- **File:** `hexacode-frontend/src/components/ui/Tooltip.tsx`
- Thin wrapper around `@radix-ui/react-tooltip` with consistent styling
- Props: `content`, `children`, `side`

### 4.4 DropdownMenu component
- **File:** `hexacode-frontend/src/components/ui/DropdownMenu.tsx`
- Wrapper around `@radix-ui/react-dropdown-menu` (already imported in PublicNav)
- Standardize for reuse in problem action menus

### 4.5 Breadcrumbs component
- **File:** `hexacode-frontend/src/components/ui/Breadcrumbs.tsx`
- Auto-generates from route path or accepts explicit items
- Props: `items: { label: string, to?: string }[]`

### 4.6 MarkdownPreview component
- **File:** `hexacode-frontend/src/components/ui/MarkdownPreview.tsx`
- Uses existing `react-markdown` + `remark-gfm` + `rehype-katex`
- Styled consistently with the problem detail page renderer

---

## Phase 5: Frontend — Dashboard Shell Improvements

### 5.1 Sidebar improvements
- **File:** `hexacode-frontend/src/components/shell/DashboardShell.tsx`
- **Changes:**
  - Add Tooltip to collapsed nav icons
  - Group nav items into sections (Content, People, System) with subtle dividers
  - Remove "New problem" from nav (keep it as button in Problems page)
  - Add responsive behavior: auto-collapse on mobile, hamburger toggle
  - Fix user card positioning (use flex instead of absolute)

### 5.2 Header improvements
- **File:** `hexacode-frontend/src/components/shell/DashboardShell.tsx`
- **Changes:**
  - Replace raw pathname with Breadcrumbs component
  - Make "Back to site" more prominent

---

## Phase 6: Frontend — Problem List Overhaul

### 6.1 Rewrite dashboard-problems with search, filter, sort, pagination
- **File:** `hexacode-frontend/src/routes/dashboard-problems.tsx`
- **Changes:**
  - Add SearchInput at top
  - Add status filter tabs (All, Draft, Pending Review, Approved, Published, Archived)
  - Add sort dropdown (Newest, Recently updated, Title A-Z)
  - Add pagination controls (prev/next + page indicator)
  - Connect to new paginated backend API
  - Move secondary actions to DropdownMenu (⋯ button per problem)
  - Keep only primary action inline (the most likely next step based on status)
  - Replace `window.confirm()` with ConfirmDialog
  - Include problem title in toast messages
  - Add completeness indicator (✓ statement, ✓ testset, ✓ checker)
  - Add scope "All" for admins

---

## Phase 7: Frontend — User Management Overhaul

### 7.1 Rewrite dashboard-users with search, filter, detail panel
- **File:** `hexacode-frontend/src/routes/dashboard-users.tsx`
- **Changes:**
  - Add SearchInput at top
  - Add role filter tabs (All, Authors, Reviewers, Moderators, Admins)
  - Add pagination controls
  - Simplify table: show username, status, roles (as chips), problem count, joined
  - Hide cognito_sub and UUID (show on row click/expand)
  - Move role management to a slide-out panel (click user row → panel opens)
  - Add ConfirmDialog for role changes (especially admin grant with warning)
  - Make "Grant admin" button visually distinct (red/warning style)
  - Add ConfirmDialog for disable action

---

## Phase 8: Frontend — Problem Editor Overhaul

### 8.1 Restructure form layout
- **File:** `hexacode-frontend/src/features/problem-editor/ProblemEditor.tsx`
- **Changes:**
  - Remove Status dropdown (controlled by submit buttons)
  - Remove Visibility dropdown (automatic: private until published)
  - Remove Type dropdown (only one option exists)
  - Reduce metadata row to: Difficulty + Scoring (2 dropdowns)
  - Reduce submit buttons to 2: "Save draft" + "Submit for review" (edit mode: "Save changes")

### 8.2 Add markdown split-pane editor
- **Changes:**
  - Replace plain `<Textarea>` with split-pane layout using `react-resizable-panels`
  - Left panel: Monaco editor (`@monaco-editor/react`) with markdown language mode
  - Right panel: MarkdownPreview component (live preview)
  - Add tab toggle: "Edit" | "Preview" | "Split" for different screen sizes

### 8.3 Replace tag input with multi-select chips
- **Changes:**
  - Remove free-text tag input
  - Add combobox/searchable multi-select using available tags from API
  - Show selected tags as removable chips
  - Use `@radix-ui/react-popover` for the dropdown

### 8.4 Add inline field validation
- **Changes:**
  - Integrate `react-hook-form` + `zod` schema for the form
  - Validate slug format on blur with inline error message
  - Validate numeric fields on blur (positive int, within bounds)
  - Validate title non-empty on blur
  - Show red border + error text below invalid fields

### 8.5 Add completeness checklist sidebar
- **Changes:**
  - Replace runtime catalog in sidebar with completeness checklist:
    - ✓/✗ Basic info (slug + title filled)
    - ✓/✗ Statement (has content or file)
    - ✓/✗ Testset (has at least one testset — read from initialData)
    - ✓/✗ Checker (configured)
  - Disable "Submit for review" button until all checks pass
  - Keep draft status indicator (move to top of sidebar)

### 8.6 Decouple testset section
- **Changes:**
  - In the editor, show testset status as read-only card:
    - "Primary testset · 25 cases" or "No testset uploaded"
    - Link: "Manage testsets →" (goes to `/dashboard/problems/:id/testsets`)
  - Remove testset archive upload from the main form
  - For create mode: show "Upload testsets after creating the problem"

### 8.7 Collapse checker section
- **Changes:**
  - When checker type = "diff": show single collapsed line "Checker: diff (default)" with expand toggle
  - When checker type = "custom": show full configuration panel
  - Move checker source upload to a dedicated sub-section with drag-and-drop (`react-dropzone`)

### 8.8 Add file drag-and-drop
- **Changes:**
  - Replace raw `<input type="file">` with `react-dropzone` zones
  - Add visual drop targets with dashed borders
  - Show file preview after selection (name, size, type icon)

---

## Phase 9: Frontend — Dashboard Home Improvements

### 9.1 Role-specific dashboard widgets
- **File:** `hexacode-frontend/src/routes/dashboard-home.tsx`
- **Changes:**
  - Reviewer widget: "X problems awaiting review" with link to review scope
  - Author widget: "X drafts in progress" with links
  - Moderator widget: "X users, X disabled" summary
  - Ops widget: worker health summary (online/offline count, queue depth)
  - Add "Needs attention" section for problems stuck > 7 days in review

---

## Execution Order & Dependencies

```
Phase 1 (bugs/security) ──→ can deploy independently
Phase 2 (pagination API) ──→ Phase 6, 7 depend on this
Phase 3 (audit/locking) ──→ can deploy independently
Phase 4 (shared components) ──→ Phase 5, 6, 7, 8 depend on this
Phase 5 (shell) ──→ independent after Phase 4
Phase 6 (problem list) ──→ depends on Phase 2 + 4
Phase 7 (user mgmt) ──→ depends on Phase 2 + 4
Phase 8 (problem editor) ──→ depends on Phase 4
Phase 9 (dashboard home) ──→ depends on Phase 2
```

Parallelizable groups:
- **Group A (backend):** Phase 1 + 2 + 3 (all backend, no frontend dependency)
- **Group B (frontend foundation):** Phase 4 (shared components)
- **Group C (frontend pages):** Phase 5 + 6 + 7 + 8 + 9 (after Group A + B)

---

## Estimated Scope

| Phase | Files Modified | Complexity |
|-------|---------------|------------|
| 1 | 2 backend files | Low — targeted fixes |
| 2 | 2 backend files + 1 SQL | Medium — query changes + new params |
| 3 | 2 backend files + 1 SQL | Medium — new table + logic |
| 4 | 6 new frontend files | Medium — reusable components |
| 5 | 1 frontend file | Low-Medium — shell refactor |
| 6 | 1 frontend file (rewrite) | High — full page rewrite |
| 7 | 1 frontend file (rewrite) | High — full page rewrite |
| 8 | 1 frontend file (major refactor) | High — 860-line component overhaul |
| 9 | 1 frontend file | Low-Medium — add widgets |

---

## Notes for Implementation

- All frontend changes should maintain existing API compatibility until Phase 2 APIs are ready
- Phase 8 (editor) is the largest single change — consider splitting into sub-PRs
- Phase 4 components should be built with Storybook-style isolation (test in isolation before integrating)
- Backend Phase 2 should be backward-compatible (pagination params are optional, default to current behavior)
- The existing `Dialog`, `Tabs`, `Card`, `Chip`, `Table` components are solid — build on top of them
