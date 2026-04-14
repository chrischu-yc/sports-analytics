import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import fastf1

# User input year and race name
print("Welcome to F1 Race Trace Plotter! Powered by FastF1.")
year_input = int(input("Enter the year (2018 onwards): "))
name_input = input("Enter the race name (e.g., 'Japan', 'Silverstone'): ")
race = fastf1.get_session(year_input, name_input, 'R')
race.load()

race_name = race.session_info['Meeting']['Name']
race_year = race.session_info['StartDate'].year
race_round = race.session_info['Meeting']['Number']
print(f"{race_name} {race_year} - Round {race_round}")

lap_numbers = race.laps['LapNumber'].unique()
driver_numbers = race.laps['DriverNumber'].unique()

# Get the average pace for each lap, don't count laps without LapTime
lap_pace = []
for n in lap_numbers:
    avg_time = 0.0
    count = 0
    for d in driver_numbers:
        lap_data = race.laps[(race.laps['LapNumber'] == n) & (race.laps['DriverNumber'] == d)]
        if not lap_data.empty and lap_data['LapStartTime'].iloc[0] is not pd.NaT:
            avg_time += lap_data['Time'].iloc[0].total_seconds()
            count += 1
    if count > 0:
        lap_pace.append(avg_time / count)
        #lap_pace.append(np.median(avg_time))

# A list of each driver's time offset from the average pace for each lap
driver_offsets = {d: [] for d in driver_numbers}
for n in lap_numbers:
    ind = int(n) - 1
    avg_time = lap_pace[ind]  # Lap numbers start at 1
    for d in driver_numbers:
        lap_data = race.laps[(race.laps['LapNumber'] == n) & (race.laps['DriverNumber'] == d)]
        if not lap_data.empty and lap_data['LapStartTime'].iloc[0] is not pd.NaT:
            driver_time = lap_data['Time'].iloc[0].total_seconds()
            driver_offsets[d].append(avg_time - driver_time) # positive means faster than average
        else:
            driver_offsets[d].append(np.nan)

# A list of each driver's pit laps
driver_pit_laps = {d: [] for d in driver_numbers}
for d in driver_numbers:
    for n in lap_numbers:
        lap_data = race.laps[(race.laps['LapNumber'] == n) & (race.laps['DriverNumber'] == d)]
        if not lap_data.empty and lap_data['LapStartTime'].iloc[0] is not pd.NaT:
            if lap_data['PitInTime'].iloc[0] is not pd.NaT:
                driver_pit_laps[d].append(int(n))

# Safety car periods
safety_car_lap_numbers = []
for status in race.laps['TrackStatus'].dropna().unique():
    if '4' in status:
        laps_with_status = race.laps[race.laps['TrackStatus'] == status]
        safety_car_lap_numbers.extend(laps_with_status['LapNumber'].unique())
safety_car_lap_numbers = sorted(set(safety_car_lap_numbers))
safety_car_lap_numbers = safety_car_lap_numbers[1:]

# Driver info for plotting (name, finishing position, team color, line style)
driver_info = {}
team_repeat = []
for d in driver_numbers:
    driver_data = race.results[race.results['DriverNumber'] == d]
    if not driver_data.empty:
        abb = driver_data['Abbreviation'].iloc[0]
        last_name = driver_data['LastName'].iloc[0]
        position = int(driver_data['Position'].iloc[0])
        team_color = driver_data['TeamColor'].iloc[0]
        # use different line style for teammates
        if team_color in team_repeat:
            plot_linestyle = '-.'
        else:
            plot_linestyle = '-'
            team_repeat.append(team_color)
        driver_info[d] = (abb, last_name, position, team_color, plot_linestyle)

# Plot the time offsets for each driver
plt.figure(figsize=(12, 8))
plt.gca().set_facecolor("oldlace")
#plt.gcf().patch.set_facecolor("oldlace")
for d in driver_numbers:
    plt.plot(lap_numbers, driver_offsets[d], label=f"{driver_info[d][2]}. {driver_info[d][1]}", color='#' + driver_info[d][3], linestyle=driver_info[d][4], alpha=0.7)
    for pit_lap in driver_pit_laps[d]:
        plt.plot(pit_lap, driver_offsets[d][int(pit_lap)-1], 'o', color='#' + driver_info[d][3], markersize=3)
