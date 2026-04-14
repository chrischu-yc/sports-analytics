import os
import tempfile
from datetime import datetime
import fastf1
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import streamlit as st

#CACHE_DIR = os.path.join(os.path.dirname(__file__), ".fastf1-cache")
# Use /tmp so the app works in ephemeral cloud environments like Streamlit Community Cloud.
#CACHE_DIR = os.path.join(tempfile.gettempdir(), "fastf1-cache")
#os.makedirs(CACHE_DIR, exist_ok=True)
#fastf1.Cache.enable_cache(CACHE_DIR)


@st.cache_resource(show_spinner=False)
def load_race_session(year: int, race_name: str):
    session = fastf1.get_session(year, race_name, "R")
    session.load()
    return session


@st.cache_data(show_spinner=False)
def get_race_options(year: int):
    schedule = fastf1.get_event_schedule(year, include_testing=False)

    if "RoundNumber" in schedule.columns:
        round_numbers = pd.to_numeric(schedule["RoundNumber"], errors="coerce").fillna(0)
        schedule = schedule[round_numbers > 0].copy()
        schedule = schedule.sort_values("RoundNumber")

    event_col = "EventName" if "EventName" in schedule.columns else "Location"
    races = [str(name) for name in schedule[event_col].dropna().tolist()]

    ordered_unique_races = []
    seen = set()
    for race in races:
        if race not in seen:
            seen.add(race)
            ordered_unique_races.append(race)

    return ordered_unique_races


def compute_race_data(session):
    laps = session.laps
    lap_numbers = sorted([int(x) for x in laps["LapNumber"].dropna().unique()])
    driver_numbers = [str(x) for x in laps["DriverNumber"].dropna().unique()]

    valid_laps = laps[
        laps["LapStartTime"].notna()
        & laps["Time"].notna()
        & laps["LapNumber"].notna()
        & laps["DriverNumber"].notna()
    ].copy()
    valid_laps["LapSeconds"] = valid_laps["Time"].dt.total_seconds()

    lap_pace = valid_laps.groupby("LapNumber")["LapSeconds"].mean().to_dict()

    driver_offsets = {d: [] for d in driver_numbers}
    for d in driver_numbers:
        d_laps = valid_laps[valid_laps["DriverNumber"].astype(str) == d]
        d_lap_seconds = (
            d_laps.groupby("LapNumber")["LapSeconds"].first().to_dict()
            if not d_laps.empty
            else {}
        )

        for lap in lap_numbers:
            pace = lap_pace.get(lap)
            driver_time = d_lap_seconds.get(lap)
            if pace is None or driver_time is None:
                driver_offsets[d].append(np.nan)
            else:
                # Positive values mean faster than average pace.
                driver_offsets[d].append(pace - driver_time)

    pit_laps = {d: [] for d in driver_numbers}
    for d in driver_numbers:
        d_laps = valid_laps[valid_laps["DriverNumber"].astype(str) == d]
        pitted = d_laps[d_laps["PitInTime"].notna()]
        pit_laps[d] = sorted([int(x) for x in pitted["LapNumber"].dropna().unique()])

    status_rows = laps[["LapNumber", "TrackStatus"]].dropna()
    safety_car_laps = sorted(
        {
            int(row["LapNumber"])
            for _, row in status_rows.iterrows()
            if "4" in str(row["TrackStatus"])
        }
    )

    driver_info = {}
    used_team_colors = set()
    for d in driver_numbers:
        row = session.results[session.results["DriverNumber"].astype(str) == d]
        if row.empty:
            continue

        row = row.iloc[0]
        team_color = str(row.get("TeamColor", "777777"))
        line_style = "-." if team_color in used_team_colors else "-"
        used_team_colors.add(team_color)

        try:
            position = int(row.get("Position", 99))
        except (TypeError, ValueError):
            position = 99

        driver_info[d] = {
            "abbreviation": str(row.get("Abbreviation", d)),
            "last_name": str(row.get("LastName", d)),
            "position": position,
            "team_color": f"#{team_color}",
            "line_style": line_style,
        }

    return {
        "lap_numbers": lap_numbers,
        "driver_numbers": driver_numbers,
        "driver_offsets": driver_offsets,
        "pit_laps": pit_laps,
        "safety_car_laps": safety_car_laps,
        "driver_info": driver_info,
    }


