-- ============================================================================
-- Yourbiss — 0014 · Projects
--
-- A board: columns of work, cards in them, and somebody's name on each card. That is
-- the whole app, and this file keeps it that way — no sprints, no dependencies, no
-- Gantt, no time tracking. Each of those is a separate product decision, and none of
-- them is what a workspace asks for when it says "we need to see the work".
--
-- Three tables:
--
--   * `board_projects` — a name, a sentence about what it is, and whether it is still
--     running. A workspace can have as many as it needs; each one gets its own board.
--   * `board_columns`  — the lanes on one board, left to right. A new project is
--     created with three of them (To do, In progress, Done) and the workspace is free
--     to rename the ones it does not use or remove them. `is_done` is the only
--     judgement a lane carries, and every number on this app's screens reads it.
--   * `board_tasks`    — a card. A title, optional detail, one assignee, one due date,
--     and the lane it is standing in.
--
-- Guarantees, in the order the file enforces them:
--   1. every row belongs to exactly one workspace, and that workspace is taken from
--      the board rather than from whatever the browser sent (`board_column_guard`,
--      `board_task_guard`);
--   2. a card cannot claim to be finished while it stands in a lane that is not the
--      done lane, and cannot keep a completion date after it has been reopened — the
--      lane decides both, in the trigger, because no screen is trusted to;
--   3. removing a lane that still holds work is refused, so no card disappears because
--      somebody tidied the board;
--   4. a card stays on the board it was written on;
--   5. the board writes into `activity_log` like every other app, which is what lets
--      Automations watch it — the four events at the end of this file are those lines.
--
-- Order inside a lane is a `position` integer assigned as `max + 1` when a card is
-- written or moved, so dropping one into a lane puts it at the end. Ties are harmless:
-- every read falls back to the moment the card was written.
-- ============================================================================

create type public.board_project_status as enum ('active', 'paused', 'completed');

comment on type public.board_project_status is
  'active: on the board and in the lists. paused: kept but not worked. completed: finished, kept apart from the running work.';

-- ===========================================================================
-- Projects
-- ===========================================================================

