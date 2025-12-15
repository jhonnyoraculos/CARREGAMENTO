import Dexie, { Table } from "dexie";

export type User = {
  id?: number;
  name: string;
};

export type Trip = {
  id?: number;
  name: string;
  date?: string;
  truck?: string;
  driver?: string;
};

export type Slot = {
  id?: number;
  code: string;
};

export type PlannedVolume = {
  id?: number;
  tripId: number;
  volumeCode: string;
};

export type LoadEvent = {
  id?: number;
  tripId: number;
  volumeCode: string;
  slotCode: string;
  userId?: number;
  timestamp: string;
};

export class CarregamentoDB extends Dexie {
  users!: Table<User, number>;
  trips!: Table<Trip, number>;
  slots!: Table<Slot, number>;
  plannedVolumes!: Table<PlannedVolume, number>;
  loadEvents!: Table<LoadEvent, number>;

  constructor() {
    super("carregamento-pwa");
    this.version(1).stores({
      users: "++id, name",
      trips: "++id, name, date",
      slots: "++id, code",
      plannedVolumes: "++id, tripId, volumeCode",
      loadEvents: "++id, tripId, volumeCode, slotCode, userId, timestamp",
    });
  }
}

export const db = new CarregamentoDB();

export const ensureSeed = async () => {
  const users = await db.users.count();
  if (users === 0) {
    const userId = await db.users.add({ name: "Conferente" });
    await db.users.add({ name: "Motorista" });
    const tripId = await db.trips.add({
      name: "Viagem Demo",
      date: new Date().toISOString().slice(0, 10),
      truck: "Caminhão Demo",
      driver: "Fulano",
    });
    const slotCodes = ["A1", "A2", "A3", "B1", "B2"];
    await db.slots.bulkAdd(slotCodes.map((code) => ({ code })));
    const planned = ["VOL-001", "VOL-002", "VOL-003"];
    await db.plannedVolumes.bulkAdd(
      planned.map((volumeCode) => ({ tripId, volumeCode }))
    );
    await db.loadEvents.add({
      tripId,
      volumeCode: "VOL-001",
      slotCode: "A1",
      userId: Number(userId),
      timestamp: new Date().toISOString(),
    });
  }
};
