import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder
} from 'discord.js';

export const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? 32768;

const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';
const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };

export function reminderCard(followup) {
  return decisionReminderCard(followup);
}

export function overdueCard(followup) {
  return buildFollowupCard(followup, `Overdue: ${followup.shortId}`, overdueDurationText(followup));
}

export function decisionReminderCard(followup, clientProfile = null) {
  const level = Math.min(Number(followup.reminderLevel ?? 0), 3);
  const title = level >= 3
    ? `Stalled loop: ${followup.shortId}`
    : level >= 2
      ? `Decision needed: ${followup.shortId}`
      : `Follow-up: ${followup.shortId}`;
  const nudge = level >= 3
    ? 'This loop is stalled. Decide now: reply, intentionally delay, wait on the client, or close it.'
    : level >= 2
      ? 'This needs a decision, not another vague later.'
      : 'Pick the next concrete action.';

  const details = [
    `**${nudge}**`,
    `**Client:** ${followup.client}`,
    `**Project:** ${followup.project}`,
    `**Context:** ${followup.context}`,
    `**Promised:** ${followup.promised || 'Not specified'}`,
    `**Status:** ${humanizeStatus(followup.status)}`,
    `**Priority:** ${followup.priority}`,
    `**Deadline:** ${formatDate(followup.deadline)}`,
    `**Last reminder:** ${formatDate(followup.lastReminderAt)}`,
    `**Next action:** ${humanizeStatus(followup.nextAction || 'decide_next_action')}`,
    clientProfile?.notes ? `**Client notes:** ${clientProfile.notes}` : ''
  ].filter(Boolean).join('\n');

  const container = baseContainer(title, details);
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(`draft_${followup.shortId}`, 'Reply Draft', ButtonStyle.Primary),
      button(`waiting_${followup.shortId}`, 'Waiting on Client', ButtonStyle.Success),
      button(`needinfo_${followup.shortId}`, 'Need Info', ButtonStyle.Secondary),
      button(`delay_${followup.shortId}`, 'Delay', ButtonStyle.Secondary),
      button(`pending_${followup.shortId}`, 'Still Pending', ButtonStyle.Secondary)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(`close_${followup.shortId}`, 'Close', ButtonStyle.Danger),
      button(`profile_${followup.shortId}`, 'Client Profile', ButtonStyle.Secondary)
    )
  );

  return { components: [container], flags: COMPONENTS_V2_FLAG };
}

export function inboxCard(followups) {
  const waiting = [...followups]
    .filter((followup) => followup.status === 'waiting_on_me')
    .sort(compareByPriorityThenDeadline);

  const body = waiting.length
    ? waiting.map((item) => [
      `**${item.shortId}** | ${item.client} | ${item.project}`,
      `${item.context}`,
      `Deadline: ${formatDate(item.deadline)} | Priority: ${item.priority}`
    ].join('\n')).join('\n\n')
    : 'No one is waiting on you right now.';

  return displayOnlyCard('Inbox', body);
}

export function allFollowupsCard(followups) {
  const open = followups.filter((followup) => followup.status !== 'closed');
  if (!open.length) {
    return displayOnlyCard('All Follow-ups', 'No open loops. Clean slate.');
  }

  const grouped = groupBy(open, (followup) => followup.status);
  const statusOrder = ['waiting_on_me', 'overdue', 'delayed', 'waiting_on_client'];
  const sections = statusOrder
    .filter((status) => grouped[status]?.length)
    .map((status) => {
      const lines = grouped[status]
        .sort(compareByPriorityThenDeadline)
        .map((item) => `**${item.shortId}** | ${item.client} | ${item.project} | ${item.status} | ${formatDate(item.deadline)}`);
      return `### ${humanizeStatus(status)}\n${lines.join('\n')}`;
    });

  return displayOnlyCard('All Follow-ups', sections.join('\n\n'));
}

export function dailyDigestCard(waiting, overdue) {
  return triageDigestCard(waiting, overdue, waiting.filter((followup) => Number(followup.reminderLevel ?? 0) >= 2));
}

