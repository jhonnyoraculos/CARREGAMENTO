import { db, LoadEvent, PlannedVolume, Slot, Trip, User } from "./db";

const normalize = (value: string) => value.trim().toUpperCase();

export const listUsers = () => db.users.orderBy("name").toArray();

export const createUser = (name: string) =>
  db.users.add({ name: name.trim() }).then((id) => ({ id, name: name.trim() }));

export const listTrips = () => db.trips.orderBy("date").reverse().toArray();

export const createTrip = (payload: Trip) =>
  db.trips.add(payload).then((id) => ({ ...payload, id }));

export const listSlots = () => db.slots.orderBy("code").toArray();

export const addSlot = (code: string) =>
  db.slots.add({ code: normalize(code) }).then((id) => ({ id, code: normalize(code) }));

export const addSlotsBulk = async (input: string) => {
  const codes = input
    .split(/[\s,;]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map(normalize);
  await db.slots.bulkAdd(codes.map((code) => ({ code })));
};

export const listPlanned = (tripId: number) =>
  db.plannedVolumes.where({ tripId }).sortBy("volumeCode");

export const addPlanned = (tripId: number, volumeCode: string) =>
  db.plannedVolumes
    .add({ tripId, volumeCode: normalize(volumeCode) })
    .then((id) => ({ id, tripId, volumeCode: normalize(volumeCode) }));

export const addPlannedBulk = async (tripId: number, input: string) => {
  const codes = input
    .split(/[\s,;]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .map(normalize);
  await db.plannedVolumes.bulkAdd(
    codes.map((volumeCode) => ({ tripId, volumeCode }))
  );
};

export const recordEvent = async (params: {
  tripId: number;
  volumeCode: string;
  slotCode: string;
  userId?: number;
}) => {
  const timestamp = new Date().toISOString();
  const payload: LoadEvent = {
    tripId: params.tripId,
    volumeCode: normalize(params.volumeCode),
    slotCode: normalize(params.slotCode),
    userId: params.userId,
    timestamp,
  };
  const id = await db.loadEvents.add(payload);
  return { ...payload, id };
};

export const getHistory = (tripId: number, volumeCode: string) =>
  db.loadEvents
    .where({ tripId, volumeCode: normalize(volumeCode) })
    .reverse()
    .sortBy("timestamp");

export const getCurrentPlacement = async (tripId: number, volumeCode: string) => {
  const history = await getHistory(tripId, volumeCode);
  return history[0];
};

export const getVolumeStatus = async (tripId: number, volumeCode: string) => {
  const normalized = normalize(volumeCode);
  const history = await db.loadEvents
    .where({ tripId, volumeCode: normalized })
    .reverse()
    .sortBy("timestamp");
  const planned = await db.plannedVolumes
    .where({ tripId, volumeCode: normalized })
    .count();
  return {
    loaded: history.length > 0,
    slotCode: history[0]?.slotCode,
    history,
    planned: planned > 0,
    duplicateEvents: history.length,
  };
};

export const getTripSummary = async (tripId: number) => {
  const planned = await db.plannedVolumes.where({ tripId }).toArray();
  const loaded = await db.loadEvents.where({ tripId }).toArray();
  const uniqueLoaded = Array.from(new Set(loaded.map((l) => l.volumeCode)));
  const missing = planned
    .map((p) => p.volumeCode)
    .filter((code) => !uniqueLoaded.includes(code));
  const duplicatesMap = loaded.reduce<Record<string, number>>((acc, ev) => {
    acc[ev.volumeCode] = (acc[ev.volumeCode] || 0) + 1;
    return acc;
  }, {});
  const duplicates = Object.entries(duplicatesMap)
    .filter(([, count]) => count > 1)
    .map(([volumeCode, events]) => ({ volumeCode, events }));
  const notPlanned = uniqueLoaded.filter(
    (code) => !planned.find((p) => p.volumeCode === code)
  );
  return {
    plannedTotal: planned.length,
    loadedTotal: uniqueLoaded.length,
    missing,
    duplicates,
    notPlanned,
  };
};
