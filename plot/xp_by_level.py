import matplotlib.pyplot as plt

xp_by_level = {
    1: 0,
    2: 5,
    3: 10,
    4: 25,
    5: 50,
    6: 100,
    7: 150,
    8: 250,
    9: 350,
    10: 500,
    11: 750,
    12: 1000,
    13: 1500,
    14: 2000,
    15: 2500,
    16: 4000,
    17: 5500,
    18: 7000,
    19: 8500,
    20: 10000,
    21: 12000,
    22: 14500,
    23: 17000,
    24: 19500,
    25: 22000,
    26: 24500,
    27: 27000,
    28: 29500,
    29: 32000,
    30: 34500,
    31: 37000,
    32: 40000,
    33: 43000,
    34: 46000,
    35: 50000,
    36: 55000,
    37: 60000,
    38: 65000,
    39: 70000,
    40: 76250,
    41: 82500,
    42: 88750,
    43: 95000,
    44: 102500,
    45: 110000,
    46: 117500,
    47: 125000,
    48: 132500,
    49: 140000,
    50: 148750,
    51: 157500,
    52: 166250,
    53: 175000,
    54: 185000,
    55: 200000,
    56: 215000,
    57: 230000,
    58: 245000,
    59: 260000,
    60: 275000,
    61: 290000,
    62: 305000,
    63: 320000,
    64: 335000,
    65: 350000,
    66: 365000,
    67: 380000,
    68: 395000,
    69: 410000,
    70: 425000,
    71: 440000,
    72: 455000,
    73: 470000,
    74: 485000,
    75: 500000,
    76: 517500,
    77: 535000,
    78: 555000,
    79: 575000,
    80: 600000,
    81: 625000,
    82: 675000,
    83: 750000,
    84: 850000,
    85: 975000,
    86: 1125000,
    87: 1300000,
    88: 1500000,
    89: 1725000,
    90: 1975000,
    91: 2250000,
    92: 2525000,
    93: 2800000,
    94: 3075000,
    95: 3350000,
    96: 3625000,
    97: 3900000,
    98: 4175000,
    99: 4500000,
    100: 5000000,
}

levels = list(xp_by_level.keys())
xp = list(xp_by_level.values())

# XP gained between each level
xp_per_level = [xp[i] - xp[i - 1] for i in range(1, len(xp))]

fig, axes = plt.subplots(1, 2, figsize=(14, 5))

# Cumulative XP curve
axes[0].plot(levels, xp, marker="o", markersize=3)
axes[0].set_title("Cumulative XP by Level")
axes[0].set_xlabel("Level")
axes[0].set_ylabel("Total XP Required")
axes[0].grid(True, alpha=0.3)

# XP required to advance to the next level
axes[1].plot(levels[1:], xp_per_level, marker="o", markersize=3, color="orange")
axes[1].set_title("XP Required Per Level")
axes[1].set_xlabel("Level")
axes[1].set_ylabel("XP Needed Since Previous Level")
axes[1].grid(True, alpha=0.3)

plt.tight_layout()
plt.show()
