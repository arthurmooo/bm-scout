create or replace function public.scout_is_do_not_contact(
  input_email text default null,
  input_domain text default null,
  input_company_id uuid default null,
  input_contact_id uuid default null
)
returns boolean
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.scout_do_not_contact dnc
    where
      (input_email is not null and dnc.normalized_email_hash = public.scout_email_hash(input_email))
      or (input_domain is not null and dnc.normalized_domain = lower(trim(input_domain)))
      or (input_company_id is not null and dnc.company_id = input_company_id)
      or (input_contact_id is not null and dnc.contact_id = input_contact_id)
  );
$$;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.scout_is_do_not_contact(text, text, uuid, uuid) from public, anon;
grant execute on function public.scout_is_do_not_contact(text, text, uuid, uuid) to authenticated, service_role;
