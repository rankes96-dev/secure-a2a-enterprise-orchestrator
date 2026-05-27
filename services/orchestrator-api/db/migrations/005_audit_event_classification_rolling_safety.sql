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
