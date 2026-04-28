from datetime import datetime
import fastf1
import fastf1.plotting
import matplotlib as mpl
import seaborn as sns
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
import numpy as np
import pandas as pd
import streamlit as st

#CACHE_DIR = os.path.join(os.path.dirname(__file__), ".fastf1-cache")
# Use /tmp so the app works in ephemeral cloud environments like Streamlit Community Cloud.
#CACHE_DIR = os.path.join(tempfile.gettempdir(), "fastf1-cache")
#os.makedirs(CACHE_DIR, exist_ok=True)
#fastf1.Cache.enable_cache(CACHE_DIR)


def add_plot_tag(fig, tag="@chrischu-yc"):
    fig.text(
        0.99,
        0.01,
        tag,
        ha="right",
        va="bottom",
        fontsize=8,
        color="gray",
        alpha=0.8,
    )


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

    lap_pace = valid_laps.groupby("LapNumber")["LapSeconds"].median().to_dict()

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
                # Positive values mean faster than median lap pace.
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
    # Match the original notebook behavior by skipping the first detected SC lap.
    safety_car_laps = safety_car_laps[1:]

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
    plt.rcdefaults()

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
    ax.set_ylabel("Time Offset from Median Pace (seconds)")
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
    add_plot_tag(fig)
    plt.tight_layout(rect=(0, 0.04, 1, 1))
    plt.rcdefaults()
    return fig


def build_team_pace_comparison_plot(session, race_title):
    plt.rcdefaults()
    fastf1.plotting.setup_mpl(mpl_timedelta_support=False, color_scheme="fastf1")
    try:
        race_laps = session.laps.pick_quicklaps().copy()

        transformed_laps = race_laps.copy()
        transformed_laps.loc[:, "LapTime (s)"] = transformed_laps["LapTime"].dt.total_seconds()
        transformed_laps = transformed_laps[
            transformed_laps["LapTime (s)"].notna() & transformed_laps["Team"].notna()
        ]

        if transformed_laps.empty:
            raise ValueError("No quick lap data available for team pace comparison.")

        def _normalize_team_color(color_value):
            if pd.isna(color_value):
                return "gray"

            color_text = str(color_value).strip()
            if not color_text or color_text.lower() in {"nan", "none", "null"}:
                return "gray"

            if not color_text.startswith("#"):
                color_text = f"#{color_text}"

            return color_text if mpl.colors.is_color_like(color_text) else "gray"

        team_order = (
            transformed_laps[["Team", "LapTime (s)"]]
            .groupby("Team")
            .median()["LapTime (s)"]
            .sort_values()
            .index
        )

        team_palette = {}
        results_team_palette = {}
        if {"TeamName", "TeamColor"}.issubset(session.results.columns):
            for _, row in session.results[["TeamName", "TeamColor"]].iterrows():
                team_name = str(row["TeamName"])
                results_team_palette[team_name] = _normalize_team_color(row["TeamColor"])

        for team in team_order:
            if team in results_team_palette:
                team_palette[team] = results_team_palette[team]
            else:
                try:
                    team_palette[team] = _normalize_team_color(fastf1.plotting.get_team_color(team, session=session))
                except Exception:
                    team_palette[team] = "gray"

        fig, ax = plt.subplots(figsize=(15, 8))
        sns.boxplot(
            data=transformed_laps,
            x="Team",
            y="LapTime (s)",
            hue="Team",
            order=team_order,
            palette=team_palette,
            whiskerprops={"color": "white"},
            boxprops={"edgecolor": "white"},
            medianprops={"color": "white"},
            capprops={"color": "white"},
            ax=ax,
        )

        legend = ax.get_legend()
        if legend is not None:
            legend.remove()

        ax.set_title(f"{race_title} - Team Pace Comparison", fontsize=14)
        ax.set_xlabel("")
        ax.set_ylabel("Lap Time (s)")
        ax.tick_params(axis="x", rotation=25)
        ax.grid(axis="y", alpha=0.2)
        add_plot_tag(fig)
        fig.tight_layout()
        return fig
    finally:
        plt.rcdefaults()


