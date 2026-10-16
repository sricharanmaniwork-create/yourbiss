-- ============================================================================
-- Yourbiss — 0009: conditional logic in the submission guard
--
-- Migration 0004 accepts a response only if every field marked required has an
-- answer in it. That is right for a form whose questions are all on screen and
-- wrong for a form using conditional logic: a field the visitor was never shown
-- cannot be answered, so `record_form_submission` refuses the submission with
-- "missing required fields" for a question nobody saw. The app-side validator
-- already drops hidden fields before calling this function, so the row it wants
-- to store is correct — the database was the last one still disagreeing.
--
-- This migration adds the same visibility rule the application uses, in SQL, and
-- replaces only the required-answer loop. Nothing else about the function
-- changes: the form lock, the published check, the duplicate guard, the unknown
-- key rejection, the insert, the counter and the activity row all stay as 0004
-- wrote them.
--
-- PARITY IS THE WHOLE POINT. These helpers are a line-for-line reading of
-- `fieldIsVisible` and `evaluateCondition` in src/lib/forms/types.ts, including
-- its defaults: an absent `action` behaves as `hide`, an absent `match` behaves
-- as `any`, and a JSON null answer is "no answer". Anywhere the two could not be
-- made to agree is called out on the function below. Disagreeing is not a
-- harmless difference — a field the browser hid but SQL believes is shown and
-- required makes a valid submission fail, which is the exact bug this file was
-- written to remove.
--
-- Additive. It reads 0004's tables but alters no table, no policy and no grant
-- that already exists.
-- ============================================================================

-- --------------------------------------------------------------------------
-- The answer as JavaScript sees it
-- --------------------------------------------------------------------------

