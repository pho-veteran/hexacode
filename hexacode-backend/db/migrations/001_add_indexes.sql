-- Migration: Add indexes for pagination and search performance
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_users_username ON app_identity.users(username);
CREATE INDEX IF NOT EXISTS idx_users_status ON app_identity.users(status_code);
CREATE INDEX IF NOT EXISTS idx_problems_status ON problem.problems(status_code);
CREATE INDEX IF NOT EXISTS idx_problems_created_by ON problem.problems(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_problems_slug_lower ON problem.problems(lower(slug));
CREATE INDEX IF NOT EXISTS idx_problems_title_trgm ON problem.problems USING gin(title gin_trgm_ops);
