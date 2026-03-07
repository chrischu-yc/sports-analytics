import streamlit as st
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from statsbombpy import sb

import warnings
warnings.filterwarnings("ignore")

from matchid_finder import (
    position_id_to_coordinates,
    get_team_lineup,
    player_name_split,
    goal_scorers,
)

# ---------------------------------------------------------------------------
# Cached data fetchers
# ---------------------------------------------------------------------------

@st.cache_data
def fetch_competitions():
    return sb.competitions()


@st.cache_data
def fetch_matches(competition_id, season_id):
    return sb.matches(competition_id=competition_id, season_id=season_id)


@st.cache_data
def fetch_events(match_id):
    return sb.events(match_id=match_id)


@st.cache_data
def fetch_lineups(match_id):
    return sb.lineups(match_id=match_id)


# ---------------------------------------------------------------------------
# Adapted plot_formation — returns fig instead of saving/showing
# ---------------------------------------------------------------------------

def plot_formation(formations, lineups, team_names, score, date, competition, round, events):
    icon_colors = ['red', 'blue']
    gk_color = ['orange', 'purple']

    max_bench = max(len(lineup[lineup["start_reason"] != "Starting XI"]) for lineup in lineups)
    bench_rows = (max_bench + 1) // 2
    bench_space = 7 + bench_rows * 9

    fig_height = 8 * (120 + bench_space) / 120
    fig = plt.figure(figsize=(13, fig_height))
    plt.suptitle(
        f"{team_names[0]} {score['home_score']} - {score['away_score']} {team_names[1]} - Starting Lineups\n"
        f"{date} | {competition} | Round: {round}",
        fontsize=16,
        fontweight='bold',
    )

    for i, team in enumerate(team_names):
        startingxi = lineups[i][lineups[i]["start_reason"] == "Starting XI"]
        bench = lineups[i][lineups[i]["start_reason"] != "Starting XI"].reset_index(drop=True)
        goal_scorers_list = goal_scorers(events[events["team"] == team])

        ax = plt.subplot(1, 2, i + 1)
        plt.title(f"{team} - Formation: {formations[i]}")
        plt.xlim(0, 80)
        plt.ylim(-bench_space, 120)
        plt.xticks([])
        plt.yticks([])
        ax.set_facecolor('white')
        ax.axhspan(-3, 120, facecolor='lightgreen', zorder=0)

        for _, player in startingxi.iterrows():
            pos_coords = position_id_to_coordinates(player["position_id"])
            player_first_name, player_last_name = player_name_split(player["player_name"])
            if pos_coords is not None:
                if player["position_id"] == 1:
                    plt.scatter(pos_coords[1], pos_coords[0], s=500, color=gk_color[i], edgecolors='black', zorder=5)
                else:
                    plt.scatter(pos_coords[1], pos_coords[0], s=400, color=icon_colors[i], edgecolors='black', zorder=5)
                plt.text(pos_coords[1], pos_coords[0], player["jersey_number"], ha='center', va='center', fontsize=9, fontweight='bold', color='white', zorder=6)
                plt.text(pos_coords[1], pos_coords[0] - 4.5, f"{player_first_name}", ha='center', va='center', fontsize=11, zorder=6)
                plt.text(pos_coords[1], pos_coords[0] - 7.5, f"{player_last_name}", ha='center', va='center', fontsize=11, zorder=6)
                if isinstance(player["end_reason"], str) and "Substitution" in player["end_reason"]:
                    plt.arrow(pos_coords[1] + 3.5, pos_coords[0] + 4, 0, -4, head_width=1.5, head_length=2, color='tomato', zorder=7)

        ax.axhline(y=-3, color='gray', linewidth=1.5, linestyle='--', zorder=4)
        col_x = [4, 44]
        for j, (_, player) in enumerate(bench.iterrows()):
            col = j % 2
            row = j // 2
            cx = col_x[col]
            ty = -9 - row * 9
            color = gk_color[i] if player["position"] == "Goalkeeper" else icon_colors[i]
            plt.scatter(cx, ty, s=300, color=color, edgecolors='black', zorder=5)
            plt.text(cx, ty, player["jersey_number"], ha='center', va='center', fontsize=8, fontweight='bold', color='white', zorder=6)
            fn, ln = player_name_split(player["player_name"])
            if ln == "":
                plt.text(cx + 6, ty - 0.2, fn, ha='left', va='center', fontsize=9, fontweight='bold', zorder=6)
            else:
                plt.text(cx + 6, ty + 1.5, fn, ha='left', va='center', fontsize=9, zorder=6)
                plt.text(cx + 6, ty - 2.0, ln, ha='left', va='center', fontsize=9, fontweight='bold', zorder=6)
            if isinstance(player["start_reason"], str) and "Substitution" in player["start_reason"]:
                plt.arrow(cx + 4, ty - 3, 0, 4, head_width=1.5, head_length=2, color='limegreen', zorder=7)

    plt.tight_layout()
    return fig


# ---------------------------------------------------------------------------
# App layout
# ---------------------------------------------------------------------------

st.title("⚽ StatsBomb Match & Formation Viewer")
st.markdown("Explore StatsBomb open data — pick a competition, season and teams to view match details and starting lineups.")

# Initialise session state keys
for key in ("competition_id", "season_id", "match_id", "home_team", "away_team", "events", "match_info", "matches"):
    if key not in st.session_state:
        st.session_state[key] = None

# --- Step 1: Competition selector ---
with st.spinner("Loading competitions…"):
    competitions = fetch_competitions()

unique_competitions = (
    competitions[["competition_id", "competition_name"]]
    .drop_duplicates()
    .sort_values("competition_name")
)
comp_options = {row["competition_name"]: row["competition_id"] for _, row in unique_competitions.iterrows()}

