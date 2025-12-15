import base64
import io
import json
import socket
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

import qrcode
import streamlit as st
from PIL import Image

# Optional QR decoder (requires pyzbar + zbar on the system)
try:
    from pyzbar.pyzbar import decode as qr_decode  # type: ignore
except Exception:  # pragma: no cover
    qr_decode = None

# Fallback decoder via ZXing (requires Java runtime)
try:
    from pyzxing import BarCodeReader  # type: ignore
except Exception:  # pragma: no cover
    BarCodeReader = None

DB_PATH = Path("carregamento_streamlit.db")


# -------------------------
# Database helpers
# -------------------------
def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            date TEXT,
            truck TEXT,
            driver TEXT
        );
        CREATE TABLE IF NOT EXISTS slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS planned_volumes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            volume_code TEXT NOT NULL,
            description TEXT,
            UNIQUE(trip_id, volume_code),
            FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS load_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            volume_code TEXT NOT NULL,
            slot_code TEXT,
            user_id INTEGER,
            timestamp TEXT NOT NULL,
            FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        """
    )
    # Migration: add description column if missing
    cols = cur.execute("PRAGMA table_info(planned_volumes)").fetchall()
    has_desc = any(c[1] == "description" for c in cols)
    if not has_desc:
        try:
            cur.execute("ALTER TABLE planned_volumes ADD COLUMN description TEXT;")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    conn.close()


def seed_demo():
    conn = get_conn()
    cur = conn.cursor()
    count = cur.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count == 0:
        cur.execute("INSERT INTO users (name) VALUES (?)", ("Conferente",))
        cur.execute("INSERT INTO users (name) VALUES (?)", ("Motorista",))
        cur.execute(
            "INSERT INTO trips (name, date, truck, driver) VALUES (?, ?, ?, ?)",
            ("Viagem Demo", datetime.now().date().isoformat(), "Caminhao Demo", "Fulano"),
        )
        trip_id = cur.lastrowid
        for code in ["A1", "A2", "A3", "B1", "B2"]:
            cur.execute("INSERT INTO slots (code) VALUES (?)", (code,))
        for vol in ["VOL-001", "VOL-002", "VOL-003"]:
            cur.execute(
                "INSERT INTO planned_volumes (trip_id, volume_code, description) VALUES (?, ?, ?)",
                (trip_id, vol, f"Volume demo {vol}"),
            )
        cur.execute(
            "INSERT INTO load_events (trip_id, volume_code, slot_code, user_id, timestamp) VALUES (?, ?, ?, ?, ?)",
            (trip_id, "VOL-001", "A1", 1, datetime.now().isoformat()),
        )
    conn.commit()
    conn.close()


# -------------------------
# CRUD helpers
# -------------------------
def list_users() -> List[Tuple[int, str]]:
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute("SELECT id, name FROM users ORDER BY name").fetchall()
    conn.close()
    return rows


def create_user(name: str) -> int:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("INSERT INTO users (name) VALUES (?)", (name.strip(),))
    conn.commit()
    uid = cur.lastrowid
    conn.close()
    return uid


def list_trips() -> List[Tuple[int, str, str, str, str]]:
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT id, name, date, truck, driver FROM trips ORDER BY date DESC, id DESC"
    ).fetchall()
    conn.close()
    return rows


def create_trip(name: str, date: str, truck: str, driver: str) -> int:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO trips (name, date, truck, driver) VALUES (?, ?, ?, ?)",
        (name.strip(), date or None, truck or None, driver or None),
    )
    conn.commit()
    tid = cur.lastrowid
    conn.close()
    return tid


def list_slots() -> List[Tuple[int, str]]:
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute("SELECT id, code FROM slots ORDER BY code").fetchall()
    conn.close()
    return rows


def add_slot(code: str) -> int:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("INSERT OR IGNORE INTO slots (code) VALUES (?)", (code.strip().upper(),))
    conn.commit()
    sid = cur.lastrowid
    conn.close()
    return sid


def add_slots_bulk(raw: str):
    for code in parse_codes(raw):
        add_slot(code)


def list_planned(trip_id: int) -> List[Tuple[int, str, Optional[str]]]:
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT id, volume_code, description FROM planned_volumes WHERE trip_id = ? ORDER BY volume_code",
        (trip_id,),
    ).fetchall()
    conn.close()
    return rows


def add_planned(trip_id: int, volume: str, description: Optional[str] = None) -> int:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT OR IGNORE INTO planned_volumes (trip_id, volume_code, description) VALUES (?, ?, ?)",
        (trip_id, volume.strip().upper(), description),
    )
    conn.commit()
    vid = cur.lastrowid
    conn.close()
    return vid


def add_planned_bulk(trip_id: int, raw: str):
    for code in parse_codes(raw):
        add_planned(trip_id, code)


def record_event(trip_id: int, volume: str, slot: str, user_id: Optional[int]):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO load_events (trip_id, volume_code, slot_code, user_id, timestamp) VALUES (?, ?, ?, ?, ?)",
        (trip_id, volume.strip().upper(), slot.strip().upper(), user_id, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def get_history(trip_id: int, volume: str) -> List[Tuple[str, str, Optional[int], str]]:
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT volume_code, slot_code, user_id, timestamp FROM load_events WHERE trip_id = ? AND volume_code = ? ORDER BY datetime(timestamp) DESC",
        (trip_id, volume.strip().upper()),
    ).fetchall()
    conn.close()
    return rows


def get_status(trip_id: int, volume: str):
    history = get_history(trip_id, volume)
    loaded = len(history) > 0
    slot_code = history[0][1] if loaded else None
    conn = get_conn()
    cur = conn.cursor()
    planned_row = cur.execute(
        "SELECT description FROM planned_volumes WHERE trip_id = ? AND volume_code = ?",
        (trip_id, volume.strip().upper()),
    ).fetchone()
    planned = planned_row is not None
    description = planned_row[0] if planned_row else None
    conn.close()
    return {
        "loaded": loaded,
        "slot": slot_code,
        "history": history,
        "planned": planned,
        "moves": len(history),
        "description": description,
    }


def get_summary(trip_id: int):
    conn = get_conn()
    cur = conn.cursor()
    planned = [row[0] for row in cur.execute(
        "SELECT volume_code FROM planned_volumes WHERE trip_id = ?", (trip_id,)
    ).fetchall()]
    loaded_rows = cur.execute(
        "SELECT volume_code, slot_code FROM load_events WHERE trip_id = ?", (trip_id,)
    ).fetchall()
    conn.close()

    loaded_unique = sorted(set([v for v, _ in loaded_rows]))
    missing = sorted([v for v in planned if v not in loaded_unique])
    counts = {}
    for v, _ in loaded_rows:
        counts[v] = counts.get(v, 0) + 1
    duplicates = [{"volume_code": v, "events": c} for v, c in counts.items() if c > 1]
    not_planned = [v for v in loaded_unique if v not in planned]
    return {
        "planned_total": len(planned),
        "loaded_total": len(loaded_unique),
        "missing": missing,
        "duplicates": duplicates,
        "not_planned": not_planned,
    }


# -------------------------
# Utilities
# -------------------------
def parse_codes(raw: str):
    return [c.strip().upper() for c in raw.split() if c.strip()]


def next_volume_code() -> str:
    conn = get_conn()
    cur = conn.cursor()
    total = cur.execute("SELECT COUNT(*) FROM planned_volumes").fetchone()[0] or 0
    conn.close()
    idx = total + 1
    year = datetime.now().year
    return f"VOL-{year}-{idx:05d}"


def generate_qr_base64(payload: dict) -> str:
    data = json.dumps(payload)
    img = qrcode.make(data)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def decode_qr_from_image(img_bytes: bytes) -> Optional[str]:
    # Try pyzbar (needs zbar)
    if qr_decode is not None:
        try:
            with Image.open(io.BytesIO(img_bytes)) as img:
                results = qr_decode(img)
            if results:
                return results[0].data.decode("utf-8")
        except Exception:
            pass
    # Fallback: ZXing via Java (pyzxing)
    if BarCodeReader is not None:
        try:
            reader = BarCodeReader()
            # Save temp file
            tmp = io.BytesIO(img_bytes)
            with Image.open(tmp) as img:
                tmp_path = Path("tmp_qr_upload.png")
                img.save(tmp_path)
            res = reader.decode(str(tmp_path))
            tmp_path.unlink(missing_ok=True)
            if res and res.get("parsed"):
                return res["parsed"]
        except Exception:
            pass
    return None


def parse_qr_payload(text: str) -> Tuple[str, Optional[str]]:
    try:
        data = json.loads(text)
        if isinstance(data, dict) and "volume_id" in data:
            return str(data["volume_id"]), data.get("description")
    except Exception:
        pass
    return text, None


def local_ip() -> str:
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return "SEU_IP"


# -------------------------
# UI
# -------------------------
def main():
    st.set_page_config(page_title="Carregamento QR (Streamlit)", layout="wide")
    st.title("Carregamento de volumes com QR (Streamlit)")
    st.session_state.setdefault("load_volume", "")
    st.session_state.setdefault("load_slot", "")

    cols = st.columns(3)
    with cols[0]:
        st.caption("Rede local")
        st.code(f"http://{local_ip()}:8501")
    with cols[1]:
        st.caption("Para HTTPS/câmera mobile, usar proxy (Caddy/nginx) conforme README anterior")
    with cols[2]:
        st.caption("Se a câmera falhar, digite volume/slot manualmente.")

    # Sidebar selections
    users = list_users()
    trips = list_trips()

    user_names = {u[0]: u[1] for u in users}
    trip_names = {t[0]: t[1] for t in trips}

    st.sidebar.header("Sessão")
    user_id = st.sidebar.selectbox("Usuário", [None] + [u[0] for u in users], format_func=lambda x: user_names.get(x, "Selecione") if x else "Selecione")
    if st.sidebar.button("Novo usuário"):
        name = st.sidebar.text_input("Nome do novo usuário", key="new_user_name")
        if name:
            uid = create_user(name)
            st.sidebar.success(f"Usuário criado: {name}")
            st.rerun()

    trip_id = st.sidebar.selectbox("Viagem", [None] + [t[0] for t in trips], format_func=lambda x: trip_names.get(x, "Selecione") if x else "Selecione")
    if st.sidebar.button("Nova viagem"):
        name = st.sidebar.text_input("Nome da viagem (ex: data + caminhão + motorista)", key="new_trip_name")
        if name:
            tid = create_trip(name, datetime.now().date().isoformat(), "", "")
            st.sidebar.success(f"Viagem criada: {name}")
            st.rerun()

    st.sidebar.markdown("---")
    if st.sidebar.button("Recarregar dados"):
        st.rerun()

    # Slots
    st.subheader("Slots do caminhão")
    slot_input = st.text_input("Adicionar slot (ex: A1)", key="slot_input")
    cols_slots = st.columns(2)
    with cols_slots[0]:
        if st.button("Salvar slot"):
            if slot_input:
                add_slot(slot_input)
                st.success(f"Slot {slot_input} salvo.")
                st.rerun()
    with cols_slots[1]:
        bulk = st.text_area("Adicionar slots em lote (separe por espaço ou linha)", key="slot_bulk")
        if st.button("Salvar lista de slots"):
            if bulk.strip():
                add_slots_bulk(bulk)
                st.success("Slots adicionados.")
                st.rerun()
    st.write("Slots cadastrados:")
    st.write(", ".join([s[1] for s in list_slots()]) or "Nenhum slot ainda.")

    # Planned volumes
    st.subheader("Volumes planejados")
    if trip_id:
        planned_input = st.text_input("Adicionar volume planejado (manual)", key="planned_input")
        cols_planned = st.columns(2)
        with cols_planned[0]:
            if st.button("Salvar volume planejado"):
                if planned_input:
                    add_planned(trip_id, planned_input)
                    st.success("Volume planejado salvo.")
                    st.rerun()
        with cols_planned[1]:
            bulk_vol = st.text_area("Adicionar volumes em lote", key="bulk_vol")
            if st.button("Salvar lista de volumes"):
                if bulk_vol.strip():
                    add_planned_bulk(trip_id, bulk_vol)
                    st.success("Lista salva.")
                    st.rerun()
        st.write("Volumes planejados:")
        planned_rows = list_planned(trip_id)
        if planned_rows:
            for _, vcode, desc in planned_rows:
                st.write(f"- {vcode} ({desc or 'sem descrição'})")
        else:
            st.write("Nenhum volume ainda.")
    else:
        st.info("Selecione uma viagem para cadastrar volumes planejados.")

    # Create volume + QR com id gerado
    st.subheader("Criar volume com ID gerado e QR")
    if trip_id:
        qr_desc = st.text_input("Descrição do volume (opcional)", key="qr_desc")
        if st.button("Gerar ID de volume + QR"):
            volume_id = next_volume_code()
            add_planned(trip_id, volume_id, qr_desc or None)
            payload = {"volume_id": volume_id, "description": qr_desc or ""}
            b64 = generate_qr_base64(payload)
            st.success(f"Volume {volume_id} criado. QR abaixo:")
            st.image(f"data:image/png;base64,{b64}", width=200)
            st.download_button(
                "Baixar QR (PNG)",
                data=base64.b64decode(b64),
                file_name=f"{volume_id}.png",
                mime="image/png",
            )
    else:
        st.info("Selecione uma viagem para criar volumes.")

    # Load event (scan/digit)
    st.subheader("Carregamento (scan ou digitar)")
    col1, col2 = st.columns(2)
    with col1:
        vol_input = st.text_input("Volume ID", value=st.session_state.get("load_volume", ""), key="load_volume")
    with col2:
        slot_val = st.text_input("Slot code", value=st.session_state.get("load_slot", ""), key="load_slot")

    if st.button("Confirmar e salvar carregamento"):
        if not trip_id or not user_id:
            st.error("Selecione usuário e viagem antes de salvar.")
        elif not vol_input.strip() or not slot_val.strip():
            st.error("Preencha volume e slot.")
        else:
            record_event(trip_id, vol_input, slot_val, user_id)
            st.success(f"Salvo {vol_input.strip().upper()} em {slot_val.strip().upper()}.")
            st.session_state["load_volume"] = ""
            st.session_state["load_slot"] = ""

    # Optional camera scan (photo) para preencher volume
    if st.checkbox("Usar câmera/foto para ler QR do volume (preenche automático)"):
        uploaded = st.camera_input("Tire foto do QR ou faça upload", key="cam_load")
        if uploaded:
            content = uploaded.getvalue()
            decoded = decode_qr_from_image(content)
            if decoded:
                vol, desc = parse_qr_payload(decoded)
                st.success(f"QR lido: {vol} {f'({desc})' if desc else ''}")
                st.session_state["load_volume"] = vol
                st.rerun()
            else:
                st.error("Não foi possível ler o QR. Use outro ângulo/luz ou digite manualmente.")

    # Consult
    st.subheader("Consultar volume")
    consult_val = st.text_input("Digite ou escaneie volume", key="consult_val")
    if st.button("Consultar"):
        if not trip_id:
            st.error("Selecione uma viagem.")
        elif consult_val.strip():
            st_status = get_status(trip_id, consult_val)
            st.write(f"Status: {'Carregado' if st_status['loaded'] else 'Não carregado'}")
            st.write(f"Slot atual: {st_status['slot'] or '-'}")
            st.write(f"Planejado: {'Sim' if st_status['planned'] else 'Não'}")
            if st_status.get("description"):
                st.write(f"Descrição: {st_status['description']}")
            st.write(f"Movimentações: {st_status['moves']}")
            st.write("Histórico:")
            if st_status["history"]:
                for v, s, u, ts in st_status["history"]:
                    st.write(f"{v} -> {s} ({ts}) User: {u or '-'}")
            else:
                st.write("Sem histórico.")

    # Summary
    st.subheader("Resumo da viagem")
    if trip_id:
        summ = get_summary(trip_id)
        st.metric("Planejado", summ["planned_total"])
        st.metric("Carregado", summ["loaded_total"])
        st.metric("Faltantes", len(summ["missing"]))
        st.metric("Duplicados", len(summ["duplicates"]))
        st.metric("Não planejados", len(summ["not_planned"]))
        st.write("Faltantes:", ", ".join(summ["missing"]) or "-")
        st.write(
            "Duplicados:",
            ", ".join([f"{d['volume_code']} ({d['events']})" for d in summ["duplicates"]]) or "-",
        )
        st.write("Não planejados:", ", ".join(summ["not_planned"]) or "-")
    else:
        st.info("Selecione uma viagem para ver o resumo.")


if __name__ == "__main__":
    init_db()
    seed_demo()
    main()