create table public.board_projects (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  -- One sentence a new member can read. Not a description field that turns into a
  -- second document nobody maintains.
  summary    text check (summary is null or char_length(summary) <= 500),
  status     public.board_project_status not null default 'active',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two boards called "Website" is how a card ends up on the wrong one.
create unique index board_projects_org_name on public.board_projects (org_id, lower(name));
create index board_projects_list on public.board_projects (org_id, created_at desc);

comment on table public.board_projects is
  'One board: a name, a sentence, and whether the work is still running.';

-- ===========================================================================
-- Columns
-- ===========================================================================

create table public.board_columns (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  project_id uuid not null references public.board_projects (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  -- Left to right on the board. Assigned by `board_column_guard` as max + 1, so the
  -- screen says "move this lane right" and swaps two numbers.
  position   integer not null default 0 check (position >= 0),
  -- The lane that means finished. Its cards carry a completion date, and every count
  -- on this app's screens is read from it.
  is_done    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index board_columns_project_name on public.board_columns (project_id, lower(name));
create index board_columns_order on public.board_columns (project_id, position);

comment on table public.board_columns is
  'The lanes of one board, in the order the board shows them.';

-- ===========================================================================
-- Tasks
-- ===========================================================================

create table public.board_tasks (
  id           uuid primary key default gen_random_uuid(),
  -- Denormalised like every child table in this suite, because RLS reads it and
  -- walking up to the board for each card is not a policy. The guard overwrites
  -- whatever the caller sent with the board's own workspace.
  org_id       uuid not null references public.orgs (id) on delete cascade,
  project_id   uuid not null references public.board_projects (id) on delete cascade,
  column_id    uuid not null references public.board_columns (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  details      text check (details is null or char_length(details) <= 4000),
  assignee_id  uuid references auth.users (id) on delete set null,
  due_at       timestamptz,
  position     integer not null default 0 check (position >= 0),
  -- Set and cleared by the guard from the lane, never typed. A card dragged back out
  -- of the done lane stops being finished, and its old date would be a lie.
  completed_at timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- What the board draws: the cards of one lane, in order.
create index board_tasks_column on public.board_tasks (column_id, position, created_at);
-- What the lists draw: one workspace's open work, oldest due date first.
create index board_tasks_org_due on public.board_tasks (org_id, due_at) where completed_at is null;
create index board_tasks_assignee on public.board_tasks (assignee_id) where completed_at is null;
create index board_tasks_project on public.board_tasks (project_id, created_at desc);

comment on table public.board_tasks is
  'A card: what has to be done, who is doing it, by when, and which lane it is standing in.';

-- ===========================================================================
-- Guards
--
-- The two invariants that make a board trustworthy are both about the relationship
-- between a card and its lane, and neither can be a CHECK — one needs the column
-- table, the other the project. So they live here, and a screen cannot talk its way
-- around them.
-- ===========================================================================

create or replace function youbiss.board_column_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select p.org_id into v_org
    from public.board_projects p
   where p.id = new.project_id;

  if not found then
    raise exception 'that lane names a board which is not here' using errcode = '23503';
  end if;

  -- The workspace comes from the board, never from the request. A lane addressed to
  -- another tenant's project is refused rather than quietly created.
  if new.org_id is null then
    new.org_id := v_org;
  elsif new.org_id <> v_org then
    raise exception 'a lane belongs to its board''s workspace' using errcode = '42809';
  end if;

  if tg_op = 'INSERT' then
    -- A new lane goes to the right end of the board. Where it goes after that is the
    -- workspace's business, and moving it is a plain two-number swap.
    select coalesce(max(c.position), -1) + 1 into new.position
      from public.board_columns c
     where c.project_id = new.project_id;
  elsif new.project_id is distinct from old.project_id then
    raise exception 'a lane belongs to the board it was made on' using errcode = '42809';
  end if;

  return new;
end;
$$;

create trigger youbiss_board_columns_guard
  before insert or update on public.board_columns
  for each row execute function youbiss.board_column_guard();

-- A lane that still holds cards is not empty, and deleting it would delete the work
-- standing in it. The cards have to be moved first — which is also the only way the
-- done dates stay honest.
create or replace function youbiss.board_column_deletable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_held integer;
begin
  select count(*) into v_held from public.board_tasks t where t.column_id = old.id;
  if v_held > 0 then
    raise exception 'that lane still holds % card(s) — move them somewhere else first', v_held
      using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger youbiss_board_columns_delete
  before delete on public.board_columns
  for each row execute function youbiss.board_column_deletable();

create or replace function youbiss.board_task_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_org     uuid;
  v_lane    record;
  v_old_lane text;
  v_action   text;
  v_summary  text;
  -- `OLD` is not assigned during an INSERT, and a plpgsql expression is free to evaluate
  -- either half of an `and`, so every read of the previous row happens inside one branch
  -- and is remembered in these two rather than tested again later.
  v_moved    boolean := false;
  v_stamped  timestamptz;
begin
  select p.org_id into v_org
    from public.board_projects p
   where p.id = new.project_id;

  if not found then
    raise exception 'that card names a board which is not here' using errcode = '23503';
  end if;

  if new.org_id is null then
    new.org_id := v_org;
  elsif new.org_id <> v_org then
    raise exception 'a card belongs to its board''s workspace' using errcode = '42809';
  end if;

  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'a card stays on the board it was written on' using errcode = '42809';
    end if;
    v_moved := new.column_id is distinct from old.column_id;
    v_stamped := old.completed_at;
  end if;

  -- The lane decides both halves of finished: whether there is a completion date at all,
  -- and which one. Entering a done lane stamps now(), and editing a card that is already
  -- finished keeps the date it carries rather than moving the deadline. Leaving the lane
  -- clears it, because the work is back in progress.
  select c.org_id, c.project_id, c.is_done,
         (select coalesce(max(t.position), -1) + 1
            from public.board_tasks t
           where t.column_id = c.id
             and t.id <> new.id) as next_position
    into v_lane
    from public.board_columns c
   where c.id = new.column_id;

  if not found then
    raise exception 'that card names a lane which is not here' using errcode = '23503';
  end if;

  if v_lane.org_id <> new.org_id or v_lane.project_id <> new.project_id then
    raise exception 'a card cannot stand in a lane of another board' using errcode = '42809';
  end if;

  if tg_op = 'INSERT' or v_moved then
    new.position := v_lane.next_position;
  end if;

  if v_lane.is_done then
    new.completed_at := coalesce(v_stamped, now());
  else
    new.completed_at := null;
  end if;

  -- The trail every app leaves, so Automations can watch a board the same way it watches
  -- an order. Only a card arriving or changing lane is worth a line — editing a title is
  -- not an event.
  if tg_op = 'INSERT' then
    insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
    values (new.org_id, auth.uid(), 'board', 'board_task', new.id::text, 'added',
            left('Added “' || new.title || '”', 500));
  elsif v_moved then
    select c0.name into v_old_lane
      from public.board_columns c0
     where c0.id = old.column_id;

    if v_lane.is_done then
      v_action := 'completed';
    else
      v_action := 'reopened';
    end if;

    v_summary := case v_action
                   when 'completed' then 'Finished “' || new.title || '” — was in '
                   else 'Reopened “' || new.title || '” — was in '
                 end || coalesce(v_old_lane, 'a lane that is gone');

    insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
    values (new.org_id, auth.uid(), 'board', 'board_task', new.id::text, v_action, left(v_summary, 500));
  end if;

  return new;
end;
$$;

create trigger youbiss_board_tasks_guard
  before insert or update on public.board_tasks
  for each row execute function youbiss.board_task_guard();

create trigger board_projects_touch
  before update on public.board_projects
  for each row execute function youbiss.touch_updated_at();

create trigger board_columns_touch
  before update on public.board_columns
  for each row execute function youbiss.touch_updated_at();

create trigger board_tasks_touch
  before update on public.board_tasks
  for each row execute function youbiss.touch_updated_at();

-- ===========================================================================
-- Making a project
--
-- A board with no lanes is not a board, and leaving three inserts to the browser would
-- leave a half-made project if the second one failed. So one call makes the project and
-- its lanes together. It runs as the owner, which is why it re-checks membership before
-- it writes anything — and why the lane positions are not passed in: the guard assigns
-- them, in order, from the left.
-- ===========================================================================

create or replace function youbiss.board_create_project(
  p_org_id  uuid,
  p_name    text,
  p_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_todo       uuid;
  v_doing      uuid;
  v_done       uuid;
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'board')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'a board needs a name' using errcode = '23514';
  end if;

  insert into public.board_projects (org_id, name, summary, created_by)
  values (p_org_id, btrim(p_name), nullif(btrim(coalesce(p_summary, '')), ''), auth.uid())
  returning id into v_project_id;

  -- One insert each, in the order they read left to right. The guard gives each its
  -- position as max + 1, so this call cannot put two lanes in the same place.
  insert into public.board_columns (org_id, project_id, name, is_done)
  values (p_org_id, v_project_id, 'To do', false)
  returning id into v_todo;

  insert into public.board_columns (org_id, project_id, name, is_done)
  values (p_org_id, v_project_id, 'In progress', false)
  returning id into v_doing;

  insert into public.board_columns (org_id, project_id, name, is_done)
  values (p_org_id, v_project_id, 'Done', true)
  returning id into v_done;

  insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
  values (p_org_id, auth.uid(), 'board', 'board_project', v_project_id::text, 'created',
          left('Started the board “' || btrim(p_name) || '”', 500));

  return jsonb_build_object(
    'project_id', v_project_id,
    'lanes', jsonb_build_array(v_todo, v_doing, v_done)
  );
end;
$$;

comment on function youbiss.board_create_project(uuid, text, text) is
  'A board and its three starting lanes, in one call, so a failed request cannot leave a project without a board.';

-- ===========================================================================
-- Counts
-- ===========================================================================

create or replace function youbiss.board_counts(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'board')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'boards',        (select count(*) from public.board_projects p where p.org_id = p_org_id),
    'active_boards', (select count(*) from public.board_projects p
                        where p.org_id = p_org_id and p.status = 'active'),
    'cards',         (select count(*) from public.board_tasks t where t.org_id = p_org_id),
    'open',          (select count(*) from public.board_tasks t
                        where t.org_id = p_org_id and t.completed_at is null),
    -- Past its date and not finished. A card with no due date is never late, which is
    -- why the clause needs both halves.
    'overdue',       (select count(*) from public.board_tasks t
                        where t.org_id = p_org_id and t.completed_at is null
                          and t.due_at is not null and t.due_at < now()),
    'mine_open',     (select count(*) from public.board_tasks t
                        where t.org_id = p_org_id and t.completed_at is null
                          and t.assignee_id = auth.uid()),
    'done_7d',       (select count(*) from public.board_tasks t
                        where t.org_id = p_org_id and t.completed_at is not null
                          and t.completed_at > now() - interval '7 days')
  ) into out;

  return out;
end;
$$;

-- The hub prints one line per board, and asking per board would be a round trip for
-- each — so they come back in one array, the way `inv_stock_map` answers the shelf.
create or replace function youbiss.board_project_stats(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'board')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  with rolled as (
    select p.name,
           jsonb_build_object(
             'id',      p.id,
             'name',    p.name,
             'status',  p.status,
             'summary', p.summary,
             'cards',   coalesce(x.cards, 0),
             'open',    coalesce(x.open, 0),
             'done',    coalesce(x.done, 0),
             'overdue', coalesce(x.overdue, 0)
           ) as row_json
      from public.board_projects p
      left join (
        select t.project_id,
               count(*) as cards,
               count(*) filter (where t.completed_at is null) as open,
               count(*) filter (where t.completed_at is not null) as done,
               count(*) filter (where t.completed_at is null and t.due_at is not null
                                     and t.due_at < now()) as overdue
        from public.board_tasks t
        where t.org_id = p_org_id
        group by t.project_id
      ) x on x.project_id = p.id
     where p.org_id = p_org_id
  )
  select jsonb_build_object(
    'boards', coalesce(jsonb_agg(row_json order by name), '[]'::jsonb)
  ) into out
  from rolled;

  return out;
end;
$$;

-- ===========================================================================
-- RLS
--
-- The same two questions as every other app: is this person a member, and is Projects
-- switched on. Running a board is ordinary work, so any member writes one; deleting a
-- whole board takes its lanes and its cards with it, so that is left to an owner or
-- admin.
-- ===========================================================================

alter table public.board_projects enable row level security;
alter table public.board_columns  enable row level security;
alter table public.board_tasks    enable row level security;

create policy board_projects_select on public.board_projects
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_projects_insert on public.board_projects
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_projects_update on public.board_projects
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_projects_delete on public.board_projects
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_columns_select on public.board_columns
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_columns_insert on public.board_columns
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_columns_update on public.board_columns
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_columns_delete on public.board_columns
  for delete to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_tasks_select on public.board_tasks
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_tasks_insert on public.board_tasks
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_tasks_update on public.board_tasks
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

create policy board_tasks_delete on public.board_tasks
  for delete to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'board'));

revoke all on public.board_projects, public.board_columns, public.board_tasks from anon, public;

grant select, insert, update, delete
  on public.board_projects, public.board_columns, public.board_tasks to authenticated;

grant all on public.board_projects, public.board_columns, public.board_tasks to service_role, postgres;

-- ===========================================================================
-- The vocabulary Automations may watch
--
-- 0013 made `automation_events` the list of things the suite really records, and a
-- rule's foreign key points at it. These four rows are exactly what the triggers above
-- insert into `activity_log`, so a rule built from them fires — and no rule can be
-- built from an event nobody writes.
-- ===========================================================================

insert into public.automation_events (app, entity_type, action, label, fields) values
  ('board', 'board_project', 'created', 'A new board is started',
   '[{"name":"name","label":"Board name","kind":"text"},
     {"name":"summary","label":"What it is for","kind":"text"},
     {"name":"status","label":"Board status","kind":"text"}]'::jsonb),

  ('board', 'board_task', 'added', 'A card is put on a board',
   '[{"name":"title","label":"Card title","kind":"text"},
     {"name":"project_id","label":"Which board","kind":"id"},
     {"name":"column_id","label":"Which lane","kind":"id"},
     {"name":"assignee_id","label":"Who it is assigned to","kind":"id"},
     {"name":"due_at","label":"Due by","kind":"time"}]'::jsonb),

  ('board', 'board_task', 'completed', 'A card reaches the done lane',
   '[{"name":"title","label":"Card title","kind":"text"},
     {"name":"project_id","label":"Which board","kind":"id"},
     {"name":"assignee_id","label":"Who finished it","kind":"id"},
     {"name":"due_at","label":"Due by","kind":"time"},
     {"name":"completed_at","label":"When it was finished","kind":"time"}]'::jsonb),

  ('board', 'board_task', 'reopened', 'A finished card is put back to work',
   '[{"name":"title","label":"Card title","kind":"text"},
     {"name":"project_id","label":"Which board","kind":"id"},
     {"name":"assignee_id","label":"Who it is assigned to","kind":"id"},
     {"name":"due_at","label":"Due by","kind":"time"}]'::jsonb);

-- The Automations hub counts "events this workspace produced today" over a list of
-- apps written into 0013, which is a list that ends the day Projects ships. Since
-- 0013 made the vocabulary a table, the count follows the table instead: a card added
-- to a board is counted because a rule could watch it, and an app that ships later is
-- counted by its own migration without this function being visited again.
create or replace function youbiss.automations_counts(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'automations')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'rules',    (select count(*) from public.automation_rules r where r.org_id = p_org_id),
    'enabled',  (select count(*) from public.automation_rules r where r.org_id = p_org_id and r.enabled),
    'runs_24h', (select count(*) from public.automation_runs x
                   where x.org_id = p_org_id and x.created_at > now() - interval '24 hours'),
    'done_24h', (select count(*) from public.automation_runs x
                   where x.org_id = p_org_id and x.outcome = 'done'
                     and x.created_at > now() - interval '24 hours'),
    'failed_24h',(select count(*) from public.automation_runs x
                   where x.org_id = p_org_id and x.outcome = 'failed'
                     and x.created_at > now() - interval '24 hours'),
    'last_run_at', (select to_char(max(x.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                      from public.automation_runs x
                     where x.org_id = p_org_id),
    'events_24h', (select count(*) from public.activity_log a
                     where a.org_id = p_org_id
                       and a.app_key in (select distinct e.app from public.automation_events e)
                       and a.created_at > now() - interval '24 hours')
  ) into out;

  return out;
end;
$$;

-- ===========================================================================
-- The RPC surface, same as 0007, 0010, 0011, 0012 and 0013: PostgREST only exposes
-- `public`, so every callable function carries its own SECURITY INVOKER wrapper. The
-- wrapper adds no permission — each body above re-checks the caller.
-- ===========================================================================

create or replace function public.board_create_project(p_org_id uuid, p_name text, p_summary text default null)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.board_create_project(p_org_id, p_name, p_summary);
$$;

create or replace function public.board_counts(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.board_counts(p_org_id);
$$;

create or replace function public.board_project_stats(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.board_project_stats(p_org_id);
$$;

-- Only the wrappers are taken back from `public`. A wrapper is SECURITY INVOKER, which
-- means the member calls `youbiss.*` itself, so the body has to stay executable — the
-- same reason 0011, 0012 and 0013 leave theirs alone. Each body re-checks membership,
-- and the trigger functions are not callable from a request in any case.
revoke all on function public.board_create_project(uuid, text, text) from public;
revoke all on function public.board_counts(uuid) from public;
revoke all on function public.board_project_stats(uuid) from public;

grant execute on function public.board_create_project(uuid, text, text) to authenticated, service_role;
grant execute on function public.board_counts(uuid) to authenticated, service_role;
grant execute on function public.board_project_stats(uuid) to authenticated, service_role;
