with duplicate_company as (
  select id, row_number() over (partition by company_id order by created_at asc, id asc) as duplicate_rank
  from public.scout_do_not_contact
  where scope = 'company'::public.scout_dnc_scope
    and company_id is not null
)
delete from public.scout_do_not_contact dnc
using duplicate_company duplicate
where dnc.id = duplicate.id
  and duplicate.duplicate_rank > 1;

with duplicate_domain as (
  select id, row_number() over (partition by normalized_domain order by created_at asc, id asc) as duplicate_rank
  from public.scout_do_not_contact
  where scope = 'domain'::public.scout_dnc_scope
    and normalized_domain is not null
)
delete from public.scout_do_not_contact dnc
using duplicate_domain duplicate
where dnc.id = duplicate.id
  and duplicate.duplicate_rank > 1;

with duplicate_contact as (
  select id, row_number() over (partition by contact_id order by created_at asc, id asc) as duplicate_rank
  from public.scout_do_not_contact
  where scope = 'contact'::public.scout_dnc_scope
    and contact_id is not null
)
delete from public.scout_do_not_contact dnc
using duplicate_contact duplicate
where dnc.id = duplicate.id
  and duplicate.duplicate_rank > 1;

with duplicate_contact_email_hash as (
  select id, row_number() over (partition by normalized_email_hash order by created_at asc, id asc) as duplicate_rank
  from public.scout_do_not_contact
  where scope = 'contact'::public.scout_dnc_scope
    and normalized_email_hash is not null
)
delete from public.scout_do_not_contact dnc
using duplicate_contact_email_hash duplicate
where dnc.id = duplicate.id
  and duplicate.duplicate_rank > 1;

create unique index if not exists scout_dnc_company_unique
on public.scout_do_not_contact (company_id)
where scope = 'company'::public.scout_dnc_scope
  and company_id is not null;

create unique index if not exists scout_dnc_domain_unique
on public.scout_do_not_contact (normalized_domain)
where scope = 'domain'::public.scout_dnc_scope
  and normalized_domain is not null;

create unique index if not exists scout_dnc_contact_unique
on public.scout_do_not_contact (contact_id)
where scope = 'contact'::public.scout_dnc_scope
  and contact_id is not null;

create unique index if not exists scout_dnc_contact_email_hash_unique
on public.scout_do_not_contact (normalized_email_hash)
where scope = 'contact'::public.scout_dnc_scope
  and normalized_email_hash is not null;
