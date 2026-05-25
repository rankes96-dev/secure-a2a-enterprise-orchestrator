create table if not exists tenants (
  id text primary key,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  tenant_id text not null references tenants(id),
  provider text not null,
  issuer text,
  subject text not null,
  email text,
  display_name text,
  roles jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, subject)
);

create table if not exists connector_trust_records (
  id text primary key,
  tenant_id text,
  owner_key_hash text not null,
  connector_id text,
  resource_system text,
  agent_id text not null,
  issuer text not null,
  audience text not null,
  runtime_endpoint text,
  connector_profile_hash text,
  external_config_hash text,
  trusted_at timestamptz not null,
  updated_at timestamptz not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  unique (tenant_id, owner_key_hash, agent_id)
);

create table if not exists audit_events (
  id text primary key,
  tenant_id text,
  actor_provider text,
  actor_subject text,
  actor_email text,
  event_type text not null,
  resource_type text,
  resource_id text,
  created_at timestamptz not null,
  safe_metadata jsonb not null default '{}'::jsonb
);

create table if not exists conversation_states (
  id text primary key,
  tenant_id text,
  actor_provider text,
  actor_subject text,
  actor_email text,
  owner_session_hash text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_resolution_status text,
  needs_more_info_count integer not null default 0,
  messages jsonb not null default '[]'::jsonb,
  pending_interaction jsonb,
  pending_follow_up jsonb,
  last_request_interpretation jsonb,
  safe_metadata jsonb not null default '{}'::jsonb
);

create table if not exists runtime_executions (
  id text primary key,
  tenant_id text,
  conversation_id text,
  actor_provider text,
  actor_subject text,
  actor_email text,
  connector_id text,
  resource_system text,
  skill_id text,
  runtime_mode text,
  status text,
  outcome text,
  created_at timestamptz not null default now(),
  safe_metadata jsonb not null default '{}'::jsonb
);

create index if not exists users_tenant_provider_subject_idx
  on users (tenant_id, provider, subject);

create index if not exists connector_trust_records_owner_key_hash_idx
  on connector_trust_records (owner_key_hash);

create index if not exists connector_trust_records_tenant_id_idx
  on connector_trust_records (tenant_id);

create index if not exists audit_events_tenant_created_at_idx
  on audit_events (tenant_id, created_at desc);

create index if not exists audit_events_actor_subject_created_at_idx
  on audit_events (actor_subject, created_at desc);

create index if not exists conversation_states_actor_subject_updated_at_idx
  on conversation_states (actor_subject, updated_at desc);

create index if not exists conversation_states_tenant_updated_at_idx
  on conversation_states (tenant_id, updated_at desc);
