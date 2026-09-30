// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVaultAdmin } from "./DeltaVaultAdmin.sol";
import { DeltaVaultBase } from "./DeltaVaultBase.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title DeltaVault
/// @notice Pooled liquidity that makes markets in one stock across the conditional markets of a
///         `ConditionalStocks` exchange, quoting both branches of each event ("stock if YES" and
///         "stock if NO") at prices set by an off-chain keeper (docs/delta-vault.md).
///
///         A share is an exact pro-rata claim on everything the vault owns on the exchange:
///         plain quote and base credit, the escrow of its resting orders, and its YES/NO claims
///         in every registered market. Deposits and withdrawals are in kind, so share accounting
///         never uses a price, a probability or keeper input:
///         - A deposit adds the same fraction to every holding. The depositor pays quote and
///           base tokens; the vault splits what it needs into YES/NO claims and hands the
///           unneeded side of each split back to the depositor as exchange claims.
///         - A withdrawal takes the same fraction of every holding: tokens for the plain part and
///           for claims that pair up across branches (merged), and the unpaired remainder as
///           exchange claims transferred to the receiver.
///         Every rounding favours the vault.
///
///         The keeper only posts passive orders in registered markets, each within a band around
///         a Chainlink price, a short lifetime, a cutoff buffer and size caps, and never leaving
///         a crossed pair of vault quotes or a worst-case YES-minus-NO stock imbalance above the
///         market cap (`DeltaVaultAdmin.update`). The guardian pauses deposits and quoting and
///         invalidates every resting order. Withdrawals are never paused; the admin can
///         rate-limit them to no less than 10% of supply per day.
/// @dev Quoting, settlement, curation, governance and views live in the `DeltaVaultAdmin`
///      module, reached by delegatecall through the fallback. Quote and base must be plain
///      ERC-20s (no transfer fees, rebasing or transfer hooks), as the exchange itself requires.
///      Nothing is upgradeable and no role can move holdings.
contract DeltaVault is DeltaVaultBase {
    using SafeERC20 for IERC20;

    address internal immutable MODULE;

    constructor(Config memory c) DeltaVaultBase(c) {
        MODULE = address(new DeltaVaultAdmin(c));
        _withdrawLimitBps = uint16(BPS);
    }

    /// @notice The immutable module implementing quoting, settlement, curation, governance and
    ///         views.
    function module() external view returns (address) {
        return MODULE;
    }

    fallback() external {
        address target = MODULE;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }

    // ---------------------------------------------------------------- deposits and withdrawals

    /// @notice Deposits quote and base tokens for the largest whole number of shares whose
    ///         in-kind cost fits both budgets; the unneeded side of every claim split goes to
    ///         `receiver` as exchange claims. The first deposit (only the admin's) takes both
    ///         budgets whole and sets the vault's initial quote/base ratio.
    function deposit(uint256 maxQuote, uint256 maxBase, uint256 minShares, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares, uint256 quoteIn, uint256 baseIn)
    {
        _checkReceiver(receiver);
        uint256 supply = totalSupply();
        if (supply <= DEAD_SHARES && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert SeedRequired();
        }
        Holdings memory h = _holdings();
        Claims[] memory needs;
        (shares, quoteIn, baseIn, needs) = _depositTerms(h, supply, maxQuote, maxBase);
        if (shares == 0 || shares < minShares || quoteIn > maxQuote || baseIn > maxBase) {
            revert Slippage();
        }
        (, uint256 quoteHigh,, uint256 baseHigh) = _totals(h);
        if (quoteHigh + quoteIn > _quoteCap || baseHigh + baseIn > _baseCap) revert CapExceeded();

        _pull(QUOTE, quoteIn);
        _pull(BASE, baseIn);
        for (uint256 i; i < needs.length; ++i) {
            _addClaims(h.markets[i], needs[i], receiver);
        }
        _recordFlow(supply, shares, false);
        if (supply == 0) _mint(DEAD, DEAD_SHARES);
        _mint(receiver, shares);
        emit Deposited(msg.sender, receiver, shares, quoteIn, baseIn);
    }

    /// @notice Burns `shares` of `owner` for the same fraction of every holding: quote and base
    ///         tokens sent to `receiver`, plus each market's unpaired YES/NO claims transferred
    ///         to `receiver` on the exchange. Cancels the vault's orders when their escrow is
    ///         needed. Never paused.
    function withdraw(
        uint256 shares,
        uint256 minQuote,
        uint256 minBase,
        address receiver,
        address owner
    ) external nonReentrant returns (uint256 quoteOut, uint256 baseOut) {
        _checkReceiver(receiver);
        if (shares == 0) revert InvalidAmount();
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        uint256 supply = totalSupply();
        Holdings memory h = _holdings();
        Claims[] memory parts;
        bool locked;
        (quoteOut, baseOut, parts, locked) = _withdrawTerms(h, supply, shares);
        for (uint256 i; i < parts.length; ++i) {
            quoteOut += Math.min(parts[i].yesQuote, parts[i].noQuote);
            baseOut += Math.min(parts[i].yesBase, parts[i].noBase);
        }
        if (quoteOut < minQuote || baseOut < minBase) revert Slippage();
        _recordFlow(supply, shares, true);
        _burn(owner, shares);

        if (locked) _cancelAll();
        for (uint256 i; i < parts.length; ++i) {
            _removeClaims(h.markets[i], parts[i], receiver);
        }
        if (quoteOut != 0) EXCHANGE.withdraw(address(QUOTE), quoteOut, receiver);
        if (baseOut != 0) EXCHANGE.withdraw(address(BASE), baseOut, receiver);
        emit Withdrawn(msg.sender, receiver, owner, shares, quoteOut, baseOut);
    }

    /// @notice What `deposit` would take and mint now, and the claims it would hand back per
    ///         market (in `markets()` order).
    function previewDeposit(uint256 maxQuote, uint256 maxBase)
        external
        view
        nonReentrantView
        returns (uint256 shares, uint256 quoteIn, uint256 baseIn, Claims[] memory returned)
    {
        Claims[] memory needs;
        (shares, quoteIn, baseIn, needs) =
            _depositTerms(_holdings(), totalSupply(), maxQuote, maxBase);
        returned = new Claims[](needs.length);
        for (uint256 i; i < needs.length; ++i) {
            Claims memory n = needs[i];
            uint256 q = Math.max(n.yesQuote, n.noQuote);
            uint256 b = Math.max(n.yesBase, n.noBase);
            returned[i] = Claims(q - n.yesQuote, q - n.noQuote, b - n.yesBase, b - n.noBase);
        }
    }

    /// @notice What `withdraw` would pay now for `shares`, and the unpaired claims it would
    ///         transfer per market (in `markets()` order).
    function previewWithdraw(uint256 shares)
        external
        view
        nonReentrantView
        returns (uint256 quoteOut, uint256 baseOut, Claims[] memory claims)
    {
        uint256 supply = totalSupply();
        if (shares == 0 || shares > supply) revert InvalidAmount();
        Claims[] memory parts;
        (quoteOut, baseOut, parts,) = _withdrawTerms(_holdings(), supply, shares);
        claims = new Claims[](parts.length);
        for (uint256 i; i < parts.length; ++i) {
            Claims memory p = parts[i];
            uint256 q = Math.min(p.yesQuote, p.noQuote);
            uint256 b = Math.min(p.yesBase, p.noBase);
            quoteOut += q;
            baseOut += b;
            claims[i] = Claims(p.yesQuote - q, p.noQuote - q, p.yesBase - b, p.noBase - b);
        }
    }

    // ---------------------------------------------------------------- share arithmetic

    /// @dev Shares and in-kind cost of a deposit. Every holding grows by at least its current
    ///      amount x shares / supply (rounded up); `needs` are the claims to add per market.
    function _depositTerms(Holdings memory h, uint256 supply, uint256 maxQuote, uint256 maxBase)
        internal
        view
        returns (uint256 shares, uint256 quoteIn, uint256 baseIn, Claims[] memory needs)
    {
        if (supply <= DEAD_SHARES) {
            // No holder yet (or none left besides the dead shares): any ratio, both assets.
            if (maxQuote == 0 || maxBase == 0) revert InvalidAmount();
            uint256 minted = Math.sqrt(maxQuote * QUOTE_TO_WAD * (maxBase * BASE_TO_WAD));
            if (minted < MIN_INITIAL_SHARES) revert InvalidAmount();
            return (supply == 0 ? minted - DEAD_SHARES : minted, maxQuote, maxBase, needs);
        }
        (, uint256 quoteHigh,, uint256 baseHigh) = _totals(h);
        if (quoteHigh == 0 && baseHigh == 0) revert EmptyVault();
        // Each nonzero term of a cost rounds up by less than one raw unit: reserving one unit per
        // term keeps the cost of the budget's share count within the budget.
        uint256 quoteTerms = h.quote == 0 ? 0 : 1;
        uint256 baseTerms = h.base == 0 ? 0 : 1;
        for (uint256 i; i < h.claims.length; ++i) {
            Claims memory c = h.claims[i];
            if (c.yesQuote != 0 || c.noQuote != 0) ++quoteTerms;
            if (c.yesBase != 0 || c.noBase != 0) ++baseTerms;
        }
        shares = type(uint256).max;
        if (quoteHigh != 0) shares = _affordable(maxQuote, quoteTerms, supply, quoteHigh);
        if (baseHigh != 0) {
            shares = Math.min(shares, _affordable(maxBase, baseTerms, supply, baseHigh));
        }

        quoteIn = _up(h.quote, shares, supply);
        baseIn = _up(h.base, shares, supply);
        needs = new Claims[](h.claims.length);
        for (uint256 i; i < h.claims.length; ++i) {
            Claims memory c = h.claims[i];
            Claims memory n = Claims(
                _up(c.yesQuote, shares, supply),
                _up(c.noQuote, shares, supply),
                _up(c.yesBase, shares, supply),
                _up(c.noBase, shares, supply)
            );
            needs[i] = n;
            quoteIn += Math.max(n.yesQuote, n.noQuote);
            baseIn += Math.max(n.yesBase, n.noBase);
        }
    }

    /// @dev Plain payout and claim parts of a withdrawal: every holding shrinks by at most its
    ///      current amount x shares / supply (rounded down). `locked` when escrow is needed.
    function _withdrawTerms(Holdings memory h, uint256 supply, uint256 shares)
        internal
        pure
        returns (uint256 plainQuote, uint256 plainBase, Claims[] memory parts, bool locked)
    {
        plainQuote = Math.mulDiv(h.quote, shares, supply);
        plainBase = Math.mulDiv(h.base, shares, supply);
        locked = plainQuote > h.freeQuote || plainBase > h.freeBase;
        parts = new Claims[](h.claims.length);
        for (uint256 i; i < h.claims.length; ++i) {
            Claims memory c = h.claims[i];
            Claims memory f = h.free[i];
            Claims memory p = Claims(
                Math.mulDiv(c.yesQuote, shares, supply),
                Math.mulDiv(c.noQuote, shares, supply),
                Math.mulDiv(c.yesBase, shares, supply),
                Math.mulDiv(c.noBase, shares, supply)
            );
            parts[i] = p;
            locked = locked || p.yesQuote > f.yesQuote || p.noQuote > f.noQuote
                || p.yesBase > f.yesBase || p.noBase > f.noBase;
        }
    }

    function _affordable(uint256 budget, uint256 terms, uint256 supply, uint256 held)
        internal
        pure
        returns (uint256)
    {
        return budget > terms ? Math.mulDiv(budget - terms, supply, held) : 0;
    }

    function _up(uint256 amount, uint256 shares, uint256 supply) internal pure returns (uint256) {
        return Math.mulDiv(amount, shares, supply, Math.Rounding.Ceil);
    }

    /// @dev Records a share flow; a withdrawal fails once net outflow passes the window limit.
    function _recordFlow(uint256 supply, uint256 shares, bool outflow) internal {
        Window memory w = _window;
        if (block.timestamp >= w.start + WITHDRAW_WINDOW) {
            w = Window(block.timestamp, supply, 0, 0);
        }
        if (outflow) {
            w.outflow += shares;
            if (
                w.outflow > w.inflow
                    && w.outflow - w.inflow > Math.mulDiv(w.supply, _withdrawLimitBps, BPS)
            ) revert WithdrawLimit();
        } else {
            w.inflow += shares;
        }
        _window = w;
    }

    // ---------------------------------------------------------------- exchange custody

    /// @dev Takes `amount` of `token` from the caller into the vault's exchange credit.
    function _pull(IERC20 token, uint256 amount) internal {
        if (amount == 0) return;
        uint256 balance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - balance != amount) revert UnsupportedToken();
        uint256 credit = EXCHANGE.credit(address(this), address(token));
        token.forceApprove(address(EXCHANGE), amount);
        EXCHANGE.deposit(address(token), amount);
        if (EXCHANGE.credit(address(this), address(token)) - credit != amount) {
            revert UnsupportedToken();
        }
    }

    /// @dev Splits credit into the claims a deposit adds, returning the unneeded side of each
    ///      split to `receiver`.
    function _addClaims(uint32 id, Claims memory n, address receiver) internal {
        uint256 amount = Math.max(n.yesQuote, n.noQuote);
        if (amount != 0) {
            EXCHANGE.split(id, 0, amount);
            _send(id, 0, 0, receiver, amount - n.yesQuote);
            _send(id, 1, 0, receiver, amount - n.noQuote);
        }
        amount = Math.max(n.yesBase, n.noBase);
        if (amount != 0) {
            EXCHANGE.split(id, 1, amount);
            _send(id, 0, 1, receiver, amount - n.yesBase);
            _send(id, 1, 1, receiver, amount - n.noBase);
        }
    }

    /// @dev Merges the paired part of a withdrawal's claims into credit and sends the rest.
    function _removeClaims(uint32 id, Claims memory p, address receiver) internal {
        uint256 paired = Math.min(p.yesQuote, p.noQuote);
        if (paired != 0) EXCHANGE.merge(id, 0, paired);
        _send(id, 0, 0, receiver, p.yesQuote - paired);
        _send(id, 1, 0, receiver, p.noQuote - paired);
        paired = Math.min(p.yesBase, p.noBase);
        if (paired != 0) EXCHANGE.merge(id, 1, paired);
        _send(id, 0, 1, receiver, p.yesBase - paired);
        _send(id, 1, 1, receiver, p.noBase - paired);
    }

    function _send(uint32 id, uint8 branch, uint8 collateral, address to, uint256 amount) internal {
        if (amount != 0) EXCHANGE.transferClaim(id, branch, collateral, to, amount);
    }

    function _checkReceiver(address receiver) internal view {
        if (receiver == address(0) || receiver == address(this) || receiver == address(EXCHANGE)) {
            revert InvalidReceiver();
        }
    }
}
