/** Invite codes: 8 characters of Crockford's base32 (digits and letters without I, L, O and U),
 * about 40 random bits, shown as XXXX-XXXX. Codes are compared in canonical form: upper case,
 * no separators, and the look-alikes I and L read as 1, O as 0. */
export const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_CODE_LENGTH = 8;

/** The canonical form of a typed or linked code, or null when it cannot be one. */
export function normalizeInviteCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  return code.length === INVITE_CODE_LENGTH && [...code].every((c) => INVITE_ALPHABET.includes(c))
    ? code
    : null;
}

/** XXXX-XXXX, the way codes are shown and shared. */
export const formatInviteCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** A fresh random code from the platform's cryptographic generator. */
export function generateInviteCode(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
) {
  // 32 symbols: the low 5 bits of each byte are uniform.
  return [...random(new Uint8Array(INVITE_CODE_LENGTH))]
    .map((byte) => INVITE_ALPHABET[byte & 31])
    .join("");
}
