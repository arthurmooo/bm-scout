alter type public.scout_message_status add value if not exists 'used_manually' after 'copied';

comment on type public.scout_message_status is
  'Lifecycle for BM Scout message drafts. used_manually means Romu used/copied the draft outside BM Scout; it is not an automatic send state.';
