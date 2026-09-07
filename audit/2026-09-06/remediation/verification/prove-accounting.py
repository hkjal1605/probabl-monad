"""Machine-checked arithmetic lemmas for the explicitly specified contract formulas.

Requires z3-solver. This is an integer accounting model, NOT whole-program or bytecode verification.
Unknown/timeouts fail the run. Proofs are conditional on the stated assumptions and solver soundness.
"""
import json
import z3

WAD = 10**18
MAX128 = 2**128 - 1
MAX256 = 2**256 - 1
results = []


def prove(name, assumptions, property_):
    solver = z3.Solver()
    solver.set(timeout=30000)
    solver.add(*assumptions, z3.Not(property_))
    result = solver.check()
    record = {"property": name, "negation": str(result)}
    if result == z3.sat:
        record["counterexample"] = str(solver.model())
    elif result == z3.unknown:
        record["reason"] = solver.reason_unknown()
    results.append(record)
    print(json.dumps(record), flush=True)
    if result != z3.unsat:
        raise SystemExit("Proof did not establish the property")


def ceil_wad(value):
    return (value + WAD - 1) / WAD


q, p = z3.Ints("quantity price")
prove("uint128 quantity-price product fits uint256",
      [q >= 0, q <= MAX128, p >= 0, p <= MAX128], q * p <= MAX256)

x = z3.Int("scaled_notional")
prove("reservation is floor execution or exactly one unit above it",
      [x >= 0], z3.And(ceil_wad(x) >= x / WAD, ceil_wad(x) - x / WAD <= 1))

f, execution, limit = z3.Ints("fill execution_price limit_price")
prove("signed bid price bounds the scaled execution debit",
      [f >= 0, execution >= 0, limit >= execution], f * execution <= f * limit)

# These are scaled products. The previous lemma establishes actual <= at_limit.
actual, at_limit, remainder = z3.Ints("actual at_limit remainder")
prove("old bid reservation covers execution plus new reservation for every partial fill",
      [actual >= 0, at_limit >= actual, remainder >= 0],
      actual / WAD + ceil_wad(remainder) <= ceil_wad(at_limit + remainder))

old, new = z3.Ints("old_scaled_remaining new_scaled_remaining")
prove("open-notional reduction is nonnegative and telescopes",
      [old >= new, new >= 0],
      z3.And(ceil_wad(old) - ceil_wad(new) >= 0,
             (ceil_wad(old) - ceil_wad(new)) + ceil_wad(new) == ceil_wad(old)))

budget, debit, residual = z3.Ints("budget debit residual")
refund = budget - debit - residual
prove("checked buyer refund exactly conserves the original escrow",
      [budget >= 0, debit >= 0, residual >= 0, budget >= debit + residual],
      z3.And(refund >= 0, debit + residual + refund == budget))

# Euclidean division: N=(minimum-1)*WAD = quotient*unit + rem; ticks=quotient+1.
unit, quotient, rem, minimum = z3.Ints("unit quotient rem minimum")
product = unit * (quotient + 1)
prove("aligned cap witness reaches minNotional and the previous tick does not",
      [unit > 0, quotient >= 0, rem >= 0, rem < unit, minimum > 0,
       (minimum - 1) * WAD == quotient * unit + rem],
      z3.And(ceil_wad(product) >= minimum, ceil_wad(quotient * unit) < minimum))

n, cap, wallet = z3.Ints("witness_notional market_cap wallet_cap")
prove("accepted feasibility witness admits two separate wallets simultaneously",
      [n > 0, cap >= 2 * n, wallet >= n], z3.And(n <= wallet, n + n <= cap))

a, b = z3.Ints("yes_balance no_balance")
prove("invalid payout floors cannot overdraw collateral from a complete set",
      [a >= 0, b >= 0, a == b], a / 2 + b / 2 <= a)

print(json.dumps({"solver": z3.get_version_string(), "proved": len(results),
                  "scope": "integer arithmetic specification; no EVM, callbacks, hash security, or upstream CTF proof"}), flush=True)
