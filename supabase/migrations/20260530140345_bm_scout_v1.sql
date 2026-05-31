create extension if not exists pgcrypto with schema extensions;

create type public.scout_mode as enum ('core', 'exploration');
create type public.scout_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.scout_verdict as enum ('validate', 'enrich', 'watch', 'reject');
create type public.scout_quality_decision as enum ('pass', 'needs_enrichment', 'blocked');
create type public.scout_message_channel as enum ('email', 'follow_up', 'linkedin');
create type public.scout_message_status as enum ('proposed', 'copied', 'edited', 'approved', 'rejected', 'blocked', 'archived');
create type public.scout_feedback_kind as enum (
  'good_lead',
  'bad_lead',
  'generic_message',
  'good_angle',
  'positive_outcome',
  'negative_outcome',
  'do_not_contact'
);
create type public.scout_contact_confidence as enum ('confirmed', 'role_only', 'uncertain');
create type public.scout_dnc_scope as enum ('contact', 'domain', 'company');
create type public.scout_evidence_reliability as enum ('high', 'medium', 'low');

create table public.scout_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  mode public.scout_mode not null,
  status public.scout_run_status not null default 'queued',
  trace_id text,
  input_payload jsonb not null default '{}'::jsonb,
  structured_output jsonb not null default '{}'::jsonb,
  scanned_count integer not null default 0 check (scanned_count >= 0),
  kept_count integer not null default 0 check (kept_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  model text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.scout_companies (
  id uuid primary key default extensions.gen_random_uuid(),
  external_id text,
  name text not null,
  website text,
  domain text generated always as (
    nullif(lower(regexp_replace(coalesce(website, ''), '^https?://(www\.)?|/.*$', '', 'g')), '')
  ) stored,
  mode public.scout_mode not null,
  segment text not null,
  score integer check (score between 0 and 100),
  verdict public.scout_verdict not null default 'watch',
  quality_decision public.scout_quality_decision not null default 'needs_enrichment',
  observed_signals text[] not null default '{}',
  pain_hypotheses text[] not null default '{}',
  score_justification text,
  next_action text,
  rejection_reason text,
  latest_run_id uuid references public.scout_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scout_contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.scout_companies(id) on delete cascade,
  name text,
  role text not null,
  email text,
  email_hash text generated always as (
    case
      when email is null then null
      else encode(extensions.digest(lower(trim(email)), 'sha256'), 'hex')
    end
  ) stored,
  linkedin_url text,
  reason text not null,
  confidence public.scout_contact_confidence not null default 'role_only',
  do_not_contact boolean not null default false,
  do_not_contact_reason text,
  created_by_run_id uuid references public.scout_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.scout_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.scout_companies(id) on delete cascade,
  contact_id uuid references public.scout_contacts(id) on delete cascade,
  label text not null,
  url text not null,
  observed_fact text not null,
  reliability public.scout_evidence_reliability not null default 'medium',
  content_hash text,
  source_terms_risk text not null default 'unknown' check (source_terms_risk in ('ok', 'restricted', 'unknown', 'forbidden')),
  created_by_run_id uuid references public.scout_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.scout_scores (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.scout_companies(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  verdict public.scout_verdict not null,
  breakdown jsonb not null default '{}'::jsonb,
  justification text not null,
  created_by_run_id uuid references public.scout_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.scout_briefs (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.scout_companies(id) on delete cascade,
  short_card text not null,
  deep_card text not null,
  facts text[] not null default '{}',
  hypotheses text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'validated', 'rejected', 'stale')),
  created_by_run_id uuid references public.scout_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.scout_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.scout_companies(id) on delete cascade,
  contact_id uuid references public.scout_contacts(id) on delete set null,
  brief_id uuid references public.scout_briefs(id) on delete set null,
  channel public.scout_message_channel not null,
  subject text,
  body text not null,
  status public.scout_message_status not null default 'proposed',
  compliance_report jsonb not null default '{}'::jsonb,
  created_by_run_id uuid references public.scout_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint scout_messages_not_sent check (status <> 'approved' or channel in ('email', 'follow_up', 'linkedin'))
);

create table public.scout_do_not_contact (
  id uuid primary key default extensions.gen_random_uuid(),
  scope public.scout_dnc_scope not null,
  normalized_email_hash text,
  normalized_domain text,
  company_id uuid references public.scout_companies(id) on delete set null,
  contact_id uuid references public.scout_contacts(id) on delete set null,
  source text not null check (source in ('manual', 'feedback', 'reply', 'import', 'compliance')),
  reason text,
  retention_basis text not null default 'opposition_management',
  minimum_keep_until date not null default (current_date + interval '3 years')::date,
  created_at timestamptz not null default now(),
  constraint scout_dnc_target check (
    normalized_email_hash is not null
    or normalized_domain is not null
    or company_id is not null
    or contact_id is not null
  )
);

create table public.scout_feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid references public.scout_companies(id) on delete set null,
  message_id uuid references public.scout_messages(id) on delete set null,
  kind public.scout_feedback_kind not null,
  note text not null,
  created_at timestamptz not null default now()
);

create table public.scout_outcomes (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.scout_companies(id) on delete cascade,
  outcome text not null check (outcome in ('interested', 'not_now', 'not_relevant', 'meeting_booked', 'negative', 'no_response')),
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.scout_quality_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid references public.scout_runs(id) on delete cascade,
  company_id uuid references public.scout_companies(id) on delete cascade,
  decision public.scout_quality_decision not null,
  gates jsonb not null default '[]'::jsonb,
  reason text not null,
  blocker_code text,
  created_at timestamptz not null default now()
);

create table public.scout_learning_lessons (
  id uuid primary key default extensions.gen_random_uuid(),
  lesson text not null,
  recommendation text not null,
  source text not null check (source in ('feedback', 'outcome', 'quality_decision', 'run_review')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  status text not null default 'pending' check (status in ('pending', 'validated', 'rejected', 'archived')),
  source_run_id uuid references public.scout_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.scout_run_steps (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.scout_runs(id) on delete cascade,
  agent_name text not null,
  step text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index scout_companies_mode_score_idx on public.scout_companies (mode, score desc);
create index scout_companies_latest_run_idx on public.scout_companies (latest_run_id);
create index scout_companies_external_id_idx on public.scout_companies (external_id);
create index scout_contacts_company_idx on public.scout_contacts (company_id);
create index scout_contacts_email_hash_idx on public.scout_contacts (email_hash);
create index scout_evidence_company_idx on public.scout_evidence (company_id);
create index scout_scores_company_created_idx on public.scout_scores (company_id, created_at desc);
create index scout_briefs_company_created_idx on public.scout_briefs (company_id, created_at desc);
create index scout_messages_company_status_idx on public.scout_messages (company_id, status);
create index scout_dnc_email_hash_idx on public.scout_do_not_contact (normalized_email_hash);
create index scout_dnc_domain_idx on public.scout_do_not_contact (normalized_domain);
create index scout_feedback_company_created_idx on public.scout_feedback (company_id, created_at desc);
create index scout_quality_reports_run_idx on public.scout_quality_reports (run_id);
create index scout_run_steps_run_created_idx on public.scout_run_steps (run_id, created_at);

create or replace function public.scout_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger scout_companies_touch_updated_at
before update on public.scout_companies
for each row execute function public.scout_touch_updated_at();

create or replace function public.scout_email_hash(email text)
returns text
language sql
immutable
strict
set search_path = public, extensions
as $$
  select encode(extensions.digest(lower(trim(email)), 'sha256'), 'hex');
$$;

create or replace function public.scout_is_do_not_contact(
  input_email text default null,
  input_domain text default null,
  input_company_id uuid default null,
  input_contact_id uuid default null
)
returns boolean
language sql
stable
security definer
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

alter table public.scout_runs enable row level security;
alter table public.scout_companies enable row level security;
alter table public.scout_contacts enable row level security;
alter table public.scout_evidence enable row level security;
alter table public.scout_scores enable row level security;
alter table public.scout_briefs enable row level security;
alter table public.scout_messages enable row level security;
alter table public.scout_do_not_contact enable row level security;
alter table public.scout_feedback enable row level security;
alter table public.scout_outcomes enable row level security;
alter table public.scout_quality_reports enable row level security;
alter table public.scout_learning_lessons enable row level security;
alter table public.scout_run_steps enable row level security;

create policy "internal read scout runs" on public.scout_runs for select to authenticated using (true);
create policy "internal read scout companies" on public.scout_companies for select to authenticated using (true);
create policy "internal read scout contacts" on public.scout_contacts for select to authenticated using (true);
create policy "internal read scout evidence" on public.scout_evidence for select to authenticated using (true);
create policy "internal read scout scores" on public.scout_scores for select to authenticated using (true);
create policy "internal read scout briefs" on public.scout_briefs for select to authenticated using (true);
create policy "internal read scout messages" on public.scout_messages for select to authenticated using (true);
create policy "internal read scout dnc" on public.scout_do_not_contact for select to authenticated using (true);
create policy "internal read scout feedback" on public.scout_feedback for select to authenticated using (true);
create policy "internal read scout outcomes" on public.scout_outcomes for select to authenticated using (true);
create policy "internal read scout quality reports" on public.scout_quality_reports for select to authenticated using (true);
create policy "internal read scout learning" on public.scout_learning_lessons for select to authenticated using (true);
create policy "internal read scout run steps" on public.scout_run_steps for select to authenticated using (true);

create policy "internal create feedback" on public.scout_feedback for insert to authenticated with check (true);
create policy "internal create dnc" on public.scout_do_not_contact for insert to authenticated with check (true);
create policy "internal update messages" on public.scout_messages for update to authenticated using (true) with check (true);
create policy "internal update companies" on public.scout_companies for update to authenticated using (true) with check (true);;
