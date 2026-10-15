-- ============================================================================
-- Yourbiss — 0005: bookings (services, staff, availability, slot engine)
--
-- The whole module rests on one idea: `youbiss.slot_conflict()` is the single
-- authoritative answer to "can this staff member take this service at this
-- instant, and if not, why?".
--
--   * available_slots() offers a candidate only if slot_conflict() returns NULL
--   * create_booking() refuses unless slot_conflict() returns NULL
--
-- So the grid a customer sees and the insert that commits use identical rules —
-- no drift between UI and database, and no way to book a slot the UI never
-- offered. A GiST exclusion constraint backstops the staff double-booking check
-- whatever path a row arrives by.
--
-- weekday convention: 0 = Sunday .. 6 = Saturday, matching JS Date.getDay().
-- ============================================================================

create type public.service_location as enum ('onsite', 'online', 'phone');
create type public.record_status    as enum ('active', 'hidden', 'archived');
create type public.booking_state    as enum ('pending', 'confirmed', 'cancelled', 'no_show', 'completed');
create type public.booking_source   as enum ('web', 'embed', 'manual', 'import');
create type public.exception_kind   as enum ('closed', 'extra');

-- ===========================================================================
-- Services
-- ===========================================================================
create table public.booking_services (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 120),
  slug              citext not null check (not youbiss.is_reserved_slug(slug)),
  description       text check (description is null or char_length(description) <= 2000),
  duration_min      integer not null check (duration_min between 5 and 1440),
  buffer_before_min integer not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min  integer not null default 0 check (buffer_after_min between 0 and 240),
  slot_step_min     integer not null default 15 check (slot_step_min between 5 and 120),
  min_lead_min      integer not null default 60 check (min_lead_min between 0 and 43200),
  max_horizon_days  integer not null default 60 check (max_horizon_days between 1 and 730),
  daily_limit       integer check (daily_limit is null or daily_limit between 1 and 64),
  capacity          integer not null default 1 check (capacity between 1 and 32),
  price_cents       integer not null default 0 check (price_cents between 0 and 100000000),
  currency          char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  location_kind     public.service_location not null default 'onsite',
  timezone          text not null default 'Asia/Kolkata' check (timezone ~ '^[A-Za-z_/]{1,64}$'),
  color             text not null default '#2E6BE6' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  intake_form_id    uuid references public.forms (id) on delete set null,
  page_config       jsonb not null default '{}'::jsonb check (youbiss.is_jsonb_object(page_config)),
  status            public.record_status not null default 'active',
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, slug),
  check (duration_min + buffer_before_min + buffer_after_min <= 1440)
);

-- ===========================================================================
-- Staff. Public profile and private contact are separate tables for the same
-- reason as forms/form_privates: a booking page shows staff by design and must
-- not be able to show their phone number by accident.
-- ===========================================================================
create table public.booking_staff (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  name       text not null check (char_length(name) between 1 and 80),
  slug       citext not null check (not youbiss.is_reserved_slug(slug)),
  bio        text check (bio is null or char_length(bio) <= 1000),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https?://'),
  timezone   text not null default 'Asia/Kolkata' check (timezone ~ '^[A-Za-z_/]{1,64}$'),
  status     public.record_status not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table public.booking_staff_contacts (
  staff_id   uuid primary key references public.booking_staff (id) on delete cascade,
  org_id     uuid not null references public.orgs (id) on delete cascade,
  email      citext,
  phone      text check (phone is null or phone ~ '^[+0-9 ()\-]{0,32}$'),
  notes      text check (notes is null or char_length(notes) <= 1000),
  updated_at timestamptz not null default now()
);

create table public.booking_staff_services (
  staff_id   uuid not null references public.booking_staff (id) on delete cascade,
  service_id uuid not null references public.booking_services (id) on delete cascade,
  org_id     uuid not null references public.orgs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, service_id)
);

