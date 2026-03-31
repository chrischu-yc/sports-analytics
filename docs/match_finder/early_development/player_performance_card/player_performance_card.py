from statsbombpy import sb
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from pathlib import Path
from matplotlib.lines import Line2D
from matplotlib.patches import FancyBboxPatch
from mplsoccer import VerticalPitch


COMPETITION_ID = 55
SEASON_ID = 282
MATCH_ID = 3943043
TEAM_NAME = "England"
PLAYER_NAME = "John Stones"
OUTPUT_PATH = Path(__file__).with_name("player_performance_card.png")


def to_xy_frame(df, location_col):
    """Convert location list columns to a clean x/y dataframe."""
    if df.empty or location_col not in df.columns:
        return pd.DataFrame(columns=["x", "y"])

    valid = df[df[location_col].notna()].copy()
    if valid.empty:
        return pd.DataFrame(columns=["x", "y"])

    valid["x"] = valid[location_col].apply(lambda loc: loc[0])
    valid["y"] = valid[location_col].apply(lambda loc: loc[1])
    return valid[["x", "y"]]


def to_segment_frame(df, start_col, end_col):
    """Convert start/end location columns to x/y/x_end/y_end."""
    if df.empty or start_col not in df.columns or end_col not in df.columns:
        return pd.DataFrame(columns=["x", "y", "x_end", "y_end"])

    valid = df[df[start_col].notna() & df[end_col].notna()].copy()
    if valid.empty:
        return pd.DataFrame(columns=["x", "y", "x_end", "y_end"])

    valid["x"] = valid[start_col].apply(lambda loc: loc[0])
    valid["y"] = valid[start_col].apply(lambda loc: loc[1])
    valid["x_end"] = valid[end_col].apply(lambda loc: loc[0])
    valid["y_end"] = valid[end_col].apply(lambda loc: loc[1])
    return valid[["x", "y", "x_end", "y_end"]]


def safe_rate(numerator, denominator):
    if denominator == 0:
        return 0.0
    return 100.0 * numerator / denominator


def get_player_context(events, lineups, player_name):
    player_row = lineups[lineups["player_name"] == player_name]
    if player_row.empty:
        raise ValueError(f"Player '{player_name}' not found in lineup.")

    player_info = player_row.iloc[0]
    positions = player_info.get("positions", [])

    position = "N/A"
    time_start = "0"
    time_end = str(int(events["minute"].max())) if "minute" in events.columns else "N/A"

    if isinstance(positions, list) and len(positions) > 0:
        first_position = positions[0]
        position = first_position.get("position", "N/A")
        raw_start = first_position.get("from")
        raw_end = first_position.get("to")

        if raw_start:
            time_start = str(raw_start).split(":")[0]
        if raw_end:
            time_end = str(raw_end)

    nickname = player_info.get("player_nickname")
    display_name = nickname if pd.notna(nickname) and nickname else player_name

    return {
        "display_name": display_name,
        "position": position,
        "time_start": time_start,
        "time_end": time_end,
        "player_info": player_info,
    }


def extract_player_data(events, player_name):
    passes = events[(events["type"] == "Pass") & (events["player"] == player_name)].copy()
    dribbles = events[(events["type"] == "Dribble") & (events["player"] == player_name)].copy()
    carries = events[(events["type"] == "Carry") & (events["player"] == player_name)].copy()
    shots = events[(events["type"] == "Shot") & (events["player"] == player_name)].copy()

    pressures = events[(events["type"] == "Pressure") & (events["player"] == player_name)].copy()
    clearances = events[(events["type"] == "Clearance") & (events["player"] == player_name)].copy()
    interceptions = events[(events["type"] == "Interception") & (events["player"] == player_name)].copy()
    tackles = events[
        (events["type"] == "Duel")
        & (events["duel_type"] == "Tackle")
        & (events["player"] == player_name)
    ].copy()
    blocks = events[
        (events["type"] == "Block")
        & (events["block_deflection"].isna())
        & (events["block_offensive"].isna())
        & (events["player"] == player_name)
    ].copy()

    recoveries = events[
        (events["type"] == "Ball Recovery")
        & (events["player"] == player_name)
        & (events["ball_recovery_recovery_failure"].isna())
    ].copy()

    pass_receptions = events[
        (events["type"] == "Pass") & (events["pass_recipient"] == player_name)
    ].copy()

    fouls_committed = events[(events["type"] == "Foul Committed") & (events["player"] == player_name)].copy()
    was_fouled = events[(events["type"] == "Foul Won") & (events["player"] == player_name)].copy()
    dispossessed = events[(events["type"] == "Dispossessed") & (events["player"] == player_name)].copy()
    dribbled_past = events[(events["type"] == "Dribbled Past") & (events["player"] == player_name)].copy()
    miscontrol = events[(events["type"] == "Miscontrol") & (events["player"] == player_name)].copy()

    return {
        "passes": passes,
        "dribbles": dribbles,
        "carries": carries,
        "shots": shots,
        "pressures": pressures,
        "clearances": clearances,
        "interceptions": interceptions,
        "tackles": tackles,
        "blocks": blocks,
        "recoveries": recoveries,
        "pass_receptions": pass_receptions,
        "fouls_committed": fouls_committed,
        "was_fouled": was_fouled,
        "dispossessed": dispossessed,
        "dribbled_past": dribbled_past,
        "miscontrol": miscontrol,
    }


