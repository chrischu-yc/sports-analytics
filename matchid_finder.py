from matplotlib.pylab import rand
from statsbombpy import sb
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import time

# User input league, season and match to visualize the formations of both teams. 
# Give out the match id based on the user input of league, season and teams. 

def opening_input():
    # Competition
    competitions = sb.competitions()
    if input("Type 'list' to see available competitions, or press Enter to continue: ").lower() == 'list':
        print(competitions[['competition_name']].drop_duplicates())
    competition = input("Enter the competition name (e.g., Bundesliga, Champions League, Euro): ")
    league_info = competitions[competitions['competition_name'].str.contains(competition, case=False)]
    if league_info.empty:
        print(f"The competition {competition} is not available.")
        exit()
        return None, None, None, None, None, None, None
    competition_name = league_info.iloc[0]['competition_name']
    league_id = league_info.iloc[0]['competition_id']

    # Season
    if input("Type 'list' to see available seasons for the selected competition, or press Enter to continue: ").lower() == 'list':
        print(competitions[competitions['competition_id'] == league_id]['season_name'].drop_duplicates())
    season = input("Enter the season (e.g., 2022/2023 for club games, 2024 for international tournaments): ")
    season_info = competitions[(competitions['competition_id'] == league_id) & (competitions['season_name'].str.contains(season, case=False))]
    if season_info.empty:
        print(f"The {season} season is not available for {competition_name}.")
        exit()
        return None, None, None, None, None, None, None
    season_name = season_info.iloc[0]['season_name']
    season_id = season_info.iloc[0]['season_id']

    # Teams
    hometeam = input("Enter the home team name: ")
    awayteam = input("Enter the away team name: ")
    matches = sb.matches(competition_id=league_id, season_id=season_id)
    match = matches[(matches['home_team'].str.contains(hometeam, case=False)) & (matches['away_team'].str.contains(awayteam, case=False))]
    if match.empty:
        match = matches[(matches['home_team'].str.contains(awayteam, case=False)) & (matches['away_team'].str.contains(hometeam, case=False))]
    home_team_name = match.iloc[0]['home_team'] if not match.empty else None
    away_team_name = match.iloc[0]['away_team'] if not match.empty else None
    if not match.empty:
        match_id = match.iloc[0]['match_id']
        events = sb.events(match_id=match_id)
        match_info = matches[matches["match_id"] == match_id]
        print(f"The match ID for {home_team_name} vs {away_team_name} in {competition_name} {season_name} is: {match_id}")
        return match_id, home_team_name, away_team_name, competition_name, season_name, events, match_info
    else:
        print(f"No match found for {hometeam} vs {awayteam} in {competition_name} {season_name} season.")
        exit()
        return None, None, None, None, None, None, None

# position id to on-pitch position mapping
# Pitch dimensions are 120 x 80 (meters). (0,0) is at top left corner. x increases to the right, y increases downwards.
dimensions = [120, 80]
def position_id_to_coordinates(position_id):
    mapping = {
        1: (8, 40),    # GK
        2: (20, 75),   # RB
        3: (20, 55),   # RCB
        4: (20, 40),   # CB
        5: (20, 25),   # LCB
        6: (20, 5),    # LB
        7: (35, 75),   # RWB
        8: (35, 5),    # LWB
        9: (45, 55),   # RDM
        10: (45, 40),  # CDM
        11: (45, 25),  # LDM
        12: (60, 75),  # RM
        13: (60, 55),  # RCM
        14: (60, 40),  # CM (center circle)
        15: (60, 25),  # LCM
        16: (60, 5),  # LM
        17: (90, 75),  # RW
        18: (80, 55),  # RAM
        19: (80, 40),  # CAM
        20: (80, 25),  # LAM
        21: (90, 5),  # LW
        22: (105, 55), # RCF
        23: (110, 40), # ST
        24: (105, 25), # LCF
        25: (98, 40),  # SS (second striker)
    }
    return mapping.get(position_id, None)

def get_team_lineup(team):
	formation = (
		events.loc[(events["team"] == team) & (events["type"] == "Starting XI"), "tactics"]
		.apply(lambda t: t.get("formation") if isinstance(t, dict) else None)
		.dropna()
	)
	formation = formation.iloc[0] if not formation.empty else None
	# turn the format of formation from an integer "433" to string "4-3-3" or "4231" to "4-2-3-1"
	if formation is not None:
		formation_str = str(formation)
		formation = "-".join(formation_str)
	team_lineup = sb.lineups(match_id=match_id)[team]
	lineup = team_lineup.assign(
		start_reason=team_lineup["positions"].apply(
			lambda p: p[0].get("start_reason") if isinstance(p, list) and len(p) > 0 else None
		),
		position=team_lineup["positions"].apply(
			lambda p: p[0].get("position") if isinstance(p, list) and len(p) > 0 else None
		),
		position_id=team_lineup["positions"].apply(
			lambda p: p[0].get("position_id") if isinstance(p, list) and len(p) > 0 else None
		),
	)[["player_name", "player_nickname", "jersey_number", "start_reason", "position", "position_id"]]
	lineup["player_nickname"] = lineup["player_nickname"].fillna(team_lineup["player_name"])
	lineup = lineup.drop(columns=["player_name"], errors="ignore").rename(columns={"player_nickname": "player_name"})
	lineup = lineup[lineup["start_reason"] == "Starting XI"]
	lineup = lineup.drop(columns=["start_reason"], errors="ignore")
	return formation, lineup