-- ===========================================================================
-- Availability
-- ===========================================================================
create table public.booking_availability (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.booking_staff (id) on delete cascade,
  org_id     uuid not null references public.orgs (id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),
  starts_at  time not null,
  ends_at    time not null,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

-- A `time` has no cast to `interval`, and `date + time` is STABLE because it
-- resolves through the session TimeZone — neither is allowed inside an index
-- expression. This helper pins every weekday onto one epoch day using only
-- IMMUTABLE arithmetic, which is what lets the overlap index and the exclusion
-- constraint below both be built. It also keeps the comparison independent of
-- `tstzrange`, whose bounds would shift with whoever queries the table.
create or replace function youbiss.time_on_epoch_day(p_time time)
returns timestamp
language sql
immutable
set search_path = public, pg_temp
as $$
  select timestamp '2000-01-01'
       + make_interval(hours => extract(hour from p_time)::int,
                       mins   => extract(minute from p_time)::int,
                       secs   => extract(second from p_time)::double precision);
$$;

-- Two windows on the same weekday may not overlap.
create index booking_availability_overlap_idx on public.booking_availability
  using gist (
    staff_id,
    tsrange(youbiss.time_on_epoch_day(starts_at), youbiss.time_on_epoch_day(ends_at))
  );
alter table public.booking_availability add constraint booking_availability_no_overlap
  exclude using gist (
    staff_id with =,
    weekday with =,
    tsrange(youbiss.time_on_epoch_day(starts_at), youbiss.time_on_epoch_day(ends_at)) with &&
  );

-- A break is a hole inside its own window, not a deduction from its end.
create table public.booking_breaks (
  id              uuid primary key default gen_random_uuid(),
  availability_id uuid not null references public.booking_availability (id) on delete cascade,
  staff_id        uuid not null references public.booking_staff (id) on delete cascade,
  org_id          uuid not null references public.orgs (id) on delete cascade,
  starts_at       time not null,
  ends_at         time not null,
  check (starts_at < ends_at)
);

create table public.booking_exceptions (
  id        uuid primary key default gen_random_uuid(),
  staff_id  uuid not null references public.booking_staff (id) on delete cascade,
  org_id    uuid not null references public.orgs (id) on delete cascade,
  day       date not null,
  kind      public.exception_kind not null,
  starts_at time,
  ends_at   time,
  reason    text check (reason is null or char_length(reason) <= 200),
  check (kind = 'closed' or (starts_at is not null and ends_at is not null and starts_at < ends_at))
);

create unique index booking_exceptions_closed_once
  on public.booking_exceptions (staff_id, day) where kind = 'closed';

-- Workspace-wide closures (festivals, blackouts) apply to every staff member.
create table public.booking_closed_days (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  day        date not null,
  reason     text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (org_id, day)
);

-- ===========================================================================
-- Bookings
-- ===========================================================================
create table public.bookings (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  service_id         uuid not null references public.booking_services (id) on delete restrict,
  staff_id           uuid not null references public.booking_staff (id) on delete restrict,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  timezone           text not null check (timezone ~ '^[A-Za-z_/]{1,64}$'),
  customer_name      text not null check (char_length(customer_name) between 1 and 120),
  customer_email     citext not null,
  customer_phone     text check (customer_phone is null or customer_phone ~ '^[+0-9 ()\-]{0,32}$'),
  notes              text check (notes is null or char_length(notes) <= 2000),
  internal_notes     text check (internal_notes is null or char_length(internal_notes) <= 2000),
  state              public.booking_state not null default 'confirmed',
  source             public.booking_source not null default 'web',
  code               citext not null unique check (code ~ '^[A-HJ-KM-NP-Z2-9]{8,12}$'),
  form_submission_id uuid references public.form_submissions (id) on delete set null,
  cancelled_at       timestamptz,
  cancel_reason      text check (cancel_reason is null or char_length(cancel_reason) <= 300),
  reminded_at        timestamptz,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at < interval '2 days')
);

create index bookings_staff_overlap_idx on public.bookings
  using gist (staff_id, tstzrange(starts_at, ends_at))
  where state in ('pending', 'confirmed');

alter table public.bookings add constraint bookings_staff_no_overlap
  exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at) with &&
  )
  where (state in ('pending', 'confirmed'));

create index bookings_customer_slot_idx on public.bookings (customer_email, starts_at);
create index bookings_org_state_idx     on public.bookings (org_id, state, starts_at);
create index bookings_service_idx       on public.bookings (service_id, starts_at);

