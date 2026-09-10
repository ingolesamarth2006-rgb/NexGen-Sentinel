from __future__ import annotations

import asyncio
import csv
import io
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .db import init_db, insert_reading, insert_alert, latest_nodes, history, alert_rows, recent_rows, counts
from .risk_engine import RiskEngine
from .telegram_alert import send_message, enabled as telegram_enabled

BASE_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="NexGen Mine Subsidence Intelligence API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
engine = RiskEngine()
clients: Set[WebSocket] = set()
last_alert_level: Dict[str, str] = {}
ACTIVE_NODES = ("N01", "N02", "N03")


class SensorPayload(BaseModel):
    node_id: str = Field(pattern=r"^N\d{2}$")
    tilt: float
    vibration: float
    displacement: float
    crack: float
    battery: float = 100
    timestamp: str | None = None


async def broadcast(payload: dict):
    dead = []
    for ws in list(clients):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def active_only(rows):
    return [row for row in rows if row.get("node_id") in ACTIVE_NODES]


async def process_reading(data: dict):
    data = dict(data)
    data["timestamp"] = data.get("timestamp") or now_iso()
    analysis = engine.analyze(data["node_id"], data)
    data.update(analysis.__dict__)
    insert_reading(data)

    prev = last_alert_level.get(data["node_id"], "NORMAL")
    current = data["risk_level"]
    if current in {"WARNING", "CRITICAL"} and current != prev:
        msg = (
            f"{current} MINE SUBSIDENCE ALERT\n"
            f"Node: {data['node_id']}\nRisk Score: {data['risk_score']}/100\n"
            f"Tilt: {data['tilt']:.2f} deg\nVibration: {data['vibration']:.2f}\n"
            f"Displacement: {data['displacement']:.2f} mm\nCrack: {data['crack']:.2f} mm\n"
            f"Analysis: {data['explanation']}\nTime: {data['timestamp']}"
        )
        insert_alert({"timestamp":data["timestamp"],"node_id":data["node_id"],"risk_score":data["risk_score"],"risk_level":current,"message":msg})
        if telegram_enabled():
            # Fire and forget so dashboard response stays fast.
            asyncio.get_event_loop().run_in_executor(None, send_message, msg)
    last_alert_level[data["node_id"]] = current

    await broadcast({"type":"reading","data":data})
    return data


@app.on_event("startup")
async def startup():
    init_db()
    # Seed a light normal dataset if this is a fresh database.
    if len(active_only(recent_rows(1000))) < 80:
        for _ in range(120):
            n = random.choice(ACTIVE_NODES)
            r = {
                "node_id": n,
                "tilt": max(0, random.gauss(0.8,0.25)),
                "vibration": max(0, random.gauss(0.12,0.05)),
                "displacement": max(0, random.gauss(1.2,0.45)),
                "crack": max(0, random.gauss(0.25,0.10)),
                "battery": random.uniform(82,100),
                "timestamp": now_iso(),
            }
            await process_reading(r)
    engine.train(active_only(recent_rows(1000)))


@app.get("/api/health")
def health():
    return {"status":"online","model":"active" if engine.model_trained else "fallback","telegram":telegram_enabled()}


@app.post("/api/sensor-data")
async def ingest(payload: SensorPayload):
    if payload.node_id not in ACTIVE_NODES:
        raise HTTPException(400, "Prototype supports N01 to N03 only")
    return await process_reading(payload.model_dump())


@app.get("/api/nodes")
def nodes():
    return [row for row in latest_nodes() if row.get("node_id") in ACTIVE_NODES]


@app.get("/api/history/{node_id}")
def node_history(node_id: str, limit: int = 60):
    if node_id not in ACTIVE_NODES:
        raise HTTPException(404, "Unknown prototype node")
    return history(node_id, min(max(limit, 5), 500))


@app.get("/api/alerts")
def alerts(limit: int = 50):
    rows = active_only(alert_rows(min(max(limit * 3, 20), 400)))
    return rows[:min(max(limit, 1), 200)]