def build_race_title(session, selected_year: int, selected_race_name: str):
    race_info = session.session_info
    meeting = race_info.get("Meeting", {}) if hasattr(race_info, "get") else {}

    meeting_name = (
        meeting.get("Name")
        or meeting.get("OfficialName")
        or meeting.get("Location")
        or selected_race_name
    )

    race_year = selected_year
    start_date = race_info.get("StartDate") if hasattr(race_info, "get") else None
    if hasattr(start_date, "year"):
        race_year = start_date.year
    elif isinstance(start_date, str) and len(start_date) >= 4 and start_date[:4].isdigit():
        race_year = int(start_date[:4])

    round_number = None
    if hasattr(meeting, "get"):
        round_number = meeting.get("Number")

    if round_number in (None, ""):
        try:
            round_number = session.event.get("RoundNumber")
        except Exception:
            round_number = None

    round_text = ""
    if round_number not in (None, ""):
        try:
            round_text = f" - Round {int(round_number)}"
        except (TypeError, ValueError):
            round_text = f" - Round {round_number}"

    return f"{meeting_name} {race_year}{round_text}"


def build_plot(data, title, selected_abbs=None, lap_range=None):
    lap_numbers = data["lap_numbers"]
    driver_numbers = data["driver_numbers"]
    driver_offsets = data["driver_offsets"]
    pit_laps = data["pit_laps"]
    safety_car_laps = data["safety_car_laps"]
    driver_info = data["driver_info"]

    if not lap_numbers:
        raise ValueError("No lap data available to plot.")

    if lap_range is None:
        lap_start, lap_end = min(lap_numbers), max(lap_numbers)
    else:
        lap_start, lap_end = lap_range

    fig, ax = plt.subplots(figsize=(12, 8))
    ax.set_facecolor("oldlace")

    for d in driver_numbers:
        if d not in driver_info:
            continue

        info = driver_info[d]
        if selected_abbs and info["abbreviation"] not in selected_abbs:
            continue

        x_vals = []
        y_vals = []
        for idx, lap in enumerate(lap_numbers):
            if lap_start <= lap <= lap_end:
                x_vals.append(lap)
                y_vals.append(driver_offsets[d][idx])

        if not x_vals:
            continue

        label = f"{info['position']}. {info['last_name']}"
        ax.plot(
            x_vals,
            y_vals,
            label=label,
            color=info["team_color"],
            linestyle=info["line_style"],
            alpha=0.8,
        )

        for pit_lap in pit_laps.get(d, []):
            if lap_start <= pit_lap <= lap_end:
                lap_index = lap_numbers.index(pit_lap)
                y_val = driver_offsets[d][lap_index]
                if not np.isnan(y_val):
                    ax.plot(
                        pit_lap,
                        y_val,
                        "o",
                        color=info["team_color"],
                        markersize=3,
                    )

    ax.axhline(0, color="gray", linestyle="--", alpha=0.5)
    for sc_lap in safety_car_laps:
        if lap_start <= sc_lap <= lap_end:
            ax.axvspan(sc_lap - 1, sc_lap, color="yellow", alpha=0.3, linewidth=0)

    ax.set_xlim(lap_start - 1, lap_end + 1)
    tick_step = 1 if (lap_end - lap_start) <= 30 else 2
    ax.set_xticks(np.arange(lap_start, lap_end + 1, tick_step))
    ax.set_xlabel("Lap Number")
    ax.set_ylabel("Time Offset from Average Pace (seconds)")
    ax.set_title(title)

    handles, labels = ax.get_legend_handles_labels()
    if handles:
        sorted_pairs = sorted(
            zip(handles, labels),
            key=lambda x: int(x[1].split(".")[0]) if "." in x[1] else 999,
        )
        sorted_handles, sorted_labels = zip(*sorted_pairs)
        ax.legend(sorted_handles, sorted_labels, bbox_to_anchor=(1.02, 1), loc="upper left")

    ax.grid(alpha=0.2)
    fig.text(
        0.01,
        0.01,
        "Yellow shading: Safety Car Period | Dots in lines: Pitstops",
        ha="left",
        va="bottom",
        fontsize=10,
        color="gray",
    )
    plt.tight_layout(rect=(0, 0.04, 1, 1))
    return fig