def compute_metrics(player_data):
    passes = player_data["passes"]
    dribbles = player_data["dribbles"]
    carries = player_data["carries"]
    shots = player_data["shots"]
    interceptions = player_data["interceptions"]
    tackles = player_data["tackles"]

    successful_passes = passes[passes["pass_outcome"].isna()]
    long_passes = passes[passes["pass_length"] > 30] if "pass_length" in passes.columns else passes.iloc[0:0]
    successful_long_passes = long_passes[long_passes["pass_outcome"].isna()]

    passes_into_final_third = passes[
        passes["pass_end_location"].apply(lambda loc: isinstance(loc, list) and loc[0] > 80)
        & passes["location"].apply(lambda loc: isinstance(loc, list) and loc[0] < 80)
    ] if not passes.empty else passes
    successful_final_third = passes_into_final_third[passes_into_final_third["pass_outcome"].isna()]

    successful_dribbles = dribbles[dribbles["dribble_outcome"] == "Complete"] if "dribble_outcome" in dribbles.columns else dribbles.iloc[0:0]

    carries_for_prog = carries[carries["location"].notna() & carries["carry_end_location"].notna()].copy() if not carries.empty else carries
    if not carries_for_prog.empty:
        carries_for_prog["is_progressive"] = carries_for_prog.apply(
            lambda r: (r["carry_end_location"][0] - r["location"][0]) >= 10,
            axis=1,
        )
        progressive_carries = carries_for_prog[carries_for_prog["is_progressive"]]
    else:
        progressive_carries = carries_for_prog

    key_passes = passes[(passes["pass_shot_assist"] == True) | (passes["pass_goal_assist"] == True)] if not passes.empty else passes
    assists = passes[passes["pass_goal_assist"] == True] if not passes.empty else passes

    goals = shots[shots["shot_outcome"] == "Goal"] if not shots.empty else shots
    shots_xg = float(shots["shot_statsbomb_xg"].fillna(0).sum()) if "shot_statsbomb_xg" in shots.columns else 0.0

    success_outcomes = ["Won", "Success", "Success In Play", "Success Out"]
    successful_interceptions = interceptions[
        interceptions["interception_outcome"].isin(success_outcomes)
    ] if "interception_outcome" in interceptions.columns else interceptions.iloc[0:0]
    successful_tackles = tackles[
        tackles["duel_outcome"].isin(success_outcomes)
    ] if "duel_outcome" in tackles.columns else tackles.iloc[0:0]

    return {
        "passes_completed": len(successful_passes),
        "passes_total": len(passes),
        "final_third_completed": len(successful_final_third),
        "final_third_total": len(passes_into_final_third),
        "long_pass_completed": len(successful_long_passes),
        "long_pass_total": len(long_passes),
        "dribbles_completed": len(successful_dribbles),
        "dribbles_total": len(dribbles),
        "pass_accuracy": safe_rate(len(successful_passes), len(passes)),
        "long_pass_accuracy": safe_rate(len(successful_long_passes), len(long_passes)),
        "final_third_accuracy": safe_rate(len(successful_final_third), len(passes_into_final_third)),
        "dribble_success": safe_rate(len(successful_dribbles), len(dribbles)),
        "progressive_carries": len(progressive_carries),
        "key_passes": len(key_passes),
        "assists": len(assists),
        "shots": len(shots),
        "goals": len(goals),
        "xg": shots_xg,
        "interception_success": safe_rate(len(successful_interceptions), len(interceptions)),
        "tackle_success": safe_rate(len(successful_tackles), len(tackles)),
        "pressures": len(player_data["pressures"]),
        "clearances": len(player_data["clearances"]),
        "recoveries": len(player_data["recoveries"]),
        "fouls_committed": len(player_data["fouls_committed"]),
        "was_fouled": len(player_data["was_fouled"]),
        "dispossessed": len(player_data["dispossessed"]),
        "dribbled_past": len(player_data["dribbled_past"]),
        "miscontrol": len(player_data["miscontrol"]),
    }

# -------------------------------------Calculate Match Rating------------------------------------
def classify_pitch_area(location):
    if not isinstance(location, list) or len(location) < 2:
        return 'anywhere'
    x, y = location[0], location[1]
    if x <= 18 and 18 <= y <= 62:
        return 'own_box'
    if x >= 102 and 18 <= y <= 62:
        return 'opposition_box'
    if x < 40:
        return 'own_third'
    if x < 80:
        return 'middle_third'
    return 'final_third'

def is_in_penalty_area(location):
    if not isinstance(location, list) or len(location) < 2:
        return False
    x, y = location[0], location[1]
    return x >= 102 and 18 <= y <= 62

# Passing impact calculation
LONG_PASS_THRESHOLD = 30.0
PASS_POSITIVE_WEIGHTS = {
    'shot_assist': 0.40,
    'goal_assist': 1.20,
    'into_final_third': 0.12,
    'into_penalty_area': 0.05,
    'long_pass': 0.07,
    'switch_long_pass': 0.03,
    'under_pressure': 0.03,
}
SWITCH_LATERAL_THRESHOLD = 24.0
PASS_MISPLACED_PENALTY_BY_START_AREA = {
    'own_box': 0.40,
    'own_third': 0.10,
    'middle_third': 0.07,
    'final_third': 0.02,
    'opposition_box': 0.02,
    'anywhere': 0.20,
}
def get_pass_length(event_row):
    raw_length = event_row.get('pass_length')
    if pd.notna(raw_length):
        return float(raw_length)

    start = event_row.get('location')
    end = event_row.get('pass_end_location')
    if isinstance(start, list) and isinstance(end, list) and len(start) >= 2 and len(end) >= 2:
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        return (dx * dx + dy * dy) ** 0.5
    return 0.0
