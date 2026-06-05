import cron from 'node-cron';
import { catchUpDigestCard, decisionReminderCard, triageDigestCard, weeklyReportCard } from './cards.js';
import { appendHistory, getAllFollowups, getClientProfile, updateFollowup } from './store.js';
import { generateWeeklyStats } from './report.js';

const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';
const REMINDER_INTERVAL_HOURS = Number(process.env.REMINDER_INTERVAL_HOURS || 3);
const REMINDER_INTERVAL_MS = REMINDER_INTERVAL_HOURS * 60 * 60 * 1000;
let schedulerStarted = false;
let lastDailyDigestMinuteKey = '';

export function startScheduler(client, userId) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  catchUpOnStart(client, userId);
  scheduleFollowUps(client, userId);
  scheduleDailyDigest(client, userId);
  scheduleWeeklyReport(client, userId);
}

export async function catchUpOnStart(client, userId) {
  const user = await client.users.fetch(userId);
  const now = Date.now();
  const followups = await getAllFollowups();
  const due = followups.filter((followup) =>
    followup.followUpAt &&
    new Date(followup.followUpAt).getTime() < now &&
    ['waiting_on_me', 'delayed'].includes(followup.status)
  );

  if (!due.length) return;

  const newlyOverdue = [];
  for (const followup of due) {
    const updated = await updateFollowup(followup.shortId, { status: 'overdue' });
    await appendHistory(followup.shortId, 'overdue', 'Marked overdue during startup catch-up.');
    newlyOverdue.push(updated);
  }

  await user.send(catchUpDigestCard(newlyOverdue));
}

export function scheduleFollowUps(client, userId) {
  cron.schedule('*/5 * * * *', async () => {
    const user = await client.users.fetch(userId);
    const now = Date.now();
    const followups = await getAllFollowups();
    const due = followups.filter((followup) =>
      followup.status === 'waiting_on_me' &&
      (
        isFollowupDue(followup, now) ||
        isRecurringReminderDue(followup, now)
      )
    );

    for (const followup of due) {
      const nextReminderLevel = Math.min(Number(followup.reminderLevel ?? 0) + 1, 3);
      const historyAction = nextReminderLevel >= 3 ? 'stalled' : 'decision_prompted';
      const updated = await updateFollowup(followup.shortId, {
        followUpAt: isFollowupDue(followup, now) ? null : followup.followUpAt,
        lastReminderAt: new Date(now).toISOString(),
        reminderLevel: nextReminderLevel,
        nextAction: nextReminderLevel >= 2 ? 'make_decision' : (followup.nextAction || 'decide_next_action')
      });
      await appendHistory(followup.shortId, historyAction, `Reminder level ${nextReminderLevel}.`);
      await user.send(decisionReminderCard(updated, await getClientProfile(updated.client)));
    }
  }, { timezone: TIMEZONE });
}

function isFollowupDue(followup, now) {
  return Boolean(followup.followUpAt && new Date(followup.followUpAt).getTime() <= now);
}

function isRecurringReminderDue(followup, now) {
  if (followup.followUpAt && new Date(followup.followUpAt).getTime() > now) {
    return false;
  }

  const lastReminderAt = followup.lastReminderAt || followup.lastTouchedAt || followup.createdAt;
  if (!lastReminderAt) return true;

  return now - new Date(lastReminderAt).getTime() >= REMINDER_INTERVAL_MS;
}

export function scheduleDailyDigest(client, userId) {
  const sendDigest = async () => {
    const minuteKey = getMinuteKey(new Date());
    if (lastDailyDigestMinuteKey === minuteKey) return;
    lastDailyDigestMinuteKey = minuteKey;

    const user = await client.users.fetch(userId);
    const followups = await getAllFollowups();
    const open = followups.filter((followup) => followup.status !== 'closed');
    const overdue = followups.filter((followup) => followup.status === 'overdue');
    const stalled = open.filter((followup) => Number(followup.reminderLevel ?? 0) >= 3);
    await user.send(triageDigestCard(open, overdue, stalled));
  };

  cron.schedule('0 9 * * *', sendDigest, { timezone: TIMEZONE });
  cron.schedule('0 15 * * *', sendDigest, { timezone: TIMEZONE });
  cron.schedule('0 19 * * *', sendDigest, { timezone: TIMEZONE });
}

function getMinuteKey(date) {
  return date.toISOString().slice(0, 16);
}

export function scheduleWeeklyReport(client, userId) {
  cron.schedule('0 20 * * 0', async () => {
    const user = await client.users.fetch(userId);
    const stats = await generateWeeklyStats();
    await user.send(weeklyReportCard(stats));
  }, { timezone: TIMEZONE });
}