-- Outbox: create_booking queues rows here and the mail worker claims them, so a
-- slow SMTP provider can never make the customer's booking request fail.
create table public.booking_notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  kind         text not null check (kind in ('confirmation','reminder','cancelled','rescheduled','team_alert')),
  recipient    citext not null,
  delivered_at timestamptz,
  attempts     integer not null default 0 check (attempts between 0 and 20),
  error        text,
  created_at   timestamptz not null default now(),
  unique (booking_id, kind, recipient)
);

create index bnotif_pending_idx on public.booking_notifications (created_at)
  where delivered_at is null;

-- ===========================================================================
-- working_windows — local-time windows this staff member could be booked in on
-- one date: weekly pattern, plus any 'extra' exception, empty if the staff
-- member, the org, or the weekday says closed. Breaks are NOT removed here; they
-- are tested per candidate by slot_conflict so a mid-day break stays a hole.
-- ===========================================================================
create or replace function youbiss.working_windows(p_staff_id uuid, p_day date)
returns table (opens_at timestamp, closes_at timestamp)
language sql
stable
as $$
  select (p_day::timestamp + w.s)::timestamp as opens_at,
         (p_day::timestamp + w.e)::timestamp as closes_at
  from (
    select a.starts_at as s, a.ends_at as e
    from public.booking_availability a
    where a.staff_id = p_staff_id
      and a.weekday = extract(dow from p_day)::smallint
    union all
    select x.starts_at, x.ends_at
    from public.booking_exceptions x
    where x.staff_id = p_staff_id and x.day = p_day and x.kind = 'extra'
  ) w
  where exists (select 1 from public.booking_staff st
                 where st.id = p_staff_id and st.status = 'active')
    and not exists (select 1 from public.booking_exceptions x
                    where x.staff_id = p_staff_id and x.day = p_day and x.kind = 'closed')
    and not exists (
      select 1 from public.booking_closed_days c
      join public.booking_staff st on st.id = p_staff_id
      where c.org_id = st.org_id and c.day = p_day
    );
$$;

-- ===========================================================================
-- slot_conflict — the single rule.
--
-- Takes an absolute instant and answers NULL (bookable) or a stable reason code.
-- Buffers are applied against neighbours; the window test ignores buffers, since
-- pre/post time only matters next to another booking, not against the wall.
-- ===========================================================================
create or replace function youbiss.slot_conflict(
  p_service_id uuid,
  p_staff_id   uuid,
  p_starts_at  timestamptz,
  p_tz         text default null
)
returns text
language plpgsql
stable
as $$
declare
  v_service  public.booking_services;
  v_staff    public.booking_staff;
  v_org      public.orgs;
  v_tz       text;
  v_day      date;
  v_local    timestamp;
  v_local_end timestamp;
  v_abs_end  timestamptz;
  v_buf_pre  interval;
  v_buf_post interval;
  v_span     interval;
  v_count    integer;
  v_in_hours boolean := false;
  v_rec      record;