def main():
    st.set_page_config(page_title="F1 Race Trace App", layout="wide")
    st.title("F1 Race Trace App")
    st.caption("Interactive race pace trace powered by FastF1")

    current_year = datetime.now().year

    with st.sidebar:
        st.header("Race Selection")
        year_options = list(range(2018, current_year + 1))
        preferred_year = st.session_state.get("year_choice", min(2024, current_year))
        if preferred_year not in year_options:
            preferred_year = year_options[-1]

        year = st.selectbox(
            "Year",
            options=year_options,
            index=year_options.index(preferred_year),
        )
        st.session_state["year_choice"] = int(year)

        try:
            race_options = get_race_options(int(year))
        except Exception as exc:
            st.error(f"Could not load race list for {year}: {exc}")
            race_options = []

        if race_options:
            preferred_race = st.session_state.get("race_name_choice", "")
            if preferred_race in race_options:
                race_index = race_options.index(preferred_race)
            elif "Japanese Grand Prix" in race_options:
                race_index = race_options.index("Japanese Grand Prix")
            else:
                race_index = 0

            race_name = st.selectbox(
                "Race Name",
                options=race_options,
                index=race_index,
            )
            st.session_state["race_name_choice"] = race_name
        else:
            race_name = ""
            st.warning("No races found for this year.")

        load_clicked = st.button("Load Race", type="primary", disabled=not race_options)

    race_key = (int(year), race_name.strip().lower())
    if load_clicked:
        try:
            with st.spinner("Loading session data from FastF1..."):
                session = load_race_session(int(year), race_name.strip())
                data = compute_race_data(session)
        except Exception as exc:
            st.error(f"Could not load race data: {exc}")
            return

        race_title = build_race_title(session, int(year), race_name.strip())

        st.session_state["race_key"] = race_key
        st.session_state["race_data"] = data
        st.session_state["race_title"] = race_title

        all_abbs = sorted([info["abbreviation"] for info in data["driver_info"].values()])
        min_lap = min(data["lap_numbers"])
        max_lap = max(data["lap_numbers"])
        st.session_state["selected_abbs"] = all_abbs[: min(6, len(all_abbs))]
        st.session_state["selected_laps"] = (min_lap, max_lap)

    if "race_data" not in st.session_state:
        st.info("Choose a year and race name, then click Load Race.")
        return

    data = st.session_state["race_data"]
    race_title = st.session_state["race_title"]
    st.success(race_title)

    full_fig = build_plot(data, f"Race Trace - {race_title}")
    st.pyplot(full_fig)

    st.subheader("Filtered View")
    all_abbs = sorted([info["abbreviation"] for info in data["driver_info"].values()])
    min_lap = min(data["lap_numbers"])
    max_lap = max(data["lap_numbers"])
    with st.form("filter_form"):
        selected_abbs = st.multiselect(
            "Drivers",
            options=all_abbs,
            default=st.session_state.get("selected_abbs", all_abbs[: min(6, len(all_abbs))]),
            help="Leave empty to show all drivers.",
        )
        selected_laps = st.slider(
            "Lap Range",
            min_value=min_lap,
            max_value=max_lap,
            value=st.session_state.get("selected_laps", (min_lap, max_lap)),
            step=1,
        )
        plot_clicked = st.form_submit_button("Plot")

    if plot_clicked:
        st.session_state["selected_abbs"] = selected_abbs
        st.session_state["selected_laps"] = selected_laps

    chosen_abbs = st.session_state.get("selected_abbs", [])
    chosen_abbs = chosen_abbs if chosen_abbs else None
    chosen_laps = st.session_state.get("selected_laps", (min_lap, max_lap))

    filtered_fig = build_plot(
        data,
        f"Filtered Race Trace - {race_title}",
        selected_abbs=chosen_abbs,
        lap_range=chosen_laps,
    )
    st.pyplot(filtered_fig)


if __name__ == "__main__":
    main()
