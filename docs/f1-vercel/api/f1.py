from datetime import datetime
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import fastf1


# Vercel functions are ephemeral. Do not create a FastF1 disk cache.
fastf1.Cache.set_disabled()
fastf1.Cache._default_cache_enabled = True


def _event_identifier(year, race_name):
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    matches = schedule[schedule["EventName"].astype(str) == race_name]
    if not matches.empty:
        round_number = matches.iloc[0].get("RoundNumber")
        if round_number is not None:
            return int(round_number)
    return race_name


def _load_session(year, race_name, session_type):
    session = fastf1.get_session(
        year, _event_identifier(year, race_name), session_type
    )
    session.load(telemetry=False, weather=False, messages=False)
    return session


def _race_options(year):
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    schedule = schedule.copy()
    schedule["RoundNumber"] = schedule["RoundNumber"].astype(float)
    schedule = schedule[schedule["RoundNumber"] > 0].sort_values("RoundNumber")
    return [
        {
            "round": int(row.RoundNumber),
            "name": str(row.EventName),
            "location": str(row.Location),
        }
        for row in schedule.itertuples()
    ]


def _summary(year, race_name):
    session = _load_session(year, race_name, "R")
    laps = session.laps
    results = session.results
    return {
        "title": f"{race_name} {year}",
        "drivers": int(len(results)),
        "laps": int(len(laps)),
        "fastest_lap": _fastest_lap(laps),
        "results": [
            {
                "position": _number(row.get("Position")),
                "driver": str(row.get("Abbreviation", "")),
                "name": str(row.get("FullName", "")),
                "team": str(row.get("TeamName", "")),
            }
            for _, row in results.head(10).iterrows()
        ],
    }


def _fastest_lap(laps):
    if "LapTime" not in laps.columns:
        return None
    valid = laps.dropna(subset=["LapTime"])
    if valid.empty:
        return None
    row = valid.loc[valid["LapTime"].idxmin()]
    return {
        "driver": str(row.get("Driver", "")),
        "time": str(row["LapTime"]),
    }


def _number(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _request_data(query):
    try:
        action = query.get("action", ["races"])[0]
        year = int(query.get("year", [datetime.now().year])[0])
        if action == "races":
            return 200, {"year": year, "races": _race_options(year)}
        if action == "summary":
            race_name = query.get("race", [None])[0]
            if not race_name:
                return 400, {"error": "Missing race parameter."}
            return 200, _summary(year, race_name)
        return 400, {"error": "Unknown action."}
    except Exception as exc:
        return 502, {"error": f"FastF1 could not load this request: {exc}"}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        status, payload = _request_data(parse_qs(urlparse(self.path).query))
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
