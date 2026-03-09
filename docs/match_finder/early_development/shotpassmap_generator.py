from statsbombpy import sb
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

PITCH_LENGTH = 120
PITCH_WIDTH = 80

def draw_pitch(ax):
    ax.set_facecolor("#69ae5b")

    # Pitch outline
    ax.add_patch(plt.Rectangle((0, 0), PITCH_LENGTH, PITCH_WIDTH,
                                fill=False, edgecolor='white', linewidth=2))

    # Halfway line
    ax.plot([60, 60], [0, PITCH_WIDTH], color='white', linewidth=2)

    # Center circle and spot
    ax.add_patch(plt.Circle((60, 40), 10, fill=False, edgecolor='white', linewidth=2))
    ax.plot(60, 40, 'o', color='white', markersize=4)

    # Left penalty area (18-yard box): 18 deep, 44 wide (centred on goal)
    ax.add_patch(plt.Rectangle((0, 18), 18, 44, fill=False, edgecolor='white', linewidth=2))
    # Left 6-yard box
    ax.add_patch(plt.Rectangle((0, 30), 6, 20, fill=False, edgecolor='white', linewidth=2))
    # Left penalty spot and D-arc (radius 10, part outside the box)
    ax.plot(12, 40, 'o', color='white', markersize=4)
    ax.add_patch(patches.Arc((12, 40), 20, 20, theta1=307, theta2=53,
                              color='white', linewidth=2))

    # Right penalty area
    ax.add_patch(plt.Rectangle((102, 18), 18, 44, fill=False, edgecolor='white', linewidth=2))
    # Right 6-yard box
    ax.add_patch(plt.Rectangle((114, 30), 6, 20, fill=False, edgecolor='white', linewidth=2))
    # Right penalty spot and D-arc
    ax.plot(108, 40, 'o', color='white', markersize=4)
    ax.add_patch(patches.Arc((108, 40), 20, 20, theta1=127, theta2=233,
                              color='white', linewidth=2))

    # Goals (extend 2 units beyond the pitch)
    ax.add_patch(plt.Rectangle((-2, 36), 2, 8, fill=False, edgecolor='white', linewidth=2))
    ax.add_patch(plt.Rectangle((120, 36), 2, 8, fill=False, edgecolor='white', linewidth=2))


def generate_shotmap(match_id, team_name):
    events = sb.events(match_id=match_id)
    shots = events[events['type'] == 'Shot']
    team_shots = shots[shots['team'] == team_name]

    fig, ax = plt.subplots(figsize=(14, 10))
    draw_pitch(ax)

    ax.scatter(
        team_shots['location'].apply(lambda x: x[0]),
        team_shots['location'].apply(lambda x: x[1]),
        c='red', s=100, zorder=5, label='Shots'
    )

    ax.set_title(f'Shot Map for {team_name}', fontsize=16, color='white')
    fig.patch.set_facecolor('#69ae5b')
    ax.set_xlim(-5, PITCH_LENGTH + 5)
    ax.set_ylim(-5, PITCH_WIDTH + 5)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.legend(facecolor='#69ae5b', labelcolor='white')
    plt.tight_layout()
    plt.show()

def generate_passmap(match_id, team_name, player_name):
    events = sb.events(match_id=match_id)
    passes = events[events['type'] == 'Pass']
    player_passes = passes[passes['player'] == player_name]

    fig, ax = plt.subplots(figsize=(14, 10))
    draw_pitch(ax)

    for _, pass_event in player_passes.iterrows():
        start_x, start_y = pass_event['location']
        end_x, end_y = pass_event['pass_end_location']
        ax.arrow(start_x, start_y, end_x - start_x, end_y - start_y,
                 head_width=1, head_length=1, fc='blue', ec='blue', length_includes_head=True)
        ax.scatter(start_x, start_y, c='blue', s=50, zorder=5, alpha=0.2)

    ax.set_title(f'Pass Map for {player_name}', fontsize=16, color='white')
    fig.patch.set_facecolor('#69ae5b')
    ax.set_xlim(-5, PITCH_LENGTH + 5)
    ax.set_ylim(-5, PITCH_WIDTH + 5)
    ax.set_aspect('equal')
    ax.axis('off')
    plt.tight_layout()
    plt.show()
    

generate_shotmap(3754146, 'Leicester City')
generate_passmap(3754146, 'Leicester City', 'Jamie Vardy')