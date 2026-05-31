create unique index if not exists scout_agent_tasks_active_type_schedule_uniq
on public.scout_agent_tasks (type, scheduled_for)
where status in ('queued', 'running');;
