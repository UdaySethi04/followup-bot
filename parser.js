const DEFAULT_TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const DEADLINE_PARSE_ERROR =
  "Couldn't parse deadline. Try: today 6pm, tomorrow 3pm, monday 10am, in 2 hours, eod, eow";

export function parseDeadline(str, timezone = DEFAULT_TIMEZONE) {
  if (!str || !String(str).trim()) {
    return null;
  }

  const input = String(str).trim().toLowerCase();
  const now = new Date();
  const nowParts = getZonedParts(now, timezone);

  const relativeMatch = input.match(/^in\s+(\d+)\s*(hour|hours|hr|hrs|minute|minutes|min|mins)$/);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    const ms = unit.startsWith('hour') || unit.startsWith('hr')
      ? amount * 60 * 60 * 1000
      : amount * 60 * 1000;
    return new Date(now.getTime() + ms).toISOString();
  }

  if (input === 'eod' || input === 'end of day') {
    return zonedDateToUtcIso(nowParts.year, nowParts.month, nowParts.day, 18, 0, timezone);
  }

  if (input === 'eow' || input === 'end of week') {
    const daysUntilFriday = (5 - nowParts.weekday + 7) % 7;
    const target = addDaysInZone(nowParts, daysUntilFriday);
    return zonedDateToUtcIso(target.year, target.month, target.day, 18, 0, timezone);
  }

  const todayMatch = input.match(/^today(?:\s+(.+))?$/);
  if (todayMatch) {
    const parsedTime = parseTime(todayMatch[1] || '9am');
    if (!parsedTime) return null;
    return zonedDateToUtcIso(nowParts.year, nowParts.month, nowParts.day, parsedTime.hour, parsedTime.minute, timezone);
  }

  const tomorrowMatch = input.match(/^tomorrow(?:\s+(.+))?$/);
  if (tomorrowMatch) {
    const parsedTime = parseTime(tomorrowMatch[1] || '9am');
    if (!parsedTime) return null;
    const target = addDaysInZone(nowParts, 1);
    return zonedDateToUtcIso(target.year, target.month, target.day, parsedTime.hour, parsedTime.minute, timezone);
  }

  const weekdayMatch = input.match(/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(.+))?$/);
  if (weekdayMatch) {
    const targetWeekday = WEEKDAYS.indexOf(weekdayMatch[1]);
    let daysUntilTarget = (targetWeekday - nowParts.weekday + 7) % 7;
    if (daysUntilTarget === 0) daysUntilTarget = 7;
    const parsedTime = parseTime(weekdayMatch[2] || '9am');
    if (!parsedTime) return null;
    const target = addDaysInZone(nowParts, daysUntilTarget);
    return zonedDateToUtcIso(target.year, target.month, target.day, parsedTime.hour, parsedTime.minute, timezone);
  }

  return null;
}

export function tomorrowAtNine(timezone = DEFAULT_TIMEZONE) {
  const parts = getZonedParts(new Date(), timezone);
  const tomorrow = addDaysInZone(parts, 1);
  return zonedDateToUtcIso(tomorrow.year, tomorrow.month, tomorrow.day, 9, 0, timezone);
}

function parseTime(raw) {
  const value = String(raw || '').trim().toLowerCase();
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3];

  if (minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return { hour, minute };
}

function getZonedParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday.toLowerCase())
  };
}

function addDaysInZone(parts, days) {
  const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return getZonedParts(noonUtc, 'UTC');
}

function zonedDateToUtcIso(year, month, day, hour, minute, timezone) {
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedParts(utc, timezone);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
    utc = new Date(utc.getTime() + wanted - actual);
  }

  return utc.toISOString();
}