def build_tyre_strategy_comparison_plot(session, race_title, selected_drivers=None, plot_title=None):
    plt.rcdefaults()
    try:
        laps = session.laps[["Driver", "Stint", "Compound", "LapNumber"]].dropna(
            subset=["Driver", "Stint", "Compound", "LapNumber"]
        ).copy()

        if laps.empty:
            raise ValueError("No stint data available for tyre strategy comparison.")

        if selected_drivers:
            selected_driver_set = {str(driver) for driver in selected_drivers}
            laps = laps[laps["Driver"].astype(str).isin(selected_driver_set)].copy()
            if laps.empty:
                raise ValueError("No stint data available for the selected drivers.")

        stints = (
            laps.groupby(["Driver", "Stint", "Compound"], sort=True)
            .agg(StartLap=("LapNumber", "min"), StintLength=("LapNumber", "count"))
            .reset_index()
        )

        stints["Driver"] = stints["Driver"].astype(str)
        stints["Compound"] = stints["Compound"].astype(str)

        if selected_drivers:
            driver_order = [str(driver) for driver in selected_drivers if str(driver) in stints["Driver"].unique().tolist()]
        else:
            driver_order = []
            if "Abbreviation" in session.results.columns:
                driver_order = [
                    abb
                    for abb in session.results["Abbreviation"].dropna().astype(str).tolist()
                    if abb in stints["Driver"].unique().tolist()
                ]

        if not driver_order:
            driver_order = sorted(stints["Driver"].unique().tolist())

        manual_compound_colors = {
            "SOFT": "red",
            "MEDIUM": "yellow",
            "HARD": "white",
            "INTERMEDIATE": "green",
            "WET": "blue",
        }

        def _manual_compound_color(compound_value):
            return manual_compound_colors.get(str(compound_value).strip().upper(), "gray")

        def _normalize_compound_color(color_value, compound_value):
            color_text = str(color_value).strip()
            if not color_text or color_text.lower() in {"nan", "none", "null"}:
                return _manual_compound_color(compound_value)
            if not color_text.startswith("#"):
                color_text = f"#{color_text}"
            return color_text if mpl.colors.is_color_like(color_text) else _manual_compound_color(compound_value)

        compound_order = []
        seen_compounds = set()
        for compound in stints["Compound"].tolist():
            if compound not in seen_compounds:
                seen_compounds.add(compound)
                compound_order.append(compound)

        compound_palette = {}
        for compound in compound_order:
            try:
                compound_palette[compound] = _normalize_compound_color(
                    fastf1.plotting.get_compound_color(compound, session=session),
                    compound,
                )
            except Exception:
                compound_palette[compound] = _manual_compound_color(compound)

        if selected_drivers:
            fig, ax = plt.subplots(figsize=(15, 4.5))
            y_positions = np.arange(len(driver_order))

            for idx, driver in enumerate(driver_order):
                driver_stints = stints[stints["Driver"] == driver].sort_values(["StartLap", "Stint"])

                for _, row in driver_stints.iterrows():
                    compound_color = compound_palette.get(row["Compound"], "gray")
                    ax.barh(
                        idx,
                        row["StintLength"],
                        left=float(row["StartLap"]) - 0.5,
                        height=0.6,
                        color=compound_color,
                        edgecolor="black",
                        linewidth=0.6,
                    )

            legend_handles = [
                mpl.patches.Patch(facecolor=compound_palette[compound], label=compound)
                for compound in compound_order
            ]
            if legend_handles:
                ax.legend(handles=legend_handles, title="Compound", bbox_to_anchor=(1.02, 1), loc="upper left")

            ax.set_yticks(y_positions)
            ax.set_yticklabels([get_driver_display_name(session, driver) for driver in driver_order])
            ax.set_xlabel("Lap Number")
            max_lap = int((stints["StartLap"] + stints["StintLength"] - 1).max())
            tick_step = 1 if max_lap <= 30 else 2 if max_lap <= 60 else 5
            ax.set_xlim(0.5, max_lap + 0.5)
            ax.set_xticks(np.arange(1, max_lap + 1, tick_step))
            ax.set_title(plot_title or f"{race_title} - Tyre Strategy Comparison", fontsize=16)
            ax.grid(axis="x", alpha=0.3)
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
            ax.spines["left"].set_color("gray")
            add_plot_tag(fig)
            fig.tight_layout()
            return fig

        fig, ax = plt.subplots(figsize=(15, 8))
        x_positions = np.arange(len(driver_order))

        for idx, driver in enumerate(driver_order):
            driver_stints = stints[stints["Driver"] == driver].sort_values(["StartLap", "Stint"])
            previous_stint_end = 0

            for _, row in driver_stints.iterrows():
                compound_color = compound_palette.get(row["Compound"], "gray")
                ax.bar(
                    idx,
                    row["StintLength"],
                    bottom=previous_stint_end,
                    color=compound_color,
                    edgecolor="black",
                    linewidth=0.6,
                    width=0.75,
                )
                previous_stint_end += row["StintLength"]

        legend_handles = [
            mpl.patches.Patch(facecolor=compound_palette[compound], label=compound)
            for compound in compound_order
        ]
        if legend_handles:
            ax.legend(handles=legend_handles, title="Compound", bbox_to_anchor=(1.02, 1), loc="upper left")

        ax.set_xticks(x_positions)
        ax.set_xticklabels([get_driver_display_name(session, driver) for driver in driver_order])
        ax.set_ylabel("Lap Number")
        ax.set_title(plot_title or f"{race_title} - Tyre Strategy Overview", fontsize=16)
        ax.grid(axis="y", alpha=0.3)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["bottom"].set_visible(False)
        #ax.spines["left"].set_color("gray")
        add_plot_tag(fig)
        fig.tight_layout()
        return fig
    finally:
        plt.rcdefaults()


def get_team_options(session):
    if "TeamName" not in session.results.columns:
        return []

    teams = session.results["TeamName"].dropna().astype(str).tolist()
    ordered_unique_teams = []
    seen = set()
    for team in teams:
        if team not in seen:
            seen.add(team)
            ordered_unique_teams.append(team)
    return ordered_unique_teams


def get_driver_options(session):
    if "Abbreviation" not in session.results.columns:
        return []

    results = session.results.copy()
    if "Position" in results.columns:
        results["_driver_sort_position"] = pd.to_numeric(results["Position"], errors="coerce").fillna(999)
        results = results.sort_values(["_driver_sort_position", "Abbreviation"])

    driver_options = []
    seen = set()
    for abbreviation in results["Abbreviation"].dropna().astype(str).tolist():
        if abbreviation not in seen:
            seen.add(abbreviation)
            driver_options.append(abbreviation)

    return driver_options


def get_driver_result_row(session, driver_abbreviation):
    if "Abbreviation" not in session.results.columns:
        return None

    rows = session.results[session.results["Abbreviation"].astype(str) == str(driver_abbreviation)]
    if rows.empty:
        return None

    return rows.iloc[0]


def get_driver_finish_position(session, driver_abbreviation):
    row = get_driver_result_row(session, driver_abbreviation)
    if row is None:
        return "N/A"

    position_value = row.get("Position")
    if pd.isna(position_value):
        return "N/A"

    try:
        return str(int(position_value))
    except (TypeError, ValueError):
        return str(position_value)


def get_driver_display_name(session, driver_abbreviation):
    row = get_driver_result_row(session, driver_abbreviation)
    if row is None:
        return str(driver_abbreviation)

    full_name = row.get("FullName")
    if pd.notna(full_name):
        full_name_text = str(full_name).strip()
        if full_name_text:
            return full_name_text

    first_name = str(row.get("FirstName", "")).strip()
    last_name = str(row.get("LastName", "")).strip()
    combined_name = " ".join(part for part in [first_name, last_name] if part)
    if combined_name:
        return combined_name

    broadcast_name = row.get("BroadcastName")
    if pd.notna(broadcast_name):
        broadcast_name_text = str(broadcast_name).strip()
        if broadcast_name_text:
            return broadcast_name_text

    return str(driver_abbreviation)


def get_driver_team_color(session, driver_abbreviation):
    row = get_driver_result_row(session, driver_abbreviation)
    if row is None:
        return "gray"

    color_value = str(row.get("TeamColor", "")).strip().lstrip("#")
    if not color_value or color_value.lower() in {"nan", "none", "null"}:
        return "gray"

    color_text = f"#{color_value}"
    return color_text if mpl.colors.is_color_like(color_text) else "gray"


