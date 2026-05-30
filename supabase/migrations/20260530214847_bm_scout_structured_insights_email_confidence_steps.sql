alter table public.scout_companies
  add column if not exists structured_insights jsonb not null default '{"observed":[],"inferred":[],"uncertain":[]}'::jsonb;

alter table public.scout_contacts
  add column if not exists email_type text not null default 'unknown',
  add column if not exists email_source_url text,
  add column if not exists email_confidence text not null default 'low',
  add column if not exists email_status text not null default 'not_usable';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'scout_companies_structured_insights_shape'
  ) then
    alter table public.scout_companies
      add constraint scout_companies_structured_insights_shape
      check (
        jsonb_typeof(structured_insights) = 'object'
        and jsonb_typeof(coalesce(structured_insights->'observed', '[]'::jsonb)) = 'array'
        and jsonb_typeof(coalesce(structured_insights->'inferred', '[]'::jsonb)) = 'array'
        and jsonb_typeof(coalesce(structured_insights->'uncertain', '[]'::jsonb)) = 'array'
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'scout_contacts_email_type_check'
  ) then
    alter table public.scout_contacts
      add constraint scout_contacts_email_type_check
      check (email_type in ('public_named', 'generic', 'probable_pattern', 'unknown'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'scout_contacts_email_confidence_check'
  ) then
    alter table public.scout_contacts
      add constraint scout_contacts_email_confidence_check
      check (email_confidence in ('high', 'medium', 'low'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'scout_contacts_email_status_check'
  ) then
    alter table public.scout_contacts
      add constraint scout_contacts_email_status_check
      check (email_status in ('usable', 'verify', 'not_usable'));
  end if;
end
$$;

create index if not exists scout_contacts_email_status_idx on public.scout_contacts (email_status);

create or replace function public.scout_persist_mission_output(payload jsonb)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  run_id uuid;
  company_id uuid;
  contact_id uuid;
  first_contact_id uuid;
  brief_id uuid;
  lead jsonb;
  persona jsonb;
  proof jsonb;
  lesson jsonb;
  run_step jsonb;
  channel_name text;
  message_body text;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  insert into public.scout_runs (
    mode,
    status,
    trace_id,
    structured_output,
    scanned_count,
    kept_count,
    rejected_count,
    started_at
  )
  values (
    (payload->>'mode')::public.scout_mode,
    'running',
    payload->>'trace_id',
    payload,
    coalesce((payload->>'scanned_count')::integer, 0),
    coalesce((payload->>'kept_count')::integer, 0),
    coalesce((payload->>'rejected_count')::integer, 0),
    now()
  )
  returning id into run_id;

  insert into public.scout_run_steps (
    run_id,
    agent_name,
    step,
    event_type,
    payload
  )
  values (
    run_id,
    'bm_scout_worker',
    'mission_start',
    'run_started',
    jsonb_build_object(
      'mode', payload->>'mode',
      'trace_id', payload->>'trace_id',
      'scanned_count', coalesce((payload->>'scanned_count')::integer, 0)
    )
  );

  for lead in
    select value
    from jsonb_array_elements(coalesce(payload->'leads', '[]'::jsonb) || coalesce(payload->'rejected', '[]'::jsonb))
  loop
    insert into public.scout_companies (
      external_id,
      name,
      website,
      mode,
      segment,
      score,
      verdict,
      quality_decision,
      observed_signals,
      pain_hypotheses,
      structured_insights,
      score_justification,
      next_action,
      rejection_reason,
      latest_run_id
    )
    values (
      lead->>'id',
      lead->>'company',
      nullif(lead->>'website', ''),
      (lead->>'mode')::public.scout_mode,
      lead->>'segment',
      coalesce((lead->>'score')::integer, 0),
      (lead->>'verdict')::public.scout_verdict,
      (lead->>'quality_decision')::public.scout_quality_decision,
      array(select jsonb_array_elements_text(coalesce(lead->'observed_signals', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(lead->'pain_hypotheses', '[]'::jsonb))),
      coalesce(lead->'insights', '{"observed":[],"inferred":[],"uncertain":[]}'::jsonb),
      lead->>'score_justification',
      lead->>'next_action',
      nullif(lead->>'rejection_reason', ''),
      run_id
    )
    returning id into company_id;

    first_contact_id := null;

    for persona in
      select value from jsonb_array_elements(coalesce(lead->'personas', '[]'::jsonb))
    loop
      insert into public.scout_contacts (
        company_id,
        name,
        role,
        email,
        email_type,
        email_source_url,
        email_confidence,
        email_status,
        reason,
        confidence,
        do_not_contact,
        created_by_run_id
      )
      values (
        company_id,
        nullif(persona->>'name', ''),
        persona->>'role',
        nullif(persona->>'email', ''),
        coalesce(persona->>'email_type', 'unknown'),
        nullif(persona->>'email_source_url', ''),
        coalesce(persona->>'email_confidence', 'low'),
        coalesce(persona->>'email_status', 'not_usable'),
        persona->>'reason',
        coalesce(persona->>'contact_confidence', 'role_only')::public.scout_contact_confidence,
        coalesce((persona->>'do_not_contact')::boolean, false),
        run_id
      )
      returning id into contact_id;

      if first_contact_id is null then
        first_contact_id := contact_id;
      end if;
    end loop;

    for proof in
      select value from jsonb_array_elements(coalesce(lead->'evidence', '[]'::jsonb))
    loop
      insert into public.scout_evidence (
        company_id,
        label,
        url,
        observed_fact,
        reliability,
        source_terms_risk,
        created_by_run_id
      )
      values (
        company_id,
        proof->>'label',
        proof->>'url',
        proof->>'observed_fact',
        coalesce(proof->>'reliability', 'medium')::public.scout_evidence_reliability,
        'unknown',
        run_id
      );
    end loop;

    insert into public.scout_scores (
      company_id,
      score,
      verdict,
      breakdown,
      justification,
      created_by_run_id
    )
    values (
      company_id,
      coalesce((lead->>'score')::integer, 0),
      (lead->>'verdict')::public.scout_verdict,
      jsonb_build_object('mode', lead->>'mode', 'segment', lead->>'segment'),
      lead->>'score_justification',
      run_id
    );

    insert into public.scout_briefs (
      company_id,
      short_card,
      deep_card,
      facts,
      hypotheses,
      created_by_run_id
    )
    values (
      company_id,
      lead->>'short_card',
      lead->>'deep_card',
      array(select jsonb_array_elements_text(coalesce(lead->'observed_signals', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(lead->'pain_hypotheses', '[]'::jsonb))),
      run_id
    )
    returning id into brief_id;

    foreach channel_name in array array['email', 'follow_up', 'linkedin']
    loop
      message_body := case channel_name
        when 'email' then lead#>>'{outreach,cold_email}'
        when 'follow_up' then lead#>>'{outreach,follow_up}'
        else lead#>>'{outreach,linkedin}'
      end;

      insert into public.scout_messages (
        company_id,
        contact_id,
        brief_id,
        channel,
        body,
        status,
        created_by_run_id
      )
      values (
        company_id,
        first_contact_id,
        brief_id,
        channel_name::public.scout_message_channel,
        coalesce(message_body, 'Brouillon bloqué : message absent.'),
        case
          when coalesce(message_body, '') ilike 'Brouillon blo%' then 'blocked'::public.scout_message_status
          else 'proposed'::public.scout_message_status
        end,
        run_id
      );
    end loop;

    insert into public.scout_quality_reports (
      run_id,
      company_id,
      decision,
      gates,
      reason,
      blocker_code
    )
    values (
      run_id,
      company_id,
      (lead->>'quality_decision')::public.scout_quality_decision,
      coalesce(lead->'quality_gates', '[]'::jsonb),
      coalesce(nullif(lead->>'rejection_reason', ''), lead->>'next_action', 'Décision QC non renseignée.'),
      (
        select gate->>'code'
        from jsonb_array_elements(coalesce(lead->'quality_gates', '[]'::jsonb)) gate
        where coalesce((gate->>'passed')::boolean, false) = false
        limit 1
      )
    );

    insert into public.scout_run_steps (
      run_id,
      agent_name,
      step,
      event_type,
      payload
    )
    values (
      run_id,
      'supabase_persistence',
      'lead_persisted',
      'lead_saved',
      jsonb_build_object(
        'company_id', company_id,
        'external_id', lead->>'id',
        'quality_decision', lead->>'quality_decision',
        'verdict', lead->>'verdict',
        'evidence_count', jsonb_array_length(coalesce(lead->'evidence', '[]'::jsonb))
      )
    );
  end loop;

  for run_step in
    select value from jsonb_array_elements(coalesce(payload->'run_steps', '[]'::jsonb))
  loop
    insert into public.scout_run_steps (
      run_id,
      agent_name,
      step,
      event_type,
      payload
    )
    values (
      run_id,
      coalesce(run_step->>'agent_name', 'bm_scout_worker'),
      coalesce(run_step->>'step', 'tool_call'),
      coalesce(run_step->>'event_type', 'tool_call'),
      coalesce(run_step->'payload', run_step)
    );
  end loop;

  for lesson in
    select value from jsonb_array_elements(coalesce(payload->'lessons', '[]'::jsonb))
  loop
    insert into public.scout_learning_lessons (
      lesson,
      recommendation,
      source,
      confidence,
      source_run_id
    )
    values (
      lesson->>'lesson',
      lesson->>'recommendation',
      case
        when lesson->>'source' in ('feedback', 'outcome', 'quality_decision', 'run_review') then lesson->>'source'
        else 'run_review'
      end,
      coalesce((lesson->>'confidence')::numeric, 0.5),
      run_id
    );
  end loop;

  insert into public.scout_run_steps (
    run_id,
    agent_name,
    step,
    event_type,
    payload
  )
  values (
    run_id,
    'bm_scout_worker',
    'mission_complete',
    'run_completed',
    jsonb_build_object(
      'kept_count', coalesce((payload->>'kept_count')::integer, 0),
      'rejected_count', coalesce((payload->>'rejected_count')::integer, 0),
      'final_decision', payload->>'final_decision'
    )
  );

  update public.scout_runs
  set status = 'succeeded',
      finished_at = now()
  where id = run_id;

  return run_id;
end;
$$;

revoke all on function public.scout_persist_mission_output(jsonb) from public, anon, authenticated;
grant execute on function public.scout_persist_mission_output(jsonb) to service_role;
