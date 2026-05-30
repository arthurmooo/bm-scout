create type public.scout_agent_task_type as enum (
  'weekly_core_research',
  'weekly_exploration_scan',
  'daily_brief',
  'learning_review',
  'dnc_check',
  'followup_review'
);

create type public.scout_agent_task_status as enum (
  'queued',
  'running',
  'blocked',
  'completed',
  'failed',
  'cancelled'
);

create type public.scout_action_type as enum (
  'validate_lead',
  'reject_lead',
  'watch_lead',
  'exclude_lead',
  'request_enrichment',
  'rerun_qc',
  'copy_email',
  'copy_follow_up',
  'copy_linkedin',
  'mark_message_used',
  'add_do_not_contact',
  'launch_core',
  'launch_exploration',
  'launch_daily_brief',
  'launch_learning_review'
);

create table public.scout_agent_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  type public.scout_agent_task_type not null,
  status public.scout_agent_task_status not null default 'queued',
  title text not null,
  summary text not null,
  recommendation text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  result_run_id uuid references public.scout_runs(id) on delete set null,
  blocked_reason text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scout_agent_tasks_completion_check check (
    (status not in ('completed', 'failed', 'cancelled') or completed_at is not null)
    and (status <> 'blocked' or blocked_reason is not null)
  )
);

create table public.scout_action_events (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid references public.scout_companies(id) on delete set null,
  message_id uuid references public.scout_messages(id) on delete set null,
  task_id uuid references public.scout_agent_tasks(id) on delete set null,
  action public.scout_action_type not null,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index scout_agent_tasks_status_schedule_idx on public.scout_agent_tasks (status, scheduled_for);
create index scout_agent_tasks_type_created_idx on public.scout_agent_tasks (type, created_at desc);
create index scout_action_events_company_created_idx on public.scout_action_events (company_id, created_at desc);
create index scout_action_events_action_created_idx on public.scout_action_events (action, created_at desc);

create or replace function public.scout_prevent_dnc_message()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  contact_email text;
  company_domain text;
begin
  select domain into company_domain
  from public.scout_companies
  where id = new.company_id;

  if new.contact_id is not null then
    select email into contact_email
    from public.scout_contacts
    where id = new.contact_id;
  end if;

  if new.status <> 'blocked'
    and public.scout_is_do_not_contact(contact_email, company_domain, new.company_id, new.contact_id)
  then
    raise exception 'Do-not-contact gate: message blocked for company %, contact %', new.company_id, new.contact_id;
  end if;

  return new;
end;
$$;

create trigger scout_messages_prevent_dnc
before insert or update of status, contact_id, company_id on public.scout_messages
for each row execute function public.scout_prevent_dnc_message();

create trigger scout_agent_tasks_touch_updated_at
before update on public.scout_agent_tasks
for each row execute function public.scout_touch_updated_at();

alter table public.scout_agent_tasks enable row level security;
alter table public.scout_action_events enable row level security;

create policy "internal read scout agent tasks" on public.scout_agent_tasks
  for select to authenticated using (true);

create policy "internal read scout action events" on public.scout_action_events
  for select to authenticated using (true);

create policy "internal create scout agent tasks" on public.scout_agent_tasks
  for insert to authenticated with check (true);

create policy "internal update scout agent tasks" on public.scout_agent_tasks
  for update to authenticated using (true) with check (true);

create policy "internal create scout action events" on public.scout_action_events
  for insert to authenticated with check (true);

grant select on public.scout_agent_tasks, public.scout_action_events to authenticated;
grant insert, update on public.scout_agent_tasks to authenticated;
grant insert on public.scout_action_events to authenticated;
