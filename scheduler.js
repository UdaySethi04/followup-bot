import cron from 'node-cron';
import { dailyDigestCard, reminderCard, weeklyReportCard } from './cards.js';
import { appendHistory, getAllFollowups, updateFollowup } from './store.js';
import { generateWeeklyStats } from './report.js';

const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';

export function startScheduler(client, userId) {
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

  await user.send(dailyDigestCard([], newlyOverdue));
}

export function scheduleFollowUps(client, userId) {
  cron.schedule('*/5 * * * *', async () => {
    const user = await client.users.fetch(userId);
    const now = Date.now();
    const followups = await getAllFollowups();
    const due = followups.filter((followup) =>
      followup.followUpAt &&
      new Date(followup.followUpAt).getTime() <= now &&
      followup.status === 'waiting_on_me'
    );

    for (const followup of due) {
      await user.send(reminderCard(followup));
      await updateFollowup(followup.shortId, { followUpAt: null });
    }
  }, { timezone: TIMEZONE });
}

export function scheduleDailyDigest(client, userId) {
  const sendDigest = async () => {
    const user = await client.users.fetch(userId);
    const followups = await getAllFollowups();
    const waiting = followups.filter((followup) => followup.status === 'waiting_on_me');
    const overdue = followups.filter((followup) => followup.status === 'overdue');
    await user.send(dailyDigestCard(waiting, overdue));
  };

  cron.schedule('0 9 * * *', sendDigest, { timezone: TIMEZONE });
  cron.schedule('0 15 * * *', sendDigest, { timezone: TIMEZONE });
  cron.schedule('0 19 * * *', sendDigest, { timezone: TIMEZONE });
}

export function scheduleWeeklyReport(client, userId) {
  cron.schedule('0 20 * * 0', async () => {
    const user = await client.users.fetch(userId);
    const stats = await generateWeeklyStats();
    await user.send(weeklyReportCard(stats));
  }, { timezone: TIMEZONE });
}
