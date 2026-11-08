-- Migration 011: fix "could not choose the best candidate function" errors.
--
-- Several earlier migrations added new optional parameters to a function
-- via `create or replace function` without first dropping the old,
-- shorter-arg-list version. Postgres allows function overloading, so both
-- versions ended up coexisting — and any call using the old (shorter)
-- argument list became ambiguous between the two.
--
-- This drops every stale overload, keeping only the current (longest/most
-- recent) signature for each function.

-- create_group: keep the 3-arg version from 009_group_language.sql
drop function if exists create_group(text, text);

-- update_household_settings: keep the 8-arg version from 010_rewards_and_theming.sql
drop function if exists update_household_settings(uuid, text, text, boolean);
drop function if exists update_household_settings(uuid, text, text, boolean, text);
drop function if exists update_household_settings(uuid, text, text, boolean, text, text);

-- complete_chore_event: keep the 3-arg version from 007/010
drop function if exists complete_chore_event(uuid, text);

-- create_onetime_task: keep the 10-arg version from 010_rewards_and_theming.sql
drop function if exists create_onetime_task(uuid, text, text, uuid[], date, boolean);

-- create_chore_type_scheduled: keep the 14-arg version from 010_rewards_and_theming.sql
drop function if exists create_chore_type_scheduled(uuid, text, text, int, uuid[], boolean);
drop function if exists create_chore_type_scheduled(uuid, text, text, int, uuid[], boolean, jsonb, boolean, boolean, int);

-- update_personal_settings: keep the 7-arg version from 008_nudges_and_vacations.sql
drop function if exists update_personal_settings(uuid, text, text, int, jsonb, text);

-- update_chore_schedule: keep the 8-arg version from 007_massive_feature_expansion.sql
drop function if exists update_chore_schedule(uuid, int, uuid[], boolean);