-- `String(actual ?? '')` from evaluateCondition. A text answer is itself, a number
-- prints without quotes, an absent or null answer is empty, and a list joins with
-- commas in submission order — which is what `String(['a','b'])` gives in the
-- browser. Reading `->>` instead of this would show a list as `["a","b"]`, so an
-- `is` rule written against a multi-choice question would match in SQL and not on
-- screen.
create or replace function youbiss.answer_as_text(p_answer jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_answer is null or jsonb_typeof(p_answer) = 'null' then ''
    when jsonb_typeof(p_answer) = 'array' then
      coalesce((select string_agg(e.value #>> '{}', ',' order by e.ordinality)
                from jsonb_array_elements(p_answer) with ordinality as e(value, ordinality)), '')
    else p_answer #>> '{}'
  end;
$$;

-- The `empty` test in evaluateCondition: undefined, null, a blank string or an
-- empty list. A ticked or unticked boolean counts as an answer, because that is
-- what TypeScript does with `false` — it is not in its empty test either.
create or replace function youbiss.answer_is_empty(p_answer jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_answer is null
      or jsonb_typeof(p_answer) = 'null'
      or (jsonb_typeof(p_answer) = 'string' and btrim(p_answer #>> '{}') = '')
      -- The array length goes inside a CASE because Postgres does not promise to
      -- evaluate the type check first, and asking for the length of a string
      -- would abort the whole submission.
      or coalesce(case when jsonb_typeof(p_answer) = 'array'
                       then jsonb_array_length(p_answer) = 0 end, false);
$$;

-- --------------------------------------------------------------------------
-- One condition, against the answers as they arrived
-- --------------------------------------------------------------------------

create or replace function youbiss.logic_matches(p_condition jsonb, p_answers jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case coalesce(p_condition ->> 'operator', 'is')
    when 'is_empty' then
      youbiss.answer_is_empty(p_answers -> (p_condition ->> 'field_id'))
    when 'is_filled' then
      not youbiss.answer_is_empty(p_answers -> (p_condition ->> 'field_id'))
    when 'is' then
      youbiss.answer_as_text(p_answers -> (p_condition ->> 'field_id')) =
        coalesce(p_condition ->> 'value', '')
    when 'is_not' then
      youbiss.answer_as_text(p_answers -> (p_condition ->> 'field_id')) <>
        coalesce(p_condition ->> 'value', '')
    -- `contains` on a list is element equality in the browser, not a substring
    -- search, so it is element equality here too. On anything else both sides
    -- lowercase and look for the substring.
    when 'contains' then
      case
        when jsonb_typeof(p_answers -> (p_condition ->> 'field_id')) = 'array' then
          exists (
            select 1 from jsonb_array_elements(p_answers -> (p_condition ->> 'field_id')) e
            where e.value #>> '{}' = coalesce(p_condition ->> 'value', ''))
        else
          strpos(
            lower(youbiss.answer_as_text(p_answers -> (p_condition ->> 'field_id'))),
            lower(coalesce(p_condition ->> 'value', ''))) > 0
      end
    -- `Number(actual) > Number(value)` in the browser: a side that is not a number
    -- makes the comparison false rather than an error, so a side that does not read
    -- as a number is false here as well. The shape test goes in the WHEN and the
    -- cast in the THEN because Postgres may evaluate `AND` operands in any order,
    -- and one un-guarded `::numeric` on a word would abort the whole submission.
    -- One case is deliberately not reproduced: JavaScript turns a stored null into 0
    -- before comparing, and treating a question nobody answered as the number zero is
    -- not worth matching.
    when 'gt' then
      case
        when youbiss.answer_as_text(p_answers -> (p_condition ->> 'field_id'))
               ~ '^-?[0-9]+([.][0-9]+)?$'
         and coalesce(p_condition ->> 'value', '')
               ~ '^-?[0-9]+([.][0-9]+)?$'
          then youbiss.answer_as_text(p_answers -> (p_condition ->> 'field_id'))::numeric
               > (p_condition ->> 'value')::numeric
        else false
      end
    when 'lt' then
      case
        when youbiss.answer_as_text(p_answers -> (p_condition ->> 'field_id'))
               ~ '^-?[0-9]+([.][0-9]+)?$'
         and coalesce(p_condition ->> 'value', '')
               ~ '^-?[0-9]+([.][0-9]+)?$'
          then youbiss.answer_as_text(p_answers -> (p_condition ->> 'field_id'))::numeric
               < (p_condition ->> 'value')::numeric
        else false
      end
    else false
  end;
$$;

-- --------------------------------------------------------------------------
-- A field's whole rule
-- --------------------------------------------------------------------------

-- `match: all` needs every condition to hold, `match: any` only one. An empty or
-- absent condition list is "no logic", which is the early return the browser
-- makes — it must not fall through to the `all` branch, where "every condition
-- holds" over nothing would be true and would hide fields that belong on screen.
create or replace function youbiss.logic_matched(p_logic jsonb, p_answers jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(
           case when jsonb_typeof(p_logic -> 'conditions') = 'array'
                then jsonb_array_length(p_logic -> 'conditions') end,
           0) = 0 then false
    -- `field.logic.match === 'all' ? every : some` — anything that is not exactly
    -- `all`, including a missing key, is `some`.
    when coalesce(p_logic ->> 'match', 'any') = 'all' then
      not exists (
        select 1 from jsonb_array_elements(p_logic -> 'conditions') c
        where not youbiss.logic_matches(c.value, p_answers))
    else
      exists (
        select 1 from jsonb_array_elements(p_logic -> 'conditions') c
        where youbiss.logic_matches(c.value, p_answers))
  end;
$$;

-- Returns whether the field is NOT on screen. `action: show` reveals it when the
-- conditions match, `action: hide` does the opposite, and no logic at all leaves
-- it visible. A field the visitor never saw is the one this migration stops
-- treating as an unanswered question.
create or replace function youbiss.field_hidden(p_field jsonb, p_answers jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_field -> 'logic') <> 'object' then false
    when coalesce(
           case when jsonb_typeof(p_field -> 'logic' -> 'conditions') = 'array'
                then jsonb_array_length(p_field -> 'logic' -> 'conditions') end,
           0) = 0 then false
    -- `field.logic.action === 'show' ? matched : !matched` — a missing action is
    -- not `show`, so the field is hidden by its conditions matching.
    when p_field -> 'logic' ->> 'action' = 'show'
      then not youbiss.logic_matched(p_field -> 'logic', p_answers)
    else youbiss.logic_matched(p_field -> 'logic', p_answers)
  end;
$$;

revoke all on function youbiss.answer_as_text(jsonb)                                 from public, anon, authenticated;
revoke all on function youbiss.answer_is_empty(jsonb)                                from public, anon, authenticated;
revoke all on function youbiss.logic_matches(jsonb, jsonb)                           from public, anon, authenticated;
revoke all on function youbiss.logic_matched(jsonb, jsonb)                           from public, anon, authenticated;
revoke all on function youbiss.field_hidden(jsonb, jsonb)                            from public, anon, authenticated;

-- These run inside `record_form_submission`, which is SECURITY DEFINER and owned
-- by the role that creates it. The grants below are for that same role being a
-- step removed from the caller; nothing outside the guard can reach these names.
grant execute on function youbiss.answer_as_text(jsonb)      to service_role;
grant execute on function youbiss.answer_is_empty(jsonb)     to service_role;
grant execute on function youbiss.logic_matches(jsonb, jsonb) to service_role;
grant execute on function youbiss.logic_matched(jsonb, jsonb) to service_role;
grant execute on function youbiss.field_hidden(jsonb, jsonb)  to service_role;

-- --------------------------------------------------------------------------
-- The guard, with hidden fields out of the required check.
--
-- Same name, same arguments, same returns as the version in 0004, so
-- `public.record_form_submission` from migration 0007 — the wrapper PostgREST
-- exposes — keeps calling it unchanged, and the grant 0004 gave to
-- service_role survives the replace.
-- --------------------------------------------------------------------------
create or replace function youbiss.record_form_submission(
  p_form_id       uuid,
  p_data          jsonb,
  p_submitter_email text,
  p_visitor_key   text,
  p_source_url    text,
  p_user_agent    text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form      public.forms;
  v_answer    text;
  v_field     jsonb;
  v_missing   text[] := '{}';
  v_sub_id    uuid;
begin
  select * into v_form from public.forms f where f.id = p_form_id for update;
  if not found then
    raise exception 'form not found' using errcode = 'P0002';
  end if;
  if v_form.status <> 'published' then
    raise exception 'this form is not accepting responses' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'answers must be an object';
  end if;

  -- Duplicate guard. The form row is locked above, so two submissions from the
  -- same visitor to the same form cannot both read "no answer in the last hour"
  -- and both insert — the lock makes this check atomic without an expression
  -- index. errcode 23505 is deliberate: it is the same code a unique violation
  -- raises, so the route that calls this can keep one message for both.
  if p_visitor_key is not null and exists (
    select 1 from public.form_submissions s
    where s.form_id = p_form_id
      and s.visitor_key = p_visitor_key
      and s.created_at > now() - interval '1 hour') then
    raise exception 'this visitor already answered this form in the last hour'
      using errcode = '23505';
  end if;

  -- Reject answers for fields the form does not define.
  if exists (
    select 1 from jsonb_object_keys(p_data) k
    where not exists (
      select 1 from jsonb_array_elements(v_form.fields) f where f ->> 'id' = k)) then
    raise exception 'unexpected answer key';
  end if;

  for v_field in select * from jsonb_array_elements(v_form.fields) loop
    -- Same skip list as PRESENTATIONAL in src/lib/forms/types.ts. 0004 listed a
    -- 'rating_display' type that the product never had and left out 'note', which
    -- it does — so a note marked required in a hand-edited row used to be able to
    -- block a submission for an answer no field ever asks.
    continue when v_field ->> 'type' in ('section', 'heading', 'note', 'divider', 'spacer');
    -- The one line this migration adds. A question the visitor was never shown
    -- is not missing; it was never asked. Coerced to false rather than left
    -- nullable, because `continue when null` would not skip anything.
    continue when coalesce(youbiss.field_hidden(v_field, p_data), false);
    v_answer := coalesce(p_data ->> (v_field ->> 'id'), '');
    -- Compared as jsonb rather than cast, so one hand-edited row holding
    -- "required": "yes" cannot throw on every later submit.
    if coalesce(v_field -> 'required', 'false'::jsonb) = 'true'::jsonb
       and btrim(v_answer) = '' then
      v_missing := v_missing || (v_field ->> 'label');
    end if;
  end loop;

  if v_missing <> '{}' then
    raise exception 'missing required fields: %', array_to_string(v_missing, ', ');
  end if;

  insert into public.form_submissions
    (id, form_id, org_id, data, submitter_email, visitor_key, source_url, user_agent)
  values (gen_random_uuid(), p_form_id, v_form.org_id, p_data,
          nullif(btrim(coalesce(p_submitter_email, '')), ''),
          p_visitor_key, left(coalesce(p_source_url, ''), 500),
          left(coalesce(p_user_agent, ''), 300))
  returning id into v_sub_id;

  update public.forms set submission_count = submission_count + 1 where id = p_form_id;

  insert into public.activity_log (org_id, app_key, entity_type, entity_id, action, summary)
  values (v_form.org_id, 'forms', 'form_submission', v_sub_id::text, 'created',
          left(format('New response for "%s"', v_form.title), 500));

  return v_sub_id;
end;
$$;