def compute_pass_impact(event_row):
    start_loc = event_row.get('location')
    end_loc = event_row.get('pass_end_location')
    start_area = classify_pitch_area(start_loc)
    end_area = classify_pitch_area(end_loc)
    pass_length = get_pass_length(event_row)

    pass_outcome = event_row.get('pass_outcome')
    complete = pd.isna(pass_outcome)
    incomplete = pass_outcome == 'Incomplete'
    out_pass = pass_outcome == 'Out'

    if incomplete or out_pass:
        penalty = PASS_MISPLACED_PENALTY_BY_START_AREA.get(start_area, PASS_MISPLACED_PENALTY_BY_START_AREA['anywhere'])
        outcome_label = 'out' if out_pass else 'incomplete'
        return -penalty, start_area, end_area, outcome_label

    if complete:
        # Completed pass: only specific high-value pass types contribute positively.
        components = []
        impact = 0.0

        if bool(event_row.get('pass_shot_assist') == True) and not bool(event_row.get('pass_goal_assist') == True):
            components.append('shot_assist')
            impact += PASS_POSITIVE_WEIGHTS['shot_assist']

        if bool(event_row.get('pass_goal_assist') == True):
            components.append('goal_assist')
            impact += PASS_POSITIVE_WEIGHTS['goal_assist']

        into_final_third = (end_area in ('final_third', 'opposition_box')) and (start_area not in {'final_third', 'opposition_box'})
        if into_final_third:
            components.append('into_final_third')
            impact += PASS_POSITIVE_WEIGHTS['into_final_third']

        into_penalty_area = (end_area == 'opposition_box') and (start_area != 'opposition_box')
        if into_penalty_area:
            components.append('into_penalty_area')
            impact += PASS_POSITIVE_WEIGHTS['into_penalty_area']

        pass_progress_x = None
        pass_progress_y = None
        if isinstance(start_loc, list) and isinstance(end_loc, list) and len(start_loc) >= 2 and len(end_loc) >= 2:
            pass_progress_x = end_loc[0] - start_loc[0]
            pass_progress_y = end_loc[1] - start_loc[1]

        if pass_length >= LONG_PASS_THRESHOLD:
            ends_in_final_zone = end_area in {'final_third', 'opposition_box'}
            is_forward_or_sideways = (pass_progress_x is None) or (pass_progress_x >= 0)
            if ends_in_final_zone or is_forward_or_sideways:
                components.append('long_pass')
                impact += PASS_POSITIVE_WEIGHTS['long_pass']

            is_switch = (pass_progress_y is not None) and (abs(pass_progress_y) >= SWITCH_LATERAL_THRESHOLD)
            if is_switch:
                components.append('switch_long_pass')
                impact += PASS_POSITIVE_WEIGHTS['switch_long_pass']

        if bool(event_row.get('under_pressure') == True):
            components.append('under_pressure')
            impact += PASS_POSITIVE_WEIGHTS['under_pressure']

        outcome_label = 'complete_neutral' if impact == 0 else 'complete_' + '+'.join(components)
        return impact, start_area, end_area, outcome_label
    return 0.0, start_area, end_area, 'pass_other'

# Shot impact calculation
SHOT_OUTCOME_GROUPS = {
    'goal': {'Goal'},
    'saved': {'Saved', 'Saved To Post', 'Saved Off T', 'Saved to Post'},
    'blocked_or_off_target': {'Blocked', 'Off T', 'Post'},
    'wayward': {'Wayward'},
}
def _to_float_xg(value):
    try:
        return float(value) if pd.notna(value) else 0.0
    except (TypeError, ValueError):
        return 0.0

def _label_safe(value, fallback='unknown'):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return fallback
    return str(value).strip().lower().replace(' ', '_').replace('-', '_')

def classify_shot_outcome(shot_outcome):
    if shot_outcome in SHOT_OUTCOME_GROUPS['goal']:
        return 'goal'
    if shot_outcome in SHOT_OUTCOME_GROUPS['saved']:
        return 'saved'
    if shot_outcome in SHOT_OUTCOME_GROUPS['blocked_or_off_target']:
        return 'blocked_or_off_target'
    if shot_outcome in SHOT_OUTCOME_GROUPS['wayward']:
        return 'wayward'
    return 'blocked_or_off_target'

def compute_shot_impact(event_row):
    shot_outcome = event_row.get('shot_outcome')
    shot_type = event_row.get('shot_type')
    shot_type_label = _label_safe(shot_type, fallback='unspecified')
    xg = max(0.0, min(_to_float_xg(event_row.get('shot_statsbomb_xg')), 1.5))
    is_open_goal = bool(event_row.get('shot_open_goal') == True)
    outcome_group = classify_shot_outcome(shot_outcome)

    if outcome_group == 'goal':
        low_xg_boost = max(0.0, 0.7 - xg) * 0.9
        open_goal_adj = -0.50 if is_open_goal else 0.10
        impact = 1.2 + low_xg_boost + open_goal_adj
        return impact, f'goal__{shot_type_label}'

    if shot_type == 'Penalty':
        impact = -1.20
        return impact, f'missed_penalty__{shot_type_label}'

    if is_open_goal:
        impact = -(0.70 * xg)
        return impact, f'open_goal_miss__{shot_type_label}'

    if outcome_group == 'saved':
        # Saved shots gain more credit as xG rises.
        impact = 0.05 + 0.50 * xg
        return impact, f'saved__{shot_type_label}'

    if outcome_group == 'blocked_or_off_target':
        # Positive, but less than saved shots. Higher xG reduces the reward.
        impact = max(0.05, 0.30 - 0.20 * xg)
        return impact, f'blocked_or_off_target__{shot_type_label}'

    # Wayward shots are negative and punished more with higher xG.
    impact = -(0.15 + 0.30 * xg)
    return impact, f'wayward__{shot_type_label}'

# Pressure
def compute_pressure_impact(event_row):
    base_impact = 0.03
    is_counterpress = bool(event_row.get('counterpress') == True)
    if is_counterpress:
        return base_impact + 0.03, 'pressure_counterpress'
    return base_impact, 'pressure'

