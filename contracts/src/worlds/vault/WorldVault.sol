// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IWorldBooks } from "../interfaces/IWorldBooks.sol";
import { WorldVaultAdmin } from "./WorldVaultAdmin.sol";
import { WorldVaultBase } from "./WorldVaultBase.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title WorldVault
/// @notice A pool of the deployment's stablecoin that makes markets in world books
///         (docs/version-2-plan.md). It is a maker contract on `WorldBooks`: its keeper signs
///         quotes, and its `onWorldFill` hook (`WorldVaultAdmin`) accepts each fill only within
///         the curator's eligibility, price and risk bounds, checked on the balances after it.
///
///         Every atom the vault sells comes from a full set it split, so its counterparties'
///         payouts are always backed in `WorldBooks`. The vault's own value is its credit there
///         plus its remaining atoms, which lies between `guaranteed` (credit plus its lowest atom
///         balance in each book) and `best` (credit plus each highest).
///
///         Shares are ERC-20s. Deposits and redemptions are requested into a batch, which closes
///         at least BATCH_PERIOD after it opened; its requests are then priced together at one
///         net asset value the marker posts, which must lie between the batch's `guaranteed` and
///         `best` at closing and move at most `maxMarkMoveBps` per share unless the guardian
///         approved it. A batch left unmarked MARK_TIMEOUT processes at its guaranteed value.
///         Redemptions pay from the vault's credit, up to `withdrawLimitBps` of supply per batch;
///         the unfilled remainder is handed back. Results are claimed per batch. Every rounding
///         favours the vault. Redemptions are never paused.
/// @dev The hook, risk tracking, curation, governance and views live in the `WorldVaultAdmin`
///      module, reached by delegatecall through the fallback. Nothing is upgradeable and no role
///      can move holdings.
contract WorldVault is WorldVaultBase {
    using SafeERC20 for IERC20;

    address internal immutable MODULE;

    constructor(
        IWorldBooks books,
        address admin,
        uint48 adminDelay,
        string memory name_,
        string memory symbol_
    ) WorldVaultBase(books, admin, adminDelay, name_, symbol_) {
        MODULE = address(new WorldVaultAdmin(books, admin, adminDelay, name_, symbol_));
        _withdrawLimitBps = uint16(BPS);
        _maxMarkMoveBps = 1000;
    }

    /// @notice The immutable module implementing the hook, risk, curation, governance and views.
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

    // ---------------------------------------------------------------- seed

    /// @notice The admin's first deposit: `assets` for `assets × 10^(18 - decimals)` shares, of
    ///         which DEAD_SHARES are locked forever. Opens the first batch.
    function seed(uint256 assets) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (totalSupply() != 0) revert AlreadySeeded();
        uint256 shares = assets * SHARE_SCALE;
        if (shares < MIN_SEED_SHARES) revert InvalidAmount();
        _pull(assets);
        _depositToBooks(assets);
        _mint(DEAD, DEAD_SHARES);
        _mint(msg.sender, shares - DEAD_SHARES);
        _refNav = assets;
        _lastNavPerShare = Math.mulDiv(assets, NAV_SCALE, shares);
        _batchId = 1;
        _batches[1].openedAt = uint40(block.timestamp);
        _batches[1].status = OPEN;
        emit Seeded(msg.sender, assets, shares);
    }

    // ---------------------------------------------------------------- requests

    /// @notice Requests a deposit of `assets` into the open batch. While deposits are not open,
    ///         only depositors may request.
    function requestDeposit(uint256 assets) external nonReentrant whenNotPaused {
        if (assets == 0) revert InvalidAmount();
        if (_batchId == 0) revert SeedRequired();
        if (!_openDeposits && !hasRole(DEPOSITOR_ROLE, msg.sender)) revert NotDepositor();
        if (_refNav + _pendingAssets + assets > _depositCap) revert CapExceeded();
        _pull(assets);
        uint64 id = _batchId;
        _batches[id].depositAssets += assets;
        _deposits[id][msg.sender] += assets;
        _pendingAssets += assets;
        emit DepositRequested(id, msg.sender, assets);
    }

    /// @notice Withdraws part or all of the caller's deposit request in the open batch.
    function cancelDeposit(uint256 assets) external nonReentrant {
        uint64 id = _batchId;
        uint256 requested = _deposits[id][msg.sender];
        if (assets == 0 || assets > requested) revert InvalidAmount();
        _deposits[id][msg.sender] = requested - assets;
        _batches[id].depositAssets -= assets;
        _pendingAssets -= assets;
        QUOTE.safeTransfer(msg.sender, assets);
        emit DepositCancelled(id, msg.sender, assets);
    }

    /// @notice Requests the redemption of `shares` in the open batch; they are held until the
    ///         batch is processed. Never paused.
    function requestRedeem(uint256 shares) external nonReentrant {
        if (shares == 0) revert InvalidAmount();
        if (_batchId == 0) revert SeedRequired();
        _transfer(msg.sender, address(this), shares);
        _escrowShares += shares;
        uint64 id = _batchId;
        _batches[id].redeemShares += shares;
        _redeems[id][msg.sender] += shares;
        emit RedeemRequested(id, msg.sender, shares);
    }

    function cancelRedeem(uint256 shares) external nonReentrant {
        uint64 id = _batchId;
        uint256 requested = _redeems[id][msg.sender];
        if (shares == 0 || shares > requested) revert InvalidAmount();
        _redeems[id][msg.sender] = requested - shares;
        _batches[id].redeemShares -= shares;
        _escrowShares -= shares;
        _transfer(address(this), msg.sender, shares);
        emit RedeemCancelled(id, msg.sender, shares);
    }

    // ---------------------------------------------------------------- batches

    /// @notice Closes the open batch once it is BATCH_PERIOD old, holds requests and no other
    ///         batch awaits its mark (anyone can call). Snapshots the vault's guaranteed and
    ///         best values and its supply, and opens the next batch.
    function closeBatch() external nonReentrant returns (uint64 id) {
        id = _batchId;
        if (id == 0 || _closedBatch != 0) revert BatchState();
        Batch storage bt = _batches[id];
        if (block.timestamp < uint256(bt.openedAt) + BATCH_PERIOD) revert BatchState();
        if (bt.depositAssets == 0 && bt.redeemShares == 0) revert BatchState();
        uint256 credit = BOOKS.credit(address(this));
        bt.guaranteed = credit + _sumLo;
        bt.best = credit + _sumHi;
        bt.supply = totalSupply();
        bt.closedAt = uint40(block.timestamp);
        bt.status = CLOSED;
        _closedBatch = id;
        uint64 next = id + 1;
        _batchId = next;
        _batches[next].openedAt = uint40(block.timestamp);
        _batches[next].status = OPEN;
        emit BatchClosed(id, bt.guaranteed, bt.best, bt.supply);
    }

    /// @notice The marker's net asset value for the closed batch, which processes it.
    function mark(uint64 id, uint256 nav) external nonReentrant onlyRole(MARKER_ROLE) {
        Batch storage bt = _closed(id);
        if (nav < bt.guaranteed || nav > bt.best) revert MarkBounds();
        uint256 last = _lastNavPerShare;
        uint256 next = Math.mulDiv(nav, NAV_SCALE, bt.supply);
        uint256 move = next > last ? next - last : last - next;
        if (move * BPS > last * _maxMarkMoveBps && _approvedMarks[id] != nav + 1) {
            revert MarkMove();
        }
        _process(id, bt, nav, false);
    }

    /// @notice Processes a batch left unmarked for MARK_TIMEOUT (anyone can call): redemptions at
    ///         its guaranteed value, the price least favourable to whoever leaves, and deposits
    ///         refunded, since the most favourable price for whoever enters would dilute the
    ///         holders. The last mark stays the reference for the next one.
    function processAtFloor(uint64 id) external nonReentrant {
        Batch storage bt = _closed(id);
        if (block.timestamp < uint256(bt.closedAt) + MARK_TIMEOUT) revert BatchState();
        _process(id, bt, bt.guaranteed, true);
    }

    /// @notice Pays `owner`'s results of a processed batch: the shares its deposit bought (or the
    ///         deposit back if the batch refunded deposits), and its redemption's assets plus the
    ///         unfilled shares (anyone can call).
    function claim(uint64 id, address owner) external nonReentrant {
        Batch storage bt = _batches[id];
        if (bt.status != PROCESSED) revert BatchState();
        uint256 assets = _deposits[id][owner];
        uint256 shares = _redeems[id][owner];
        if (assets == 0 && shares == 0) revert NothingToClaim();
        delete _deposits[id][owner];
        delete _redeems[id][owner];
        uint256 outShares;
        uint256 outAssets;
        if (assets != 0) {
            if (bt.refunded) outAssets = assets;
            else outShares = Math.mulDiv(assets, bt.minted, bt.depositAssets);
        }
        if (shares != 0) {
            uint256 total = bt.redeemShares;
            outAssets += Math.mulDiv(shares, bt.paid, total);
            outShares += Math.mulDiv(shares, total - bt.filled, total);
        }
        if (outShares != 0) {
            _escrowShares -= outShares;
            _transfer(address(this), owner, outShares);
        }
        if (outAssets != 0) {
            _owedAssets -= outAssets;
            QUOTE.safeTransfer(owner, outAssets);
        }
        emit Claimed(id, owner, outShares, outAssets);
    }

    function _closed(uint64 id) private view returns (Batch storage bt) {
        if (id == 0 || id != _closedBatch) revert BatchState();
        bt = _batches[id];
    }

    /// @dev Prices the batch at `nav` for its snapshot supply. Deposits mint shares at
    ///      nav / supply (refunded whole if that buys none, or at the floor); redemptions pay from
    ///      credit, at most `withdrawLimitBps` of supply and what the credit (with this batch's
    ///      deposits) covers.
    function _process(uint64 id, Batch storage bt, uint256 nav, bool floor) private {
        uint256 supply = bt.supply;
        uint256 deposits = bt.depositAssets;
        uint256 minted;
        bool refunded;
        if (deposits != 0) {
            minted = nav == 0 || floor ? 0 : Math.mulDiv(deposits, supply, nav);
            _pendingAssets -= deposits;
            if (minted == 0) {
                refunded = true;
                _owedAssets += deposits;
            } else {
                _depositToBooks(deposits);
                _mint(address(this), minted);
                _escrowShares += minted;
            }
        }
        uint256 filled;
        uint256 paid;
        uint256 wanted = bt.redeemShares;
        if (wanted != 0 && nav != 0) {
            uint256 available = BOOKS.credit(address(this));
            filled = Math.min(
                Math.min(wanted, Math.mulDiv(supply, _withdrawLimitBps, BPS)),
                Math.mulDiv(available, supply, nav)
            );
            paid = Math.mulDiv(filled, nav, supply);
            if (filled != 0) {
                _escrowShares -= filled;
                _burn(address(this), filled);
            }
            if (paid != 0) {
                BOOKS.withdraw(paid, address(this));
                _owedAssets += paid;
            }
        }
        bt.nav = nav;
        bt.minted = minted;
        bt.filled = filled;
        bt.paid = paid;
        bt.refunded = refunded;
        bt.status = PROCESSED;
        _closedBatch = 0;
        if (floor) {
            uint256 ref = _refNav;
            _refNav = ref > paid ? ref - paid : 0;
        } else {
            _refNav = nav + (refunded ? 0 : deposits) - paid;
            _lastNavPerShare = Math.mulDiv(nav, NAV_SCALE, supply);
        }
        emit BatchProcessed(id, nav, minted, filled, paid, refunded, floor);
    }

    function _pull(uint256 assets) private {
        uint256 before = QUOTE.balanceOf(address(this));
        QUOTE.safeTransferFrom(msg.sender, address(this), assets);
        if (QUOTE.balanceOf(address(this)) - before != assets) revert InvalidAmount();
    }

    function _depositToBooks(uint256 assets) private {
        QUOTE.forceApprove(address(BOOKS), assets);
        BOOKS.deposit(assets);
    }
}