def plot_formation(formations, lineups, team_names, score, date, competition, round):
    plt.figure(figsize=(13, 8))
    plt.suptitle(f"{team_names[0]} {score['home_score']} - {score['away_score']} {team_names[1]} - Starting Lineups\n{date} | {competition} | Round: {round}", fontsize=16, fontweight='bold')
    for i, team in enumerate(team_names):
        plt.subplot(1, 2, i+1)
        plt.title(f"{team} - Formation: {formations[i]}")
        plt.xlim(0, 80)
        plt.ylim(0, 120)
        plt.xticks([])
        plt.yticks([])
        plt.gca().set_facecolor('lightgreen')
        icon_colors = ['red', 'blue']  # Colors for the two teams

        for _, player in lineups[i].iterrows():
            pos_coords = position_id_to_coordinates(player["position_id"])
            player_name_split = player["player_name"].split()
            if len(player_name_split) == 1:  
                player_first_name = player_name_split[0]
                player_last_name = ""
            if len(player_name_split) == 2:  
                player_first_name = player["player_name"].split()[0] if isinstance(player["player_name"], str) else "Unknown"
                player_last_name = player["player_name"].split()[-1] if isinstance(player["player_name"], str) else "Unknown"
            if len(player_name_split) >= 3:
                player_first_name = player["player_name"].split()[0] if isinstance(player["player_name"], str) else "Unknown"
                player_last_name = " ".join(player["player_name"].split()[1:]) if isinstance(player["player_name"], str) else "Unknown"
            if pos_coords is not None:
                plt.scatter(pos_coords[1], pos_coords[0], s=400, color=icon_colors[i], edgecolors='black', zorder=5)
                plt.text(pos_coords[1], pos_coords[0], player["jersey_number"], ha='center', va='center', fontsize=9, fontweight='bold', color='white', zorder=6)
                plt.text(pos_coords[1], pos_coords[0] - 4, f"{player_first_name}", ha='center', va='center', fontsize=11, zorder=6)
                plt.text(pos_coords[1], pos_coords[0] - 7, f"{player_last_name}", ha='center', va='center', fontsize=11, zorder=6)
    plt.tight_layout()
    #plt.savefig('/home/chrischu/sports_analytics/formations.png', dpi=300)
    plt.show()

if __name__ == "__main__":
    # User input
    print("Welcome to the Statsbomb Match ID Finder! Made by CYC.")
    if input("Press Enter to begin, or type 'exit' to exit: ").lower() == 'exit':
        exit()
    if input("Type 'r' to receive a random match, or press Enter to continue: ").lower() == 'r':
        competitions = sb.competitions()
        random_competition = competitions.sample(1).iloc[0]
        league_id = random_competition['competition_id']
        season_id = random_competition['season_id']
        matches = sb.matches(competition_id=league_id, season_id=season_id)
        random_match = matches.sample(1).iloc[0]
        match_id = random_match['match_id']
        home_team_name = random_match['home_team']
        away_team_name = random_match['away_team']
        competition_name = random_match['competition']
        season_name = random_match['season']
        events = sb.events(match_id=match_id)
        match_info = matches[matches["match_id"] == match_id]
        print(f"Random Match: {home_team_name} vs {away_team_name} in {season_name} {competition_name} on {random_match['match_date']}. Match ID: {match_id}")

    else:
        match_id, home_team_name, away_team_name, competition_name, season_name, events, match_info = opening_input()

    #match_id, home_team_name, away_team_name, competition_name, season_name, events, match_info = opening_input()
    if match_id is None: # No valid match found
        exit()
    
    # Show match info and starting lineups
    print("\n")
    score = match_info[["home_score", "away_score"]].iloc[0] if not match_info.empty else {"home_score": "Unknown", "away_score": "Unknown"}
    date_of_match = match_info["match_date"].iloc[0] if not match_info.empty else "Unknown"
    competition = match_info["competition"].iloc[0] if not match_info.empty else "Unknown"
    round = match_info["competition_stage"].iloc[0] if not match_info.empty else "Unknown"
    print(f"Date: {date_of_match}, Competition: {competition}, Round: {round}")
    print(f"{home_team_name} {score['home_score']} - {score['away_score']} {away_team_name}")

    time.sleep(2)  # Wait two seconds before continuing
    if input("Type 'lineup' to see the starting lineups, or press Enter to exit: ").lower() != 'lineup':
        exit()
    home_formation, home_lineup = get_team_lineup(home_team_name)
    away_formation, away_lineup = get_team_lineup(away_team_name)
    plot_formation([home_formation, away_formation], [home_lineup, away_lineup], [home_team_name, away_team_name], score, date_of_match, competition, round)

    