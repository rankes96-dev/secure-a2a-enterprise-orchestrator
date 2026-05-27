alter table audit_events
  add column if not exists outcome text;

alter table audit_events
  add column if not exists severity text;

update audit_events
set outcome = case
  when event_type = 'connector.runtime.failed' then 'failure'
  when event_type = 'connector.runtime.authorization_required' then 'needs_action'
  when event_type in ('security.request.blocked', 'gateway.authorization.denied', 'tenant.access.denied') then 'blocked'
  when event_type like '%blocked%' then 'blocked'
  when event_type like '%failed%' then 'failure'
  else 'success'
end
where outcome is null;

update audit_events
set severity = case
  when event_type = 'user.identity.verified' then 'info'
  when event_type = 'connector.onboarding.trusted' then 'medium'
  when event_type = 'connector.runtime.token.issued' then 'info'
  when event_type = 'connector.runtime.succeeded' then 'info'
  when event_type = 'connector.runtime.failed' then 'medium'
  when event_type = 'connector.runtime.authorization_required' then 'low'
  when event_type = 'security.request.blocked' then 'high'
  when event_type = 'gateway.authorization.denied' then 'high'
  when event_type = 'gateway.authorization.evaluated' then 'info'
  when event_type = 'tenant.access.denied' then 'high'
  when event_type like '%blocked%' then 'high'
  when event_type like '%failed%' then 'medium'
  else 'info'
end
where severity is null;

alter table audit_events
  alter column outcome set not null;

alter table audit_events
  alter column severity set not null;

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
      check (outcome in ('success', 'failure', 'blocked', 'needs_action'));
  end if;
end $$;

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
      check (severity in ('info', 'low', 'medium', 'high', 'critical'));
  end if;
end $$;

create index if not exists audit_events_tenant_created_at_id_idx
  on audit_events (tenant_id, created_at desc, id desc);

create index if not exists audit_events_tenant_outcome_created_at_id_idx
  on audit_events (tenant_id, outcome, created_at desc, id desc);

create index if not exists audit_events_tenant_severity_created_at_id_idx
  on audit_events (tenant_id, severity, created_at desc, id desc);

create index if not exists audit_events_tenant_outcome_severity_created_at_id_idx
  on audit_events (tenant_id, outcome, severity, created_at desc, id desc);
