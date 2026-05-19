CREATE TABLE IF NOT EXISTS app_identity.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES app_identity.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON app_identity.audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON app_identity.audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON app_identity.audit_log(created_at DESC);
