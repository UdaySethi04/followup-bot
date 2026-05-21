import { readFile, rename, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';

const STORE_PATH = new URL('./followups.json', import.meta.url);
const TMP_STORE_PATH = new URL('./followups.tmp.json', import.meta.url);

const EMPTY_STORE = {
  followups: [],
  clientCounters: {}
};

export async function loadStore() {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      followups: Array.isArray(parsed.followups) ? parsed.followups : [],
      clientCounters: parsed.clientCounters && typeof parsed.clientCounters === 'object'
        ? parsed.clientCounters
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

export async function addFollowup(fields) {
  const data = await loadStore();
  const now = new Date().toISOString();
  const shortId = generateShortId(fields.client, data);

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