# Miscontrol, error, dispossessed, dribbled past impact (area-based penalties)
BY_AREA_GAIN_BACK_HEAVY = {
    'own_box': 0.40,
    'own_third': 0.27,
    'middle_third': 0.15,
    'final_third': 0.05,
    'opposition_box': 0.05,
    'anywhere': 0.10,
}

def compute_turnover_area_penalty(location, label):
    area = classify_pitch_area(location)
    penalty = BY_AREA_GAIN_BACK_HEAVY.get(area, BY_AREA_GAIN_BACK_HEAVY['anywhere'])
    if label == 'error':
        penalty *= 1.20
    if label == 'dribbled_past':
        penalty *= 0.80
    return -penalty, label, area

def compute_miscontrol_impact(event_row):
    aerial_won = bool(event_row.get('miscontrol_aerial_won') == True)
    area = classify_pitch_area(event_row.get('location'))

    if aerial_won:
        return 0.0, 'miscontrol_after_aerial_win_neutral', area

    return compute_turnover_area_penalty(event_row.get('location'), 'miscontrol')

def compute_error_impact(event_row):
    return compute_turnover_area_penalty(event_row.get('location'), 'error')

def compute_dispossessed_impact(event_row):
    return compute_turnover_area_penalty(event_row.get('location'), 'dispossessed')

def compute_dribbled_past_impact(event_row):
    return compute_turnover_area_penalty(event_row.get('location'), 'dribbled_past')

# Clearance
CLEARANCE_REWARD_BY_AREA = {'own_box': 0.10, 'own_third': 0.04,}
def compute_clearance_impact(event_row):
    area = classify_pitch_area(event_row.get('location'))
    reward = CLEARANCE_REWARD_BY_AREA.get(area, 0.0)
    if reward == 0.0:
        return 0.0, 'clearance_no_impact', area
    return reward, 'clearance', area

# Block
BLOCK_REWARD_BY_AREA = {'own_box': 0.15, 'own_third': 0.08, 'middle_third': 0.04, 'final_third': 0.01}
def compute_block_impact(event_row):
    if event_row.get('block_deflection') == True or event_row.get('block_offensive') == True:
        return 0.0, 'block_no_impact', classify_pitch_area(event_row.get('location'))
    area = classify_pitch_area(event_row.get('location'))
    reward = BLOCK_REWARD_BY_AREA.get(area, 0.0)
    if bool(event_row.get('block_save') == True):
        reward *= 1.25
    if bool(event_row.get('block_counterpress') == True):
        reward += 0.04
    return reward, 'block', area

# Fouls
def compute_foul_committed_impact(event_row):
    def _as_minute(value):
        try:
            minute = float(value)
        except (TypeError, ValueError):
            minute = 90.0
        return max(1.0, min(90.0, minute))

    def _time_scaled(early_penalty, late_penalty, minute):
        # minute=1 -> early_penalty, minute=90 -> late_penalty
        early_factor = (90.0 - minute) / 89.0
        return late_penalty + (early_penalty - late_penalty) * early_factor

    minute = _as_minute(event_row.get('minute'))
    card = str(event_row.get('foul_committed_card') or '').strip()
    leads_to_penalty = bool(event_row.get('foul_committed_penalty') == True)

    if card == 'Red Card':
        penalty = _time_scaled(4.0, 2.0, minute)
        label = 'straight_red_card'
    elif card in {'Second Yellow', 'Second Yellow Card'}:
        penalty = _time_scaled(2.6, 1.3, minute)
        label = 'second_yellow_card'
    elif card == 'Yellow Card':
        penalty = _time_scaled(1.1, 0.5, minute)
        label = 'first_yellow_card'
    elif leads_to_penalty:
        penalty = 1.0
        label = 'penalty_conceded'
    else:
        area = classify_pitch_area(event_row.get('location'))
        if area == 'own_third':
            return -0.07, 'dangerous_freekick_foul', area
        return 0.0, 'foul_no_impact', 'anywhere'

    if leads_to_penalty and label != 'penalty_conceded':
        penalty = max(penalty, 1.8)
        label = f'{label}+penalty_conceded'

    return -penalty, label, 'anywhere'

BY_AREA_GAIN_FRONT_HEAVY = {
    'own_box': 0.01,
    'own_third': 0.03,
    'middle_third': 0.05,
    'final_third': 0.10,
    'opposition_box': 0.40,
    'anywhere': 0.10,
}
def compute_foul_won_impact(event_row):
    area = classify_pitch_area(event_row.get('location'))
    leads_to_penalty = bool(event_row.get('foul_won_penalty') == True)
    if leads_to_penalty:
        return 1.0, 'penalty_won', area
    reward = BY_AREA_GAIN_FRONT_HEAVY.get(area, BY_AREA_GAIN_FRONT_HEAVY['anywhere'])
    if reward == 0.0:
        return 0.0, 'foul_won_no_impact', area
    return reward, 'foul_won', area

def compute_bad_behaviour_impact(event_row):
    card = str(event_row.get('bad_behaviour_card') or '').strip()
    if card == 'Red Card':
        return -3.0, 'bad_behaviour_red_card', 'anywhere'
    if card in {'Yellow Card', 'Second Yellow', 'Second Yellow Card'}:
        return -1.5, 'bad_behaviour_yellow_card', 'anywhere'
    return 0.0, 'bad_behaviour_no_impact', 'anywhere'

# Ball Recovery
def compute_ball_recovery_impact(event_row):
    recovery_failure = bool(event_row.get('ball_recovery_recovery_failure') == True)
    if recovery_failure:
        return -0.10, 'ball_recovery_failed', classify_pitch_area(event_row.get('location'))
    return 0.05, 'ball_recovery', classify_pitch_area(event_row.get('location'))

