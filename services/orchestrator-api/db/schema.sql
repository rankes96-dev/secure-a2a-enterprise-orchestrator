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
  provider text,
  issuer text,
  subject text,
  email text not null,
  display_name text,
  roles jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users
  add column if not exists status text not null default 'active';

do $$
begin
  if exists (select 1 from users where email is null or trim(email) = '') then
    raise exception 'users.email contains null values; seed/update users before enforcing user directory access';
  end if;
end $$;

alter table users
  alter column email set not null;

alter table users
  alter column subject drop not null;

alter table users
  alter column provider drop not null;

alter table users
  drop constraint if exists users_tenant_id_provider_subject_key;

do $$
declare
  unique_constraint_name text;
begin
  for unique_constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'users'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, provider, subject)'
  loop
    execute format('alter table users drop constraint if exists %I', unique_constraint_name);
  end loop;
end $$;

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
  outcome text,
  severity text,
  safe_metadata jsonb not null default '{}'::jsonb
);

alter table audit_events
  add column if not exists outcome text;

alter table audit_events
  add column if not exists severity text;

alter table audit_events
  alter column outcome drop not null;

alter table audit_events
  alter column severity drop not null;

create or replace function audit_event_outcome_for_event_type(audit_event_type text)
returns text
language sql
immutable
as $$
  select case
    when audit_event_type = 'connector.runtime.failed' then 'failure'
    when audit_event_type = 'connector.runtime.authorization_required' then 'needs_action'
    when audit_event_type in ('security.request.blocked', 'gateway.authorization.denied', 'tenant.access.denied') then 'blocked'
    when audit_event_type like '%blocked%' then 'blocked'
    when audit_event_type like '%failed%' then 'failure'
    else 'success'
  end
$$;

create or replace function audit_event_severity_for_event_type(audit_event_type text)
returns text
language sql
immutable
as $$
  select case
    when audit_event_type = 'user.identity.verified' then 'info'
    when audit_event_type = 'connector.onboarding.trusted' then 'medium'
    when audit_event_type = 'connector.runtime.token.issued' then 'info'
    when audit_event_type = 'connector.runtime.succeeded' then 'info'
    when audit_event_type = 'connector.runtime.failed' then 'medium'
    when audit_event_type = 'connector.runtime.authorization_required' then 'low'
    when audit_event_type = 'security.request.blocked' then 'high'
    when audit_event_type = 'gateway.authorization.denied' then 'high'
    when audit_event_type = 'gateway.authorization.evaluated' then 'info'
    when audit_event_type = 'tenant.access.denied' then 'high'
    when audit_event_type like '%blocked%' then 'high'
    when audit_event_type like '%failed%' then 'medium'
    else 'info'
  end
$$;

create or replace function audit_events_materialize_classification()
returns trigger
language plpgsql
as $$
begin
  if new.outcome is null then
    new.outcome := audit_event_outcome_for_event_type(new.event_type);
  end if;
  if new.severity is null then
    new.severity := audit_event_severity_for_event_type(new.event_type);
  end if;
  return new;
end
$$;

drop trigger if exists audit_events_materialize_classification_trigger on audit_events;

create trigger audit_events_materialize_classification_trigger
  before insert or update of event_type, outcome, severity on audit_events
  for each row
  execute function audit_events_materialize_classification();

update audit_events
set outcome = coalesce(outcome, audit_event_outcome_for_event_type(event_type)),
    severity = coalesce(severity, audit_event_severity_for_event_type(event_type))
where outcome is null
   or severity is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'audit_events'::regclass
      and conname = 'audit_events_outcome_check'
  ) then
    alter table audit_events
      add constraint audit_events_outcome_check
      check (outcome in ('success', 'failure', 'blocked', 'needs_action')) not valid;
  end if;
end $$;

alter table audit_events
  validate constraint audit_events_outcome_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'audit_events'::regclass
      and conname = 'audit_events_severity_check'
  ) then
    alter table audit_events
      add constraint audit_events_severity_check
      check (severity in ('info', 'low', 'medium', 'high', 'critical')) not valid;
  end if;
end $$;

alter table audit_events
  validate constraint audit_events_severity_check;

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

create unique index if not exists users_tenant_email_idx
  on users (tenant_id, lower(email));

create unique index if not exists users_tenant_provider_issuer_subject_idx
  on users (tenant_id, provider, issuer, subject)
  where provider is not null and subject is not null;

create index if not exists users_tenant_provider_subject_idx
  on users (tenant_id, provider, subject)
  where provider is not null and subject is not null;

create index if not exists connector_trust_records_owner_key_hash_idx
  on connector_trust_records (owner_key_hash);

create index if not exists connector_trust_records_tenant_id_idx
  on connector_trust_records (tenant_id);

create index if not exists audit_events_tenant_created_at_idx
  on audit_events (tenant_id, created_at desc);

create index if not exists audit_events_tenant_created_at_id_idx
  on audit_events (tenant_id, created_at desc, id desc);

create index if not exists audit_events_tenant_outcome_created_at_id_idx
  on audit_events (tenant_id, outcome, created_at desc, id desc);

create index if not exists audit_events_tenant_severity_created_at_id_idx
  on audit_events (tenant_id, severity, created_at desc, id desc);

create index if not exists audit_events_tenant_outcome_severity_created_at_id_idx
  on audit_events (tenant_id, outcome, severity, created_at desc, id desc);

create index if not exists audit_events_actor_subject_created_at_idx
  on audit_events (actor_subject, created_at desc);

create index if not exists conversation_states_actor_subject_updated_at_idx
  on conversation_states (actor_subject, updated_at desc);

create index if not exists conversation_states_tenant_updated_at_idx
  on conversation_states (tenant_id, updated_at desc);