def build_team_fastest_lap_comparison_plot(session, team_name, race_title):
    plt.rcdefaults()
    fastf1.plotting.setup_mpl(mpl_timedelta_support=True, color_scheme="fastf1")
    try:
        team_results = session.results[session.results["TeamName"].astype(str) == str(team_name)]
        driver_abb = team_results["Abbreviation"].dropna().astype(str).tolist()

        if len(driver_abb) < 2:
            raise ValueError("This team does not have two drivers available for comparison.")

        circuit_info = session.get_circuit_info()
        fig, ax = plt.subplots(figsize=(12, 6))
        faster_driver = driver_abb[0]
        last_car_data = None

        for abb in driver_abb[:2]:
            fastest_lap = session.laps.pick_drivers(abb).pick_fastest()
            if fastest_lap is None or pd.isna(fastest_lap["LapTime"]):
                continue

            lap_time = fastest_lap["LapTime"].total_seconds()
            car_data = fastest_lap.get_car_data().add_distance()
            last_car_data = car_data
            team_color = str(team_results[team_results["Abbreviation"].astype(str) == abb]["TeamColor"].iloc[0]).lstrip("#")
            color = f"#{team_color}" if abb == faster_driver else "thistle"
            style = "-" if abb == faster_driver else "-."
            label = f"{fastest_lap['Driver']} - {lap_time:.3f} s"
            ax.plot(car_data["Distance"], car_data["Speed"], color=color, linestyle=style, label=label)

        if last_car_data is not None:
            v_min = last_car_data["Speed"].min()
            v_max = last_car_data["Speed"].max()
            ax.vlines(
                x=circuit_info.corners["Distance"],
                ymin=v_min - 10,
                ymax=v_max + 10,
                linestyles="dotted",
                colors="grey",
            )

            for _, corner in circuit_info.corners.iterrows():
                txt = f"{corner['Number']}{corner['Letter']}"
                ax.text(
                    corner["Distance"],
                    v_min - 20,
                    txt,
                    va="center_baseline",
                    ha="center",
                    size="small",
                )

            ax.set_ylim([v_min - 30, v_max + 20])

        ax.set_xlabel("Distance in m")
        ax.set_ylabel("Speed in km/h")
        ax.set_title(f"{race_title} - {team_name} - Fastest Lap Comparison")
        ax.legend()
        fig.set_size_inches(12, 6)
        add_plot_tag(fig)
        fig.tight_layout()
        return fig
    finally:
        plt.rcdefaults()


def build_driver_fastest_lap_comparison_plot(session, driver_a, driver_b, race_title):
    plt.rcdefaults()
    fastf1.plotting.setup_mpl(mpl_timedelta_support=True, color_scheme="fastf1")
    try:
        circuit_info = session.get_circuit_info()
        fig, ax = plt.subplots(figsize=(12, 6))
        last_car_data = None
        driver_a_name = get_driver_display_name(session, driver_a)
        driver_b_name = get_driver_display_name(session, driver_b)

        for idx, driver_abbreviation in enumerate([driver_a, driver_b]):
            fastest_lap = session.laps.pick_drivers(driver_abbreviation).pick_fastest()
            if fastest_lap is None or pd.isna(fastest_lap["LapTime"]):
                continue

            lap_time = fastest_lap["LapTime"].total_seconds()
            car_data = fastest_lap.get_car_data().add_distance()
            last_car_data = car_data
            color = get_driver_team_color(session, driver_abbreviation)
            style = "-" if idx == 0 else "-."
            label = f"{get_driver_display_name(session, driver_abbreviation)} - {lap_time:.3f} s"
            ax.plot(car_data["Distance"], car_data["Speed"], color=color, linestyle=style, label=label)

        if last_car_data is not None:
            v_min = last_car_data["Speed"].min()
            v_max = last_car_data["Speed"].max()
            ax.vlines(
                x=circuit_info.corners["Distance"],
                ymin=v_min - 10,
                ymax=v_max + 10,
                linestyles="dotted",
                colors="grey",
            )

            for _, corner in circuit_info.corners.iterrows():
                txt = f"{corner['Number']}{corner['Letter']}"
                ax.text(
                    corner["Distance"],
                    v_min - 20,
                    txt,
                    va="center_baseline",
                    ha="center",
                    size="small",
                )

            ax.set_ylim([v_min - 30, v_max + 20])

        ax.set_xlabel("Distance in m")
        ax.set_ylabel("Speed in km/h")
        ax.set_title(f"{race_title} - {driver_a_name} vs {driver_b_name} - Fastest Lap Comparison", size=14)
        ax.legend()
        fig.set_size_inches(14, 6)
        add_plot_tag(fig)
        fig.tight_layout()
        return fig
    finally:
        plt.rcdefaults()


def build_driver_fastest_lap_metric_plot(
    session,
    driver_a,
    driver_b,
    race_title,
    metric_column,
    y_label,
    plot_suffix,
    low_padding,
    high_padding,
    corner_label_offset,
):
    plt.rcdefaults()
    fastf1.plotting.setup_mpl(mpl_timedelta_support=True, color_scheme="fastf1")
    try:
        circuit_info = session.get_circuit_info()
        fig, ax = plt.subplots(figsize=(14, 6))
        driver_a_name = get_driver_display_name(session, driver_a)
        driver_b_name = get_driver_display_name(session, driver_b)
        all_metric_values = []

        for idx, driver_abbreviation in enumerate([driver_a, driver_b]):
            fastest_lap = session.laps.pick_drivers(driver_abbreviation).pick_fastest()
            if fastest_lap is None or pd.isna(fastest_lap["LapTime"]):
                continue

            lap_time = fastest_lap["LapTime"].total_seconds()
            car_data = fastest_lap.get_car_data().add_distance()
            metric_values = car_data[metric_column].dropna()
            if not metric_values.empty:
                all_metric_values.append(metric_values)

            color = get_driver_team_color(session, driver_abbreviation)
            style = "-" if idx == 0 else "-."
            label = f"{get_driver_display_name(session, driver_abbreviation)} - {lap_time:.3f} s"
            ax.plot(car_data["Distance"], car_data[metric_column], color=color, linestyle=style, label=label)

        if all_metric_values:
            combined_values = pd.concat(all_metric_values)
            v_min = combined_values.min()
            v_max = combined_values.max()
            ax.vlines(
                x=circuit_info.corners["Distance"],
                ymin=v_min - low_padding,
                ymax=v_max + high_padding,
                linestyles="dotted",
                colors="grey",
            )

            for _, corner in circuit_info.corners.iterrows():
                txt = f"{corner['Number']}{corner['Letter']}"
                ax.text(
                    corner["Distance"],
                    v_min + corner_label_offset,
                    txt,
                    va="center_baseline",
                    ha="center",
                    size="small",
                )

            ax.set_ylim([v_min - low_padding, v_max + high_padding])

        ax.set_xlabel("Distance in m")
        ax.set_ylabel(y_label)
        ax.set_title(f"{race_title} - {driver_a_name} vs {driver_b_name} - {plot_suffix}", size=14)
        ax.legend()
        add_plot_tag(fig)
        fig.tight_layout()
        return fig
    finally:
        plt.rcdefaults()


