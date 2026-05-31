create index if not exists scout_action_events_message_id_idx
on public.scout_action_events (message_id);

create index if not exists scout_action_events_task_id_idx
on public.scout_action_events (task_id);

create index if not exists scout_agent_tasks_result_run_id_idx
on public.scout_agent_tasks (result_run_id);

create index if not exists scout_briefs_created_by_run_id_idx
on public.scout_briefs (created_by_run_id);

create index if not exists scout_contacts_created_by_run_id_idx
on public.scout_contacts (created_by_run_id);

create index if not exists scout_do_not_contact_company_id_idx
on public.scout_do_not_contact (company_id);

create index if not exists scout_do_not_contact_contact_id_idx
on public.scout_do_not_contact (contact_id);

create index if not exists scout_evidence_contact_id_idx
on public.scout_evidence (contact_id);

create index if not exists scout_evidence_created_by_run_id_idx
on public.scout_evidence (created_by_run_id);

create index if not exists scout_feedback_message_id_idx
on public.scout_feedback (message_id);

create index if not exists scout_learning_lessons_source_run_id_idx
on public.scout_learning_lessons (source_run_id);

create index if not exists scout_messages_brief_id_idx
on public.scout_messages (brief_id);

create index if not exists scout_messages_contact_id_idx
on public.scout_messages (contact_id);

create index if not exists scout_messages_created_by_run_id_idx
on public.scout_messages (created_by_run_id);

create index if not exists scout_outcomes_company_id_idx
on public.scout_outcomes (company_id);

create index if not exists scout_quality_reports_company_id_idx
on public.scout_quality_reports (company_id);

create index if not exists scout_scores_created_by_run_id_idx
on public.scout_scores (created_by_run_id);;
