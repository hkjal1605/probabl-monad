export class MatcherInvariantError extends Error {
  override readonly name = "MatcherInvariantError";
}

export class CanonicalInputError extends Error {
  override readonly name = "CanonicalInputError";
}

export class StaleProposalError extends Error {
  override readonly name = "StaleProposalError";
}
