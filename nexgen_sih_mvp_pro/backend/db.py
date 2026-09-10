from __future__ import annotations
import os
import sqlite3
from typing import List, Dict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.getenv("NEXGEN_DB", os.path.join(BASE_DIR, "data", "nexgen.db"))


def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with connect() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                node_id TEXT NOT NULL,
                tilt REAL NOT NULL,
                vibration REAL NOT NULL,
                displacement REAL NOT NULL,
                crack REAL NOT NULL,
                battery REAL DEFAULT 100,
                anomaly_score REAL DEFAULT 0,
                trend_score REAL DEFAULT 0,
                spatial_score REAL DEFAULT 0,
                risk_score REAL DEFAULT 0,
                risk_level TEXT DEFAULT 'NORMAL',
                explanation TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                node_id TEXT NOT NULL,
                risk_score REAL NOT NULL,
                risk_level TEXT NOT NULL,
                message TEXT NOT NULL,
                acknowledged INTEGER DEFAULT 0
            );
            """
        )


def insert_reading(r: Dict):
    with connect() as con:
        con.execute(
            """
            INSERT INTO readings(timestamp,node_id,tilt,vibration,displacement,crack,battery,
                                 anomaly_score,trend_score,spatial_score,risk_score,risk_level,explanation)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                r["timestamp"], r["node_id"], r["tilt"], r["vibration"], r["displacement"], r["crack"], r.get("battery",100),
                r.get("anomaly_score",0), r.get("trend_score",0), r.get("spatial_score",0), r.get("risk_score",0), r.get("risk_level","NORMAL"), r.get("explanation","")
            )
        )


def insert_alert(a: Dict):
    with connect() as con:
        con.execute(
            "INSERT INTO alerts(timestamp,node_id,risk_score,risk_level,message) VALUES(?,?,?,?,?)",
            (a["timestamp"],a["node_id"],a["risk_score"],a["risk_level"],a["message"])
        )


def latest_nodes() -> List[Dict]:
    with connect() as con:
        rows = con.execute(
            """
            SELECT r.* FROM readings r
            JOIN (SELECT node_id, MAX(id) AS mid FROM readings GROUP BY node_id) x
              ON r.node_id=x.node_id AND r.id=x.mid
            ORDER BY r.node_id
            """
        ).fetchall()
    return [dict(x) for x in rows]


def history(node_id: str, limit: int = 60) -> List[Dict]:
    with connect() as con:
        rows = con.execute(
            "SELECT * FROM readings WHERE node_id=? ORDER BY id DESC LIMIT ?", (node_id,limit)
        ).fetchall()
    return [dict(x) for x in reversed(rows)]


def recent_rows(limit: int = 1000) -> List[Dict]:
    with connect() as con:
        rows = con.execute("SELECT * FROM readings ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(x) for x in rows]


def alert_rows(limit: int = 50) -> List[Dict]:
    with connect() as con:
        rows = con.execute("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(x) for x in rows]


def counts() -> Dict:
    with connect() as con:
        total = con.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
        normal = con.execute("SELECT COUNT(*) FROM readings WHERE risk_level='NORMAL'").fetchone()[0]
        warning = con.execute("SELECT COUNT(*) FROM readings WHERE risk_level='WARNING'").fetchone()[0]
        critical = con.execute("SELECT COUNT(*) FROM readings WHERE risk_level='CRITICAL'").fetchone()[0]
    return {"total":total,"normal":normal,"warning":warning,"critical":critical}
