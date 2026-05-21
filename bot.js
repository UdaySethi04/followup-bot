import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';
import {
  allFollowupsCard,
  helpCard,
  inboxCard,
  overdueCard,
  reminderCard,
  snoozeWarningCard
} from './cards.js';
import { DEADLINE_PARSE_ERROR, parseDeadline, tomorrowAtNine } from './parser.js';
import { startScheduler } from './scheduler.js';
import {
  addFollowup,
  appendHistory,
  getAllFollowups,
  getFollowupById,
  updateFollowup
} from './store.js';

const { BOT_TOKEN, CLIENT_ID, YOUR_USER_ID } = process.env;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';

if (!BOT_TOKEN || !CLIENT_ID || !YOUR_USER_ID) {
  throw new Error('Missing BOT_TOKEN, CLIENT_ID, or YOUR_USER_ID. Copy .env.example to .env and fill it in.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder()
    .setName('followup')
    .setDescription('Manage client follow-ups')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add a client loop to track')
        .addStringOption((option) => option.setName('client').setDescription('Client name').setRequired(true))
        .addStringOption((option) => option.setName('project').setDescription('Project name').setRequired(true))
        .addStringOption((option) => option.setName('context').setDescription('What you owe or need to track').setRequired(true))
        .addStringOption((option) => option.setName('promised').setDescription('What you promised'))
        .addStringOption((option) => option.setName('deadline').setDescription('today 6pm, tomorrow 3pm, monday 10am, in 2 hours, eod, eow'))
        .addStringOption((option) =>
          option
            .setName('priority')
            .setDescription('Priority')
            .addChoices(
              { name: 'low', value: 'low' },
              { name: 'medium', value: 'medium' },
              { name: 'high', value: 'high' }
            )
        )
        .addStringOption((option) =>
          option
            .setName('platform')
            .setDescription('Where this loop started')
            .addChoices(
              { name: 'discord', value: 'discord' },
              { name: 'whatsapp', value: 'whatsapp' },
              { name: 'email', value: 'email' }
            )
        )
        .addStringOption((option) => option.setName('source_url').setDescription('Optional source URL'))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List all non-closed follow-ups')
    ),
  new SlashCommandBuilder()
    .setName('inbox')
    .setDescription('Show items waiting on you'),
  new SlashCommandBuilder()
    .setName('overdue')
    .setDescription('Show overdue follow-ups'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show FollowUp Bot commands and context'),
  new SlashCommandBuilder()
    .setName('replied')
    .setDescription('Mark a follow-up as waiting on the client')
    .addStringOption((option) => option.setName('id').setDescription('Short ID, e.g. DZG-01').setRequired(true)),
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close a follow-up')
    .addStringOption((option) => option.setName('id').setDescription('Short ID, e.g. DZG-01').setRequired(true)),
  new SlashCommandBuilder()
    .setName('snooze')
    .setDescription('Snooze a follow-up for one hour')
    .addStringOption((option) => option.setName('id').setDescription('Short ID, e.g. DZG-01').setRequired(true)),
  new SlashCommandBuilder()
    .setName('delay')
    .setDescription('Intentionally delay a follow-up')
    .addStringOption((option) => option.setName('id').setDescription('Short ID, e.g. DZG-01').setRequired(true))
    .addStringOption((option) => option.setName('deadline').setDescription('New deadline').setRequired(true))
].map((command) => command.toJSON());

client.once('ready', async () => {
  await registerCommands();
  console.log(`FollowUp Bot online as ${client.user.tag}`);
  startScheduler(client, YOUR_USER_ID);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.user.id !== YOUR_USER_ID) {
      await interaction.reply({ content: 'This is a single-user personal bot.', ephemeral: true });
      return;
    }

    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error(error);
    const payload = { content: 'Something went wrong. Check the bot console for details.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !client.user) return;
  if (!message.mentions.users.has(client.user.id)) return;

  if (message.author.id !== YOUR_USER_ID) {
    await message.reply('This is a single-user personal bot.');
    return;
  }

  await message.reply(helpCard());
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
}

async function handleCommand(interaction) {
  if (interaction.commandName === 'followup') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') {
      await handleAdd(interaction);
      return;
    }
    if (subcommand === 'list') {
      const followups = await getAllFollowups();
      await interaction.reply(allFollowupsCard(followups));
      return;
    }
  }

  if (interaction.commandName === 'inbox') {
    const followups = await getAllFollowups();
    await interaction.reply(inboxCard(followups));
    return;
  }

  if (interaction.commandName === 'overdue') {
    const overdue = (await getAllFollowups()).filter((followup) => followup.status === 'overdue');
    if (!overdue.length) {
      await interaction.reply({ content: 'No overdue follow-ups.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: `Sending ${overdue.length} overdue follow-up card(s) to your DM.`, ephemeral: true });
    for (const followup of overdue) {
      await interaction.user.send(overdueCard(followup));
    }
    return;
  }

  if (interaction.commandName === 'help') {
    await interaction.reply(helpCard());
    return;
  }

  if (interaction.commandName === 'replied') {
    await updateStatusCommand(interaction, 'waiting_on_client', 'replied', { snoozeCount: 0 });
    return;
  }

  if (interaction.commandName === 'close') {
    await updateStatusCommand(interaction, 'closed', 'closed', { snoozeCount: 0 });
    return;
  }

  if (interaction.commandName === 'snooze') {
    await handleSnoozeCommand(interaction);
    return;
  }

  if (interaction.commandName === 'delay') {
    await handleDelayCommand(interaction);
  }
}

async function handleAdd(interaction) {
  const rawDeadline = interaction.options.getString('deadline');
  const deadline = rawDeadline ? parseDeadline(rawDeadline, TIMEZONE) : null;

  if (rawDeadline && !deadline) {
    await interaction.reply({ content: DEADLINE_PARSE_ERROR, ephemeral: true });
    return;
  }

  const followup = await addFollowup({
    client: interaction.options.getString('client', true),
    project: interaction.options.getString('project', true),
    context: interaction.options.getString('context', true),
    promised: interaction.options.getString('promised') ?? '',
    deadline,
    followUpAt: deadline,
    priority: interaction.options.getString('priority') ?? 'medium',
    platform: interaction.options.getString('platform') ?? 'discord',
    sourceUrl: interaction.options.getString('source_url') ?? ''
  });

  await interaction.user.send(reminderCard(followup));
  await interaction.reply({ content: `Added follow-up ${followup.shortId} and sent the card to your DM.`, ephemeral: true });
}

async function updateStatusCommand(interaction, status, historyAction, extraChanges = {}) {
  const shortId = interaction.options.getString('id', true);
  const followup = await getFollowupOrReply(interaction, shortId);
  if (!followup) return;

  const updated = await updateFollowup(shortId, { status, followUpAt: null, ...extraChanges });
  await appendHistory(shortId, historyAction);
  await interaction.reply({ content: `${updated.shortId} marked ${status.replaceAll('_', ' ')}.`, ephemeral: true });
}

async function handleSnoozeCommand(interaction) {
  const shortId = interaction.options.getString('id', true);
  const followup = await getFollowupOrReply(interaction, shortId);
  if (!followup) return;

  const result = await snoozeFollowup(followup);
  if (result.warning) {
    await interaction.reply(snoozeWarningCard(result.followup));
    return;
  }

  await interaction.reply({ content: `${result.followup.shortId} snoozed for 1 hour.`, ephemeral: true });
}

async function handleDelayCommand(interaction) {
  const shortId = interaction.options.getString('id', true);
  const rawDeadline = interaction.options.getString('deadline', true);
  const deadline = parseDeadline(rawDeadline, TIMEZONE);

  if (!deadline) {
    await interaction.reply({ content: DEADLINE_PARSE_ERROR, ephemeral: true });
    return;
  }

  const followup = await getFollowupOrReply(interaction, shortId);
  if (!followup) return;

  const updated = await updateFollowup(shortId, {
    status: 'delayed',
    deadline,
    followUpAt: deadline,
    snoozeCount: 0
  });
  await appendHistory(shortId, 'delayed', `Delayed until ${rawDeadline}.`);
  await interaction.reply({ content: `${updated.shortId} delayed intentionally.`, ephemeral: true });
}

async function handleButton(interaction) {
  const { action, shortId } = parseCustomId(interaction.customId);
  const followup = await getFollowupOrReply(interaction, shortId);
  if (!followup) return;

  if (action === 'delay') {
    await interaction.reply({
      content: `Use /delay id:${shortId} deadline:<new deadline> to intentionally delay this loop.`,
      ephemeral: true
    });
    return;
  }

  let updated;
  if (action === 'replied') {
    updated = await updateFollowup(shortId, { status: 'waiting_on_client', followUpAt: null, snoozeCount: 0 });
    await appendHistory(shortId, 'replied');
  } else if (action === 'waiting') {
    updated = await updateFollowup(shortId, { status: 'waiting_on_client', followUpAt: null, snoozeCount: 0 });
    await appendHistory(shortId, 'waiting_on_client');
  } else if (action === 'pending') {
    updated = await updateFollowup(shortId, { status: 'waiting_on_me' });
    await appendHistory(shortId, 'still_pending');
  } else if (action === 'tomorrow') {
    updated = await updateFollowup(shortId, { followUpAt: tomorrowAtNine(TIMEZONE) });
    await appendHistory(shortId, 'snoozed_tomorrow');
  } else if (action === 'snooze') {
    const result = await snoozeFollowup(followup);
    if (result.warning) {
      await interaction.update(snoozeWarningCard(result.followup));
      return;
    }
    updated = result.followup;
  } else if (action === 'close') {
    updated = await updateFollowup(shortId, { status: 'closed', followUpAt: null, snoozeCount: 0 });
    await appendHistory(shortId, 'closed');
  } else {
    await interaction.reply({ content: 'Unknown button action.', ephemeral: true });
    return;
  }

  await interaction.update(reminderCard(updated));
}

async function snoozeFollowup(followup) {
  const nextCount = (followup.snoozeCount ?? 0) + 1;
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  if (nextCount >= 2 && !followup.snoozeReason) {
    const warned = await updateFollowup(followup.shortId, {
      snoozeCount: nextCount,
      snoozeReason: 'warned'
    });
    await appendHistory(followup.shortId, 'snoozed', 'Second snooze requested; warning shown.');
    return { followup: warned, warning: true };
  }

  const updated = await updateFollowup(followup.shortId, {
    snoozeCount: nextCount,
    snoozeReason: '',
    followUpAt: oneHourFromNow
  });
  await appendHistory(followup.shortId, 'snoozed', 'Snoozed for 1 hour.');
  return { followup: updated, warning: false };
}

async function getFollowupOrReply(interaction, shortId) {
  const followup = await getFollowupById(shortId);
  if (!followup) {
    await interaction.reply({ content: `No follow-up found with ID ${shortId}.`, ephemeral: true });
  }
  return followup;
}

function parseCustomId(customId) {
  const [action, ...idParts] = customId.split('_');
  return { action, shortId: idParts.join('_') };
}

client.login(BOT_TOKEN);
