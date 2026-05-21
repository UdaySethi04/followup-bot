import { getAllFollowups } from './store.js';

export async function generateWeeklyStats() {
  const followups = await getAllFollowups();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const recentFollowups = followups.filter((followup) => new Date(followup.createdAt).getTime() >= cutoff);
  const recentHistory = followups.flatMap((followup) =>
    (followup.history || [])
      .filter((entry) => new Date(entry.at).getTime() >= cutoff)
      .map((entry) => ({ ...entry, followup }))
  );

  const responseDurations = followups
    .map((followup) => {
      const firstReply = (followup.history || [])
        .filter((entry) => entry.action === 'replied')
        .sort((a, b) => new Date(a.at) - new Date(b.at))[0];

      if (!firstReply || !followup.createdAt) return null;
      return new Date(firstReply.at).getTime() - new Date(followup.createdAt).getTime();
    })
    .filter((duration) => Number.isFinite(duration) && duration >= 0);

  const avgResponseHours = responseDurations.length
    ? Number((responseDurations.reduce((sum, duration) => sum + duration, 0) / responseDurations.length / 3600000).toFixed(1))
    : 0;

  return {
    total: recentFollowups.length,
    replied: recentHistory.filter((entry) => entry.action === 'replied').length,
    closed: recentHistory.filter((entry) => entry.action === 'closed').length,
    overdue: followups.filter((followup) => followup.status === 'overdue').length,
    snoozed: recentHistory.filter((entry) => entry.action === 'snoozed').length,
    avgResponseHours
  };
}
