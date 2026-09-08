"""Scoped integer transition lemmas, not Solidity/EVM or whole-program verification.

Assumes canonical exact-transfer assets, a failed subcall rolls back, authenticated
withdrawals, and the contract's balance/credit checks. Tests cover these assumptions
separately; this file does not prove external token or receiver behavior.
"""
import json
import z3

b, total, owner, other, amount = z3.Ints("balance total owner other amount")
bounds = [b >= total, total == owner + other, owner >= 0, other >= 0,
          amount > 0, b < 2**256]
cases = [
    ("failed exact payout remains backed without overflowing uint256",
     bounds + [b - total >= amount],
     z3.And(b >= total + amount, owner + amount < 2**256, total + amount < 2**256)),
    ("successful payout preserves prior credits and their backing",
     bounds + [b - total >= amount], b - amount >= total),
    ("beneficiary withdrawal reduces its own liability and backing equally",
     bounds + [amount <= owner],
     z3.And(owner - amount >= 0, total - amount == owner - amount + other,
            b - amount >= total - amount)),
    ("withdrawal cannot consume another beneficiary's credit",
     bounds + [amount <= owner], total - amount >= other),
]
fills, releases = z3.Ints("fills releases")
cases.append(("bounded atomic staging never exceeds 193 payout slots",
              [fills >= 0, fills <= 32, releases >= 0, releases <= 32],
              fills * 5 + releases + 1 <= 193))
for name, assumptions, property_ in cases:
    solver = z3.Solver()
    solver.set(timeout=30000)
    solver.add(*assumptions, z3.Not(property_))
    result = solver.check()
    print(json.dumps({"property": name, "negation": str(result)}), flush=True)
    if result != z3.unsat:
        raise SystemExit("Payout accounting property not proved")
print(json.dumps({"solver": z3.get_version_string(), "proved": len(cases),
                  "scope": "integer transition specification only"}), flush=True)
