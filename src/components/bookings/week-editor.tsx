'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { saveWeek } from '@/lib/actions/bookings';
import { Button, Card, CardBody, CardFooter, CardHeader, Field, FormStatus, Input, Switch, toast, useAction } from '@/components/ui';
import { WEEKDAY_ORDER, toInputTime, weekdayLabel } from '@/lib/bookings/types';
import type { WeekWindowDoc } from './types-client';

/**
 * The weekly hours a person keeps.
 *
 * A whole week replaces a whole week, because `booking_availability` carries an exclusion
 * constraint that forbids two overlapping windows on one weekday: editing row by row
 * would have to fight it every time a morning slot moves, and a half-saved week is worse
 * than a refused one. The same check runs on the server before anything is deleted, so
 * the message here names the day rather than a constraint.
 *
 * A day with no windows is a day off — that is the state the engine reads, not a flag on
 * the row. Times are 24-hour and are judged in the person's own time zone, which the card
 * says out loud because a wrong clock shows wrong times that still book.
 */

interface WindowDraft {
  starts_at: string;
  ends_at: string;
  breaks: { starts_at: string; ends_at: string }[];
}

const DEFAULT_WINDOW: WindowDraft = { starts_at: '09:00', ends_at: '17:00', breaks: [] };

export function WeekEditor({
  staffId,
  staffName,
  timezone,
  windows,
  canManage,
  onSaved,
}: {
  staffId: string;
  staffName: string;
  timezone: string;
  windows: WeekWindowDoc[];
  canManage: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { state, pending, run } = useAction();

  const [days, setDays] = useState<Record<number, WindowDraft[]>>(() => groupWindows(windows));
  const [saved, setSaved] = useState<Record<number, WindowDraft[]>>(() => groupWindows(windows));

  const dirty = JSON.stringify(days) !== JSON.stringify(saved);

  const setDay = (weekday: number, next: WindowDraft[]) => setDays((current) => ({ ...current, [weekday]: next }));

  const openDay = (weekday: number, wanted: boolean) =>
    setDay(weekday, wanted ? [{ ...DEFAULT_WINDOW, breaks: [] }] : []);

  const patchWindow = (weekday: number, index: number, patch: Partial<WindowDraft>) => {
    const list = days[weekday] ?? [];
    const target = list[index];
    if (!target) return;
    setDay(weekday, list.map((window, position) => (position === index ? { ...window, ...patch } : window)));
  };

  const addWindow = (weekday: number) => setDay(weekday, [...(days[weekday] ?? []), { ...DEFAULT_WINDOW, breaks: [] }]);

  const removeWindow = (weekday: number, index: number) =>
    setDay(weekday, (days[weekday] ?? []).filter((_, position) => position !== index));

  const patchBreak = (weekday: number, index: number, position: number, patch: Partial<{ starts_at: string; ends_at: string }>) => {
    const list = days[weekday] ?? [];
    const target = list[index];
    if (!target) return;
    patchWindow(weekday, index, {
      breaks: target.breaks.map((brake, place) => (place === position ? { ...brake, ...patch } : brake)),
    });
  };

  const addBreak = (weekday: number, index: number) => {
    const target = (days[weekday] ?? [])[index];
    if (!target) return;
    // Start the break an hour after the window opens, inside it, so the first thing a
    // person sees is a legal row instead of one the schema refuses.
    const startsAt = shift(target.starts_at, 60);
    patchWindow(weekday, index, { breaks: [...target.breaks, { starts_at: startsAt, ends_at: shift(startsAt, 60) }] });
  };

  const removeBreak = (weekday: number, index: number, position: number) => {
    const target = (days[weekday] ?? [])[index];
    if (!target) return;
    patchWindow(weekday, index, { breaks: target.breaks.filter((_, place) => place !== position) });
  };

  const copyMonday = () => {
    const monday = days[1] ?? [];
    if (monday.length === 0) {
      toast.error('Monday has no hours to copy. Give Monday a window first.');
      return;
    }
    setDays((current) => {
      const next = { ...current };
      for (const weekday of WEEKDAY_ORDER) {
        if (weekday === 1) continue;
        next[weekday] = monday.map((window) => ({ ...window, breaks: window.breaks.map((brake) => ({ ...brake })) }));
      }
      return next;
    });
  };

  const problems = check(days);

  const save = () => {
    if (problems.length > 0) return;
    void run(async () => {
      const payload = {
        windows: WEEKDAY_ORDER.flatMap((weekday) =>
          (days[weekday] ?? []).map((window) => ({ weekday, starts_at: window.starts_at, ends_at: window.ends_at, breaks: window.breaks })),
        ),
      };
      const result = await saveWeek(staffId, payload);
      if (result.ok) {
        setSaved(groupWindowsFromDraft(days));
        toast.success(`${staffName}’s weekly hours saved`);
        onSaved();
        router.refresh();
      }
      return result;
    });
  };

  return (
    <Card>
      <CardHeader
        title="Every week"
        description={`A day with no window is a day off. Times are read in ${timezone.replace(/_/g, ' ')}.`}
        action={
          canManage ? (
            <Button variant="ghost" size="sm" onClick={copyMonday}>
              <Copy size={13} />
              Copy Monday to the week
            </Button>
          ) : undefined
        }
      />

      <CardBody className="grid gap-1.5">
        {WEEKDAY_ORDER.map((weekday) => {
          const list = days[weekday] ?? [];
          const open = list.length > 0;
          return (
            <div key={weekday} className="rounded-md border border-line px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Switch
                  checked={open}
                  label={`${weekdayLabel(weekday)} open`}
                  disabled={!canManage}
                  onChange={(wanted) => openDay(weekday, wanted)}
                />
                <span className="w-20 flex-none text-[13px] font-medium text-ink">{weekdayLabel(weekday)}</span>

                {!open ? (
                  <span className="text-[12.5px] text-muted">Closed all day</span>
                ) : (
                  <span className="text-[12px] text-muted">
                    {list.length === 1 ? 'One window' : `${list.length} windows`}
                  </span>
                )}

                {open && canManage && (
                  <button
                    type="button"
                    onClick={() => addWindow(weekday)}
                    className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
                  >
                    <Plus size={13} />
                    Add window
                  </button>
                )}
              </div>

              {open && (
                <div className="mt-2 grid gap-2">
                  {list.map((window, index) => (
                    <div key={index} className="rounded-md bg-raised px-3 py-2.5">
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label="Opens" htmlFor={`open-${weekday}-${index}`}>
                          <Input
                            id={`open-${weekday}-${index}`}
                            type="time"
                            step={300}
                            value={window.starts_at}
                            disabled={!canManage}
                            className="w-32"
                            onChange={(event) => patchWindow(weekday, index, { starts_at: event.target.value })}
                          />
                        </Field>
                        <Field label="Closes" htmlFor={`close-${weekday}-${index}`}>
                          <Input
                            id={`close-${weekday}-${index}`}
                            type="time"
                            step={300}
                            value={window.ends_at}
                            disabled={!canManage}
                            className="w-32"
                            onChange={(event) => patchWindow(weekday, index, { ends_at: event.target.value })}
                          />
                        </Field>

                        {canManage && (
                          <div className="flex items-center gap-2 pb-1">
                            <button
                              type="button"
                              onClick={() => addBreak(weekday, index)}
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline"
                            >
                              <Plus size={13} />
                              Break
                            </button>
                            {list.length > 1 && (
                              <Button
                                variant="ghost"
                                size="iconSm"
                                aria-label={`Remove the ${windowLabel(window)} window on ${weekdayLabel(weekday)}`}
                                onClick={() => removeWindow(weekday, index)}
                              >
                                <Trash2 size={13} />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {window.breaks.length > 0 && (
                        <ul className="mt-2 grid gap-1.5">
                          {window.breaks.map((brake, position) => (
                            <li key={position} className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
                              <span className="text-muted">Break</span>
                              <Input
                                type="time"
                                step={300}
                                aria-label={`Break start on ${weekdayLabel(weekday)}`}
                                value={brake.starts_at}
                                disabled={!canManage}
                                className="w-28"
                                onChange={(event) => patchBreak(weekday, index, position, { starts_at: event.target.value })}
                              />
                              <span aria-hidden="true">to</span>
                              <Input
                                type="time"
                                step={300}
                                aria-label={`Break end on ${weekdayLabel(weekday)}`}
                                value={brake.ends_at}
                                disabled={!canManage}
                                className="w-28"
                                onChange={(event) => patchBreak(weekday, index, position, { ends_at: event.target.value })}
                              />
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => removeBreak(weekday, index, position)}
                                  className="text-muted hover:text-danger"
                                  aria-label={`Remove the break at ${brake.starts_at} on ${weekdayLabel(weekday)}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      {window.starts_at >= window.ends_at && (
                        <p className="mt-1.5 text-[12px] text-danger">This window closes before it opens.</p>
                      )}
                      {window.breaks
                        .filter((brake) => brake.starts_at >= brake.ends_at || brake.starts_at < window.starts_at || brake.ends_at > window.ends_at)
                        .map((brake, position) => (
                          <p key={position} className="mt-1.5 text-[12px] text-danger">
                            The break at {brake.starts_at} has to sit inside {window.starts_at}–{window.ends_at}.
                          </p>
                        ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardBody>

      <CardFooter>
        <span className="mr-auto max-w-[520px] text-[12px] leading-relaxed text-danger">
          {/* The client check speaks first: it names the day, and it fires before a
              request that the server would refuse with the same words anyway. */}
          {problems.length > 0 ? problems[0] : <FormStatus state={state} />}
        </span>
        <Button variant="primary" loading={pending} disabled={!canManage || !dirty || problems.length > 0} onClick={save}>
          Save the week
        </Button>
      </CardFooter>
    </Card>
  );
}

/** The column holds `HH:MM:SS`; the editor works in what a time input shows. */
function groupWindows(windows: WeekWindowDoc[]): Record<number, WindowDraft[]> {
  const days: Record<number, WindowDraft[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const window of windows) {
    const list = days[window.weekday] ?? [];
    list.push({
      starts_at: toInputTime(window.starts_at),
      ends_at: toInputTime(window.ends_at),
      breaks: window.breaks.map((brake) => ({ starts_at: toInputTime(brake.starts_at), ends_at: toInputTime(brake.ends_at) })),
    });
    days[window.weekday] = list;
  }
  for (const weekday of WEEKDAY_ORDER) {
    (days[weekday] ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  return days;
}

function groupWindowsFromDraft(days: Record<number, WindowDraft[]>): Record<number, WindowDraft[]> {
  const next: Record<number, WindowDraft[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const weekday of WEEKDAY_ORDER) {
    next[weekday] = (days[weekday] ?? []).map((window) => ({
      starts_at: window.starts_at,
      ends_at: window.ends_at,
      breaks: window.breaks.map((brake) => ({ ...brake })),
    }));
  }
  return next;
}

function windowLabel(window: WindowDraft) {
  return `${window.starts_at}–${window.ends_at}`;
}

/** `HH:MM` plus minutes, clamped to the day — the hour a new break starts at. */
function shift(value: string, minutes: number): string {
  const [hours = 9, minute = 0] = value.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, hours * 60 + minute + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function check(days: Record<number, WindowDraft[]>): string[] {
  const out: string[] = [];
  for (const weekday of WEEKDAY_ORDER) {
    const list = days[weekday] ?? [];
    for (const window of list) {
      if (!window.starts_at || !window.ends_at) {
        out.push(`${weekdayLabel(weekday)} has a window without both times.`);
        continue;
      }
      if (window.starts_at >= window.ends_at) {
        out.push(`${weekdayLabel(weekday)} has a window that closes before it opens.`);
      }
      for (const brake of window.breaks) {
        if (brake.starts_at >= brake.ends_at) out.push(`${weekdayLabel(weekday)} has a break that ends before it starts.`);
        else if (brake.starts_at < window.starts_at || brake.ends_at > window.ends_at)
          out.push(`${weekdayLabel(weekday)} has a break outside its window.`);
      }
    }
    const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous && current && current.starts_at < previous.ends_at) {
        out.push(`${weekdayLabel(weekday)} has two windows that overlap.`);
      }
    }
  }
  return [...new Set(out)];
}