begin
  select * into v_service from public.booking_services where id = p_service_id;
  if v_service.id is null then return 'service_not_found'; end if;
  if v_service.status <> 'active' then return 'service_inactive'; end if;

  select * into v_staff from public.booking_staff where id = p_staff_id;
  if v_staff.id is null then return 'staff_not_found'; end if;
  if v_staff.status <> 'active' then return 'staff_inactive'; end if;
  if v_staff.org_id <> v_service.org_id then return 'cross_org'; end if;
  if not exists (select 1 from public.booking_staff_services
                 where staff_id = p_staff_id and service_id = p_service_id) then
    return 'staff_does_not_offer_service';
  end if;

  select * into v_org from public.orgs where id = v_service.org_id;
  v_tz := coalesce(nullif(btrim(p_tz), ''), v_staff.timezone, v_service.timezone, v_org.timezone);

  v_span     := make_interval(mins => v_service.duration_min);
  v_buf_pre  := make_interval(mins => v_service.buffer_before_min);
  v_buf_post := make_interval(mins => v_service.buffer_after_min);
  v_abs_end  := p_starts_at + v_span;
  v_local    := p_starts_at at time zone v_tz;
  v_local_end:= v_abs_end at time zone v_tz;
  v_day      := v_local::date;

  if v_local_end <= v_local then return 'invalid_slot'; end if;
  if p_starts_at < now() + make_interval(mins => v_service.min_lead_min) then
    return 'too_soon';
  end if;
  if p_starts_at > (now() at time zone v_tz) + make_interval(days => v_service.max_horizon_days) then
    return 'beyond_horizon';
  end if;

  for v_rec in select * from youbiss.working_windows(p_staff_id, v_day) loop
    if v_local >= v_rec.opens_at and v_local_end <= v_rec.closes_at then
      v_in_hours := true;
    end if;
  end loop;
  if not v_in_hours then return 'outside_hours'; end if;

  -- Any break that touches this candidate blocks it.
  if exists (
    select 1 from public.booking_breaks b
    join public.booking_availability a on a.id = b.availability_id
    where b.staff_id = p_staff_id
      and a.weekday = extract(dow from v_day)::smallint
      and (v_day::timestamp + b.starts_at) < v_local_end
      and (v_day::timestamp + b.ends_at)   > v_local
  ) then
    return 'on_break';
  end if;

  -- Neighbouring bookings, buffers included.
  if exists (
    select 1 from public.bookings bk
    where bk.staff_id = p_staff_id
      and bk.state in ('pending','confirmed')
      and bk.starts_at < v_abs_end + v_buf_post
      and bk.ends_at   > p_starts_at - v_buf_pre
  ) then
    return 'staff_busy';
  end if;

  -- Shared-capacity services count concurrent customers across all staff.
  if v_service.capacity > 1 then
    select count(*) into v_count
    from public.bookings bk
    where bk.service_id = p_service_id
      and bk.state in ('pending','confirmed')
      and bk.starts_at < v_abs_end and bk.ends_at > p_starts_at;
    if v_count >= v_service.capacity then return 'capacity_full'; end if;
  else
    -- capacity 1 is already covered by the staff_busy test above for the same
    -- staff member; across staff it must also be exclusive.
    if exists (
      select 1 from public.bookings bk
      where bk.service_id = p_service_id
        and bk.state in ('pending','confirmed')
        and bk.starts_at < v_abs_end and bk.ends_at > p_starts_at
    ) then
      return 'service_full';
    end if;
  end if;

  if v_service.daily_limit is not null then
    select count(*) into v_count
    from public.bookings bk
    where bk.staff_id = p_staff_id
      and bk.state in ('pending','confirmed')
      and (bk.starts_at at time zone v_tz)::date = v_day;
    if v_count >= v_service.daily_limit then return 'day_full'; end if;
  end if;

  return null;
end;
$$;

-- ===========================================================================
-- available_slots — walks each working window in slot_step_min increments and
-- emits only candidates slot_conflict() accepts. Because it shares that one
-- function with create_booking, what is offered is always what can be booked.
-- ===========================================================================
create or replace function youbiss.available_slots(
  p_service_id uuid,
  p_staff_id   uuid,
  p_day        date,
  p_tz         text default null
)
returns table (starts_at timestamptz, ends_at timestamptz, state text)
language plpgsql
stable
as $$
declare
  v_service public.booking_services;
  v_staff   public.booking_staff;
  v_tz      text;
  v_step    interval;
  v_span    interval;
  v_local   timestamp;
  v_reason  text;
  w         record;
begin
  select * into v_service from public.booking_services where id = p_service_id;
  select * into v_staff   from public.booking_staff   where id = p_staff_id;
  if v_service.id is null or v_staff.id is null then
    return;
  end if;

  v_tz   := coalesce(nullif(btrim(p_tz), ''), v_staff.timezone, v_service.timezone);
  v_step := make_interval(mins => v_service.slot_step_min);
  v_span := make_interval(mins => v_service.duration_min);

  for w in select * from youbiss.working_windows(p_staff_id, p_day) loop
    v_local := w.opens_at;
    -- Floor onto the step grid so the grid stays stable as the day scrolls.
    while v_local + v_span <= w.closes_at loop
      v_reason := youbiss.slot_conflict(p_service_id, p_staff_id,
                                        v_local at time zone v_tz, v_tz);
      if v_reason is null then
        return query select
          v_local at time zone v_tz,
          (v_local + v_span) at time zone v_tz,
          'free';
      else
        return query select
          v_local at time zone v_tz,
          (v_local + v_span) at time zone v_tz,
          v_reason;
      end if;
      v_local := v_local + v_step;
    end loop;
  end loop;
