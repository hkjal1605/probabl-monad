"""Scoped integer lemmas for AtomicOrderRouter's bounded accumulation.

Requires z3-solver. This is not Solidity/EVM, callback, signature or whole-program verification.
The model relies on ABI uint128 bounds, MAX_MAKERS=32 and checked plan acceptance.
"""
import json
import z3

amounts = [z3.Int(f"fill_{i}") for i in range(32)]
total = z3.Sum(amounts)
uint128 = 2**128 - 1
bounds = [term for amount in amounts for term in (amount >= 0, amount <= uint128)]
quantity = z3.Int("taker_quantity")
cases = [
    ("all 32 uint128 fills sum below 2^133 and cannot overflow uint256", bounds, total < 2**133),
    ("every accepted prefix fits the signed quantity without intermediate underflow",
     bounds + [quantity >= 0, quantity <= uint128, total <= quantity],
     z3.And(*[z3.Sum(amounts[:i]) <= quantity for i in range(1, 33)])),
    ("accepted plan conserves signed base quantity and bounds the remaining uint128",
     bounds + [quantity >= 0, quantity <= uint128, total <= quantity],
     z3.And(quantity - total >= 0, quantity - total <= uint128,
            total + (quantity - total) == quantity)),
]
for name, assumptions, property_ in cases:
    solver = z3.Solver()
    solver.set(timeout=30000)
    solver.add(*assumptions, z3.Not(property_))
    result = solver.check()
    print(json.dumps({"property": name, "negation": str(result)}), flush=True)
    if result != z3.unsat:
        raise SystemExit("Atomic bounds were not proved")
print(json.dumps({"solver": z3.get_version_string(), "proved": len(cases),
                  "scope": "bounded integer specification only"}), flush=True)