@app.get("/api/dataset/stats")
def dataset_stats():
    rows = active_only(recent_rows(5000))
    c = {
        "total": len(rows),
        "normal": sum(1 for r in rows if r.get("risk_level") == "NORMAL"),
        "warning": sum(1 for r in rows if r.get("risk_level") == "WARNING"),
        "critical": sum(1 for r in rows if r.get("risk_level") == "CRITICAL"),
    }
    c["model_trained"] = engine.model_trained
    c["training_samples"] = engine.training_samples
    return c


@app.get("/api/dataset/recent")
def dataset_recent(limit: int = 80):
    # Recent scored records for the dashboard table.
    rows = active_only(recent_rows(min(max(limit * 3, 30), 900)))
    return rows[:min(max(limit, 10), 300)]


@app.post("/api/dataset/import.csv")
async def dataset_import_csv(request: Request):
    raw = (await request.body()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    required = {"node_id", "tilt", "vibration", "displacement", "crack"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise HTTPException(400, "CSV must contain node_id, tilt, vibration, displacement, crack")
    imported = 0
    skipped = 0
    for row in reader:
        if imported >= 500:
            break
        try:
            node_id = str(row.get("node_id", "")).strip().upper()
            if node_id not in ACTIVE_NODES:
                raise ValueError("invalid node")
            data = {
                "node_id": node_id,
                "tilt": float(row["tilt"]),
                "vibration": float(row["vibration"]),
                "displacement": float(row["displacement"]),
                "crack": float(row["crack"]),
                "battery": float(row.get("battery") or 100),
                "timestamp": (row.get("timestamp") or now_iso()).strip(),
            }
            await process_reading(data)
            imported += 1
        except Exception:
            skipped += 1
    if imported == 0:
        raise HTTPException(400, "No valid rows were imported")
    return {"ok": True, "imported": imported, "skipped": skipped}


@app.post("/api/model/train")
def train_model():
    ok, message = engine.train(active_only(recent_rows(5000)))
    if not ok:
        raise HTTPException(400, message)
    return {"ok":True,"message":message,"training_samples":engine.training_samples}


@app.get("/api/dataset/export.csv")
def export_csv():
    rows = list(reversed(active_only(recent_rows(5000))))
    if not rows:
        raise HTTPException(404, "No data")
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
    writer.writeheader(); writer.writerows(rows)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition":"attachment; filename=nexgen_dataset.csv"})


SCENARIOS = {
    "normal": dict(tilt=(0.5,1.4), vibration=(0.05,0.18), displacement=(0.4,1.8), crack=(0.05,0.35)),
    "warning": dict(tilt=(2.3,3.6), vibration=(0.26,0.45), displacement=(3.8,5.8), crack=(0.8,1.6)),
    "critical": dict(tilt=(4.8,6.2), vibration=(0.62,0.90), displacement=(7.0,10.0), crack=(2.3,4.0)),
}


@app.post("/api/simulate/{scenario}")
async def simulate(scenario: str):
    if scenario not in {"normal","warning","critical","subsidence"}:
        raise HTTPException(404, "Unknown scenario")

    emitted = []
    if scenario == "subsidence":
        # Adjacent nodes progressively deteriorate to demonstrate spatial + temporal fusion.
        for step, node in enumerate(["N01","N02","N03","N02","N03"]):
            severity = min(1.0, 0.50 + step*0.12)
            data = {
                "node_id":node,
                "tilt":2.0 + 4.0*severity + random.uniform(-0.15,0.15),
                "vibration":0.20 + 0.68*severity + random.uniform(-0.03,0.03),
                "displacement":2.5 + 7.4*severity + random.uniform(-0.3,0.3),
                "crack":0.6 + 3.3*severity + random.uniform(-0.1,0.1),
                "battery":random.uniform(78,96),
                "timestamp":now_iso(),
            }
            emitted.append(await process_reading(data))
            await asyncio.sleep(0.12)
    else:
        ranges = SCENARIOS[scenario]
        for node in ACTIVE_NODES:
            data = {"node_id":node,"battery":random.uniform(80,100),"timestamp":now_iso()}
            for k,(a,b) in ranges.items(): data[k]=random.uniform(a,b)
            emitted.append(await process_reading(data))
    return {"ok":True,"scenario":scenario,"readings":emitted}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept(); clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)
    except Exception:
        clients.discard(ws)


app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR)), name="assets")

@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")