def build_driver_lap_time_plot(session, driver_a, driver_b, race_title):
    plt.rcdefaults()
    fastf1.plotting.setup_mpl(mpl_timedelta_support=True, color_scheme="fastf1")
    try:
        fig, ax = plt.subplots(figsize=(12, 6))
        driver_markers = {driver_a: "o", driver_b: "D"}
        driver_a_name = get_driver_display_name(session, driver_a)
        driver_b_name = get_driver_display_name(session, driver_b)

        race_data = st.session_state.get("race_data", {})
        safety_car_laps = race_data.get("safety_car_laps", []) if isinstance(race_data, dict) else []

        for driver_abbreviation in [driver_a, driver_b]:
            driver_laps = session.laps.pick_drivers(driver_abbreviation).pick_quicklaps().reset_index()
            if driver_laps.empty:
                continue

            driver_laps = driver_laps[driver_laps["LapTime"].notna()].copy()
            if driver_laps.empty:
                continue

            driver_color = get_driver_team_color(session, driver_abbreviation)
            sns.scatterplot(
                data=driver_laps,
                x="LapNumber",
                y="LapTime",
                marker=driver_markers[driver_abbreviation],
                s=55,
                alpha=0.8,
                color=driver_color,
                edgecolor="black",
                linewidth=0.4,
                ax=ax,
                legend=False,
            )

        try:
            lap_numbers_all = session.laps["LapNumber"].dropna().astype(int)
            lap_min = int(lap_numbers_all.min()) if not lap_numbers_all.empty else 1
            lap_max = int(lap_numbers_all.max()) if not lap_numbers_all.empty else None
        except Exception:
            lap_min, lap_max = 1, None

        for sc_lap in safety_car_laps:
            try:
                sc_l = int(sc_lap)
            except Exception:
                continue
            if lap_min <= sc_l and (lap_max is None or sc_l <= lap_max):
                ax.axvspan(sc_l - 1, sc_l, color="yellow", alpha=0.3, linewidth=0)

        handles = [
            mpl.lines.Line2D(
                [], [],
                linestyle="None",
                marker=driver_markers[driver_abbreviation],
                markersize=8,
                markerfacecolor=get_driver_team_color(session, driver_abbreviation),
                markeredgecolor="black",
                label=get_driver_display_name(session, driver_abbreviation),
            )
            for driver_abbreviation in [driver_a, driver_b]
        ]

        ax.set_xlabel("Lap Number", size=12)
        ax.set_ylabel("Lap Time", size=12)
        ax.set_title(f"{race_title} - {driver_a_name} vs {driver_b_name} - Lap Times", size=12)
        ax.grid(alpha=0.2)
        ax.invert_yaxis()
        ax.legend(handles=handles, title="Driver", bbox_to_anchor=(1.02, 1), loc="upper left")
        add_plot_tag(fig)
        plt.tight_layout()
        return fig
    finally:
        plt.rcdefaults()


def build_team_track_map_plot(session, team_name, race_title):
    plt.rcdefaults()
    try:
        team_results = session.results[session.results["TeamName"].astype(str) == str(team_name)]
        driver_abb = team_results["Abbreviation"].dropna().astype(str).tolist()

        if len(driver_abb) < 1:
            raise ValueError("No drivers found for the selected team.")

        faster_driver = driver_abb[0]
        fastest_lap = session.laps.pick_drivers(faster_driver).pick_fastest()
        if fastest_lap is None:
            raise ValueError("Could not find a fastest lap for the selected team.")

        circuit_info = session.get_circuit_info()

        telemetry = fastest_lap.get_telemetry()
        x = telemetry["X"]
        y = telemetry["Y"]
        color = telemetry["Speed"]
        colormap = mpl.cm.plasma
        points = np.array([x, y]).T.reshape(-1, 1, 2)
        segments = np.concatenate([points[:-1], points[1:]], axis=1)

        pos = fastest_lap.get_pos_data()

        def rotate(xy, *, angle):
            rot_mat = np.array([[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]])
            return np.matmul(xy, rot_mat)

        track = pos.loc[:, ("X", "Y")].to_numpy()
        track_angle = circuit_info.rotation / 180 * np.pi
        rotated_track = rotate(track, angle=track_angle)
        rotated_points = rotate(np.array([x, y]).T, angle=track_angle)
        rotated_segments = np.concatenate([
            rotated_points[:-1].reshape(-1, 1, 2),
            rotated_points[1:].reshape(-1, 1, 2),
        ], axis=1)

        fig, ax = plt.subplots(sharex=True, sharey=True, figsize=(12, 6.75))
        fig.suptitle(f"{race_title} - {faster_driver} - Fastest Lap", size=18, y=0.97)
        plt.subplots_adjust(left=0.1, right=0.9, top=0.9, bottom=0.12)
        ax.axis("off")
        ax.plot(
            rotated_track[:, 0],
            rotated_track[:, 1],
            color="black",
            linestyle="-",
            linewidth=16,
            zorder=0,
        )

        norm = plt.Normalize(color.min(), color.max())
        lc = LineCollection(rotated_segments, cmap=colormap, norm=norm, linestyle="-", linewidth=5)
        lc.set_array(color)
        ax.add_collection(lc)

        cbaxes = fig.add_axes([0.25, 0.05, 0.5, 0.05])
        normlegend = mpl.colors.Normalize(vmin=color.min(), vmax=color.max())
        legend = mpl.colorbar.ColorbarBase(cbaxes, norm=normlegend, cmap=colormap, orientation="horizontal")
        legend.set_label("Speed in km/h", size="small")

        offset_vector = [500, 0]
        for _, corner in circuit_info.corners.iterrows():
            txt = f"{corner['Number']}{corner['Letter']}"
            offset_angle = corner["Angle"] / 180 * np.pi
            offset_x, offset_y = rotate(offset_vector, angle=offset_angle)
            text_x = corner["X"] + offset_x
            text_y = corner["Y"] + offset_y
            text_x, text_y = rotate([text_x, text_y], angle=track_angle)
            track_x, track_y = rotate([corner["X"], corner["Y"]], angle=track_angle)
            ax.scatter(text_x, text_y, color="grey", s=140)
            ax.plot([track_x, text_x], [track_y, text_y], color="grey")
            ax.text(text_x, text_y, txt, va="center_baseline", ha="center", size="small", color="white")

        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_aspect("equal", adjustable="box")
        add_plot_tag(fig)

        return fig
    finally:
        plt.rcdefaults()


