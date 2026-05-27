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
end $$;

alter table audit_events
  alter column outcome set not null;

alter table audit_events
  alter column severity set not null;
