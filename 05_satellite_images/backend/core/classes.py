"""
core/classes.py
---------------
Esquemas de clases de cobertura según el método de entrenamiento.

- ``rules``      : pseudo-etiquetado por umbrales (método del curso), 3 clases.
- ``worldcover`` : etiquetas tomadas de ESA WorldCover 2021, 5 clases; agrega
                   «Urbano / construido» y separa «Bosque» de «Pastos y cultivos».

Convenciones compartidas por ambos esquemas (el resto del código se apoya en ellas):
- El código 0 es la clase «principal» de vegetación (vegetación o bosque): su
  pérdida es la que se marca en el mapa de cambios y la que cuenta el titular.
- El código 1 es siempre «Agua» y el 2 «Suelo expuesto / minería».
- -1 es «sin datos / nube».

Los colores están validados para daltonismo (todos los pares, simulación de
Machado) sobre el papel #fbfcf8.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

NODATA_COLOR = "#1b2430"


@dataclass(frozen=True)
class ClassDef:
    code: int
    key: str
    label: str
    color: str


SCHEMES: dict[str, list[ClassDef]] = {
    "rules": [
        ClassDef(0, "vegetation", "Vegetación", "#16a34a"),
        ClassDef(1, "water", "Agua", "#2563eb"),
        ClassDef(2, "mining", "Suelo expuesto / minería", "#b45309"),
    ],
    "worldcover": [
        ClassDef(0, "forest", "Bosque", "#14532d"),
        ClassDef(1, "water", "Agua", "#2563eb"),
        ClassDef(2, "mining", "Suelo expuesto / minería", "#b45309"),
        ClassDef(3, "urban", "Urbano / construido", "#db2777"),
        ClassDef(4, "grass", "Pastos y cultivos", "#a3e635"),
    ],
}

DEFAULT_SCHEME = "rules"


def scheme(name: str | None) -> list[ClassDef]:
    return SCHEMES.get(name or DEFAULT_SCHEME, SCHEMES[DEFAULT_SCHEME])


def scheme_json(name: str | None) -> list[dict]:
    return [asdict(c) for c in scheme(name)]


def primary(name: str | None) -> ClassDef:
    """Clase de vegetación principal (código 0) del esquema."""
    return scheme(name)[0]


def label_of(name: str | None, code: int) -> str:
    for c in scheme(name):
        if c.code == code:
            return c.label
    return "Sin datos / nube"