end;
$$;

-- ===========================================================================
-- bookable_days — 28-day calendar summary in one call, so the booking page does
-- not fire 28 RPCs. Only "is anything free on this day" is needed for the grid;
-- the full slot list is fetched for the single day the customer selects.
-- ===========================================================================
create or replace function youbiss.bookable_days(
  p_service_id uuid,
  p_staff_id   uuid,
  p_from       date default null,
  p_days       integer default 28
)
returns table (day date, closed boolean, has_free_slot boolean)
language sql
stable
as $$
  with bounds as (
    select coalesce(
             p_from,
             (now() at time zone coalesce(
                (select s.timezone from public.booking_staff s where s.id = p_staff_id),
                (select v.timezone from public.booking_services v where v.id = p_service_id),
                'UTC'))::date
           ) as d0
  ),
  grid as (
    select ((select d0 from bounds) + make_interval(days => g))::date as day
    from generate_series(0, least(greatest(coalesce(p_days, 28), 1), 90) - 1) g
  )
  select gr.day,
         not exists (select 1 from youbiss.working_windows(p_staff_id, gr.day) ww),
         exists (select 1 from youbiss.available_slots(p_service_id, p_staff_id, gr.day) a
                 where a.state = 'free')
  from grid gr;
$$;

-- ===========================================================================
-- create_booking — the only door.
-- ===========================================================================
create or replace function youbiss.create_booking(
  p_service_id     uuid,
  p_staff_id       uuid,
  p_starts_at      timestamptz,
  p_customer_name  text,
  p_customer_email text,
  p_customer_phone text  default null,
  p_notes          text  default null,
  p_source         public.booking_source default 'web',
  p_tz             text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service public.booking_services;
  v_staff   public.booking_staff;
  v_org     public.orgs;
  v_tz      text;
  v_reason  text;
  v_code    text;
  v_day     date;
  v_b       public.bookings;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'name is required';
  end if;
  if btrim(coalesce(p_customer_email, '')) = '' then
    raise exception 'email is required';
  end if;
  if p_customer_email !~ '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$' then
    raise exception 'email address is not valid';
  end if;
  if p_starts_at is null then
    raise exception 'a start time is required';
  end if;

  select * into v_service from public.booking_services where id = p_service_id;
  if v_service.id is null then
    raise exception 'service not found' using errcode = 'P0002';
  end if;
  select * into v_staff from public.booking_staff where id = p_staff_id;
  if v_staff.id is null then
    raise exception 'staff member not found' using errcode = 'P0002';
  end if;
  select * into v_org from public.orgs where id = v_service.org_id;
  v_tz := coalesce(nullif(btrim(p_tz), ''), v_staff.timezone, v_service.timezone, v_org.timezone);

  -- Serialise per staff+day so two concurrent submissions cannot both believe
  -- the slot is free. slot_conflict is re-run after the lock is held.
  v_day := (p_starts_at at time zone v_tz)::date;
  perform pg_advisory_xact_lock(hashtextextended(v_staff.id::text || '|' || v_day::text, 0));

  v_reason := youbiss.slot_conflict(p_service_id, p_staff_id, p_starts_at, v_tz);
  if v_reason is not null then
    raise exception 'cannot book: %', v_reason using errcode = 'P0001';
  end if;

  -- Unambiguous alphabet: no 0/O/1/I/L, so a reference can be read over the phone.
  loop
    v_code := translate(upper(substr(encode(gen_random_bytes(16), 'hex'), 1, 10)), '01', '92');
    exit when not exists (select 1 from public.bookings b where b.code = v_code);
  end loop;

  insert into public.bookings
    (id, org_id, service_id, staff_id, starts_at, ends_at, timezone,
     customer_name, customer_email, customer_phone, notes, state, source, code, created_by)
  values
    (gen_random_uuid(), v_service.org_id, p_service_id, p_staff_id,
     p_starts_at, p_starts_at + make_interval(mins => v_service.duration_min), v_tz,
     left(btrim(p_customer_name), 120), lower(btrim(p_customer_email)),
     nullif(btrim(coalesce(p_customer_phone, '')), ''),
     nullif(btrim(coalesce(p_notes, '')), ''),
     'confirmed', coalesce(p_source, 'web'), v_code, auth.uid())
  returning * into v_b;

  insert into public.booking_notifications (org_id, booking_id, kind, recipient)
  values (v_b.org_id, v_b.id, 'confirmation', v_b.customer_email)
  on conflict (booking_id, kind, recipient) do nothing;

  insert into public.booking_notifications (org_id, booking_id, kind, recipient)
  select v_b.org_id, v_b.id, 'team_alert', c.email
  from public.booking_staff_contacts c
  where c.staff_id = p_staff_id and c.email is not null
  on conflict (booking_id, kind, recipient) do nothing;

  insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
  values (v_b.org_id, auth.uid(), 'bookings', 'booking', v_b.id::text, 'created',
          left(format('%s booked %s for %s', v_b.customer_name, v_service.name,
                      (v_b.starts_at at time zone v_tz)), 500));

  return v_b;
end;
$$;

-- ===========================================================================
-- cancel_booking / reschedule_booking
--
-- Both verify the pair (code, email) — the only secrets a customer legitimately
-- holds — and re-run slot_conflict on any new time.
-- ===========================================================================
create or replace function youbiss.cancel_booking(
  p_code text,
  p_email text,
  p_reason text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings
  where code = upper(btrim(p_code)) and customer_email = lower(btrim(p_email))
  for update;
  if v_b.id is null then
    raise exception 'no booking matches that reference and email' using errcode = 'P0002';
  end if;
  if v_b.state in ('cancelled','completed','no_show') then
    raise exception 'this booking is already %', v_b.state;
  end if;
  if v_b.starts_at < now() then
    raise exception 'a past booking cannot be cancelled';
  end if;

  update public.bookings
  set state = 'cancelled', cancelled_at = now(),
      cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  where id = v_b.id
  returning * into v_b;

  insert into public.booking_notifications (org_id, booking_id, kind, recipient)
  values (v_b.org_id, v_b.id, 'cancelled', v_b.customer_email)
  on conflict (booking_id, kind, recipient) do update
    set delivered_at = null, attempts = 0, error = null;

  insert into public.activity_log (org_id, app_key, entity_type, entity_id, action, summary)
  values (v_b.org_id, 'bookings', 'booking', v_b.id::text, 'cancelled',
          left(format('%s cancelled %s', v_b.customer_name, v_b.code), 500));

  return v_b;
end;
$$;

-- ===========================================================================
-- reschedule_booking
--
-- Moves an existing row in place rather than delete+reinsert: the notification
-- history and the activity trail hang off booking_id, and a cascade would erase
-- them. The immutability trigger normally blocks starts_at/staff_id on UPDATE;
-- it lets this call through via a transaction-local flag naming the row id, so
-- the exception is this function and nothing else.
-- ===========================================================================
create or replace function youbiss.reschedule_booking(
  p_code text,
  p_email text,
  p_starts_at timestamptz,
  p_tz text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b      public.bookings;
  v_tz     text;
  v_span   interval;
  v_reason text;
  v_day    date;
begin
  select * into v_b from public.bookings
  where code = upper(btrim(p_code)) and customer_email = lower(btrim(p_email))
  for update;
  if v_b.id is null then
    raise exception 'no booking matches that reference and email' using errcode = 'P0002';
  end if;
  if v_b.state in ('cancelled','completed','no_show') then
    raise exception 'this booking is already %', v_b.state;
  end if;
  if p_starts_at is null then
    raise exception 'a new start time is required';
  end if;

  v_tz  := coalesce(nullif(btrim(p_tz), ''), v_b.timezone);
  v_day := (p_starts_at at time zone v_tz)::date;

  -- Hold both the current and the target day so two callers racing for the same
  -- slot serialise, then judge the move with the shared rule.
  perform pg_advisory_xact_lock(hashtextextended(v_b.staff_id::text || '|' ||
                                                 (v_b.starts_at at time zone v_b.timezone)::date::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_b.staff_id::text || '|' || v_day::text, 0));

  select make_interval(mins => s.duration_min) into v_span
  from public.booking_services s where s.id = v_b.service_id;

  v_reason := youbiss.slot_conflict(v_b.service_id, v_b.staff_id, p_starts_at, v_tz);
  if v_reason is not null then
    raise exception 'cannot move to that time: %', v_reason using errcode = 'P0001';
  end if;

  perform set_config('youbiss.reschedule_booking_id', v_b.id::text, true);

  update public.bookings
  set starts_at = p_starts_at,
      ends_at   = p_starts_at + v_span,
      timezone  = v_tz
  where id = v_b.id
  returning * into v_b;

  perform set_config('youbiss.reschedule_booking_id', '', true);

  insert into public.booking_notifications (org_id, booking_id, kind, recipient)
  values (v_b.org_id, v_b.id, 'rescheduled', v_b.customer_email)
  on conflict (booking_id, kind, recipient) do update
    set delivered_at = null, attempts = 0, error = null;

  insert into public.activity_log (org_id, app_key, entity_type, entity_id, action, summary)
  values (v_b.org_id, 'bookings', 'booking', v_b.id::text, 'rescheduled',
          left(format('%s moved to %s', v_b.customer_name,
                      (v_b.starts_at at time zone v_b.timezone)), 500));

  return v_b;
end;
$$;

-- ===========================================================================
-- staff_for_service — who can take this service, in display order. Public page
-- data only; contacts stay in their own table.
-- ===========================================================================
create or replace function youbiss.staff_for_service(p_service_id uuid)
returns table (id uuid, name text, slug text, bio text, avatar_url text,
               timezone text, sort_order integer)
language sql
stable
as $$
  select s.id, s.name, s.slug::text, s.bio, s.avatar_url, s.timezone, s.sort_order
  from public.booking_staff s
  join public.booking_staff_services ss on ss.staff_id = s.id
  where ss.service_id = p_service_id and s.status = 'active'
  order by s.sort_order, s.name;
$$;

-- ===========================================================================
-- Triggers
-- ===========================================================================
create trigger youbiss_bservices_touch before update on public.booking_services
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_bstaff_touch    before update on public.booking_staff
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_bookings_touch  before update on public.bookings
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_bcontacts_touch before update on public.booking_staff_contacts
  for each row execute function youbiss.touch_updated_at();

-- A booking is an appointment, not a free-form row: the appointment identity
-- (who, what, when, whose reference) may only change through create_booking,
-- cancel_booking or reschedule_booking. Enforcement here rather than in a policy
-- subquery, because a WITH CHECK that reads its own table sees an indeterminate
-- version of the row being written.
create or replace function youbiss.bookings_immutable_fields()
returns trigger
language plpgsql
as $$
declare
  v_rescheduling boolean := current_setting('youbiss.reschedule_booking_id', true)
                          = old.id::text;
begin
  -- Identity is fixed for the life of the row, no exceptions.
  if new.id            is distinct from old.id
     or new.org_id     is distinct from old.org_id
     or new.code       is distinct from old.code
     or new.service_id is distinct from old.service_id
     or new.customer_email is distinct from old.customer_email then
    raise exception 'booking identity fields cannot be updated' using errcode = '42809';
  end if;

  if v_rescheduling then
    -- reschedule_booking has already re-run slot_conflict under an advisory lock.
    if new.ends_at - new.starts_at is distinct from old.ends_at - old.starts_at then
      raise exception 'reschedule may not change the booking length' using errcode = '42809';
    end if;
    return new;
  end if;

  -- Outside a reschedule, the appointment cannot be moved or reassigned: that
  -- must go through reschedule_booking, which checks conflicts first.
  if new.starts_at is distinct from old.starts_at
     or new.ends_at  is distinct from old.ends_at
     or new.staff_id is distinct from old.staff_id then
    raise exception 'use reschedule_booking to move a booking' using errcode = '42809';
  end if;

  if old.state in ('cancelled','completed','no_show') and new.state <> old.state then
    raise exception 'a closed booking cannot be reopened' using errcode = '42809';
  end if;

  return new;
end;
$$;

create trigger youbiss_bookings_immutable
  before update on public.bookings
  for each row execute function youbiss.bookings_immutable_fields();

create or replace function youbiss.staff_ensure_contact_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.booking_staff_contacts (staff_id, org_id)
  values (new.id, new.org_id)
  on conflict (staff_id) do update set org_id = excluded.org_id;
  return new;
end;
$$;

create trigger youbiss_bstaff_contact_mirror
  after insert or update of org_id on public.booking_staff
  for each row execute function youbiss.staff_ensure_contact_row();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.booking_services       enable row level security;
alter table public.booking_staff          enable row level security;
alter table public.booking_staff_contacts enable row level security;
alter table public.booking_staff_services enable row level security;
alter table public.booking_availability   enable row level security;
alter table public.booking_breaks         enable row level security;
alter table public.booking_exceptions     enable row level security;
alter table public.booking_closed_days    enable row level security;
alter table public.bookings               enable row level security;
alter table public.booking_notifications  enable row level security;

create policy bservices_select on public.booking_services
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bservices_write on public.booking_services
  for all to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));

create policy bstaff_select on public.booking_staff
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bstaff_write on public.booking_staff
  for all to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));

