update public.scout_messages
set status = 'used_manually'::public.scout_message_status
where status = 'approved'::public.scout_message_status;

alter table public.scout_messages
  drop constraint if exists scout_messages_no_approved_state;

alter table public.scout_messages
  add constraint scout_messages_no_approved_state
  check (status <> 'approved'::public.scout_message_status);

comment on constraint scout_messages_no_approved_state on public.scout_messages
  is 'BM Scout V1 ne peut pas approuver ou envoyer automatiquement un message ; used_manually trace seulement une utilisation humaine.';
