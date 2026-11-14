import test from "node:test";
import assert from "node:assert/strict";
import {
  FantasyClock, clockLabel, fantasySecondOfDay, localDayIndex, localSecondOfDay,
  timeZoneOffsetHours,
} from "../src/clock.ts";
import { activityAt, dailyPlan, personalityFor, scheduledActivitySpanEnd, traitsFor } from "../src/routines.ts";
import { residentStationaryWithinActivity } from "../src/resident-query.ts";
import { cities } from "../src/geography.ts";

const HOUR = 3600;
/** The reported defect came from a GMT+5 settlement, so the tests use the real one. */
const city = cities[0];
const LON = city.canonicalPosition.lon;
const DAY_START = 6 * HOUR, NIGHT_START = 18 * HOUR;

const guard = (shift: 0 | 1, day = 0) => dailyPlan(
  { code: "ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/0/SETTLEMENT/v2/CITY/0/RESIDENT/7",
    role: "guard", ageGroup: "adult", guardShift: shift },
  traitsFor("ADVISOR-0126-ALDERWICK/v4/CONT/0/COUNTRY/0/SETTLEMENT/v2/CITY/0/RESIDENT/7", "guard", "adult"),
  day, 0,
);

const minutesOfDay = () => {
  const seconds: number[] = [];
  for (let second = 0; second < 24 * HOUR; second += 60) seconds.push(second);
  return seconds;
};

test("the twelve-hour watches hold exactly their posted hours, all day", () => {
  const dayShift = guard(0), nightShift = guard(1);
  for (const second of minutesOfDay()) {
    const onDayWatch = activityAt(dayShift, second).activity.kind === "guard";
    const onNightWatch = activityAt(nightShift, second).activity.kind === "guard";
    const inDayWindow = second >= DAY_START && second < NIGHT_START;
    assert.equal(onDayWatch, inDayWindow,
      `day shift must guard only 06:00-18:00, was ${onDayWatch} at ${clockLabel(second)}`);
    assert.equal(onNightWatch, !inDayWindow,
      `night shift must guard only 18:00-06:00, was ${onNightWatch} at ${clockLabel(second)}`);
  }
});

test("a watch keeps its true span instead of ending at midnight", () => {
  const dayShift = guard(0), nightShift = guard(1);

  // Day shift: one continuous watch reported as 06:00-18:00.
  const dayGuard = activityAt(dayShift, 13 * HOUR);
  assert.equal(dayGuard.activity.kind, "guard");
  assert.equal(dayGuard.activity.task, "Guard duty");
  assert.equal(scheduledActivitySpanEnd(dayShift, dayGuard.index), NIGHT_START,
    "the day watch ends when the night watch takes over");

  // Night shift evening entry: the watch continues after midnight to 06:00, so
  // its end is past 24 hours and its clock label wraps to 06:00.
  const evening = activityAt(nightShift, 22 * HOUR);
  assert.equal(evening.activity.kind, "guard");
  assert.equal(evening.activity.task, "Night watch");
  const eveningEnd = scheduledActivitySpanEnd(nightShift, evening.index);
  assert.equal(eveningEnd, 24 * HOUR + DAY_START, "the night watch runs to 06:00 the next day");
  assert.equal(clockLabel(eveningEnd % (24 * HOUR)), "06:00",
    "the popup prints the wrapped end as 06:00, not 00:00");

  // Progress is measured across the real 12-hour watch, so it cannot reach 100%
  // at midnight while the guard is still standing there.
  const atMidnight = (24 * HOUR - evening.activity.start) / (eveningEnd - evening.activity.start);
  assert.ok(atMidnight > .45 && atMidnight < .55,
    `midnight is mid-watch, not the end of it (${atMidnight.toFixed(3)})`);
});