# Ball Receipt
def compute_ball_receipt_impact(event_row):
    if 'ball_receipt_outcome' in event_row and event_row.get('ball_receipt_outcome') == 'Incomplete':
        return -0.03, 'ball_receipt_incomplete', classify_pitch_area(event_row.get('pass_end_location'))
    area = classify_pitch_area(event_row.get('pass_end_location'))
    if area in {'own_box', 'own_third'}:
        return 0.005, 'ball_receipt_own_third', area
    if area == 'middle_third':
        return 0.01, 'ball_receipt_middle_third', area
    if area in {'final_third'}:
        return 0.02, 'ball_receipt_final_third', area
    if area in {'opposition_box'}:
        return 0.04, 'ball_receipt_opposition_box', area
    return 0.0, 'ball_receipt_other_area', area

# Carry
def compute_carry_impact(event_row):
    start_area = classify_pitch_area(event_row.get('location'))
    end_area = classify_pitch_area(event_row.get('carry_end_location'))
    progress_x = event_row.get('carry_end_location')[0] - event_row.get('location')[0] if isinstance(event_row.get('location'), list) and isinstance(event_row.get('carry_end_location'), list) else 0
    progress_y = event_row.get('carry_end_location')[1] - event_row.get('location')[1] if isinstance(event_row.get('location'), list) and isinstance(event_row.get('carry_end_location'), list) else 0
    carry_length = np.sqrt(progress_x ** 2 + progress_y ** 2)
    if carry_length < 3.0:
        return 0.0, 'carry_no_impact', end_area
    is_progressive = (progress_x >= 10) if progress_x is not None else False
    under_pressure = bool(event_row.get('under_pressure') == True)
    impact = 0.0
    labels = []
    if is_progressive:
        impact += 0.08
        labels.append('progressive_carry')
    if end_area in {'final_third', 'opposition_box'} and start_area not in {'final_third', 'opposition_box'}:
        impact += 0.03
        labels.append('carry_into_final_third')
    if under_pressure:
        impact += 0.02
        labels.append('carry_under_pressure')
    if carry_length >= LONG_PASS_THRESHOLD:
        impact += 0.05
        labels.append('long_carry')
    return impact, 'carry_' + '_'.join(labels) if labels else 'carry_no_impact', end_area

# Duel
TACKLE_AREA_MULTIPLIER = {
    'opposition_box': 1.2,
    'final_third': 1.2,
    'middle_third': 1.0,
    'own_third': 1.2,
    'own_box': 1.4,
    'anywhere': 1.0,
}
def compute_duel_impact(event_row):
    area = classify_pitch_area(event_row.get('location'))
    duel_type = event_row.get('duel_type')
    if duel_type == 'Ariel Lost':
        if area in {'final_third', 'opposition_box'}:
            return -0.02, 'aerial_duel_lost_in_attacking_area', area
        if area == 'middle_third':
            return -0.03, 'aerial_duel_lost_in_middle_third', area
        if area == 'own_third':
            return -0.05, 'aerial_duel_lost_in_defensive_third', area
        if area == 'own_box':
            return -0.07, 'aerial_duel_lost_in_own_box', area
        return -0.03, 'aerial_duel_lost', area
    if duel_type == 'Tackle':
        outcome = event_row.get('duel_outcome')
        multiplier = TACKLE_AREA_MULTIPLIER.get(area, TACKLE_AREA_MULTIPLIER['anywhere'])
        if outcome in {'Won'}:
            return 0.15 * multiplier, 'tackle_won', area
        if outcome in {'Success', 'Success In Play', 'Success Out'}:
            return 0.12 * multiplier, 'tackle_success', area
        if outcome in {'Lost In Play', 'Lost Out'}:
            return -0.06 * multiplier, 'tackle_lost', area
        return 0.0, 'tackle_no_impact', area
    return 0.0, 'duel_other', area
    
# Dribble
def compute_dribble_impact(event_row):
    area = classify_pitch_area(event_row.get('location'))
    outcome = event_row.get('dribble_outcome')
    if outcome == 'Complete':
        if area in {'final_third', 'opposition_box'}:
            return 0.20, 'successful_dribble_in_attacking_area', area
        if area == 'middle_third':
            return 0.10, 'successful_dribble_in_middle_third', area
        if area in {'own_third', 'own_box'}:
            return 0.05, 'successful_dribble_in_defensive_area', area
        return 0.08, 'successful_dribble', area
    if outcome == 'Incomplete':
        if area in {'final_third', 'opposition_box'}:
            return -0.04, 'failed_dribble_in_attacking_area', area
        if area == 'middle_third':
            return -0.07, 'failed_dribble_in_middle_third', area
        if area in {'own_third', 'own_box'}:
            return -0.13, 'failed_dribble_in_defensive_area', area
        return -0.05, 'failed_dribble', area
    return 0.0, 'dribble_no_impact', area

# Interception
def compute_interception_impact(event_row):
    area = classify_pitch_area(event_row.get('location'))
    outcome = event_row.get('interception_outcome')
    multiplier = TACKLE_AREA_MULTIPLIER.get(area, TACKLE_AREA_MULTIPLIER['anywhere'])
    if outcome in {'Won', 'Success', 'Success In Play', 'Success Out'}:
        return 0.10 * multiplier, 'interception_success', area
    if outcome in {'Lost', 'Lost In Play', 'Lost Out'}:
        return -0.05 * multiplier, 'interception_lost', area
    return 0.0, 'interception_no_impact', area

# 50/50
def compute_5050_impact(event_row):
    area = classify_pitch_area(event_row.get('location'))
    outcome = event_row.get('50/50_outcome')
    if outcome in {'Won', 'Success To Team'}:
        return 0.10, '50/50_won', area
    if outcome in {'Lost', 'Success To Opposition'}:
        return -0.05, '50/50_lost', area
    return 0.0, '50/50_no_impact', area