-- Admin only: never part of a public booking page.
create policy bstaff_contacts_admin on public.booking_staff_contacts
  for all to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'bookings')
              and exists (select 1 from public.booking_staff s where s.id = staff_id and s.org_id = org_id));

create policy bss_select on public.booking_staff_services
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bss_write on public.booking_staff_services
  for all to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings')
              and exists (select 1 from public.booking_staff s where s.id = staff_id and s.org_id = org_id)
              and exists (select 1 from public.booking_services v where v.id = service_id and v.org_id = org_id));

create policy bavail_select on public.booking_availability
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bavail_write on public.booking_availability
  for all to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings')
              and exists (select 1 from public.booking_staff s where s.id = staff_id and s.org_id = org_id));

create policy bbreaks_select on public.booking_breaks
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bbreaks_write on public.booking_breaks
  for all to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings')
              and exists (select 1 from public.booking_availability a
                          where a.id = availability_id and a.org_id = org_id));

create policy bexceptions_select on public.booking_exceptions
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bexceptions_write on public.booking_exceptions
  for all to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings')
              and exists (select 1 from public.booking_staff s where s.id = staff_id and s.org_id = org_id));

create policy bclosed_select on public.booking_closed_days
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bclosed_write on public.booking_closed_days
  for all to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'bookings'));

