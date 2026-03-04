from statsbombpy import sb
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# User input league, season and match to visualize the formations of both teams. 
# Example input: "Bundesliga", "2022/2023", "Leverkusen", "Bayern Munich"
# Give out the match id based on the user input of league, season and teams. 

if __name__ == "__main__":
    # User input
    print("Welcome to the Statsbomb Match ID Finder! Made by CYC.")

    # Competition
    competitions = sb.competitions()
    if input("Type 'list' to see available competitions, or press Enter to continue: ").lower() == 'list':
        print(competitions[['competition_name']].drop_duplicates())
    competition = input("Enter the competition name (e.g., Bundesliga, Champions League, Euro): ")
    league_info = competitions[competitions['competition_name'].str.contains(competition, case=False)]
    if league_info.empty:
        print(f"The competition {competition} is not available.")
        exit()
    league_id = league_info.iloc[0]['competition_id']

    # Season
    if input("Type 'list' to see available seasons for the selected competition, or press Enter to continue: ").lower() == 'list':
        print(competitions[competitions['competition_id'] == league_id]['season_name'].drop_duplicates())
    season = input("Enter the season (e.g., 2022/2023 for club games, 2024 for international tournaments): ")
    season_info = competitions[(competitions['competition_id'] == league_id) & (competitions['season_name'].str.contains(season, case=False))]
    if season_info.empty:
        print(f"The {season} season is not available for {competition}.")
        exit()
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
        print(f"The match ID for {home_team_name} vs {away_team_name} in {competition} {season} is: {match_id}")
        match_info = matches[matches["match_id"] == match_id]
        events = sb.events(match_id=match_id)
    else:
        print(f"No match found for {hometeam} vs {awayteam} in {competition} {season} season.")
        exit()
    
    # Show starting lineups