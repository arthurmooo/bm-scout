create or replace function public.scout_is_internal_user()
returns boolean
language sql
stable
set search_path = public, auth
as $$
  with claims as (
    select coalesce((select auth.jwt()) -> 'app_metadata', '{}'::jsonb) as app_metadata
  )
  select
    coalesce(app_metadata ->> 'bm_scout_role', '') in ('arthur', 'romu', 'admin', 'worker')
    or coalesce(app_metadata ->> 'bm_scout_access', '') in ('true', '1', 'yes')
    or exists (
      select 1
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(coalesce(app_metadata -> 'bm_scout_roles', '[]'::jsonb)) = 'array'
            then coalesce(app_metadata -> 'bm_scout_roles', '[]'::jsonb)
          else '[]'::jsonb
        end
      ) as role_name(role)
      where role_name.role in ('arthur', 'romu', 'admin', 'worker')
    )
  from claims;
$$;

revoke execute on function public.scout_is_internal_user() from public;
grant execute on function public.scout_is_internal_user() to authenticated;

drop policy if exists "internal read scout runs" on public.scout_runs;
drop policy if exists "internal read scout companies" on public.scout_companies;
drop policy if exists "internal read scout contacts" on public.scout_contacts;
drop policy if exists "internal read scout evidence" on public.scout_evidence;
drop policy if exists "internal read scout scores" on public.scout_scores;
drop policy if exists "internal read scout briefs" on public.scout_briefs;
drop policy if exists "internal read scout messages" on public.scout_messages;
drop policy if exists "internal read scout dnc" on public.scout_do_not_contact;
drop policy if exists "internal read scout feedback" on public.scout_feedback;
drop policy if exists "internal read scout outcomes" on public.scout_outcomes;
drop policy if exists "internal read scout quality reports" on public.scout_quality_reports;
drop policy if exists "internal read scout learning" on public.scout_learning_lessons;
drop policy if exists "internal read scout run steps" on public.scout_run_steps;
drop policy if exists "internal create feedback" on public.scout_feedback;
drop policy if exists "internal create dnc" on public.scout_do_not_contact;
drop policy if exists "internal update messages" on public.scout_messages;
drop policy if exists "internal update companies" on public.scout_companies;
drop policy if exists "internal read scout agent tasks" on public.scout_agent_tasks;
drop policy if exists "internal read scout action events" on public.scout_action_events;
drop policy if exists "internal create scout agent tasks" on public.scout_agent_tasks;
drop policy if exists "internal update scout agent tasks" on public.scout_agent_tasks;
drop policy if exists "internal create scout action events" on public.scout_action_events;

create policy "scout internal read runs" on public.scout_runs
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read companies" on public.scout_companies
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read contacts" on public.scout_contacts
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read evidence" on public.scout_evidence
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read scores" on public.scout_scores
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read briefs" on public.scout_briefs
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read messages" on public.scout_messages
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read dnc" on public.scout_do_not_contact
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read feedback" on public.scout_feedback
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read outcomes" on public.scout_outcomes
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read quality reports" on public.scout_quality_reports
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read learning" on public.scout_learning_lessons
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read run steps" on public.scout_run_steps
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read agent tasks" on public.scout_agent_tasks
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal read action events" on public.scout_action_events
  for select to authenticated using ((select public.scout_is_internal_user()));

create policy "scout internal create feedback" on public.scout_feedback
  for insert to authenticated with check ((select public.scout_is_internal_user()));

create policy "scout internal create dnc" on public.scout_do_not_contact
  for insert to authenticated with check ((select public.scout_is_internal_user()));

create policy "scout internal create agent tasks" on public.scout_agent_tasks
  for insert to authenticated with check ((select public.scout_is_internal_user()));

create policy "scout internal create action events" on public.scout_action_events
  for insert to authenticated with check ((select public.scout_is_internal_user()));

create policy "scout internal update companies" on public.scout_companies
  for update to authenticated
  using ((select public.scout_is_internal_user()))
  with check ((select public.scout_is_internal_user()));

create policy "scout internal update messages" on public.scout_messages
  for update to authenticated
  using ((select public.scout_is_internal_user()))
  with check ((select public.scout_is_internal_user()));

create policy "scout internal update agent tasks" on public.scout_agent_tasks
  for update to authenticated
  using ((select public.scout_is_internal_user()))
  with check ((select public.scout_is_internal_user()));;
