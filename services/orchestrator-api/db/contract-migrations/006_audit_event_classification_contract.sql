do $$
begin
  if exists (
    select 1
    from audit_events
    where outcome is null
       or severity is null
  ) then
    raise exception 'audit_events classification contract blocked: null outcome/severity rows remain';
  end if;

  if exists (
    select 1
    from pg_attribute
    where attrelid = 'audit_events'::regclass
      and attname = 'outcome'
      and not attnotnull
  ) then
    alter table audit_events
      alter column outcome set not null;
  end if;

  if exists (
    select 1
    from pg_attribute
    where attrelid = 'audit_events'::regclass
      and attname = 'severity'
      and not attnotnull
  ) then
    alter table audit_events
      alter column severity set not null;
  end if;
end $$;
