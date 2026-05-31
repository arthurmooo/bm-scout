create or replace function public.scout_block_messages_for_dnc()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  update public.scout_messages messages
  set status = 'blocked'
  where messages.status <> 'blocked'
    and (
      (new.company_id is not null and messages.company_id = new.company_id)
      or (new.contact_id is not null and messages.contact_id = new.contact_id)
      or (
        new.normalized_domain is not null
        and exists (
          select 1
          from public.scout_companies companies
          where companies.id = messages.company_id
            and companies.domain = lower(trim(new.normalized_domain))
        )
      )
      or (
        new.normalized_email_hash is not null
        and exists (
          select 1
          from public.scout_contacts contacts
          where contacts.id = messages.contact_id
            and contacts.email_hash = new.normalized_email_hash
        )
      )
    );

  return new;
end;
$$;

drop trigger if exists scout_dnc_blocks_existing_messages on public.scout_do_not_contact;
create trigger scout_dnc_blocks_existing_messages
after insert or update of normalized_email_hash, normalized_domain, company_id, contact_id
on public.scout_do_not_contact
for each row execute function public.scout_block_messages_for_dnc();

revoke execute on function public.scout_block_messages_for_dnc() from public, anon, authenticated;

create or replace function public.scout_block_contact_messages_if_dnc()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.do_not_contact is true
    or public.scout_is_do_not_contact(new.email, null, new.company_id, new.id)
  then
    update public.scout_messages messages
    set status = 'blocked'
    where messages.status <> 'blocked'
      and messages.contact_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists scout_contacts_block_existing_dnc_messages on public.scout_contacts;
create trigger scout_contacts_block_existing_dnc_messages
after insert or update of email, company_id, do_not_contact
on public.scout_contacts
for each row execute function public.scout_block_contact_messages_if_dnc();

revoke execute on function public.scout_block_contact_messages_if_dnc() from public, anon, authenticated;

create or replace function public.scout_block_company_messages_if_dnc()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if public.scout_is_do_not_contact(null, new.domain, new.id, null)
  then
    update public.scout_messages messages
    set status = 'blocked'
    where messages.status <> 'blocked'
      and messages.company_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists scout_companies_block_existing_dnc_messages on public.scout_companies;
create trigger scout_companies_block_existing_dnc_messages
after insert or update of website
on public.scout_companies
for each row execute function public.scout_block_company_messages_if_dnc();

revoke execute on function public.scout_block_company_messages_if_dnc() from public, anon, authenticated;