def build_driver_fastest_lap_track_map_plot(session, driver_abbreviation, race_title, metric_column, metric_label, plot_title_suffix):
    plt.rcdefaults()
    try:
        fastest_lap = session.laps.pick_drivers(driver_abbreviation).pick_fastest()
        if fastest_lap is None:
            raise ValueError("Could not find a fastest lap for the selected driver.")

        telemetry = fastest_lap.get_telemetry()
        if metric_column not in telemetry.columns:
            raise ValueError(f"Telemetry does not include {metric_column}.")

        circuit_info = session.get_circuit_info()
        x = telemetry["X"]
        y = telemetry["Y"]
        color = telemetry[metric_column]
        colormap = mpl.cm.plasma
        points = np.array([x, y]).T.reshape(-1, 1, 2)
        segments = np.concatenate([points[:-1], points[1:]], axis=1)

        pos = fastest_lap.get_pos_data()

        def rotate(xy, *, angle):
            rot_mat = np.array([[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]])
            return np.matmul(xy, rot_mat)

        track = pos.loc[:, ("X", "Y")].to_numpy()
        track_angle = circuit_info.rotation / 180 * np.pi
        rotated_track = rotate(track, angle=track_angle)
        rotated_points = rotate(np.array([x, y]).T, angle=track_angle)
        rotated_segments = np.concatenate([
            rotated_points[:-1].reshape(-1, 1, 2),
            rotated_points[1:].reshape(-1, 1, 2),
        ], axis=1)

        driver_name = get_driver_display_name(session, driver_abbreviation)
        fig, ax = plt.subplots(sharex=True, sharey=True, figsize=(12, 6.75))
        fig.suptitle(f"{race_title} - {driver_name} - {plot_title_suffix}", size=18, y=0.97)
        plt.subplots_adjust(left=0.1, right=0.9, top=0.9, bottom=0.12)
        ax.axis("off")
        ax.plot(
            rotated_track[:, 0],
            rotated_track[:, 1],
            color="black",
            linestyle="-",
            linewidth=16,
            zorder=0,
        )

        norm = plt.Normalize(color.min(), color.max())
        lc = LineCollection(rotated_segments, cmap=colormap, norm=norm, linestyle="-", linewidth=5)
        lc.set_array(color)
        ax.add_collection(lc)

        cbaxes = fig.add_axes([0.25, 0.05, 0.5, 0.05])
        normlegend = mpl.colors.Normalize(vmin=color.min(), vmax=color.max())
        legend = mpl.colorbar.ColorbarBase(cbaxes, norm=normlegend, cmap=colormap, orientation="horizontal")
        legend.set_label(metric_label, size="small")

        offset_vector = [500, 0]
        for _, corner in circuit_info.corners.iterrows():
            txt = f"{corner['Number']}{corner['Letter']}"
            offset_angle = corner["Angle"] / 180 * np.pi
            offset_x, offset_y = rotate(offset_vector, angle=offset_angle)
            text_x = corner["X"] + offset_x
            text_y = corner["Y"] + offset_y
            text_x, text_y = rotate([text_x, text_y], angle=track_angle)
            track_x, track_y = rotate([corner["X"], corner["Y"]], angle=track_angle)
            ax.scatter(text_x, text_y, color="grey", s=140)
            ax.plot([track_x, text_x], [track_y, text_y], color="grey")
            ax.text(text_x, text_y, txt, va="center_baseline", ha="center", size="small", color="white")

        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_aspect("equal", adjustable="box")
        add_plot_tag(fig)

        return fig
    finally:
        plt.rcdefaults()