selected_comp_name = st.selectbox("Select Competition", options=list(comp_options.keys()))
selected_comp_id = comp_options[selected_comp_name]

if st.session_state["competition_id"] != selected_comp_id:
    # Reset downstream state when competition changes
    for key in ("season_id", "match_id", "home_team", "away_team", "events", "match_info", "matches"):
        st.session_state[key] = None
    st.session_state["competition_id"] = selected_comp_id

# --- Step 2: Season selector ---
seasons_for_comp = (
    competitions[competitions["competition_id"] == selected_comp_id][["season_id", "season_name"]]
    .drop_duplicates()
    .sort_values("season_name")
)
season_options = {row["season_name"]: row["season_id"] for _, row in seasons_for_comp.iterrows()}

selected_season_name = st.selectbox("Select Season", options=list(season_options.keys()))
selected_season_id = season_options[selected_season_name]

if st.session_state["season_id"] != selected_season_id:
    for key in ("match_id", "home_team", "away_team", "events", "match_info", "matches"):
        st.session_state[key] = None
    st.session_state["season_id"] = selected_season_id

# Load matches for chosen competition/season
with st.spinner("Loading matches…"):
    matches = fetch_matches(selected_comp_id, selected_season_id)
st.session_state["matches"] = matches

# --- Step 3: Team inputs + random match ---
st.subheader("Team Selection")
use_random = st.checkbox("🎲 Pick a random match", value=False)

if use_random and not matches.empty:
    random_match = matches.sample(1).iloc[0]
    default_home = random_match["home_team"]
    default_away = random_match["away_team"]
elif use_random:
    st.warning("No matches available for this competition/season to pick at random.")
    default_home = st.session_state["home_team"] or ""
    default_away = st.session_state["away_team"] or ""
else:
    default_home = st.session_state["home_team"] or ""
    default_away = st.session_state["away_team"] or ""

col1, col2 = st.columns(2)
with col1:
    home_input = st.text_input("Home Team", value=default_home)
with col2:
    away_input = st.text_input("Away Team", value=default_away)

# --- Step 4: Find match ---
if st.button("🔍 Find Match"):
    hometeam = home_input.strip()
    awayteam = away_input.strip()

    if not hometeam and not awayteam:
        st.error("Please enter at least one team name (or use the random match option).")
    else:
        with st.spinner("Searching for match…"):
            if hometeam and awayteam:
                match = matches[
                    matches["home_team"].str.contains(hometeam, case=False, na=False)
                    & matches["away_team"].str.contains(awayteam, case=False, na=False)
                ]
                if match.empty:
                    # Try reversed
                    match = matches[
                        matches["home_team"].str.contains(awayteam, case=False, na=False)
                        & matches["away_team"].str.contains(hometeam, case=False, na=False)
                    ]
            elif hometeam:
                match = matches[matches["home_team"].str.contains(hometeam, case=False, na=False)]
            else:
                match = matches[matches["away_team"].str.contains(awayteam, case=False, na=False)]

        if match.empty:
            st.error(f"No match found for '{hometeam}' vs '{awayteam}' in {selected_comp_name} {selected_season_name}.")
        else:
            row = match.iloc[0]
            match_id = row["match_id"]
            with st.spinner("Loading match events…"):
                events = fetch_events(match_id)

            st.session_state["match_id"] = match_id
            st.session_state["home_team"] = row["home_team"]
            st.session_state["away_team"] = row["away_team"]
            st.session_state["events"] = events
            st.session_state["match_info"] = matches[matches["match_id"] == match_id]

# Display match info if a match is loaded
if st.session_state["match_id"] is not None:
    match_info = st.session_state["match_info"]
    events = st.session_state["events"]
    match_id = st.session_state["match_id"]
    home_team_name = st.session_state["home_team"]
    away_team_name = st.session_state["away_team"]

    score = match_info[["home_score", "away_score"]].iloc[0].to_dict() if not match_info.empty else {"home_score": "?", "away_score": "?"}
    date_of_match = match_info["match_date"].iloc[0] if not match_info.empty else "Unknown"
    competition_label = match_info["competition"].iloc[0] if not match_info.empty else "Unknown"
    round_label = match_info["competition_stage"].iloc[0] if not match_info.empty else "Unknown"

    st.success(
        f"**{home_team_name}  {score['home_score']} – {score['away_score']}  {away_team_name}**  \n"
        f"📅 {date_of_match} | 🏆 {competition_label} | 🔁 Round: {round_label}"
    )

    with st.expander("📋 Raw Lineup Data"):
        with st.spinner("Loading lineups…"):
            lineups_data = fetch_lineups(match_id)
        col1, col2 = st.columns(2)
        with col1:
            st.markdown(f"**{home_team_name}**")
            if home_team_name in lineups_data:
                st.dataframe(lineups_data[home_team_name])
            else:
                st.info("Lineup not available.")
        with col2:
            st.markdown(f"**{away_team_name}**")
            if away_team_name in lineups_data:
                st.dataframe(lineups_data[away_team_name])
            else:
                st.info("Lineup not available.")

    # --- Step 5: Formation plot ---
    if st.button("📊 Show Starting Lineups"):
        with st.spinner("Generating formation plot…"):
            home_formation, home_lineup = get_team_lineup(home_team_name, events, match_id)
            away_formation, away_lineup = get_team_lineup(away_team_name, events, match_id)
            fig = plot_formation(
                [home_formation, away_formation],
                [home_lineup, away_lineup],
                [home_team_name, away_team_name],
                score,
                date_of_match,
                competition_label,
                round_label,
                events,
            )
        st.pyplot(fig)
        plt.close(fig)
