/** The only wall-clock boundary. All gameplay consumes the resulting fantasy tick. */
export const REAL_EPOCH_MS = Date.parse("2026-10-07T08:48:29Z");
export const TIME_SCALE = 24;
export const YEAR_OFFSET = 1900;
export const WORLD_TIMEZONE = "Europe/Istanbul";
export function fantasyOrigin(realMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WORLD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(realMs);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const date = new Date(0);
  date.setUTCFullYear(n("year") - YEAR_OFFSET, n("month") - 1, n("day"));
  date.setUTCHours(n("hour"), n("minute"), n("second"), 0);
  return date.getTime();
}
export class FantasyClock {
  readonly origin: number;
  readonly epoch: number;
  constructor(epoch = REAL_EPOCH_MS) {
    this.epoch = epoch;
    this.origin = fantasyOrigin(epoch);
  }
  tickAt(realMs: number): number {
    return Math.max(0, Math.floor(((realMs - this.epoch) / 1000) * TIME_SCALE));
  }
  dateAt(realMs: number): Date {
    return new Date(this.origin + this.tickAt(realMs) * 1000);
  }
  labelAt(realMs: number): string {
    const d = this.dateAt(realMs),
      pad = (n: number, width = 2) => String(n).padStart(width, "0");
    return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCFullYear(), 4)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
}

/**
 * Fantasy calendar shared by the HUD and the simulation. Tick 0 is the fantasy
 * origin (not midnight), so routines must use these helpers to agree with the
 * displayed Fantasy Time. Deterministic: derived from the fixed REAL_EPOCH_MS.
 */
export const FANTASY_DAY_SECONDS = 86_400;
const ORIGIN_SECONDS = Math.floor(fantasyOrigin(REAL_EPOCH_MS) / 1000),
  ORIGIN_SECOND_OF_DAY = ((ORIGIN_SECONDS % FANTASY_DAY_SECONDS) + FANTASY_DAY_SECONDS) % FANTASY_DAY_SECONDS,
  ORIGIN_DAY = Math.floor(ORIGIN_SECONDS / FANTASY_DAY_SECONDS);
/** Seconds since fantasy midnight shown by the HUD clock for a simulation tick. */
export function fantasySecondOfDay(tick: number) {
  return (((ORIGIN_SECOND_OF_DAY + tick) % FANTASY_DAY_SECONDS) + FANTASY_DAY_SECONDS) % FANTASY_DAY_SECONDS;
}
/** Absolute fantasy day number (calendar day since 1 Jan 1 of the fantasy calendar epoch). */
export function fantasyDayIndex(tick: number) {
  return ORIGIN_DAY + Math.floor((ORIGIN_SECOND_OF_DAY + tick) / FANTASY_DAY_SECONDS);
}
/** 0 = first workday … 6 = rest day of the seven-day fantasy week. */
export function fantasyWeekday(tick: number) {
  return ((fantasyDayIndex(tick) % 7) + 7) % 7;
}
/**
 * Simulation tick at which calendar day `day` (0 = the origin day) shows `secondOfDay` on the HUD clock.
 * Hours of day 0 before the origin time lie before tick 0, so use day >= 1 for a full calendar day.
 */
export function tickAtFantasyTime(day: number, secondOfDay: number) {
  return day * FANTASY_DAY_SECONDS + secondOfDay - ORIGIN_SECOND_OF_DAY;
}

/**
 * Local time zones. The global fantasy clock above is realm time (the one
 * authority for all settings). The world is split by longitude into 14 bands,
 * GMT+1 (far west) to GMT+14 (far east); a place's local time is realm time
 * plus its band's offset. Lighting and NPC routines use local time.
 */
export const TIME_ZONE_COUNT = 14;
/** Zone offset in hours (1-14) for a longitude in radians. */
export function timeZoneOffsetHours(lonRad: number) {
  const lon = ((lonRad + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return 1 + Math.min(TIME_ZONE_COUNT - 1, Math.floor(lon / (2 * Math.PI) * TIME_ZONE_COUNT));
}
/** Realm tick shifted by the local zone: feed it to the fantasy* helpers to get local day, weekday and second. */
export function localTick(tick: number, lonRad: number) {
  return tick + timeZoneOffsetHours(lonRad) * 3600;
}
export function localSecondOfDay(tick: number, lonRad: number) {
  return fantasySecondOfDay(localTick(tick, lonRad));
}
export function localDayIndex(tick: number, lonRad: number) {
  return fantasyDayIndex(localTick(tick, lonRad));
}
export function localWeekday(tick: number, lonRad: number) {
  return fantasyWeekday(localTick(tick, lonRad));
}
/** Realm tick at which a place's local clock shows `secondOfDay` on calendar day `day`. */
export function tickAtLocalTime(day: number, secondOfDay: number, lonRad: number) {
  return tickAtFantasyTime(day, secondOfDay) - timeZoneOffsetHours(lonRad) * 3600;
}
/** "HH:MM" for a second of the day. */
export function clockLabel(secondOfDay: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(secondOfDay / 3600))}:${pad(Math.floor((secondOfDay % 3600) / 60))}`;
}
