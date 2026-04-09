"""
SkyCMD Backend — FastAPI + WebSocket

Starten:
    uvicorn main:app --host 0.0.0.0 --port 8080 --reload
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import asyncio
import json

app = FastAPI(title="SkyCMD API", version="0.1.0")

# Frontend statisch ausliefern
#
# Hinweis: Der Pfad wird absolut ausgehend vom Speicherort dieser Datei (main.py) aufgelöst.
# Dadurch funktioniert das Mounten unabhängig vom aktuellen Arbeitsverzeichnis.
import os
frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend"))
app.mount("/app", StaticFiles(directory=frontend_path, html=True), name="frontend")


# ── REST Endpoints ────────────────────────────────────────────────

@app.get("/api/status")
async def get_status():
    """Backend-Status und verbundene Geräte."""
    return {
        "version": "0.1.0",
        "mount": None,      # TODO: HAL-Status
        "camera": None,
    }


@app.post("/api/mount/goto")
async def mount_goto(ra: float, dec: float):
    """GoTo-Kommando an den Mount senden."""
    # TODO: HAL-Integration
    return {"status": "not_connected", "ra": ra, "dec": dec}


@app.get("/api/mount/position")
async def mount_position():
    """Aktuelle Mount-Position (RA/Dec)."""
    # TODO: HAL-Integration
    return {"ra": None, "dec": None, "connected": False}


# ── WebSocket ─────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, data: dict):
        msg = json.dumps(data)
        for ws in self.active:
            try:
                await ws.send_text(msg)
            except Exception:
                pass


manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Echtzeit Mount-Position senden (10 Hz)
            await asyncio.sleep(0.1)
            # TODO: echte Position aus HAL
            await manager.broadcast({"type": "mount_position", "ra": None, "dec": None})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
