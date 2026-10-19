-- Letting a founder close the setup checklist before they have finished it.
--
-- Every step the checklist shows is derived from state the app already holds
-- -- a board's `installed_at`, whether any post exists, whether a Build Prompt
-- has been generated -- so none of them need storing. What cannot be derived
-- is "I have seen this and I do not want it any more", which is the one thing
-- a founder can tell us that the data cannot.
--
-- It is a timestamp rather than a boolean because the question asked later is
-- "did they dismiss this, and when" -- a checklist closed during onboarding
-- and one closed after a month of use are different signals about whether it
-- was any good.

alter table workspaces add column setup_dismissed_at timestamptz;

comment on column workspaces.setup_dismissed_at is
  'When the founder closed the setup checklist. Null means still showing. The '
  'checklist also hides itself once every step is done, which is not recorded '
  'here -- completion is derived, dismissal is a decision.';
