create or replace function public.scout_prevent_blocking_outcome_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'blocked'
    and exists (
      select 1
      from public.scout_outcomes outcome
      where outcome.company_id = new.company_id
        and outcome.outcome = 'negative'
    )
  then
    raise exception 'Negative outcome gate: message blocked for company %', new.company_id;
  end if;

  return new;
end;
$$;

drop trigger if exists scout_messages_prevent_blocking_outcome on public.scout_messages;
create trigger scout_messages_prevent_blocking_outcome
before insert or update of status, company_id on public.scout_messages
for each row execute function public.scout_prevent_blocking_outcome_message();

create or replace function public.scout_block_messages_after_negative_outcome()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.outcome = 'negative' then
    update public.scout_messages
    set status = 'blocked'
    where company_id = new.company_id
      and status <> 'blocked';
  end if;

  return new;
end;
$$;

drop trigger if exists scout_outcomes_block_messages on public.scout_outcomes;
create trigger scout_outcomes_block_messages
after insert or update of outcome on public.scout_outcomes
for each row execute function public.scout_block_messages_after_negative_outcome();;