def infer_grade(rating):
    if rating >= 8.5:
        return 'A+', "#1cb530"
    if rating >= 8.0:
        return 'A', "#56cc66"
    if rating >= 7.5:
        return 'B+', "#baf72b"
    if rating >= 7.0:
        return 'B', "#d8f72b"
    if rating >= 6.5:
        return 'C+', "#f0f72b"
    if rating >= 6.0:
        return 'C', "#f7e62b"
    if rating >= 5.5:
        return 'D+', "#f7c72b"
    if rating >= 5.0:
        return 'D', "#f78e2b"
    return 'F', "#f72b2b"

# Calculate match rating
def compute_event_based_rating(player_events):
    starting_rating = 6.0
    total_score = 0.0
    records = []
    for _, row in player_events.iterrows():
        event_type = row.get('type')
        if pd.isna(event_type):
            continue
        if event_type == 'Pass':
            impact, start_area, end_area, outcome_label = compute_pass_impact(row)
            area_label = f'{start_area}->{end_area}'
        elif event_type == 'Shot':
            impact, outcome_label = compute_shot_impact(row)
            area_label = 'anywhere'
        elif event_type == 'Pressure':
            impact, outcome_label = compute_pressure_impact(row)
            area_label = 'anywhere'
        elif event_type == 'Clearance':
            impact, outcome_label, area_label = compute_clearance_impact(row)
        elif event_type == 'Block':
            impact, outcome_label, area_label = compute_block_impact(row)
        elif event_type == 'Miscontrol':
            impact, outcome_label, area_label = compute_miscontrol_impact(row)
        elif event_type == 'Error':
            impact, outcome_label, area_label = compute_error_impact(row)
        elif event_type == 'Dispossessed':
            impact, outcome_label, area_label = compute_dispossessed_impact(row)
        elif event_type == 'Dribbled Past':
            impact, outcome_label, area_label = compute_dribbled_past_impact(row)
        elif event_type == 'Foul Committed':
            impact, outcome_label, area_label = compute_foul_committed_impact(row)
        elif event_type == 'Foul Won':
            impact, outcome_label, area_label = compute_foul_won_impact(row)
        elif event_type == 'Bad Behaviour':
            impact, outcome_label, area_label = compute_bad_behaviour_impact(row)
        elif event_type == 'Offside':
            impact, outcome_label, area_label = -0.20, 'offside', 'anywhere'
        elif event_type == 'Ball Recovery':
            impact, outcome_label, area_label = compute_ball_recovery_impact(row)
        elif event_type == 'Ball Receipt*':
            impact, outcome_label, area_label = compute_ball_receipt_impact(row)
        elif event_type == 'Carry':
            impact, outcome_label, area_label = compute_carry_impact(row)
        elif event_type == 'Duel':
            impact, outcome_label, area_label = compute_duel_impact(row)
        elif event_type == 'Dribble':
            impact, outcome_label, area_label = compute_dribble_impact(row)
        elif event_type == 'Interception':
            impact, outcome_label, area_label = compute_interception_impact(row)
        elif event_type == '50/50':
            impact, outcome_label, area_label = compute_5050_impact(row)
        else:
            impact = 0.0
            outcome_label = 'other'
            area_label = 'anywhere'

        total_score += impact
        records.append({
            'type': event_type,
            'area': area_label,
            'outcome': outcome_label,
            'impact': impact
        })

    event_count = len([record for record in records if record['impact'] != 0])
    #if event_count == 0:
    #    return {'event_rating': starting_rating, 'event_score_raw': 0.0, 'event_grade': infer_grade(starting_rating), 'event_count': 0, 'event_breakdown': pd.DataFrame()}
    starting_minute = player_events['minute'].min() if 'minute' in player_events.columns else 1.0
    end_minute = player_events['minute'].max() if 'minute' in player_events.columns else 90.0
    onpitch_length = max(1.0, end_minute - starting_minute)
    adjustment_factor = min(max(1.0, (onpitch_length + 30) / 30), 3.0)
    #print(f"Total raw impact score: {total_score:.2f} over {event_count} impactful events across {onpitch_length:.1f} minutes on pitch.")

    score_adjustment = total_score / adjustment_factor
    #score_adjustment = total_score / 3
    rating = np.clip(starting_rating + score_adjustment, 0.0, 10.0)

    breakdown = pd.DataFrame(records)
    breakdown = breakdown.groupby(['type', 'area', 'outcome'], as_index=False).agg(
        count=('impact', 'size'),
        impact=('impact', 'sum')
    )
    breakdown = breakdown.sort_values('impact', key=np.abs, ascending=False)
    grade, grade_color = infer_grade(rating)

    return {
        'event_rating': rating,
        'event_score_raw': total_score,
        'event_grade': grade,
        'event_grade_color': grade_color,
        'event_count': event_count,
        'event_breakdown': breakdown
    }
# -------------------------------------Match Rating Functions End------------------------------------

def add_rounded_box(ax, rect, edgecolor, linewidth=1.5):
    x, y, w, h = rect
    patch = FancyBboxPatch(
        (x, y),
        w,
        h,
        boxstyle="round,pad=0.008,rounding_size=0.03",
        linewidth=linewidth,
        edgecolor=edgecolor,
        facecolor="none",
        transform=ax.transAxes,
    )
    ax.add_patch(patch)


def draw_box_rows(ax, rect, rows, fontsize=20, top_pad=0.8, bottom_pad=0.2):
    x, y, w, h = rect
    if len(rows) == 1:
        ys = [y + h * 0.5]
    else:
        ys = np.linspace(y + h * top_pad, y + h * bottom_pad, len(rows))
    for row, ypos in zip(rows, ys):
        ax.text(x + 0.02, ypos, row, transform=ax.transAxes, fontsize=fontsize, va="center", color="#111111")