def build_driver_gear_shift_comparison_plot(session, driver_a, driver_b, race_title):
    plt.rcdefaults()
    try:
        circuit_info = session.get_circuit_info()
        driver_order = [driver_a, driver_b]
        driver_data = {}
        gear_values = []

        for driver_abbreviation in driver_order:
            fastest_lap = session.laps.pick_drivers(driver_abbreviation).pick_fastest()
            if fastest_lap is None:
                raise ValueError("Could not find a fastest lap for the selected driver.")

            telemetry = fastest_lap.get_telemetry()
            if "nGear" not in telemetry.columns:
                raise ValueError("Telemetry does not include nGear.")

            telemetry = telemetry.dropna(subset=["X", "Y", "nGear"]).copy()
            if telemetry.empty:
                raise ValueError("No gear telemetry available for the selected driver.")

            gear_values.append(telemetry["nGear"].astype(int))
            driver_data[driver_abbreviation] = {
                "driver_name": get_driver_display_name(session, driver_abbreviation),
                "telemetry": telemetry,
                "pos_data": fastest_lap.get_pos_data(),
            }

        combined_gears = pd.concat(gear_values)
        min_gear = int(combined_gears.min())
        max_gear = int(combined_gears.max())
        gear_levels = np.arange(min_gear, max_gear + 1)

        base_cmap = plt.get_cmap("turbo", len(gear_levels))
        gear_colors = base_cmap(np.arange(len(gear_levels)))
        gear_cmap = mpl.colors.ListedColormap(gear_colors)
        gear_norm = mpl.colors.BoundaryNorm(np.arange(min_gear - 0.5, max_gear + 1.5, 1), gear_cmap.N)

        def rotate(xy, *, angle):
            rot_mat = np.array([[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]])
            return np.matmul(xy, rot_mat)

        fig, axes = plt.subplots(1, 2, sharex=True, sharey=True, figsize=(16, 7))
        fig.suptitle(f"{race_title} - Gear Shift Comparison", size=18, y=0.97)
        plt.subplots_adjust(left=0.04, right=0.96, top=0.88, bottom=0.18, wspace=0.04)

        offset_vector = [500, 0]
        track_angle = circuit_info.rotation / 180 * np.pi

        for ax, driver_abbreviation in zip(axes, driver_order):
            telemetry = driver_data[driver_abbreviation]["telemetry"]
            pos_data = driver_data[driver_abbreviation]["pos_data"]
            track = pos_data.loc[:, ("X", "Y")].to_numpy()
            x = telemetry["X"].to_numpy()
            y = telemetry["Y"].to_numpy()
            gear = telemetry["nGear"].astype(int).to_numpy()

            points = np.array([x, y]).T.reshape(-1, 1, 2)
            segments = np.concatenate([points[:-1], points[1:]], axis=1)

            rotated_track = rotate(track, angle=track_angle)
            rotated_points = rotate(np.array([x, y]).T, angle=track_angle)
            rotated_segments = np.concatenate([
                rotated_points[:-1].reshape(-1, 1, 2),
                rotated_points[1:].reshape(-1, 1, 2),
            ], axis=1)

            ax.axis("off")
            ax.plot(
                rotated_track[:, 0],
                rotated_track[:, 1],
                color="black",
                linestyle="-",
                linewidth=16,
                zorder=0,
            )

            lc = LineCollection(rotated_segments, cmap=gear_cmap, norm=gear_norm, linestyle="-", linewidth=5)
            lc.set_array(gear)
            ax.add_collection(lc)

            for _, corner in circuit_info.corners.iterrows():
                txt = f"{corner['Number']}{corner['Letter']}"
                offset_angle = corner["Angle"] / 180 * np.pi
                offset_x, offset_y = rotate(offset_vector, angle=offset_angle)
                text_x = corner["X"] + offset_x
                text_y = corner["Y"] + offset_y
                text_x, text_y = rotate([text_x, text_y], angle=track_angle)
                track_x, track_y = rotate([corner["X"], corner["Y"]], angle=track_angle)
                ax.scatter(text_x, text_y, color="grey", s=140)
                ax.plot([track_x, text_x], [track_y, text_y], color="grey")
                ax.text(text_x, text_y, txt, va="center_baseline", ha="center", size="small", color="white")

            ax.set_title(driver_data[driver_abbreviation]["driver_name"], size=14)
            ax.set_xticks([])
            ax.set_yticks([])
            ax.set_aspect("equal", adjustable="box")

        colorbar = fig.colorbar(
            mpl.cm.ScalarMappable(norm=gear_norm, cmap=gear_cmap),
            ax=axes,
            orientation="horizontal",
            fraction=0.04,
            pad=0.06,
            aspect=40,
        )
        colorbar.set_label("Gear number", size="small")
        colorbar.set_ticks(gear_levels)
        colorbar.set_ticklabels([str(int(gear)) for gear in gear_levels])

        add_plot_tag(fig)
        return fig
    finally:
        plt.rcdefaults()


def build_team_lap_time_plots(session, team_name, race_title):
    plt.rcdefaults()
    fastf1.plotting.setup_mpl(mpl_timedelta_support=True, color_scheme="fastf1")
    try:
        team_results = session.results[session.results["TeamName"].astype(str) == str(team_name)]
        driver_abb = team_results["Abbreviation"].dropna().astype(str).tolist()

        if not driver_abb:
            raise ValueError("No drivers found for the selected team.")

        base_tyre_colors = {
            "SOFT": "red",
            "MEDIUM": "yellow",
            "HARD": "white",
            "INTERMEDIATE": "green",
            "WET": "blue",
        }

        present_compounds = session.laps["Compound"].dropna().unique()
        tyre_colors = {compound: base_tyre_colors.get(compound, "gray") for compound in present_compounds}
        marker_cycle = ["o", "D", "^"]
        driver_markers = {abb: marker_cycle[i % len(marker_cycle)] for i, abb in enumerate(driver_abb)}

        fig, (ax_lap, ax_tire) = plt.subplots(1, 2, figsize=(14, 6), sharey=True)
        for abb in driver_abb:
            driver_laps = session.laps.pick_drivers(abb).pick_quicklaps().reset_index()
            if driver_laps.empty:
                continue

            driver_laps = driver_laps[driver_laps["LapTime"].notna()].copy()
            if driver_laps.empty:
                continue

            sns.scatterplot(
                data=driver_laps,
                x="LapNumber",
                y="LapTime",
                hue="Compound",
                palette=tyre_colors,
                marker=driver_markers[abb],
                s=55,
                alpha=0.8,
                ax=ax_lap,
                legend=False,
            )

            tire_laps = driver_laps[driver_laps["TyreLife"].notna()]
            sns.scatterplot(
                data=tire_laps,
                x="TyreLife",
                y="LapTime",
                hue="Compound",
                palette=tyre_colors,
                marker=driver_markers[abb],
                s=55,
                alpha=0.8,
                ax=ax_tire,
                legend=False,
            )

        driver_handles = [
            mpl.lines.Line2D(
                [], [],
                linestyle="None",
                marker=driver_markers[abb],
                markersize=8,
                markerfacecolor="lightgray",
                markeredgecolor="black",
                label=abb,
            )
            for abb in driver_abb
        ]

        # Shade Safety Car periods on the lap-number plot if available
        race_data = st.session_state.get("race_data", {})
        safety_car_laps = race_data.get("safety_car_laps", []) if isinstance(race_data, dict) else []
        try:
            lap_numbers_all = session.laps["LapNumber"].dropna().astype(int)
            lap_min = int(lap_numbers_all.min()) if not lap_numbers_all.empty else 1
            lap_max = int(lap_numbers_all.max()) if not lap_numbers_all.empty else None
        except Exception:
            lap_min, lap_max = 1, None

        for sc_lap in safety_car_laps:
            try:
                sc_l = int(sc_lap)
            except Exception:
                continue
            if lap_min <= sc_l and (lap_max is None or sc_l <= lap_max):
                ax_lap.axvspan(sc_l - 1, sc_l, color="yellow", alpha=0.3, linewidth=0)

        ax_lap.set_xlabel("Lap Number", size=12)
        ax_lap.set_ylabel("Lap Time", size=12)
        ax_lap.set_title("Lap Time vs Lap Number", size=11)
        ax_lap.grid(alpha=0.2)

        ax_tire.set_xlabel("Tyre Age", size=12)
        ax_tire.set_ylabel("")
        ax_tire.set_title("Lap Time vs Tyre Age", size=11)
        ax_tire.grid(alpha=0.2)

        ax_lap.invert_yaxis()
        ax_tire.legend(handles=driver_handles, title="Driver (marker)", bbox_to_anchor=(1.02, 1), loc="upper left")
        fig.suptitle(f"{race_title} - {team_name} - Lap Times", size=12)
        add_plot_tag(fig)
        plt.tight_layout()
        return fig
    finally:
        plt.rcdefaults()


