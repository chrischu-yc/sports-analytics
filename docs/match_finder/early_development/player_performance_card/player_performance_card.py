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


def metric_grade(metrics):
    weighted_score = (
        0.35 * metrics["pass_accuracy"]
        + 0.2 * metrics["final_third_accuracy"]
        + 0.15 * metrics["dribble_success"]
        + 0.15 * min(metrics["progressive_carries"] * 8, 100)
        + 0.15 * min(metrics["recoveries"] * 6, 100)
    )

    if weighted_score >= 85:
        return "A+"
    if weighted_score >= 78:
        return "A"
    if weighted_score >= 70:
        return "B"
    if weighted_score >= 62:
        return "C"
    if weighted_score >= 52:
        return "D"
    return "F"


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
    add_rounded_box(header_ax, (0.76, 0.12, 0.18, 0.52), "#d10000", linewidth=1.2)
    header_ax.text(0.85, 0.51, "Player", ha="center", va="center", fontsize=22, color="#d10000")
    header_ax.text(0.85, 0.33, "Rating", ha="center", va="center", fontsize=22, color="#d10000")
    header_ax.text(0.85, 0.15, "(A+ to F)", ha="center", va="center", fontsize=18, color="#d10000")

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
    plt.show()


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

    build_player_card(
        competition_name=competition_name,
        match_info=match_info,
        context=context,
        player_data=player_data,
        metrics=metrics,
        output_path=OUTPUT_PATH,
    )

    print(f"Saved card to {OUTPUT_PATH}")