-- No INSERT policy for any client role: create_booking is the only door.
create policy bookings_select on public.bookings
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bookings_update on public.bookings
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bookings_delete on public.bookings
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'bookings'));

create policy bnotif_select on public.booking_notifications
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));
create policy bnotif_update on public.booking_notifications
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'bookings'));

revoke all on public.booking_services, public.booking_staff, public.booking_staff_contacts,
              public.booking_staff_services, public.booking_availability, public.booking_breaks,
              public.booking_exceptions, public.booking_closed_days, public.bookings,
              public.booking_notifications
  from anon, public;

-- ===========================================================================
-- Function grants, deliberately split:
--   * read-only planning helpers are callable by signed-in members
--   * the booking-writing functions are callable ONLY by service_role, i.e. our
--     server routes. Handing these to anon or authenticated would let a browser
--     create or cancel bookings without validation, rate limiting, or the
--     honeypot check that the route applies.
-- ===========================================================================
revoke all on function youbiss.create_booking(uuid, uuid, timestamptz, text, text, text, text, public.booking_source, text) from public, anon, authenticated;
revoke all on function youbiss.cancel_booking(text, text, text) from public, anon, authenticated;
revoke all on function youbiss.reschedule_booking(text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function youbiss.create_booking(uuid, uuid, timestamptz, text, text, text, text, public.booking_source, text) to service_role;
grant execute on function youbiss.cancel_booking(text, text, text) to service_role;
grant execute on function youbiss.reschedule_booking(text, text, timestamptz, text) to service_role;

grant execute on function youbiss.working_windows(uuid, date) to authenticated, service_role;
grant execute on function youbiss.slot_conflict(uuid, uuid, timestamptz, text) to authenticated, service_role;
grant execute on function youbiss.available_slots(uuid, uuid, date, text) to authenticated, service_role;
grant execute on function youbiss.bookable_days(uuid, uuid, date, integer) to authenticated, service_role;
grant execute on function youbiss.staff_for_service(uuid) to authenticated, service_role;