def draw_vertical_map_panel(fig, panel_rect, title, layers, legend_ncol=1):
    panel_ax = fig.add_axes(panel_rect)
    panel_ax.set_facecolor("none")
    panel_ax.set_xticks([])
    panel_ax.set_yticks([])
    for spine in panel_ax.spines.values():
        spine.set_visible(False)

    panel_ax.text(0.5, 0.90, title, ha="center", va="bottom", fontsize=13, color="#111111", transform=panel_ax.transAxes)

    map_ax = panel_ax.inset_axes([0.04, 0.13, 0.92, 0.76])
    pitch = VerticalPitch(pitch_type="statsbomb", line_color="#1f1f1f", pitch_color="#f9f9f9")
    pitch.draw(ax=map_ax)

    for layer in layers:
        data = layer["data"]
        if data.empty:
            continue
        pitch.scatter(
            data["x"],
            data["y"],
            ax=map_ax,
            color=layer["color"],
            s=layer.get("size", 22),
            alpha=0.85,
            label=layer["label"],
        )

    if any(not layer["data"].empty for layer in layers):
        handles, labels = map_ax.get_legend_handles_labels()
        panel_ax.legend(
            handles,
            labels,
            loc="lower center",
            bbox_to_anchor=(0.5, 0.005),
            frameon=False,
            fontsize=8,
            ncol=legend_ncol,
            columnspacing=1.1,
            handletextpad=0.5,
        )


def draw_vertical_passing_map_panel(fig, panel_rect, title, pass_segments):
    panel_ax = fig.add_axes(panel_rect)
    panel_ax.set_facecolor("none")
    panel_ax.set_xticks([])
    panel_ax.set_yticks([])
    for spine in panel_ax.spines.values():
        spine.set_visible(False)

    panel_ax.text(0.5, 0.90, title, ha="center", va="bottom", fontsize=13, color="#111111", transform=panel_ax.transAxes)

    map_ax = panel_ax.inset_axes([0.04, 0.13, 0.92, 0.76])
    pitch = VerticalPitch(pitch_type="statsbomb", line_color="#1f1f1f", pitch_color="#f9f9f9")
    pitch.draw(ax=map_ax)

    if not pass_segments.empty:
        pitch.arrows(
            pass_segments["x"],
            pass_segments["y"],
            pass_segments["x_end"],
            pass_segments["y_end"],
            ax=map_ax,
            color="#1d4ed8",
            width=1.1,
            headwidth=4,
            headlength=4,
            alpha=0.75,
        )
        pitch.scatter(
            pass_segments["x"],
            pass_segments["y"],
            ax=map_ax,
            color="#1d4ed8",
            s=14,
            alpha=0.25,
        )

    legend_handles = [
        Line2D([0], [0], color="#1d4ed8", lw=1.6, label="Pass trajectory"),
        Line2D(
            [0],
            [0],
            marker="o",
            color="w",
            markerfacecolor="#1d4ed8",
            markeredgecolor="#1d4ed8",
            alpha=0.35,
            markersize=6,
            label="Pass start",
        ),
    ]
    panel_ax.legend(legend_handles, [h.get_label() for h in legend_handles], loc="lower center", bbox_to_anchor=(0.5, 0.01), frameon=False, fontsize=8, ncol=1)


def extract_cards(player_info):
    cards_data = player_info.get("cards")
    if cards_data is None or (isinstance(cards_data, float) and np.isnan(cards_data)):
        return []

    if isinstance(cards_data, list):
        return [c.get("card_type") for c in cards_data if isinstance(c, dict) and c.get("card_type")]

    if isinstance(cards_data, dict):
        card_type = cards_data.get("card_type")
        return [card_type] if card_type else []

    return []