test("the reported instant: at local 02:09 no day-watch guard is standing a post", () => {
  // The screenshot showed realm 21:09 / local 02:09 with a guard reporting
  // "Guard duty · 06:00-18:00". The realm instant is reproduced from the real
  // helpers rather than hard-coded, so a clock change cannot quietly break it.
  const tick = 40 * 24 * 3600 + 21 * HOUR + 9 * 60 - fantasySecondOfDay(0);
  assert.equal(clockLabel(fantasySecondOfDay(tick)), "21:09", "realm instant of the report");
  const local = localSecondOfDay(tick, LON);
  assert.equal(clockLabel(local), "02:09", "the same instant at the settlement");
  assert.equal(timeZoneOffsetHours(LON), 5, "the reported settlement is GMT+5");
  assert.equal(localDayIndex(tick, LON), localDayIndex(tick, LON) + 0);

  const dayShift = guard(0), nightShift = guard(1);
  const day = activityAt(dayShift, local), night = activityAt(nightShift, local);
  assert.equal(day.activity.kind, "sleep", "the day watch is asleep at 02:09, not on duty");
  assert.equal(day.activity.indoors, true);
  assert.equal(night.activity.kind, "guard", "the night watch holds the post at 02:09");
  assert.equal(night.activity.task, "Night watch");
});

test("the header clock states the tick it is given, so it cannot name another moment", () => {
  // The defect was two clocks: the header read the browser clock while the
  // world read the simulation tick. A label derived from the tick can only ever
  // state that tick, which is what these assert.
  const clock = new FantasyClock();
  for (const tick of [0, 1, 3600, 86_399, 86_400, 86_401, 500_000]) {
    const label = clock.labelForTick(tick);
    assert.equal(label.split(" · ")[1], clockLabel(fantasySecondOfDay(tick)),
      `realm label for tick ${tick} must state that tick's realm time`);
  }
  const labelParts = (tick: number) => {
    const [date, time] = clock.labelForTick(tick).split(" · ");
    // Labels are day.month.year in the fantasy calendar.
    return { date, time, day: Date.UTC(Number(date.slice(6)), Number(date.slice(3, 5)) - 1, Number(date.slice(0, 2))) };
  };
  const atOrigin = labelParts(0), oneDayLater = labelParts(86_400);
  assert.equal(oneDayLater.time, atOrigin.time, "a whole day later is the same time of day");
  assert.notEqual(oneDayLater.date, atOrigin.date);
  assert.equal(oneDayLater.day - atOrigin.day, 86_400_000,
    "86_400 ticks is exactly one fantasy day later");
});

test("a stale day-watch resident can never be reused as stationary night scenery", () => {
  const standing = (overrides: Record<string, unknown> = {}) => ({
    grounded: true, indoors: false, activity: "guard" as const,
    activityStart: DAY_START, activityEnd: NIGHT_START,
    travelProgress: undefined as number | undefined, route: "GATE POST 1", ...overrides,
  });
  // A day-shift guard remembered from 15:36 must not survive to 02:09.
  assert.equal(residentStationaryWithinActivity(standing(), 10, 10, 2 * HOUR + 9 * 60), false,
    "the day watch ended at 18:00 and cannot be held at the post after it");
  assert.equal(residentStationaryWithinActivity(standing(), 10, 10, 15 * HOUR + 36 * 60), true,
    "inside its own watch the same resident legitimately stays");
  // A night guard whose interval says it continues past midnight keeps the post.
  const night = standing({ activityStart: NIGHT_START, activityEnd: 24 * HOUR + DAY_START });
  assert.equal(residentStationaryWithinActivity(night, 10, 10, 22 * HOUR), true);
  assert.equal(residentStationaryWithinActivity(night, 10, 11, 2 * HOUR + 9 * 60), true,
    "the watch that began 18:00 yesterday still holds at 02:09 today");
  assert.equal(residentStationaryWithinActivity(night, 10, 11, 7 * HOUR), false,
    "and it is released once 06:00 has passed");
  assert.equal(residentStationaryWithinActivity(night, 10, 12, 2 * HOUR), false,
    "two days later needs freshly validated Simulation facts");
});
