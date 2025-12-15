"use client";

import { useEffect, useMemo, useState } from "react";
import { toDataURL } from "qrcode";
import {
  addPlanned,
  addPlannedBulk,
  addSlot,
  addSlotsBulk,
  createTrip,
  createUser,
  getHistory,
  getTripSummary,
  getVolumeStatus,
  listPlanned,
  listSlots,
  listTrips,
  listUsers,
  recordEvent,
} from "../lib/services";
import { ensureSeed, LoadEvent, PlannedVolume, Slot, Trip, User } from "../lib/db";
import ServiceWorkerRegister from "../components/ServiceWorkerRegister";
import QrScanner from "../components/QrScanner";

type VolumeStatus = Awaited<ReturnType<typeof getVolumeStatus>>;
type Summary = Awaited<ReturnType<typeof getTripSummary>>;

export default function Home() {
  const [users, setUsers] = useState<User[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [planned, setPlanned] = useState<PlannedVolume[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentTrip, setCurrentTrip] = useState<Trip | null>(null);
  const [plannedInput, setPlannedInput] = useState("");
  const [volumeInput, setVolumeInput] = useState("");
  const [slotInput, setSlotInput] = useState("");
  const [consultInput, setConsultInput] = useState("");
  const [status, setStatus] = useState<VolumeStatus | null>(null);
  const [history, setHistory] = useState<LoadEvent[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState("");
  const [scanTarget, setScanTarget] = useState<"volume" | "slot" | null>(null);
  const [lanLink, setLanLink] = useState<string>("http://SEU_IP:3000");
  const [qrVolumeInput, setQrVolumeInput] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrLabel, setQrLabel] = useState("");

  const normalize = (v: string) => v.trim().toUpperCase();

  const loadPlanned = async (tripId: number) => {
    const data = await listPlanned(tripId);
    setPlanned(data);
  };

  const loadSummary = async (tripId: number) => {
    const data = await getTripSummary(tripId);
    setSummary(data);
  };

  const loadAll = async () => {
    await ensureSeed();
    const [u, t, s] = await Promise.all([listUsers(), listTrips(), listSlots()]);
    setUsers(u);
    setTrips(t);
    setSlots(s);
    if (!currentUser && u.length) setCurrentUser(u[0]);
    if (!currentTrip && t.length) {
      setCurrentTrip(t[0]);
      loadPlanned(t[0].id!);
      loadSummary(t[0].id!);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    setLanLink(`${window.location.protocol}//${host}:${window.location.port || "3000"}`);
  }, []);

  const handleAddUser = async (name: string) => {
    if (!name.trim()) return;
    const user = await createUser(name);
    setUsers(await listUsers());
    setCurrentUser(user);
  };

  const handleAddTrip = async (payload: Trip) => {
    const trip = await createTrip(payload);
    setTrips(await listTrips());
    setCurrentTrip(trip);
    loadPlanned(trip.id!);
    loadSummary(trip.id!);
  };

  const handleAddSlot = async (code: string) => {
    if (!code.trim()) return;
    await addSlot(code);
    setSlots(await listSlots());
    setSlotInput("");
  };

  const handleAddPlanned = async (code: string) => {
    if (!currentTrip || !code.trim()) return;
    await addPlanned(currentTrip.id!, code);
    loadPlanned(currentTrip.id!);
    setPlannedInput("");
  };

  const handleRecord = async () => {
    if (!currentTrip || !currentUser) {
      setMessage("Selecione usuario e viagem.");
      return;
    }
    if (!volumeInput.trim() || !slotInput.trim()) {
      setMessage("Preencha/escaneie volume e slot.");
      return;
    }
    await recordEvent({
      tripId: currentTrip.id!,
      volumeCode: volumeInput,
      slotCode: slotInput,
      userId: currentUser.id,
    });
    setMessage(
      `Salvo ${normalize(volumeInput)} em ${normalize(slotInput)} - ${new Date().toLocaleTimeString()}`
    );
    setVolumeInput("");
    setSlotInput("");
    loadSummary(currentTrip.id!);
  };

  const handleConsult = async (value: string) => {
    if (!currentTrip) return;
    if (!value.trim()) return;
    const st = await getVolumeStatus(currentTrip.id!, value);
    const hist = await getHistory(currentTrip.id!, value);
    setStatus(st);
    setHistory(hist);
  };

  const handleGenerateQr = async () => {
    if (!currentTrip) {
      setMessage("Selecione uma viagem primeiro.");
      return;
    }
    if (!qrVolumeInput.trim()) {
      setMessage("Digite o volume para gerar o QR.");
      return;
    }
    const code = qrVolumeInput.trim().toUpperCase();
    await addPlanned(currentTrip.id!, code);
    await loadPlanned(currentTrip.id!);
    const img = await toDataURL(code, { width: 260, margin: 1 });
    setQrImage(img);
    setQrLabel(code);
    setMessage(`QR gerado para ${code}. Salve/imprima e cole no volume.`);
  };

  const actionLabel = useMemo(() => {
    if (!currentTrip) return "Selecione viagem";
    return `Viagem: ${currentTrip.name}`;
  }, [currentTrip]);

  return (
    <div className="container">
      <ServiceWorkerRegister />
      <h1 className="title">PWA Conferencia de Carregamento</h1>
      <p className="muted">
        Funciona offline com IndexedDB. Escaneie QR ou digite volume/slot. Cenario: criar volume, gerar QR, colar no
        volume e depois bipar com o slot do caminhao.
      </p>

      <div className="card">
        <strong>Abrir no celular (mesma rede Wi-Fi)</strong>
        <p className="muted">
          PC e celular precisam estar na mesma rede. Libere porta 3000/443 no firewall. Copie/acesse:
        </p>
        <div className="row">
          <a className="btn secondary" href={lanLink} target="_blank">
            {lanLink}
          </a>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(lanLink)}>
            Copiar link
          </button>
        </div>
      </div>

      <div className="card">
        <strong>Usuario</strong>
        <div className="row">
          <select
            className="input"
            value={currentUser?.id ?? ""}
            onChange={(e) => {
              const user = users.find((u) => u.id === Number(e.target.value));
              setCurrentUser(user ?? null);
            }}
          >
            <option value="">Selecione</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Novo usuario"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddUser((e.target as HTMLInputElement).value);
            }}
          />
          <button
            className="btn"
            onClick={() => {
              const input = prompt("Nome do usuario");
              if (input) handleAddUser(input);
            }}
          >
            Criar
          </button>
        </div>
      </div>

      <div className="card">
        <strong>Viagem</strong>
        <p className="muted">{actionLabel}</p>
        <div className="row">
          <select
            className="input"
            value={currentTrip?.id ?? ""}
            onChange={(e) => {
              const trip = trips.find((t) => t.id === Number(e.target.value));
              setCurrentTrip(trip ?? null);
              if (trip?.id) {
                loadPlanned(trip.id);
                loadSummary(trip.id);
              }
            }}
          >
            <option value="">Selecione</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={() => {
              const name = prompt("Nome da viagem (ex: data + caminhao)");
              if (!name) return;
              handleAddTrip({ name, date: new Date().toISOString().slice(0, 10) });
            }}
          >
            Criar viagem
          </button>
        </div>
      </div>

      <div className="card">
        <strong>Slots do caminhao</strong>
        <div className="row">
          <input
            className="input"
            placeholder="Codigo do slot (ex: A1)"
            value={slotInput}
            onChange={(e) => setSlotInput(e.target.value.toUpperCase())}
          />
          <button className="btn secondary" onClick={() => handleAddSlot(slotInput)}>
            Salvar slot
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              const bulk = prompt("Varios slots (separe por espaco ou quebra de linha)");
              if (bulk) addSlotsBulk(bulk).then(() => listSlots().then(setSlots));
            }}
          >
            Adicionar lista
          </button>
        </div>
        <div>
          {slots.map((s) => (
            <span key={s.id} className="tag">
              {s.code}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <strong>Volumes planejados da viagem</strong>
        <div className="row">
          <input
            className="input"
            placeholder="Volume"
            onChange={(e) => setPlannedInput(e.target.value.toUpperCase())}
            value={plannedInput}
          />
          <button className="btn secondary" onClick={() => handleAddPlanned(plannedInput)}>
            Salvar volume
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              if (!currentTrip) return;
              const bulk = prompt("Volumes (separe por espaco ou quebra de linha)");
              if (bulk) addPlannedBulk(currentTrip.id!, bulk).then(() => loadPlanned(currentTrip.id!));
            }}
          >
            Adicionar lista
          </button>
        </div>
        <div>
          {planned.map((p) => (
            <span key={p.id} className="tag">
              {p.volumeCode}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <strong>Criar volume e gerar QR</strong>
        <p className="muted">Cria o volume na viagem e gera o QR para imprimir/colar no produto.</p>
        <div className="row">
          <input
            className="input"
            placeholder="Volume (ex: VOL-123)"
            value={qrVolumeInput}
            onChange={(e) => setQrVolumeInput(e.target.value.toUpperCase())}
          />
          <button className="btn" onClick={handleGenerateQr}>
            Criar volume + QR
          </button>
        </div>
        {qrImage && (
          <div style={{ marginTop: 10, textAlign: "center" }}>
            <img src={qrImage} alt="QR do volume" width={200} height={200} />
            <div className="muted">{qrLabel}</div>
            <div className="muted">Clique com botao direito para salvar/imprimir.</div>
          </div>
        )}
      </div>

      <div className="card">
        <strong>Carregamento (scan ou digitar)</strong>
        <p className="muted">Primeiro volume, depois slot. Se camera bloquear, digite manualmente.</p>
        <div className="row">
          <input
            className="input"
            placeholder="Volume ID"
            value={volumeInput}
            onChange={(e) => setVolumeInput(e.target.value.toUpperCase())}
          />
          <input
            className="input"
            placeholder="Slot code"
            value={slotInput}
            onChange={(e) => setSlotInput(e.target.value.toUpperCase())}
          />
        </div>
        <div className="row">
          <button className="btn" onClick={() => setScanTarget("volume")}>
            Escanear VOLUME
          </button>
          <button className="btn" onClick={() => setScanTarget("slot")}>
            Escanear SLOT
          </button>
          <button className="btn secondary" onClick={handleRecord}>
            Confirmar e salvar
          </button>
        </div>
        {scanTarget && (
          <div style={{ marginTop: 12 }}>
            <p>{scanTarget === "volume" ? "Mire no QR do volume" : "Mire no QR do slot"}</p>
            <QrScanner
              active={true}
              onResult={(text) => {
                if (scanTarget === "volume") setVolumeInput(text.toUpperCase());
                if (scanTarget === "slot") setSlotInput(text.toUpperCase());
                setScanTarget(null);
              }}
              onError={(err) => setMessage(`Erro scanner: ${err}`)}
            />
            <button className="btn danger" onClick={() => setScanTarget(null)} style={{ marginTop: 8 }}>
              Fechar scanner
            </button>
          </div>
        )}
        {message && <p className="muted">{message}</p>}
      </div>

      <div className="card">
        <strong>Consultar volume</strong>
        <div className="row">
          <input
            className="input"
            placeholder="Digite volume ou escaneie"
            value={consultInput}
            onChange={(e) => setConsultInput(e.target.value.toUpperCase())}
          />
          <button className="btn secondary" onClick={() => handleConsult(consultInput)}>
            Consultar
          </button>
          <button className="btn" onClick={() => setScanTarget("volume")}>
            Escanear volume
          </button>
        </div>
        {status && (
          <div>
            <p>
              Status: {status.loaded ? "Carregado" : "Nao carregado"} | Slot atual: {status.slotCode || "-"}
            </p>
            <p>
              {status.planned ? "Planejado" : "Nao planejado"} | Movimentacoes: {status.duplicateEvents}
            </p>
            <p className="muted">Historico:</p>
            <ul>
              {history.map((h) => (
                <li key={h.id}>
                  {h.volumeCode} → {h.slotCode} ({new Date(h.timestamp).toLocaleString()})
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card">
        <strong>Resumo da viagem</strong>
        {summary && (
          <div>
            <p>
              Planejado: {summary.plannedTotal} | Carregado: {summary.loadedTotal} | Faltantes:{" "}
              {summary.missing.length}
            </p>
            <p>Duplicados: {summary.duplicates.length} | Nao planejados: {summary.notPlanned.length}</p>
            <div>
              <p className="muted">Faltantes:</p>
              {summary.missing.map((m) => (
                <span key={m} className="tag">
                  {m}
                </span>
              ))}
            </div>
            <div>
              <p className="muted">Duplicados:</p>
              {summary.duplicates.map((d) => (
                <span key={d.volumeCode} className="tag">
                  {d.volumeCode} ({d.events})
                </span>
              ))}
            </div>
            <div>
              <p className="muted">Nao planejados:</p>
              {summary.notPlanned.map((m) => (
                <span key={m} className="tag">
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