def main():
    st.set_page_config(page_title="F1 Race Trace App", layout="wide")
    st.title("F1 Race Trace App")
    st.caption("Interactive race pace trace powered by FastF1. Made by Chris Chu. Find out more of my work at https://github.com/chrischu-yc. ")
    st.caption("Also check out my football analytics website at https://chrischu-yc.github.io/sports-analytics/statsbomb_opendata_visualize/")

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
            # Keep race selection state scoped to each year to avoid stale behavior.
            per_year_race_key = f"race_name_choice_{int(year)}"
            preferred_race = st.session_state.get(per_year_race_key, "")
            if preferred_race in race_options:
                race_index = race_options.index(preferred_race)
            else:
                race_index = 0

            race_name = st.selectbox(
                "Race Name",
                options=race_options,
                index=race_index,
                key=f"race_name_select_{int(year)}",
            )
            st.session_state[per_year_race_key] = race_name
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
        st.session_state["race_session"] = session
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
    st.success(f"{race_title}")
    race_overview_tab, team_specific_tab, driver_comparison_tab = st.tabs(["Race Overview", "Team Specific", "Driver Comparison"])

    with race_overview_tab:
        st.subheader("Race Trace")
        full_fig = build_plot(data, f"Race Trace - {race_title}")
        st.pyplot(full_fig)
        st.caption("Race trace documents the overall race progression by plotting each driver's cumulative offset from the median race pace lap by lap. The y-axis shows how much faster (positive) or slower (negative) a driver was compared to the median pace of that lap. Dots on the lines indicate pitstops, and yellow shaded areas represent Safety Car periods. Use the filters below to focus on specific drivers or lap ranges.")

        if "race_session" in st.session_state:
            st.subheader("Team Pace Comparison")
            try:
                team_pace_fig = build_team_pace_comparison_plot(
                    st.session_state["race_session"], race_title
                )
                st.pyplot(team_pace_fig)
                st.caption("Box plot showcases each team's 25th, 50th, and 75th percentile lap times. Half of the laps by a team fall within its box, with the median lap time indicated by the line inside the box. Teams are ordered from fastest median lap time to slowest.")
            except Exception as exc:
                st.warning(f"Could not generate team pace comparison: {exc}")

            st.subheader("Tyre Strategies Comparison")
            try:
                tyre_strategy_fig = build_tyre_strategy_comparison_plot(
                    st.session_state["race_session"], race_title
                )
                st.pyplot(tyre_strategy_fig)
                st.caption("Comparison of tyre strategies used by different teams during the race.")
            except Exception as exc:
                st.warning(f"Could not generate tyre strategy comparison: {exc}")
        else:
            st.info("Click Load Race to enable Team Pace Comparison chart.")

        st.subheader("Filtered Race Trace View")
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


    with team_specific_tab:
        st.subheader("Team Specific Visualization")
        st.caption("Select a team to explore its lap and telemetry views.")

        team_options = get_team_options(st.session_state["race_session"])
        if not team_options:
            st.info("No team data available for this session.")
        else:
            default_team = st.session_state.get("team_choice", team_options[0])
            if default_team not in team_options:
                default_team = team_options[0]

            team_name = st.selectbox(
                "Team",
                options=team_options,
                index=team_options.index(default_team),
                key=f"team_select_{st.session_state['race_key'][0]}_{st.session_state['race_key'][1]}",
            )
            st.session_state["team_choice"] = team_name

            st.markdown(f"#### {team_name}")

            st.markdown("##### Fastest Lap Comparison")
            st.caption("Compares the two drivers from the selected team on their fastest lap telemetry speed traces.")
            try:
                fastest_lap_fig = build_team_fastest_lap_comparison_plot(
                    st.session_state["race_session"], team_name, race_title
                )
                st.pyplot(fastest_lap_fig)
            except Exception as exc:
                st.warning(f"Could not generate fastest lap comparison: {exc}")

            st.markdown("##### Track Map")
            st.caption("Shows the selected team's fastest lap on the circuit with speed-colored telemetry and numbered corners.")
            try:
                track_map_fig = build_team_track_map_plot(
                    st.session_state["race_session"], team_name, race_title
                )
                st.pyplot(track_map_fig)
            except Exception as exc:
                st.warning(f"Could not generate track map plot: {exc}")

            st.markdown("##### Lap Time Plots")
            st.caption("Left: lap time by lap number. Right: lap time by tire age. Marker shape identifies each driver, while color indicates the tire compound.")
            try:
                lap_time_fig = build_team_lap_time_plots(
                    st.session_state["race_session"], team_name, race_title
                )
                st.pyplot(lap_time_fig)
            except Exception as exc:
                st.warning(f"Could not generate lap time plots: {exc}")

    with driver_comparison_tab:
        st.subheader("Driver Comparison")
        st.caption("Choose two drivers, submit the selection, and compare their pace, fastest lap speed traces, and lap-time progression.")

        driver_options = get_driver_options(st.session_state["race_session"])
        if len(driver_options) < 2:
            st.info("Not enough driver data available for comparison.")
        else:
            driver_compare_state_key = f"driver_compare_selection_{st.session_state['race_key'][0]}_{st.session_state['race_key'][1]}"
            default_driver_a = st.session_state.get(f"driver_compare_driver_a_{st.session_state['race_key'][0]}_{st.session_state['race_key'][1]}", driver_options[0])
            default_driver_b = st.session_state.get(
                f"driver_compare_driver_b_{st.session_state['race_key'][0]}_{st.session_state['race_key'][1]}",
                driver_options[1] if len(driver_options) > 1 else driver_options[0],
            )
            if default_driver_a not in driver_options:
                default_driver_a = driver_options[0]
            if default_driver_b not in driver_options:
                default_driver_b = driver_options[1] if len(driver_options) > 1 else driver_options[0]

            with st.form(f"driver_compare_form_{st.session_state['race_key'][0]}_{st.session_state['race_key'][1]}"):
                driver_a = st.selectbox(
                    "Driver A",
                    options=driver_options,
                    index=driver_options.index(default_driver_a),
                    format_func=lambda abb: f"{get_driver_display_name(st.session_state['race_session'], abb)} ({get_driver_finish_position(st.session_state['race_session'], abb)})",
                    key=f"driver_compare_driver_a_{st.session_state['race_key'][0]}_{st.session_state['race_key'][1]}",
                )
                driver_b = st.selectbox(
                    "Driver B",
                    options=driver_options,
                    index=driver_options.index(default_driver_b),
                    format_func=lambda abb: f"{get_driver_display_name(st.session_state['race_session'], abb)} ({get_driver_finish_position(st.session_state['race_session'], abb)})",
                    key=f"driver_compare_driver_b_{st.session_state['race_key'][0]}_{st.session_state['race_key'][1]}",
                )
                compare_clicked = st.form_submit_button("Compare Drivers")

            if compare_clicked:
                st.session_state[driver_compare_state_key] = (driver_a, driver_b)

            selected_pair = st.session_state.get(driver_compare_state_key)
            if selected_pair:
                driver_a, driver_b = selected_pair
                if driver_a == driver_b:
                    st.warning("Please select two different drivers.")
                else:
                    pos_a = get_driver_finish_position(st.session_state["race_session"], driver_a)
                    pos_b = get_driver_finish_position(st.session_state["race_session"], driver_b)
                    driver_a_name = get_driver_display_name(st.session_state["race_session"], driver_a)
                    driver_b_name = get_driver_display_name(st.session_state["race_session"], driver_b)
                    st.markdown(f"#### {driver_a_name} ({pos_a}) vs {driver_b_name} ({pos_b})")

                    st.markdown("##### Race Trace")
                    race_compare_fig = build_plot(
                        data,
                        f"Driver Comparison Race Trace - {race_title}",
                        selected_abbs=[driver_a, driver_b],
                    )
                    st.pyplot(race_compare_fig)

                    st.markdown("##### Fastest Lap Speed Comparison")
                    try:
                        fastest_lap_compare_fig = build_driver_fastest_lap_comparison_plot(
                            st.session_state["race_session"], driver_a, driver_b, race_title
                        )
                        st.pyplot(fastest_lap_compare_fig)
                    except Exception as exc:
                        st.warning(f"Could not generate fastest lap comparison: {exc}")

                    st.markdown("##### Fastest Lap Throttle Percentage Comparison")
                    try:
                        throttle_compare_fig = build_driver_fastest_lap_metric_plot(
                            st.session_state["race_session"],
                            driver_a,
                            driver_b,
                            race_title,
                            "Throttle",
                            "Throttle in %",
                            "Throttle Comparison",
                            low_padding=15,
                            high_padding=10,
                            corner_label_offset=-10,
                        )
                        st.pyplot(throttle_compare_fig)
                    except Exception as exc:
                        st.warning(f"Could not generate throttle comparison: {exc}")

                    st.markdown("##### Fastest Lap Gear Number Comparison")
                    try:
                        gear_compare_fig = build_driver_fastest_lap_metric_plot(
                            st.session_state["race_session"],
                            driver_a,
                            driver_b,
                            race_title,
                            "nGear",
                            "Gear number",
                            "Gear Comparison",
                            low_padding=2,
                            high_padding=1,
                            corner_label_offset=-1.5,
                        )
                        st.pyplot(gear_compare_fig)
                    except Exception as exc:
                        st.warning(f"Could not generate gear comparison: {exc}")

                    st.markdown("##### Gear Shifts on Track")
                    st.caption("Each driver's fastest lap track map colored by gear number.")
                    try:
                        gear_track_map_fig = build_driver_gear_shift_comparison_plot(
                            st.session_state["race_session"],
                            driver_a,
                            driver_b,
                            race_title,
                        )
                        st.pyplot(gear_track_map_fig)
                    except Exception as exc:
                        st.warning(f"Could not generate gear shift comparison: {exc}")

                    st.markdown("##### Lap Time vs Lap Number")
                    try:
                        lap_time_compare_fig = build_driver_lap_time_plot(
                            st.session_state["race_session"], driver_a, driver_b, race_title
                        )
                        st.pyplot(lap_time_compare_fig)
                    except Exception as exc:
                        st.warning(f"Could not generate lap time comparison: {exc}")

                    st.markdown("##### Tyre Strategy Comparison")
                    try:
                        tyre_strategy_compare_fig = build_tyre_strategy_comparison_plot(
                            st.session_state["race_session"],
                            race_title,
                            selected_drivers=[driver_a, driver_b],
                            plot_title=f"{race_title} - {driver_a_name} vs {driver_b_name} - Tyre Strategy Comparison",
                        )
                        st.pyplot(tyre_strategy_compare_fig)
                    except Exception as exc:
                        st.warning(f"Could not generate tyre strategy comparison: {exc}")
            else:
                st.info("Choose two drivers and submit to generate the comparison plots.")

    st.divider()
    st.markdown("##### Acknowledgement")
    st.caption(
        "Data provided via FastF1 python package. "
        "Thanks to the FastF1 project and contributors for making motorsport analytics more accessible. "
        "This app is for educational and entertainment purposes only. It's unofficial and not associated in any way with the Formula 1 companies. "
        "F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V."
    )


if __name__ == "__main__":
    main()