def build_player_card(
    competition_name,
    match_info,
    player_events,
    context,
    player_data,
    metrics,
    output_path=OUTPUT_PATH,
):
    fig = plt.figure(figsize=(8.5, 11.9), facecolor="#e7e7e7")
    canvas_ax = fig.add_axes([0, 0, 1, 1])
    canvas_ax.set_xticks([])
    canvas_ax.set_yticks([])
    for spine in canvas_ax.spines.values():
        spine.set_visible(False)

    header_rect = [0.0, 0.79, 1.0, 0.21]
    header_ax = fig.add_axes(header_rect)
    header_ax.set_facecolor("#aed5ff")
    header_ax.set_xticks([])
    header_ax.set_yticks([])
    for spine in header_ax.spines.values():
        spine.set_visible(False)

    header_ax.text(
        0.5,
        0.81,
        f"{competition_name}  ·  {match_info['home_team']} {match_info['home_score']} - {match_info['away_score']} {match_info['away_team']}  ·  {match_info['match_date']}",
        ha="center",
        va="center",
        fontsize=15,
    )
    header_ax.text(0.06, 0.50, context["display_name"], ha="left", va="center", fontsize=32, fontweight="bold")
    header_ax.text(
        0.06,
        0.19,
        f"{context['position']}  ·  {context['time_start']}'-{context['time_end']}'",
        ha="left",
        va="center",
        fontsize=19,
    )

    cards = extract_cards(context["player_info"])
    card_text = str(len(cards))
    on_pitch_minutes = int(context.get("time_end", "90")) - int(context.get("time_start", "0"))
    if on_pitch_minutes > 10:
        rating_result = compute_event_based_rating(player_events)
        print(f"{context['display_name']} rating: {rating_result['event_rating']:.1f} ({rating_result['event_grade']})")
        add_rounded_box(header_ax, (0.72, 0.12, 0.18, 0.52), rating_result['event_grade_color'], linewidth=1.2)
        header_ax.text(0.81, 0.54, "Rating", ha="center", va="center", fontsize=22, color=rating_result['event_grade_color'])
        header_ax.text(0.81, 0.34, f"{rating_result['event_rating']:.1f}", ha="center", va="center", fontsize=35, color=rating_result['event_grade_color'])
        header_ax.text(0.81, 0.17, f"{rating_result['event_grade']}", ha="center", va="center", fontsize=18, color=rating_result['event_grade_color'])

    shot_box = (0.04, 0.72, 0.92, 0.038)
    add_rounded_box(canvas_ax, shot_box, "#ff6f00")
    draw_box_rows(canvas_ax, shot_box, [f"Shots: {metrics['shots']}                           xG: {metrics['xg']:.2f}"], fontsize=23)

    passing_box = (0.04, 0.515, 0.48, 0.175)
    add_rounded_box(canvas_ax, passing_box, "#7f3fbf")
    draw_box_rows(
        canvas_ax,
        passing_box,
        [
            f"Passing:  {metrics['passes_completed']}/{metrics['passes_total']}",
            f"Pass into final third:  {metrics['final_third_completed']}/{metrics['final_third_total']}",
            f"Long Pass:  {metrics['long_pass_completed']}/{metrics['long_pass_total']}",
            f"Key Pass:  {metrics['key_passes']}",
        ],
        fontsize=22,
        top_pad=0.85,
        bottom_pad=0.15,
    )

    fouls_box = (0.56, 0.57, 0.40, 0.12)
    add_rounded_box(canvas_ax, fouls_box, "#67b346")
    draw_box_rows(
        canvas_ax,
        fouls_box,
        [
            f"Fouls:  {metrics['fouls_committed']}",
            f"Was Fouled:  {metrics['was_fouled']}",
            f"Cards:  {card_text}",
        ],
        fontsize=22,
    )

    dribble_box = (0.04, 0.40, 0.48, 0.075)
    add_rounded_box(canvas_ax, dribble_box, "#0070d6")
    draw_box_rows(
        canvas_ax,
        dribble_box,
        [
            f"Dribble:  {metrics['dribbles_completed']}/{metrics['dribbles_total']}",
            f"Progressive Carry:  {metrics['progressive_carries']}",
        ],
        fontsize=22,
        top_pad=0.72,
        bottom_pad=0.28,
    )

    turnover_box = (0.56, 0.40, 0.40, 0.13)
    add_rounded_box(canvas_ax, turnover_box, "#ff0000")
    draw_box_rows(
        canvas_ax,
        turnover_box,
        [
            f"Dispossessed:  {metrics['dispossessed']}",
            f"Dribbled past:  {metrics['dribbled_past']}",
            f"Miscontrol:  {metrics['miscontrol']}",
        ],
        fontsize=22,
    )

    pass_receiving_xy = to_xy_frame(player_data["pass_receptions"], "pass_end_location")
    recoveries_xy = to_xy_frame(player_data["recoveries"], "location")
    open_play_passes = (
        player_data["passes"][player_data["passes"]["pass_type"].isna()]
        if "pass_type" in player_data["passes"].columns
        else player_data["passes"].iloc[0:0]
    )
    open_play_xy = to_xy_frame(open_play_passes, "pass_end_location")
    pass_segments = to_segment_frame(open_play_passes, "location", "pass_end_location")

    map_y = 0.01
    map_h = 0.36
    map_w = 0.285
    map_gap = 0.025
    map_x0 = 0.045

    draw_vertical_map_panel(
        fig,
        [map_x0, map_y, map_w, map_h],
        "Defensive Action",
        [
            {"label": "Pressure", "data": to_xy_frame(player_data["pressures"], "location"), "color": "#c1121f", "size": 16},
            {"label": "Interception", "data": to_xy_frame(player_data["interceptions"], "location"), "color": "#2a9d8f", "size": 18},
            {"label": "Tackle", "data": to_xy_frame(player_data["tackles"], "location"), "color": "#f4a261", "size": 18},
            {"label": "Clearance", "data": to_xy_frame(player_data["clearances"], "location"), "color": "#457b9d", "size": 18},
            {"label": "Block", "data": to_xy_frame(player_data["blocks"], "location"), "color": "#6d597a", "size": 18},
        ],
        legend_ncol=2,
    )

    draw_vertical_map_panel(
        fig,
        [map_x0 + map_w + map_gap, map_y, map_w, map_h],
        "Ball Receiving",
        [
            {"label": "Pass reception", "data": pass_receiving_xy, "color": "#d62828", "size": 22},
            {"label": "Recovery", "data": recoveries_xy, "color": "#1d3557", "size": 20},
        ],
    )

    draw_vertical_passing_map_panel(
        fig,
        [map_x0 + 2 * (map_w + map_gap), map_y, map_w, map_h],
        "Passing Map",
        pass_segments,
    )

    fig.savefig(output_path, dpi=300)
    #plt.show()


if __name__ == "__main__":
    events = sb.events(MATCH_ID)
    lineups = sb.lineups(MATCH_ID)[TEAM_NAME]

    competitions = sb.competitions()
    competition_row = competitions[competitions["competition_id"] == COMPETITION_ID]
    competition_name = competition_row["competition_name"].values[0] if not competition_row.empty else "Competition"

    season_matches = sb.matches(COMPETITION_ID, SEASON_ID)
    match_info = season_matches[season_matches["match_id"] == MATCH_ID].iloc[0]

    context = get_player_context(events, lineups, PLAYER_NAME)
    player_data = extract_player_data(events, PLAYER_NAME)
    metrics = compute_metrics(player_data)
    player_events = events[events['player'] == PLAYER_NAME].copy()

    build_player_card(
        competition_name=competition_name,
        match_info=match_info,
        player_events=player_events,
        context=context,
        player_data=player_data,
        metrics=metrics,
        output_path=OUTPUT_PATH,
    )

    print(f"Saved card to {OUTPUT_PATH}")
