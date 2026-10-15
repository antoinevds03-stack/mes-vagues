#!/usr/bin/env python3
"""Récupère les prévisions Open-Meteo pour tous les spots de Mes Vagues.

Écrit deux fichiers :
  - data/latest.json : prévisions au format de l'appli. L'appli l'affiche si
    Open-Meteo ne répond pas au moment où on l'ouvre.
  - data/archive/AAAA/AAAA-MM-JJ.json : prévisions horaires brutes des quatre
    modèles sur 72 h. On les garde pour comparer plus tard prévisions, mesures
    des bouées et ressentis du carnet (calibration).

Uniquement la bibliothèque standard de Python : rien à installer.
Lancement : python scripts/archive_forecast.py
"""
import json
import math
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARINE = "https://marine-api.open-meteo.com/v1/marine"
FORECAST = "https://api.open-meteo.com/v1/forecast"
HOURS = [5, 8, 11, 14, 17, 20]                   # créneaux affichés dans l'appli
MODELS = ["ecmwf_wam", "ncep_gfswave016", "dwd_gwam"]  # + Météo-France (best_match en France)
ARCHIVE_HOURS = 72                                # échéances gardées dans l'archive
OFFSHORE_KM = 4                                   # point de prévision au large de la plage


def offshore(spot, km=OFFSHORE_KM):
    """Point situé à `km` kilomètres au large, dans l'axe d'orientation de la plage."""
    r = math.radians(spot["face"])
    lat = spot["lat"] + math.cos(r) * km / 110.54
    lon = spot["lon"] + math.sin(r) * km / (111.32 * math.cos(math.radians(spot["lat"])))
    return round(lat, 4), round(lon, 4)


def get_json(url, params, tries=3):
    query = urllib.parse.urlencode(params, safe=",")
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(f"{url}?{query}", headers={"User-Agent": "mes-vagues/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
            if isinstance(data, dict) and data.get("error"):
                raise RuntimeError(data.get("reason", "erreur Open-Meteo"))
            return data if isinstance(data, list) else [data]
        except Exception as exc:  # réseau, quota, réponse invalide
            last = exc
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Open-Meteo ne répond pas : {last}")


def rnd(v):
    """Arrondi identique à Math.round en JavaScript."""
    return math.floor(v + 0.5)


def pick(arr, idx, k):
    return [None if arr[i] is None else rnd(arr[i] * k) for i in idx]


def hourly(arr, n, digits):
    return [None if v is None else round(v, digits) for v in arr[:n]]


def main():
    with open(os.path.join(ROOT, "spots.json"), encoding="utf-8") as f:
        spots = json.load(f)
    pts = [offshore(s) for s in spots]
    common = {
        "latitude": ",".join(str(p[0]) for p in pts),
        "longitude": ",".join(str(p[1]) for p in pts),
        "forecast_days": 7,
        "timezone": "Europe/Paris",
    }
    marine = get_json(MARINE, {**common, "hourly": "wave_height,wave_direction,wave_period,swell_wave_height,"
                                                   "swell_wave_direction,swell_wave_period,sea_level_height_msl"})
    weather = get_json(FORECAST, {**common, "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m,"
                                                      "weather_code,temperature_2m", "daily": "sunrise,sunset"})
    models = get_json(MARINE, {**common, "hourly": "wave_height,wave_period,wave_direction",
                               "models": ",".join(MODELS)})

    times = marine[0]["hourly"]["time"]
    idx = [i for i, t in enumerate(times) if int(t[11:13]) in HOURS]
    n_arch = min(ARCHIVE_HOURS, len(times))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    latest = {
        "gen": now,
        "days": sorted({t[:10] for t in times}),
        "hours": HOURS,
        "map": {}, "cells": {}, "winds": {},
        "models": {"names": ["meteofrance_wave"] + MODELS, "cells": {}},
    }
    archive = {"run": now, "source": "Open-Meteo (CC BY 4.0)", "start": times[0],
               "timezone": "Europe/Paris", "hours": n_arch, "spots": {}}

    for j, spot in enumerate(spots):
        sid = spot["id"]
        H, W, D, MM = marine[j]["hourly"], weather[j]["hourly"], weather[j]["daily"], models[j]["hourly"]
        latest["map"][sid] = [sid, sid]
        latest["cells"][sid] = {
            "hs": pick(H["wave_height"], idx, 10), "wd": pick(H["wave_direction"], idx, 1),
            "wp": pick(H["wave_period"], idx, 10), "sh": pick(H["swell_wave_height"], idx, 10),
            "sd": pick(H["swell_wave_direction"], idx, 1), "sp": pick(H["swell_wave_period"], idx, 10),
            "tide": [None if v is None else rnd(v * 100) for v in H["sea_level_height_msl"]],
        }
        latest["winds"][sid] = {
            "ws": pick(W["wind_speed_10m"], idx, 1), "wdir": pick(W["wind_direction_10m"], idx, 1),
            "gu": pick(W["wind_gusts_10m"], idx, 1), "wc": pick(W["weather_code"], idx, 1),
            "tp": pick(W["temperature_2m"], idx, 1),
            "sun": [a[11:] + "-" + b[11:] for a, b in zip(D["sunrise"], D["sunset"])],
        }
        mc, arch = {}, {"point": list(pts[j]),
                        "meteofrance_wave": {"hs": hourly(H["wave_height"], n_arch, 2),
                                             "tp": hourly(H["wave_period"], n_arch, 1),
                                             "dir": hourly(H["wave_direction"], n_arch, 0)}}
        for m in MODELS:
            if f"wave_height_{m}" not in MM:
                continue
            mc[m] = {"hs": pick(MM[f"wave_height_{m}"], idx, 10), "tp": pick(MM[f"wave_period_{m}"], idx, 1),
                     "dir": pick(MM[f"wave_direction_{m}"], idx, 1)}
            arch[m] = {"hs": hourly(MM[f"wave_height_{m}"], n_arch, 2), "tp": hourly(MM[f"wave_period_{m}"], n_arch, 1),
                       "dir": hourly(MM[f"wave_direction_{m}"], n_arch, 0)}
        latest["models"]["cells"][sid] = mc
        archive["spots"][sid] = arch

    with open(os.path.join(ROOT, "data", "latest.json"), "w", encoding="utf-8") as f:
        json.dump(latest, f, ensure_ascii=False, separators=(",", ":"))

    day = datetime.now(ZoneInfo("Europe/Paris")).strftime("%Y-%m-%d")
    folder = os.path.join(ROOT, "data", "archive", day[:4])
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, f"{day}.json"), "w", encoding="utf-8") as f:
        json.dump(archive, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(spots)} spots enregistrés · {day}")


if __name__ == "__main__":
    main()
