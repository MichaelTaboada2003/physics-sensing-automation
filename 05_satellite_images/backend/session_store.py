from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional
import uuid

import numpy as np
from sklearn.ensemble import RandomForestClassifier


@dataclass
class SessionData:
    scene_id: str
    scene_datetime: str
    cloud_cover: float
    bbox: list[float]                          # [lon_min, lat_min, lon_max, lat_max]
    cloud_threshold: float = 100.0             # umbral usado en la búsqueda original
    item: Optional[Any] = None                 # pystac.Item firmado para descarga
    crs: Optional[object] = None
    transform: Optional[object] = None        # affine transform de la ventana
    bands: dict = field(default_factory=dict)  # {"B02": np.ndarray, ...}
    indices: dict = field(default_factory=dict)  # {"ndvi": np.ndarray, ...}
    cloud_mask: Optional[np.ndarray] = None    # True = nube/sombra/nieve/sin datos (SCL)
    cloud_fraction: float = 0.0                # fracción de la zona enmascarada
    classifier: Optional[RandomForestClassifier] = None
    classifier_id: Optional[str] = None
    classifier_metrics: Optional[dict] = None
    class_scheme: str = "rules"                # «rules» o «worldcover» (core/classes.py)
    class_map: Optional[np.ndarray] = None
    comparisons: dict = field(default_factory=dict)  # {year: {"scene": {...}, "bands": {...}, "class_map": ...}}
    created_at: datetime = field(default_factory=datetime.utcnow)

    def is_expired(self) -> bool:
        """Returns True if the session has exceeded the 60-minute TTL."""
        return datetime.utcnow() > self.created_at + timedelta(minutes=60)


# Almacén global en memoria
_store: dict[str, SessionData] = {}

# Resultados de búsqueda de escenas (para el selector manual): {search_id: {...}}
_searches: dict[str, dict] = {}
_SEARCH_TTL = timedelta(minutes=30)


def create_search(bbox: list[float], cloud_threshold: float, items: dict) -> str:
    """Guarda los items candidatos de una búsqueda y devuelve su identificador."""
    now = datetime.utcnow()
    for key in [k for k, v in _searches.items() if now > v["created_at"] + _SEARCH_TTL]:
        del _searches[key]
    sid = str(uuid.uuid4())
    _searches[sid] = {
        "bbox": bbox,
        "cloud_threshold": cloud_threshold,
        "items": items,          # {scene_id: pystac.Item}
        "thumbnails": {},        # {scene_id: bytes}
        "created_at": now,
    }
    return sid


def get_search(sid: str) -> Optional[dict]:
    """Devuelve una búsqueda vigente o None."""
    s = _searches.get(sid)
    if s is None or datetime.utcnow() > s["created_at"] + _SEARCH_TTL:
        _searches.pop(sid, None)
        return None
    return s


def create_session(data: SessionData) -> str:
    """Store a new SessionData and return its UUID string identifier."""
    sid = str(uuid.uuid4())
    _store[sid] = data
    return sid


def get_session(sid: str) -> Optional[SessionData]:
    """
    Retrieve a session by its identifier.

    Returns None (and removes the entry) if the session has expired or does
    not exist.
    """
    s = _store.get(sid)
    if s is None:
        return None
    if s.is_expired():
        del _store[sid]
        return None
    return s


def cleanup_expired() -> int:
    """
    Remove all expired sessions from the in-memory store.

    Returns the number of sessions that were removed.
    """
    expired_keys = [sid for sid, session in _store.items() if session.is_expired()]
    for sid in expired_keys:
        del _store[sid]
    return len(expired_keys)
