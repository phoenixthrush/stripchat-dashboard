import matplotlib.pyplot as plt
import numpy as np

# PayPal packages
paypal_packages = [
    {"tokens": 80, "price": 9.99},
    {"tokens": 180, "price": 20.99},
    {"tokens": 460, "price": 49.99},
    {"tokens": 660, "price": 69.99},
    {"tokens": 1160, "price": 119.99},
    {"tokens": 2005, "price": 199.99},
]


# Credit/Debit Card packages
card_packages = [
    {"tokens": 86, "price": 9.99},
    {"tokens": 200, "price": 20.99},
    {"tokens": 520, "price": 49.99},
    {"tokens": 730, "price": 69.99},
    {"tokens": 1275, "price": 119.99},
    {"tokens": 2250, "price": 199.99},
]


# Cryptocurrency packages
crypto_packages = [
    {"tokens": 86, "price": 9.99},
    {"tokens": 200, "price": 20.99},
    {"tokens": 520, "price": 49.99},
    {"tokens": 730, "price": 69.99},
    {"tokens": 1275, "price": 119.99},
    {"tokens": 2250, "price": 199.99},
    {"tokens": 3395, "price": 299.99},
    {"tokens": 5825, "price": 499.99},
    {"tokens": 12050, "price": 999.99},
    {"tokens": 24100, "price": 1999.99},
    {"tokens": 60250, "price": 4999.99},
]


# Bank account / online banking packages
bank_packages = [
    {"tokens": 86, "price": 9.99},
    {"tokens": 200, "price": 20.99},
    {"tokens": 520, "price": 49.99},
    {"tokens": 730, "price": 69.99},
    {"tokens": 1275, "price": 119.99},
    {"tokens": 2250, "price": 199.99},
]


# Paysafecard packages
paysafecard_packages = [
    {"tokens": 80, "price": 10.00},
    {"tokens": 120, "price": 15.00},
    {"tokens": 160, "price": 20.00},
    {"tokens": 220, "price": 25.00},
    {"tokens": 265, "price": 30.00},
    {"tokens": 480, "price": 50.00},
    {"tokens": 1000, "price": 100.00},
]


# Wero packages
wero_packages = [
    {"tokens": 86, "price": 9.99},
    {"tokens": 200, "price": 20.99},
    {"tokens": 520, "price": 49.99},
    {"tokens": 730, "price": 69.99},
    {"tokens": 1275, "price": 119.99},
    {"tokens": 2250, "price": 199.99},
]


# Skrill packages
skrill_packages = [
    {"tokens": 86, "price": 9.99},
    {"tokens": 200, "price": 20.99},
    {"tokens": 520, "price": 49.99},
    {"tokens": 730, "price": 69.99},
    {"tokens": 1275, "price": 119.99},
    {"tokens": 2250, "price": 199.99},
]


# All payment methods
payment_packages = {
    "paypal": paypal_packages,
    "card": card_packages,
    "crypto": crypto_packages,
    "bank": bank_packages,
    "paysafecard": paysafecard_packages,
    "wero": wero_packages,
    "skrill": skrill_packages,
}


def tokens_by_price(packages):
    """Create a lookup dictionary using price as the key."""
    return {package["price"]: package["tokens"] for package in packages}


# Create a lookup table for every payment method
packages_by_method = {
    method: tokens_by_price(packages) for method, packages in payment_packages.items()
}


# Get every unique price from every payment method
prices = sorted(
    {price for packages in packages_by_method.values() for price in packages}
)


# Calculate tokens received per euro for every payment method
values_by_method = {}

for method, packages in packages_by_method.items():
    values_by_method[method] = [packages.get(price, np.nan) / price for price in prices]


# Print a comparison table
print("Token Value Comparison")
print("-" * 140)

header = f"{'Price':>12}"

for method in payment_packages:
    header += f"{method.title():>18}"

print(header)
print("-" * 140)

for index, price in enumerate(prices):
    row = f"€{price:>10.2f}"

    for method in payment_packages:
        value = values_by_method[method][index]

        if np.isnan(value):
            row += f"{'N/A':>18}"
        else:
            row += f"{value:>18.2f}"

    print(row)


# Payment methods and chart colors
methods = list(payment_packages.keys())

colors = {
    "paypal": "#4c78a8",
    "card": "#f58518",
    "crypto": "#54a24b",
    "bank": "#e45756",
    "paysafecard": "#72b7b2",
    "wero": "#b279a2",
    "skrill": "#ff9da6",
}


# Create grouped bar chart
x = np.arange(len(prices))
number_of_methods = len(methods)

# Automatically size the bars based on the number of payment methods
bar_group_width = 0.85
bar_width = bar_group_width / number_of_methods

plt.figure(figsize=(22, 10))

all_bars = []

for method_index, method in enumerate(methods):
    # Center the complete group around each price
    offset = (method_index - (number_of_methods - 1) / 2) * bar_width

    bars = plt.bar(
        x + offset,
        values_by_method[method],
        width=bar_width,
        label=method.title(),
        color=colors.get(method),
    )

    all_bars.append(bars)


# Add values above every visible bar
for bars in all_bars:
    for bar in bars:
        height = bar.get_height()

        if not np.isnan(height) and height > 0:
            plt.text(
                bar.get_x() + bar.get_width() / 2,
                height + 0.03,
                f"{height:.2f}",
                ha="center",
                va="bottom",
                fontsize=7,
                rotation=90,
            )


plt.title("Token Value by Payment Method", fontsize=16)
plt.xlabel("Package Price")
plt.ylabel("Tokens per Euro")

plt.xticks(
    x,
    [f"€{price:,.2f}" for price in prices],
    rotation=45,
    ha="right",
)

plt.legend(
    title="Payment Method",
    ncol=2,
)

plt.grid(axis="y", alpha=0.3)
plt.tight_layout()
plt.show()