export function triageDigestCard(waiting, overdue, stalled = []) {
  const waitingOnClient = waiting.filter((followup) => followup.status === 'waiting_on_client');
  const waitingOnYou = waiting.filter((followup) => followup.status === 'waiting_on_me');
  const needsDecision = waitingOnYou.filter((followup) => Number(followup.reminderLevel ?? 0) >= 2);
  const stalledIds = new Set(stalled.map((followup) => followup.shortId));
  const stalledItems = waitingOnYou.filter((followup) => stalledIds.has(followup.shortId) || Number(followup.reminderLevel ?? 0) >= 3);
  const sections = [
    section('Needs decision', needsDecision),
    section('Overdue', overdue),
    section('Waiting on you', waitingOnYou),
    section('Waiting on client', waitingOnClient),
    stalledItems.length ? section('Stalled', stalledItems) : ''
  ].filter(Boolean);
  const total = new Set([...waiting, ...overdue].map((followup) => followup.shortId)).size;

  return displayOnlyCard(
    'Triage Digest',
    sections.length
      ? `Open loops: **${total}**\n\n${sections.join('\n\n')}\n\n**${total} people need a clear next step.**`
      : 'No open loops need your attention.'
  );
}

export function legacyDailyDigestCard(waiting, overdue) {
  const open = [...waiting, ...overdue].sort(compareByPriorityThenDeadline);
  const list = open.length
    ? open.map((item) => `**${item.shortId}** | ${item.client} | ${item.project} | ${item.priority} | ${humanizeStatus(item.status)}`).join('\n')
    : 'No open loops need your attention.';

  const peopleWaiting = waiting.length + overdue.length;
  return displayOnlyCard(
    'Daily Digest',
    `Open loops: **${open.length}**\n\n${list}\n\n**${peopleWaiting} people waiting on you.**`
  );
}

export function clientProfileCard(clientProfile, followups) {
  const open = followups.filter((followup) => followup.status !== 'closed');
  const list = open.length
    ? open
      .sort(compareByPriorityThenDeadline)
      .map((item) => `**${item.shortId}** | ${item.project} | ${item.priority} | ${humanizeStatus(item.status)} | ${formatDate(item.deadline)}`)
      .join('\n')
    : 'No open loops for this client.';

  return displayOnlyCard('Client Profile', [
    `**Name:** ${clientProfile?.name || 'Unknown'}`,
    `**Preferred platform:** ${clientProfile?.preferredPlatform || 'discord'}`,
    `**Notes:** ${clientProfile?.notes || 'No notes yet.'}`,
    `**Last interaction:** ${clientProfile?.lastInteractionSummary || 'Not recorded.'}`,
    '',
    '**Open loops**',
    list
  ].join('\n'));
}

export function catchUpDigestCard(overdue) {
  const list = overdue.length
    ? overdue
      .sort(compareByPriorityThenDeadline)
      .map((item) => `**${item.shortId}** | ${item.client} | ${item.project} | ${item.priority} | ${humanizeStatus(item.status)}`)
      .join('\n')
    : 'No missed reminders found.';

  return displayOnlyCard(
    'Startup Catch-up',
    `Missed reminders marked overdue: **${overdue.length}**\n\n${list}`
  );
}

export function weeklyReportCard(stats) {
  const completionRate = stats.total > 0
    ? Math.round((stats.closed / stats.total) * 100)
    : 0;

  return displayOnlyCard('Weekly Report', [
    `Completion rate: **${completionRate}%**`,
    `Created: **${stats.total}**`,
    `Replied: **${stats.replied}**`,
    `Closed: **${stats.closed}**`,
    `Currently overdue: **${stats.overdue}**`,
    `Snoozed: **${stats.snoozed}**`,
    `Avg response: **${stats.avgResponseHours}h**`
  ].join('\n'));
}

export function helpCard() {
  return displayOnlyCard('FollowUp Bot Help', [
    'Track open client loops inside Discord DMs: who needs a reply, who is waiting on you, and what is overdue.',
    '',
    '**Core commands**',
    '`/followup add` - add a client loop',
    '`/followup list` - show all non-closed loops',
    '`/inbox` - show loops waiting on you',
    '`/overdue` - show overdue loops',
    '`/draft <id>` - generate a copyable client reply',
    '`/client show` - see client notes and open loops',
    '`/client note` - update client notes',
    '`/client platform` - update preferred platform',
    '`/replied <id>` - mark replied and waiting on client',
    '`/snooze <id>` - snooze for 1 hour',
    '`/delay <id> <deadline>` - intentionally delay',
    '`/close <id>` - close the loop',
    '`/help` - show this window',
    '',
    '**Deadline examples**',
    '`today 6pm`, `tomorrow 3pm`, `monday 10am`, `in 2 hours`, `eod`, `eow`',
    '',
    'Ping me with `@FollowUp` anytime to see this help window. Reminder cards now ask you to make a next-action decision instead of just poking you.'
  ].join('\n'));
}

