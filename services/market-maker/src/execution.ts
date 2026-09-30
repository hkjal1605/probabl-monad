import { signer as operatorSigner } from "@conditional-stocks/operator";

export { Executor } from "@conditional-stocks/operator";
export const signer = (secret: string, expected: string) =>
  operatorSigner(secret, expected, "MM_PRIVATE_KEY", "MM_WALLET_ADDRESS");
