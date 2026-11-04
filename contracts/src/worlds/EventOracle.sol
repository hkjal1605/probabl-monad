// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IEventOracle } from "./interfaces/IEventOracle.sol";

/// @title EventOracle
/// @notice Final outcomes of venue events (Polymarket and Kalshi), keyed as the exchange keys
///         them: keccak256(abi.encode(condition, yesIndex, noIndex)). Every world book reads its
///         legs here, so one resolution serves every book on the event.
///
///         Resolution takes two keys, as on the exchange: the market admin commits a hash of the
///         outcome and its evidence, then the resolution admin resolves exactly that. The market
///         admin or the guardian freezes an event when its result is known or imminent, which
///         halts trading in every book that uses it. A resolved outcome never changes.
/// @dev Non-upgradeable. States: UNKNOWN 0, FROZEN 1, COMMITTED 2, YES 3, NO 4, INVALID 5.
contract EventOracle is IEventOracle {
    uint8 public constant UNKNOWN = 0;
    uint8 public constant FROZEN = 1;
    uint8 public constant COMMITTED = 2;
    uint8 public constant YES = 3;
    uint8 public constant NO = 4;
    uint8 public constant INVALID = 5;

    uint64 public constant ADMIN_DELAY = 2 days;
    uint256 public constant MAX_URI = 512;

    struct Outcome {
        uint8 state;
        uint40 resolvedAt;
    }

    address internal _admin;
    address internal _pendingAdmin;
    uint64 internal _adminAfter;
    address internal _marketAdmin;
    address internal _guardian;
    address internal _resolutionAdmin;

    mapping(bytes32 key => Outcome) internal _outcomes;
    mapping(bytes32 key => bytes32) internal _commitments;
    mapping(bytes32 key => bytes32) internal _evidence;

    event Configured(address marketAdmin, address guardian, address resolutionAdmin);
    event AdminProposed(address indexed successor, uint64 acceptableAfter);
    event AdminAccepted(address indexed admin);
    event EventFrozen(bytes32 indexed key, bytes32 reason, address actor);
    event EventReopened(bytes32 indexed key, bytes32 reason, address actor);
    event EventCommitted(bytes32 indexed key, bytes32 commitment, address actor);
    event EventResolved(
        bytes32 indexed key, uint8 outcome, bytes32 evidence, string uri, address actor
    );

    error Unauthorized();
    error InvalidAddress();
    error InvalidTerms();
    error InvalidState();
    error Commitment();
    error AdminDelay();

    constructor(address admin_, address marketAdmin_, address guardian_, address resolutionAdmin_) {
        if (admin_ == address(0)) revert InvalidAddress();
        _admin = admin_;
        emit AdminAccepted(admin_);
        _configure(marketAdmin_, guardian_, resolutionAdmin_);
    }

    // ---------------------------------------------------------------- governance

    function configure(address marketAdmin_, address guardian_, address resolutionAdmin_) external {
        if (msg.sender != _admin) revert Unauthorized();
        _configure(marketAdmin_, guardian_, resolutionAdmin_);
    }

    /// @notice Starts a delayed admin transfer; a zero successor cancels a pending one.
    function proposeAdmin(address successor) external {
        if (msg.sender != _admin) revert Unauthorized();
        if (successor == _admin) revert InvalidAddress();
        uint64 after_ = uint64(block.timestamp) + ADMIN_DELAY;
        _pendingAdmin = successor;
        _adminAfter = after_;
        emit AdminProposed(successor, after_);
    }

    function acceptAdmin() external {
        if (msg.sender != _pendingAdmin || msg.sender == address(0)) revert Unauthorized();
        if (block.timestamp < _adminAfter) revert AdminDelay();
        _admin = msg.sender;
        _pendingAdmin = address(0);
        _adminAfter = 0;
        emit AdminAccepted(msg.sender);
    }

    function _configure(address marketAdmin_, address guardian_, address resolutionAdmin_) private {
        if (marketAdmin_ == address(0) || guardian_ == address(0) || resolutionAdmin_ == address(0))
        {
            revert InvalidAddress();
        }
        _marketAdmin = marketAdmin_;
        _guardian = guardian_;
        _resolutionAdmin = resolutionAdmin_;
        emit Configured(marketAdmin_, guardian_, resolutionAdmin_);
    }

    // ---------------------------------------------------------------- resolution

    /// @notice Halts every book with this event until it resolves or is reopened.
    function freeze(bytes32 key, bytes32 reason) external {
        if (msg.sender != _marketAdmin && msg.sender != _guardian) revert Unauthorized();
        if (key == bytes32(0) || reason == bytes32(0)) revert InvalidTerms();
        Outcome storage o = _outcomes[key];
        if (o.state != UNKNOWN) revert InvalidState();
        o.state = FROZEN;
        emit EventFrozen(key, reason, msg.sender);
    }

    /// @notice Undoes a freeze or a pending commitment, so books trade on the event again.
    function reopen(bytes32 key, bytes32 reason) external {
        if (msg.sender != _marketAdmin) revert Unauthorized();
        if (reason == bytes32(0)) revert InvalidTerms();
        Outcome storage o = _outcomes[key];
        if (o.state != FROZEN && o.state != COMMITTED) revert InvalidState();
        o.state = UNKNOWN;
        delete _commitments[key];
        emit EventReopened(key, reason, msg.sender);
    }

    /// @notice Commits the hash of an outcome (`resolutionHash`), freezing the event if it is not
    ///         already. Replaces a pending commitment.
    function commit(bytes32 key, bytes32 commitment_) external {
        if (msg.sender != _marketAdmin) revert Unauthorized();
        if (key == bytes32(0) || commitment_ == bytes32(0)) revert InvalidTerms();
        Outcome storage o = _outcomes[key];
        if (o.state > COMMITTED) revert InvalidState();
        o.state = COMMITTED;
        _commitments[key] = commitment_;
        emit EventCommitted(key, commitment_, msg.sender);
    }

    /// @notice The commitment the market admin prepares before the resolution admin resolves.
    function resolutionHash(bytes32 key, uint8 outcome_, bytes32 evidence_, string calldata uri)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                "PROBABL_EVM_EVENT_RESOLUTION_V1",
                block.chainid,
                address(this),
                key,
                outcome_,
                evidence_,
                keccak256(bytes(uri))
            )
        );
    }

    /// @notice Records YES, NO or INVALID exactly as committed. Final.
    function resolve(bytes32 key, uint8 outcome_, bytes32 evidence_, string calldata uri) external {
        if (msg.sender != _resolutionAdmin) revert Unauthorized();
        if (
            (outcome_ != YES && outcome_ != NO && outcome_ != INVALID) || evidence_ == bytes32(0)
                || bytes(uri).length == 0 || bytes(uri).length > MAX_URI
        ) revert InvalidTerms();
        Outcome storage o = _outcomes[key];
        if (o.state != COMMITTED) revert InvalidState();
        if (_commitments[key] != resolutionHash(key, outcome_, evidence_, uri)) {
            revert Commitment();
        }
        o.state = outcome_;
        o.resolvedAt = uint40(block.timestamp);
        delete _commitments[key];
        _evidence[key] = evidence_;
        emit EventResolved(key, outcome_, evidence_, uri, msg.sender);
    }

    // ---------------------------------------------------------------- views

    function outcome(bytes32 key) external view returns (uint8 state, uint40 resolvedAt) {
        Outcome memory o = _outcomes[key];
        return (o.state, o.resolvedAt);
    }

    function outcomes(bytes32[] calldata keys)
        external
        view
        returns (uint8[] memory states, uint40[] memory resolvedAt)
    {
        states = new uint8[](keys.length);
        resolvedAt = new uint40[](keys.length);
        for (uint256 i; i < keys.length; ++i) {
            Outcome memory o = _outcomes[keys[i]];
            states[i] = o.state;
            resolvedAt[i] = o.resolvedAt;
        }
    }

    function commitment(bytes32 key) external view returns (bytes32) {
        return _commitments[key];
    }

    function evidence(bytes32 key) external view returns (bytes32) {
        return _evidence[key];
    }

    function admin() external view returns (address) {
        return _admin;
    }

    function pendingAdmin() external view returns (address successor, uint64 acceptableAfter) {
        return (_pendingAdmin, _adminAfter);
    }

    function roles()
        external
        view
        returns (address marketAdmin, address guardian, address resolutionAdmin)
    {
        return (_marketAdmin, _guardian, _resolutionAdmin);
    }
}
