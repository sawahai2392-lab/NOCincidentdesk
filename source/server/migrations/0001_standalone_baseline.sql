-- NOC Incident Desk standalone PostgreSQL baseline
-- All schema changes after this file must be added as a new numbered migration.

DO $$ BEGIN
  CREATE TYPE workspace_role AS ENUM ('admin', 'supervisor', 'operator');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incident_status AS ENUM ('Draft', 'Open', 'Monitoring', 'Resolved', 'Closed', 'Cancel');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE incident_severity AS ENUM ('Critical', 'Major', 'Minor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS workspaces (
  id varchar(240) PRIMARY KEY,
  name varchar(200) NOT NULL,
  owner_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_email_uq ON "user"(email);

CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS session_token_uq ON "session"(token);
CREATE INDEX IF NOT EXISTS session_user_idx ON "session"(user_id);

CREATE TABLE IF NOT EXISTS "account" (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_idx ON "account"(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_account_uq ON "account"(provider_id, account_id);

CREATE TABLE IF NOT EXISTS "verification" (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification"(identifier);

CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(240) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  email varchar(320) NOT NULL,
  name varchar(180) NOT NULL,
  role workspace_role NOT NULL DEFAULT 'operator',
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_workspace_user_uq ON workspace_members(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS workspace_members_workspace_idx ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS workspace_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(240) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_settings_workspace_uq ON workspace_settings(workspace_id);

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(240) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  identity_mode varchar(16) NOT NULL DEFAULT 'standard',
  incident_id varchar(180) NOT NULL DEFAULT '',
  title_override varchar(1000) NOT NULL DEFAULT '',
  status incident_status NOT NULL DEFAULT 'Draft',
  severity incident_severity NOT NULL DEFAULT 'Critical',
  revision integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  delete_reason text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_workspace_updated_idx ON incidents(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS incidents_workspace_status_idx ON incidents(workspace_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_workspace_active_incident_id_uq
  ON incidents(workspace_id, lower(btrim(incident_id)))
  WHERE deleted_at IS NULL AND incident_id <> '';

CREATE TABLE IF NOT EXISTS incident_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(240) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  label varchar(300) NOT NULL,
  snapshot jsonb NOT NULL,
  created_by text NOT NULL,
  created_by_name varchar(180) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_versions_incident_created_idx ON incident_versions(incident_id, created_at);

CREATE TABLE IF NOT EXISTS incident_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(240) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  action varchar(100) NOT NULL,
  summary varchar(500) NOT NULL,
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  from_revision integer NOT NULL DEFAULT 0,
  to_revision integer NOT NULL DEFAULT 0,
  actor_id text NOT NULL,
  actor_name varchar(180) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_audit_logs_incident_created_idx ON incident_audit_logs(incident_id, created_at);

CREATE TABLE IF NOT EXISTS route_master_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(240) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  system_key varchar(180) NOT NULL,
  route_segment varchar(240) NOT NULL,
  source_import_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS route_master_workspace_pair_uq ON route_master_items(workspace_id, system_key, route_segment);
CREATE INDEX IF NOT EXISTS route_master_workspace_idx ON route_master_items(workspace_id);

CREATE TABLE IF NOT EXISTS legacy_documents (
  namespace varchar(240) NOT NULL,
  document_id varchar(240) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, document_id)
);
CREATE INDEX IF NOT EXISTS legacy_documents_namespace_idx ON legacy_documents(namespace);

CREATE TABLE IF NOT EXISTS workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash varchar(64) NOT NULL,
  workspace_id varchar(240) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_email varchar(320) NOT NULL,
  invited_role workspace_role NOT NULL DEFAULT 'operator',
  created_by text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_token_hash_uq ON workspace_invitations(token_hash);
CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx ON workspace_invitations(workspace_id);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  endpoint text NOT NULL,
  subscription jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS web_push_subscriptions_endpoint_uq ON web_push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx ON web_push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  title varchar(200) NOT NULL,
  body varchar(500) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx ON user_notifications(user_id, created_at);
