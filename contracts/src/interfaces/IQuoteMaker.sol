// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice A contract that makes RFQ quotes (a Δ-vault). Its quotes carry a nonce of 2^96 or
///         more whose top 160 bits are its address, and the exchange asks it, before filling, to
///         accept each one: whoever it lets sign, within whatever limits it keeps.
interface IQuoteMaker {
    /// @notice Called by the exchange (as a static call, with a bounded gas budget) before
    ///         filling `fill` of a quote naming this contract as its maker.
    /// @param digest The EIP-712 digest of Quote(taker, terms, nonce) the quote was signed as.
    /// @param terms The signed terms (market, flags, expiry, price in ticks, signed quantity).
    /// @param fill What the placement takes now, at most the signed quantity.
    /// @param r The signature's r.
    /// @param vs The signature's EIP-2098 s and y-parity.
    /// @return This function's selector to accept; anything else (or a revert) skips the quote.
    function acceptQuote(bytes32 digest, uint256 terms, uint256 fill, bytes32 r, bytes32 vs)
        external
        view
        returns (bytes4);
}
