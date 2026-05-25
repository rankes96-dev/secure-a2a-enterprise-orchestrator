alter table connector_trust_records
  add column if not exists owner_key_hash text;

do $$
declare
  unique_constraint_name text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'connector_trust_records'
      and column_name = 'owner_key'
  ) then
    for unique_constraint_name in
      select conname
      from pg_constraint
      where conrelid = 'connector_trust_records'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) like '%owner_key%'
    loop
      execute format('alter table connector_trust_records drop constraint if exists %I', unique_constraint_name);
    end loop;

    if exists (
      select 1
      from connector_trust_records
      where owner_key_hash is null
        and owner_key is not null
    ) then
      if to_regprocedure('digest(text,text)') is null then
        raise exception 'connector_trust_records.owner_key requires manual migration to owner_key_hash; install pgcrypto or backfill owner_key_hash before running this migration';
      end if;

      execute 'update connector_trust_records set owner_key_hash = encode(digest(owner_key, ''sha256''), ''hex'') where owner_key_hash is null and owner_key is not null';
    end if;

    if exists (select 1 from connector_trust_records where owner_key_hash is null) then
      raise exception 'connector_trust_records.owner_key_hash must be backfilled before owner_key can be dropped';
    end if;

    execute 'alter table connector_trust_records drop column owner_key';
  end if;
end $$;

alter table connector_trust_records
  alter column owner_key_hash set not null;

create unique index if not exists connector_trust_records_tenant_owner_agent_uidx
  on connector_trust_records (tenant_id, owner_key_hash, agent_id);

create index if not exists connector_trust_records_owner_key_hash_idx
  on connector_trust_records (owner_key_hash);
