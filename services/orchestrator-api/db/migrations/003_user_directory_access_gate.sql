alter table users
  add column if not exists status text not null default 'active';

alter table users
  alter column subject drop not null;

alter table users
  alter column provider drop not null;

do $$
begin
  if exists (select 1 from users where email is null or trim(email) = '') then
    raise exception 'users.email contains null values; seed/update users before enforcing user directory access';
  end if;
end $$;

alter table users
  alter column email set not null;

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

create unique index if not exists users_tenant_email_idx
  on users (tenant_id, lower(email));

create unique index if not exists users_tenant_provider_issuer_subject_idx
  on users (tenant_id, provider, issuer, subject)
  where provider is not null and subject is not null;
