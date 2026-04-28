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
        fig.tight_layout()
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
    race_overview_tab, team_specific_tab = st.tabs(["Race Overview", "Team Specific"])

    with race_overview_tab:
        st.subheader("Race Trace")
        full_fig = build_plot(data, f"Race Trace - {race_title}")
        st.pyplot(full_fig)

        if "race_session" in st.session_state:
            st.subheader("Team Pace Comparison")
            try:
                team_pace_fig = build_team_pace_comparison_plot(
                    st.session_state["race_session"], race_title
                )
                st.pyplot(team_pace_fig)
            except Exception as exc:
                st.warning(f"Could not generate team pace comparison: {exc}")
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
