// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { WorldBooksAdmin } from "./WorldBooksAdmin.sol";
import { WorldBooksBase } from "./WorldBooksBase.sol";
import { IWorldQuoteMaker, WorldQuote } from "./interfaces/IWorldBooks.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title WorldBooks
/// @notice Fully backed markets on "worlds": a set of venue events that must all go a chosen
///         way, optionally with a stock's price at a fixing time (docs/version-2-plan.md).
///
///         A book splits its outcomes into atoms, exactly one of which wins: atom 0 is "some leg
///         failed", and the others are "every leg passed and the fixing landed in price bucket j"
///         (or simply "every leg passed" in a book without a feed). One raw quote unit of credit
///         splits into one unit of every atom (a full set) and a full set merges back, so every
///         atom in existence is backed by its book. Products are bundles of atoms: a world bet
///         is the buckets above a strike; a conditional payout adds units of atom 0, which
///         refund the stake if the world does not happen.
///
///         Makers sign `WorldQuote`s for one taker, who fills them in one call (or through a
///         delegate within a grant). The maker delivers the bundle from the atoms it holds,
///         splitting full sets from its credit for any shortfall, and any full sets it ends up
///         holding merge back into credit. A maker contract (a nonce of 2^96 or more names it)
///         decides each fill in its `onWorldFill` hook. The taker pays the book's fee on the
///         price, up front and in credit.
///
///         Legs resolve in the `EventOracle`. The first failed leg decides a book; a book with a
///         feed is otherwise decided by its fixing (`WorldBooksAdmin`). Winners redeem atoms for
///         credit, and credit withdraws at any time.
/// @dev Non-upgradeable. Governance, books, fixing, delegation and views live in the immutable
///      `WorldBooksAdmin` module, reached by delegatecall through the fallback. The quote token
///      must be a plain ERC-20 (no rebasing or hooks); a fee-on-transfer deposit credits its net.
contract WorldBooks is WorldBooksBase {
    using SafeERC20 for IERC20;

    address internal immutable MODULE;

    constructor(
        address quote_,
        address oracle_,
        address admin_,
        address bookAdmin_,
        address guardian_,
        address resolutionAdmin_
    ) WorldBooksBase(quote_, oracle_) {
        if (
            admin_ == address(0) || bookAdmin_ == address(0) || guardian_ == address(0)
                || resolutionAdmin_ == address(0)
        ) revert InvalidAddress();
        MODULE = address(new WorldBooksAdmin(quote_, oracle_));
        _admin = admin_;
        _bookAdmin = bookAdmin_;
        _guardian = guardian_;
        _resolutionAdmin = resolutionAdmin_;
        emit AdminAccepted(admin_);
        emit Configured(bookAdmin_, guardian_, resolutionAdmin_);
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

    // ---------------------------------------------------------------- custody

    /// @notice Credits the tokens actually received (a fee-on-transfer token credits its net).
    function deposit(uint256 amount) external nonReentrant {
        _deposit(amount);
    }

    /// @notice `deposit` after an EIP-2612 permit. A permit already used (front-run) is ignored
    ///         when the allowance it granted is in place.
    function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        try IERC20Permit(QUOTE).permit(msg.sender, address(this), amount, deadline, v, r, s) { }
            catch { }
        _deposit(amount);
    }

    /// @notice Withdraws credit to a destination chosen by its owner. Never paused.
    function withdraw(uint256 amount, address to) external nonReentrant {
        if (amount == 0 || to == address(0) || to == address(this)) revert InvalidTerms();
        uint256 available = _credit[msg.sender];
        if (available < amount) revert InsufficientFunds();
        _credit[msg.sender] = available - amount;
        _liability -= amount;
        IERC20(QUOTE).safeTransfer(to, amount);
        emit Withdrawn(msg.sender, amount, to);
    }

    function _deposit(uint256 amount) private {
        if (amount == 0) revert InvalidTerms();
        IERC20 token = IERC20(QUOTE);
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received == 0 || received > amount) revert TransferFailed();
        _liability += received;
        _credit[msg.sender] += received;
        emit Deposited(msg.sender, received);
    }

    // ---------------------------------------------------------------- positions

    /// @notice Converts credit into `amount` units of every atom of an undecided book.
    function split(uint64 id, uint256 amount) external nonReentrant {
        Book memory b = _book(id);
        if (amount == 0) revert InvalidTerms();
        (uint8 status,) = _decide(id, b);
        if (status != UNDECIDED) revert InvalidState();
        uint256 available = _credit[msg.sender];
        if (available < amount) revert InsufficientFunds();
        _credit[msg.sender] = available - amount;
        _backing[id] += amount;
        uint256[] memory balances = _loadAtoms(id, msg.sender, _atomCount(b));
        for (uint256 i; i < balances.length; ++i) {
            balances[i] += amount;
        }
        _storeAtoms(id, msg.sender, balances);
        emit PositionChanged(id, msg.sender, 0, amount);
    }

    /// @notice Converts `amount` units of every atom back into credit, in any state.
    function merge(uint64 id, uint256 amount) external nonReentrant {
        Book memory b = _book(id);
        if (amount == 0) revert InvalidTerms();
        uint256[] memory balances = _loadAtoms(id, msg.sender, _atomCount(b));
        for (uint256 i; i < balances.length; ++i) {
            if (balances[i] < amount) revert InsufficientFunds();
            balances[i] -= amount;
        }
        _storeAtoms(id, msg.sender, balances);
        _backing[id] -= amount;
        _credit[msg.sender] += amount;
        emit PositionChanged(id, msg.sender, 1, amount);
    }

    function transferAtoms(uint64 id, uint8 atom, address to, uint256 amount)
        external
        nonReentrant
    {
        Book memory b = _book(id);
        uint256 count = _atomCount(b);
        if (
            atom >= count || amount == 0 || to == address(0) || to == msg.sender
                || to == address(this)
        ) revert InvalidTerms();
        uint256[] memory from = _loadAtoms(id, msg.sender, count);
        if (from[atom] < amount) revert InsufficientFunds();
        from[atom] -= amount;
        uint256[] memory into = _loadAtoms(id, to, count);
        into[atom] += amount;
        _storeAtoms(id, msg.sender, from);
        _storeAtoms(id, to, into);
        emit AtomsTransferred(id, msg.sender, to, atom, amount);
    }

    // ---------------------------------------------------------------- fills

    /// @notice Fills a maker's signed quote for the caller, its taker.
    function fillQuote(WorldQuote calldata q, bytes32 r, bytes32 vs) external nonReentrant {
        if (q.taker != msg.sender) revert Unauthorized();
        _fill(q, r, vs, address(0));
    }

    /// @notice Fills a quote for its taker as the taker's delegate, within the taker's grant.
    function fillQuoteFor(WorldQuote calldata q, bytes32 r, bytes32 vs) external nonReentrant {
        if (q.taker == msg.sender || q.taker == address(0)) revert InvalidDelegation();
        _fill(q, r, vs, msg.sender);
    }

    /// @notice Marks nonces of the caller (as a wallet maker) used: `bits` of word `word`.
    function invalidateNonces(uint256 word, uint256 bits) external {
        _nonces[msg.sender][word] |= bits;
        emit NoncesInvalidated(msg.sender, word, bits);
    }

    function _fill(WorldQuote calldata q, bytes32 r, bytes32 vs, address delegate) private {
        if (_paused) revert NotTrading();
        if (q.expiry <= block.timestamp) revert Expired();
        Book memory b = _book(q.book);
        uint256 count = _atomCount(b);
        (uint256 minPay, uint256 maxPay) = _payRange(q, count);
        // A bundle never sells for less than it is sure to pay, nor for more than it can pay.
        if (q.price < minPay || q.price > maxPay) revert InvalidBundle();
        if (_stateOf(q.book, b) != S_TRADING) revert NotTrading();

        bytes32 digest = _digest(q);
        address maker = address(uint160(q.nonce >> 96));
        bool hooked = maker != address(0);
        if (!hooked) maker = _recover(digest, r, vs);
        if (maker == q.taker || maker == delegate) revert SelfTrade();
        _useNonce(maker, q.nonce);

        uint256 fee = (uint256(q.price) * b.feeBps + BPS - 1) / BPS;
        if (delegate != address(0)) _charge(q, delegate, fee, maxPay, b.feeBps);
        uint256 makerCredit = _credit[maker];
        if (q.sell) _takerSells(q, maker, count, fee);
        else _takerBuys(q, maker, count, fee);
        _fees += fee;
        emit WorldFill(
            q.book,
            maker,
            q.taker,
            uint256(q.mask) | (q.sell ? uint256(1) << 16 : 0),
            q.units,
            q.refund,
            q.price,
            fee,
            q.nonce,
            delegate
        );
        if (hooked) _hook(maker, digest, q, r, vs, makerCredit);
    }

    /// @dev What the bundle pays at worst and at best. Rejects bundles naming atom 0 in the mask
    ///      (it is `refund`), atoms the book lacks, or nothing at all.
    function _payRange(WorldQuote calldata q, uint256 count)
        private
        pure
        returns (uint256 minPay, uint256 maxPay)
    {
        uint256 mask = q.mask;
        if (
            mask & 1 != 0 || mask >> count != 0 || (mask == 0) != (q.units == 0)
                || (mask == 0 && q.refund == 0) || q.price == 0
        ) revert InvalidBundle();
        minPay = type(uint256).max;
        for (uint256 i; i < count; ++i) {
            uint256 pay = _need(q, i);
            if (pay < minPay) minPay = pay;
            if (pay > maxPay) maxPay = pay;
        }
    }

    function _need(WorldQuote calldata q, uint256 atom) private pure returns (uint256) {
        if (atom == 0) return q.refund;
        return (uint256(q.mask) >> atom) & 1 == 1 ? q.units : 0;
    }

    /// @dev The taker pays `price + fee` from credit and receives the bundle. The maker is paid
    ///      first, then delivers from its atoms, splitting the largest shortfall from its credit;
    ///      full sets it ends up holding merge back.
    function _takerBuys(WorldQuote calldata q, address maker, uint256 count, uint256 fee) private {
        address taker = q.taker;
        uint256 cost = uint256(q.price) + fee;
        uint256 takerCredit = _credit[taker];
        if (takerCredit < cost) revert InsufficientFunds();
        _credit[taker] = takerCredit - cost;
        uint256 makerCredit = _credit[maker] + q.price;

        uint256[] memory m = _loadAtoms(q.book, maker, count);
        uint256 shortfall;
        for (uint256 i; i < count; ++i) {
            uint256 need = _need(q, i);
            if (need > m[i] && need - m[i] > shortfall) shortfall = need - m[i];
        }
        if (shortfall != 0) {
            if (makerCredit < shortfall) revert InsufficientFunds();
            makerCredit -= shortfall;
            _backing[q.book] += shortfall;
        }
        uint256[] memory t = _loadAtoms(q.book, taker, count);
        uint256 sets = type(uint256).max;
        for (uint256 i; i < count; ++i) {
            uint256 need = _need(q, i);
            uint256 left = m[i] + shortfall - need;
            m[i] = left;
            if (left < sets) sets = left;
            t[i] += need;
        }
        makerCredit += _mergeHeld(q.book, m, sets);
        _credit[maker] = makerCredit;
        _storeAtoms(q.book, maker, m);
        _storeAtoms(q.book, taker, t);
    }

    /// @dev The taker delivers the bundle and receives `price - fee`; the maker pays `price`
    ///      from its credit after merging any full sets the bundle completes.
    function _takerSells(WorldQuote calldata q, address maker, uint256 count, uint256 fee) private {
        address taker = q.taker;
        uint256[] memory t = _loadAtoms(q.book, taker, count);
        uint256[] memory m = _loadAtoms(q.book, maker, count);
        uint256 sets = type(uint256).max;
        for (uint256 i; i < count; ++i) {
            uint256 need = _need(q, i);
            if (t[i] < need) revert InsufficientFunds();
            t[i] -= need;
            uint256 held = m[i] + need;
            m[i] = held;
            if (held < sets) sets = held;
        }
        uint256 makerCredit = _credit[maker] + _mergeHeld(q.book, m, sets);
        if (makerCredit < q.price) revert InsufficientFunds();
        _credit[maker] = makerCredit - q.price;
        _credit[taker] += q.price - fee;
        _storeAtoms(q.book, taker, t);
        _storeAtoms(q.book, maker, m);
    }

    /// @dev Merges `sets` full sets out of `balances` (in memory); returns the credit they free.
    function _mergeHeld(uint64 id, uint256[] memory balances, uint256 sets)
        private
        returns (uint256)
    {
        if (sets == 0) return 0;
        for (uint256 i; i < balances.length; ++i) {
            balances[i] -= sets;
        }
        _backing[id] -= sets;
        return sets;
    }

    /// @dev A delegated fill spends the taker's grant: a buy its price plus fee, a sell the
    ///      bundle's largest payout.
    function _charge(
        WorldQuote calldata q,
        address delegate,
        uint256 fee,
        uint256 maxPay,
        uint16 feeBps
    ) private {
        address owner = q.taker;
        Delegation memory g = _grants[owner][delegate];
        uint8 permission = q.sell ? SELL : BUY;
        if (
            g.permissions & permission == 0 || g.revoked || g.epoch != _delegationEpochs[owner]
                || block.timestamp >= g.expiresAt
        ) revert DelegationInactive();
        if (feeBps > g.maxFeeBps) revert FeeCap();
        Budget storage budget = _budgets[owner][delegate];
        if (q.sell) {
            uint256 remaining = budget.remainingSell;
            if (maxPay > budget.maxSell || maxPay > remaining) revert DelegateBudget();
            budget.remainingSell = uint128(remaining - maxPay);
        } else {
            uint256 cost = uint256(q.price) + fee;
            uint256 remaining = budget.remainingBuy;
            if (cost > budget.maxBuy || cost > remaining) revert DelegateBudget();
            budget.remainingBuy = uint128(remaining - cost);
        }
    }

    function _recover(bytes32 digest, bytes32 r, bytes32 vs) private pure returns (address signer) {
        bytes32 s = vs & bytes32(type(uint256).max >> 1);
        if (uint256(s) > HALF_ORDER) revert BadSignature();
        signer = ecrecover(digest, uint8(uint256(vs) >> 255) + 27, r, s);
        if (signer == address(0)) revert BadSignature();
    }

    function _useNonce(address maker, uint256 nonce) private {
        uint256 word = _nonces[maker][nonce >> 8];
        // forge-lint: disable-next-line(incorrect-shift)
        uint256 bit = 1 << (nonce & 255);
        if (word & bit != 0) revert NonceUsed();
        _nonces[maker][nonce >> 8] = word | bit;
    }

    /// @dev Calls the maker contract after every balance moved, with a fixed gas budget and the
    ///      lock held. Only its exact selector, ABI-padded, accepts the fill.
    function _hook(
        address maker,
        bytes32 digest,
        WorldQuote calldata q,
        bytes32 r,
        bytes32 vs,
        uint256 makerCredit
    ) private {
        bytes memory data = abi.encodeCall(
            IWorldQuoteMaker.onWorldFill, (digest, q, r, vs, makerCredit)
        );
        bool ok;
        bytes32 answer;
        assembly ("memory-safe") {
            ok := call(FILL_HOOK_GAS, maker, 0, add(data, 32), mload(data), 0, 0)
            if and(ok, eq(returndatasize(), 32)) {
                returndatacopy(0, 0, 32)
                answer := mload(0)
            }
        }
        if (!ok || answer != bytes32(IWorldQuoteMaker.onWorldFill.selector)) {
            revert MakerRejected();
        }
    }

    // ---------------------------------------------------------------- redemption

    /// @notice Latches a book's outcome once its legs settle it (anyone can call).
    function settle(uint64 id) external nonReentrant returns (uint8 status, uint8 winner) {
        return _decide(id, _book(id));
    }

    /// @notice Pays the caller's winning atoms of a decided book into credit and clears the
    ///         caller's other atoms of it.
    function redeem(uint64 id) external nonReentrant returns (uint256) {
        return _redeem(id);
    }

    function redeemMany(uint64[] calldata ids) external nonReentrant returns (uint256 total) {
        for (uint256 i; i < ids.length; ++i) {
            total += _redeem(ids[i]);
        }
    }

    function _redeem(uint64 id) private returns (uint256 amount) {
        Book memory b = _book(id);
        (uint8 status, uint8 winner) = _decide(id, b);
        if (status == UNDECIDED) revert NotDecided();
        uint256 count = _atomCount(b);
        uint256[] memory balances = _loadAtoms(id, msg.sender, count);
        amount = balances[winner];
        bool any;
        for (uint256 i; i < count; ++i) {
            if (balances[i] != 0) any = true;
            balances[i] = 0;
        }
        if (!any) revert NothingToRedeem();
        _storeAtoms(id, msg.sender, balances);
        _backing[id] -= amount;
        _credit[msg.sender] += amount;
        emit Redeemed(id, msg.sender, winner, amount);
    }

    function _book(uint64 id) private view returns (Book memory b) {
        b = _books[id];
        if (b.legCount == 0) revert UnknownBook();
    }
}