plt.axhline(0, color='gray', linestyle='--', alpha=0.5)
for sc_lap in safety_car_lap_numbers:
    plt.axvspan(sc_lap - 1, sc_lap + 0, color='yellow', alpha=0.3, linewidth=0)
plt.xlim(0, max(lap_numbers)+1)
plt.xticks(np.arange(0, max(lap_numbers)+1, 2))
plt.xlabel('Lap Number')
plt.ylabel('Time Offset from Average Pace (seconds)')
plt.title(f'Race Trace - {race_name} {race_year} - Round {race_round}')
handles, labels = plt.gca().get_legend_handles_labels()
sorted_handles_labels = sorted(zip(handles, labels), key=lambda x: int(x[1].split('.')[0]))
sorted_handles, sorted_labels = zip(*sorted_handles_labels)
plt.legend(sorted_handles, sorted_labels, bbox_to_anchor=(1.02, 1), loc='upper left')
plt.grid(alpha=0.2)
plt.tight_layout()
plt.show()
print("Plotting complete! Close the plot window to continue.")

# Race trace plot with user-selected drivers and lap ranges
print("Do you want to view specific drivers in certain lap ranges? (y/n)")
view_specific = input().lower()
if view_specific != 'y':
    print("Exiting program. Thank you for using F1 Race Trace Plotter!")
else:
    print("Enter driver abbreviations separated by commas (e.g. VER, PER):")
    driver_input = input().upper()
    selected_drivers = [d.strip() for d in driver_input.split(',')]
    print("Enter lap range (e.g. 10-20):")
    lap_range_input = input()
    lap_range_parts = lap_range_input.split('-')
    if len(lap_range_parts) != 2:
        print("Invalid lap range format. Exiting.")
    else:
        lap_range = (int(lap_range_parts[0]), int(lap_range_parts[1]))
print(f"Selected drivers: {selected_drivers}, Lap {lap_range[0]} to {lap_range[1]}")
plt.figure(figsize=(12, 8))
plt.gca().set_facecolor("oldlace")
for d in driver_numbers:
    if driver_info[d][0] in selected_drivers:
        plt.plot(lap_numbers, driver_offsets[d], label=f"{driver_info[d][2]}. {driver_info[d][1]}", color='#' + driver_info[d][3], linestyle=driver_info[d][4], alpha=0.7)
        for pit_lap in driver_pit_laps[d]:
            if lap_range[0] <= pit_lap <= lap_range[1]:
                plt.plot(pit_lap, driver_offsets[d][int(pit_lap)-1], 'o', color='#' + driver_info[d][3], markersize=3)
plt.axhline(0, color='gray', linestyle='--', alpha=0.5)
for sc_lap in safety_car_lap_numbers:
    if lap_range[0] <= sc_lap <= lap_range[1]:
        plt.axvspan(sc_lap - 1, sc_lap + 0, color='yellow', alpha=0.3, linewidth=0)
plt.xlim(lap_range[0]-1, lap_range[1]+1)
plt.xticks(np.arange(lap_range[0], lap_range[1]+1, 1))
plt.xlabel('Lap Number')
plt.ylabel('Time Offset from Average Pace (seconds)')
plt.title(f'Race Trace - {race_name} {race_year} - Round {race_round}')
handles, labels = plt.gca().get_legend_handles_labels()
sorted_handles_labels = sorted(zip(handles, labels), key=lambda x: int(x[1].split('.')[0]))
sorted_handles, sorted_labels = zip(*sorted_handles_labels)
plt.legend(sorted_handles, sorted_labels, bbox_to_anchor=(1.02, 1), loc='upper left')
plt.grid(alpha=0.2)
plt.tight_layout()
plt.show()
print("Plotting complete! Close the plot window to exit.")