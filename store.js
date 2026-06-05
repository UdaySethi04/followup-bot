import { readFile, rename, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';

const STORE_PATH = new URL('./followups.json', import.meta.url);
const TMP_STORE_PATH = new URL('./followups.tmp.json', import.meta.url);

const EMPTY_STORE = {
  followups: [],
  clientCounters: {},
  clients: {}
};

export async function loadStore() {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      followups: Array.isArray(parsed.followups) ? parsed.followups : [],
      clientCounters: parsed.clientCounters && typeof parsed.clientCounters === 'object'
        ? parsed.clientCounters
        : {},
      clients: parsed.clients && typeof parsed.clients === 'object'
        ? parsed.clients
        : {}
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      await saveStore(EMPTY_STORE);
      return structuredClone(EMPTY_STORE);
    }
    throw error;
  }
}

export async function saveStore(data) {
  const payload = JSON.stringify(data, null, 2);
  await writeFile(TMP_STORE_PATH, `${payload}\n`, 'utf8');
  await rename(TMP_STORE_PATH, STORE_PATH);
}

export async function getAllFollowups() {
  const data = await loadStore();
  return data.followups;
}

export async function getFollowupById(shortId) {
  const data = await loadStore();
  const normalized = String(shortId || '').trim().toUpperCase();
  return data.followups.find((followup) => followup.shortId.toUpperCase() === normalized) ?? null;
}

export async function getClientProfile(clientName) {
  const data = await loadStore();
  const key = normalizeClientKey(clientName);
  return data.clients[key] ?? null;
}

export async function getFollowupsByClient(clientName) {
  const data = await loadStore();
  const key = normalizeClientKey(clientName);
  return data.followups.filter((followup) => normalizeClientKey(followup.client) === key);
}

export async function upsertClientProfile(clientName, changes = {}) {
  const data = await loadStore();
  const now = new Date().toISOString();
  const key = normalizeClientKey(clientName);
  const existing = data.clients[key] ?? {
    name: clientName,
    preferredPlatform: changes.preferredPlatform ?? 'discord',
    notes: '',
    lastInteractionSummary: '',
    createdAt: now,
    updatedAt: now
  };

  data.clients[key] = {
    ...existing,
    ...changes,
    name: changes.name ?? existing.name ?? clientName,
    updatedAt: now
  };

  await saveStore(data);
  return data.clients[key];
}

export async function addFollowup(fields) {
  const data = await loadStore();
  const now = new Date().toISOString();
  const shortId = generateShortId(fields.client, data);
  const clientKey = normalizeClientKey(fields.client);

  if (!data.clients[clientKey]) {
    data.clients[clientKey] = {
      name: fields.client,
      preferredPlatform: fields.platform ?? 'discord',
      notes: '',
      lastInteractionSummary: fields.context ?? '',
      createdAt: now,
      updatedAt: now
    };
  } else {
    data.clients[clientKey] = {
      ...data.clients[clientKey],
      preferredPlatform: data.clients[clientKey].preferredPlatform || fields.platform || 'discord',
      lastInteractionSummary: fields.context ?? data.clients[clientKey].lastInteractionSummary ?? '',
      updatedAt: now
    };
  }

  const followup = {
    id: randomUUID?.() ?? nanoid(),
    shortId,
    client: fields.client,
    project: fields.project,
    platform: fields.platform ?? 'discord',
    context: fields.context,
    promised: fields.promised ?? '',
    sourceUrl: fields.sourceUrl ?? '',
    priority: fields.priority ?? 'medium',
    status: fields.status ?? 'waiting_on_me',
    snoozeCount: fields.snoozeCount ?? 0,
    snoozeReason: fields.snoozeReason ?? '',
    reminderLevel: fields.reminderLevel ?? 0,
    blocker: fields.blocker ?? '',
    delayReason: fields.delayReason ?? '',
    nextAction: fields.nextAction ?? 'decide_next_action',
    lastReminderAt: fields.lastReminderAt ?? null,
    followUpAt: fields.followUpAt ?? fields.deadline ?? null,
    deadline: fields.deadline ?? null,
    lastTouchedAt: now,
    createdAt: now,
    updatedAt: now,
    history: []
  };

  data.followups.push(followup);
  await saveStore(data);
  return followup;
}

export async function updateFollowup(shortId, changes) {
  const data = await loadStore();
  const normalized = String(shortId || '').trim().toUpperCase();
  const index = data.followups.findIndex((followup) => followup.shortId.toUpperCase() === normalized);

  if (index === -1) {
    return null;
  }

  const now = new Date().toISOString();
  data.followups[index] = {
    ...data.followups[index],
    ...changes,
    updatedAt: now,
    lastTouchedAt: now
  };

  await saveStore(data);
  return data.followups[index];
}

export async function appendHistory(shortId, action, note = '') {
  const data = await loadStore();
  const normalized = String(shortId || '').trim().toUpperCase();
  const followup = data.followups.find((item) => item.shortId.toUpperCase() === normalized);

  if (!followup) {
    return null;
  }

  followup.history = Array.isArray(followup.history) ? followup.history : [];
  followup.history.push({
    action,
    at: new Date().toISOString(),
    note
  });

  await saveStore(data);
  return followup;
}

export async function recordDecision(shortId, decision, changes = {}, note = '') {
  const data = await loadStore();
  const normalized = String(shortId || '').trim().toUpperCase();
  const followup = data.followups.find((item) => item.shortId.toUpperCase() === normalized);

  if (!followup) {
    return null;
  }

  const now = new Date().toISOString();
  followup.history = Array.isArray(followup.history) ? followup.history : [];
  Object.assign(followup, changes, {
    nextAction: changes.nextAction ?? decision,
    updatedAt: now,
    lastTouchedAt: now
  });
  followup.history.push({
    action: decision,
    at: now,
    note
  });

  await saveStore(data);
  return followup;
}

export function generateShortId(clientName, data) {
  const store = data ?? EMPTY_STORE;
  const letters = String(clientName || 'XXX')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X');

  const nextCounter = (store.clientCounters[letters] ?? 0) + 1;
  store.clientCounters[letters] = nextCounter;
  return `${letters}-${String(nextCounter).padStart(2, '0')}`;
}

export function normalizeClientKey(clientName) {
  return String(clientName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