export function snoozeWarningCard(followup) {
  const container = baseContainer(
    'Snooze Check',
    `You've snoozed ${followup.client} twice. Reply, intentionally delay, or close.`
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(`snooze_${followup.shortId}`, 'Last Snooze', ButtonStyle.Secondary, '⏰'),
      button(`delay_${followup.shortId}`, 'Delay', ButtonStyle.Primary, '🗓'),
      button(`close_${followup.shortId}`, 'Close', ButtonStyle.Danger, '❌')
    )
  );

  return { components: [container], flags: COMPONENTS_V2_FLAG };
}

function buildFollowupCard(followup, title, preface = '') {
  const details = [
    preface,
    `**Client:** ${followup.client}`,
    `**Project:** ${followup.project}`,
    `**Context:** ${followup.context}`,
    `**Promised:** ${followup.promised || 'Not specified'}`,
    `**Status:** ${humanizeStatus(followup.status)}`,
    `**Priority:** ${followup.priority}`,
    `**Deadline:** ${formatDate(followup.deadline)}`
  ].filter(Boolean).join('\n');

  const container = baseContainer(title, details);
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(`replied_${followup.shortId}`, 'Replied', ButtonStyle.Success, '✅'),
      button(`waiting_${followup.shortId}`, 'Waiting on Client', ButtonStyle.Primary, '⏳'),
      button(`pending_${followup.shortId}`, 'Still Pending', ButtonStyle.Secondary, '📌')
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(`tomorrow_${followup.shortId}`, 'Tomorrow', ButtonStyle.Secondary, '🕓'),
      button(`snooze_${followup.shortId}`, 'Snooze 1h', ButtonStyle.Secondary, '⏰'),
      button(`close_${followup.shortId}`, 'Close', ButtonStyle.Danger, '❌')
    )
  );

  return { components: [container], flags: COMPONENTS_V2_FLAG };
}

function displayOnlyCard(title, body) {
  const container = baseContainer(title, body);
  return { components: [container], flags: COMPONENTS_V2_FLAG };
}

function section(title, followups) {
  const unique = [...new Map(followups.map((followup) => [followup.shortId, followup])).values()];
  if (!unique.length) return '';
  const lines = unique
    .sort(compareByPriorityThenDeadline)
    .slice(0, 8)
    .map((item) => `**${item.shortId}** | ${item.client} | ${item.project} | ${item.priority} | ${humanizeStatus(item.nextAction || item.status)}`);
  return `### ${title}\n${lines.join('\n')}`;
}

function baseContainer(title, body) {
  return new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body.slice(0, 4000)));
}

function button(customId, label, style, emoji = null) {
  const builder = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);

  if (emoji) {
    builder.setEmoji(emoji);
  }

  return builder;
}

export function formatDate(value) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleString('en-IN', {
    timeZone: TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function overdueDurationText(followup) {
  const base = followup.deadline || followup.followUpAt;
  if (!base) return '**Overdue.**';
  const diffMs = Math.max(0, Date.now() - new Date(base).getTime());
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);

  if (days > 0) return `**Overdue by ${days} day${days === 1 ? '' : 's'}.**`;
  if (hours > 0) return `**Overdue by ${hours} hour${hours === 1 ? '' : 's'}.**`;
  const minutes = Math.max(1, Math.floor(diffMs / (60 * 1000)));
  return `**Overdue by ${minutes} minute${minutes === 1 ? '' : 's'}.**`;
}

function compareByPriorityThenDeadline(a, b) {
  const priorityDiff = (PRIORITY_WEIGHT[a.priority] ?? 1) - (PRIORITY_WEIGHT[b.priority] ?? 1);
  if (priorityDiff !== 0) return priorityDiff;
  return new Date(a.deadline || a.followUpAt || 8640000000000000)
    - new Date(b.deadline || b.followUpAt || 8640000000000000);
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});
}

function humanizeStatus(status) {
  return String(status || '').replaceAll('_', ' ');
}
