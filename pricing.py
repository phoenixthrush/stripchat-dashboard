"""Estimate token costs from saved package constants, never from live offers."""

from collections import deque
from decimal import Decimal
from statistics import median


def estimate_costs(rows, reference):
    """Annotate chronological rows before UI filters; consume all debits FIFO.

    Credits without a purchase price and missing opening inventory use an explicit
    fallback rate. Duplicate packages across methods do not bias the median.
    Decimal arithmetic is retained until values cross the JSON boundary.
    """
    packages = {
        (int(p["tokens"]), Decimal(str(p["price"])))
        for key, values in reference.items()
        if key.endswith("_packages")
        for p in values
        if p["tokens"] > 0 and p["price"] > 0
    }
    if not packages:
        raise ValueError("No valid package prices are available.")
    prices_by_size = {}
    for tokens, price in packages:
        prices_by_size.setdefault(tokens, set()).add(price)
    matched = [
        r
        for r in rows
        if r["purchase"] and len(prices_by_size.get(r["tokens"], set())) == 1
    ]
    fallback = (
        sum(next(iter(prices_by_size[r["tokens"]])) for r in matched)
        / sum(r["tokens"] for r in matched)
        if matched
        else median(sorted(price / tokens for tokens, price in packages))
    )
    fallback_basis = (
        "Token-weighted rate of matched purchases"
        if matched
        else "Median rate of distinct reference packages"
    )
    inventory = deque()
    for row in rows:
        tokens = row["tokens"]
        count = abs(tokens)
        matched_tokens = 0
        matched_eur = Decimal(0)
        if tokens > 0:
            candidates = prices_by_size.get(tokens, set()) if row["purchase"] else set()
            if len(candidates) == 1:
                cost = next(iter(candidates))
                basis = "Package size matched"
                matched_tokens = count
                matched_eur = cost
            elif candidates:
                cost = median(sorted(candidates))
                basis = "Ambiguous package prices: median"
            else:
                cost = tokens * fallback
                basis = (
                    "Unmatched purchase: fallback"
                    if row["purchase"]
                    else "Other credit: fallback valuation"
                )
            rate = cost / count
            inventory.append([count, rate, bool(matched_tokens)])
        elif tokens < 0:
            remaining, cost = count, Decimal(0)
            while remaining and inventory:
                batch = inventory[0]
                consumed = min(remaining, batch[0])
                cost += consumed * batch[1]
                if batch[2]:
                    matched_tokens += consumed
                    matched_eur += consumed * batch[1]
                remaining -= consumed
                batch[0] -= consumed
                if not batch[0]:
                    inventory.popleft()
            cost += remaining * fallback
            rate = cost / count
            basis = (
                "Matched packages · FIFO"
                if matched_tokens == count
                else "FIFO + fallback estimate"
                if matched_tokens
                else "Fallback estimate"
            )
        else:
            cost, rate, basis = Decimal(0), Decimal(0), "No token movement"
        row.update(
            estimated_eur=float(cost),
            matched_estimated_eur=float(matched_eur),
            fallback_estimated_eur=float(cost - matched_eur),
            eur_per_token=float(rate),
            cost_basis=basis,
            matched_cost_tokens=matched_tokens,
            fallback_cost_tokens=count - matched_tokens,
        )
    return {
        "currency": "EUR",
        "allocation": "FIFO",
        "fallback_eur_per_token": float(fallback),
        "fallback_basis": fallback_basis,
        "matched_purchases": len(matched),
        "purchase_count": sum(r["purchase"] for r in rows),
        "remaining_tokens": sum(b[0] for b in inventory),
        "remaining_estimated_eur": float(
            sum((b[0] * b[1] for b in inventory), Decimal(0))
        ),
    }
