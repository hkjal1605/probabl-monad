import { expect, mock, test } from "bun:test";
import { signInMessage } from "@conditional-stocks/evm-client";
import { Window } from "happy-dom";
import { getAddress } from "viem";

const dom = new Window({ url: "http://localhost:3002" });
for (const key of [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "Element",
  "Node",
  "Document",
  "DocumentFragment",
  "Event",
  "CustomEvent",
  "StorageEvent",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: Reflect.get(dom, key),
  });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const owner = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const exchange = getAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3");
const transaction = {
  from: owner,
  to: exchange,
  data: "0x1234",
  value: "0",
  chainId: 31337,
} as const;
/** While set, on-chain role reads wait for it: a network check in flight. */
let rolesRead: Promise<void> | null = null;
let walletChain = "0x7a69";
const sent: unknown[] = [];

mock.module("../../src/config/protocol", () => ({
  adminConfig: {
    chainId: 31337,
    chainName: "Anvil",
    exchange,
    rpcUrl: "http://127.0.0.1:8545",
    explorerUrl: "",
    polygonConditionalTokens: "",
    deltaVaults: [],
  },
}));
mock.module("../../src/lib/chain", () => ({
  readRoles: async () => {
    await rolesRead;
    return {
      admin: owner,
      marketAdmin: owner,
      guardian: owner,
      resolutionAdmin: owner,
      quote: exchange,
    };
  },
  preflightTransaction: async () => {},
  waitForAdminReceipt: async () => {},
}));
mock.module("../../src/lib/delta-vaults", () => ({ vaultOperators: async () => [] }));
mock.module("../../src/lib/admin-api", () => ({
  SESSION_EXPIRED_EVENT: "admin-session-expired",
  requestJson: async (path: string) => {
    const nonce = "ab".repeat(32);
    if (path.endsWith("/auth/challenge"))
      return {
        challengeId: nonce,
        message: signInMessage(
          { chainId: 31337, exchange },
          window.location.origin,
          owner,
          nonce,
          new Date(Date.now() + 60_000),
        ),
      };
    if (path.endsWith("/auth/verify")) return { token: "cd".repeat(32) };
    throw new Error(`Unexpected request ${path}`);
  },
}));
Object.assign(dom, {
  ethereum: {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [owner];
      if (method === "eth_chainId") return walletChain;
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "personal_sign") return `0x${"11".repeat(65)}`;
      if (method === "eth_sendTransaction") {
        sent.push(params?.[0]);
        return `0x${"22".repeat(32)}`;
      }
      throw new Error(`Unexpected wallet request ${method}`);
    },
    on: () => {},
    removeListener: () => {},
  },
});

const { act, useEffect } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AdminProvider, useAdmin } = await import("../../src/components/providers/AdminProvider");

let admin!: ReturnType<typeof useAdmin>;
const page = { mounts: 0, unmounts: 0 };
function Page() {
  useEffect(() => {
    page.mounts++;
    return () => {
      page.unmounts++;
    };
  }, []);
  return <main>Create market form</main>;
}
/** AdminShell's gate: only a signed-in operator on the deployment's chain sees the page. */
function Console() {
  admin = useAdmin();
  const open = admin.account && admin.token && admin.role === "operator" && admin.chainId === 31337;
  return open ? <Page /> : <p>Operator authentication required</p>;
}
const host = document.createElement("div");
document.body.appendChild(host);
/** What the console shows: the page or the sign-in gate. */
const shown = () => host.querySelector("main, p")?.textContent;
const root = createRoot(host);
await act(async () => {
  root.render(
    <AdminProvider>
      <Console />
    </AdminProvider>,
  );
  // The provider's restore timer: no saved wallet.
  await new Promise((resolve) => setTimeout(resolve, 20));
});
await act(() => admin.connect());
await act(() => admin.authenticate());

test("a transaction's network recheck keeps the signed-in page and its state mounted", async () => {
  expect(shown()).toBe("Create market form");
  let release!: () => void;
  rolesRead = new Promise((resolve) => {
    release = resolve;
  });
  let sending!: Promise<string>;
  await act(async () => {
    sending = admin.sendTransaction(transaction);
  });
  // The recheck is in flight: the page stays, as before it.
  expect(admin.checkingNetwork).toBe(true);
  expect(shown()).toBe("Create market form");
  rolesRead = null;
  let hash = "";
  await act(async () => {
    release();
    hash = await sending;
  });
  expect(hash).toBe(`0x${"22".repeat(32)}`);
  expect(sent).toHaveLength(1);
  expect(page).toEqual({ mounts: 1, unmounts: 0 });
});

test("a failed recheck still closes the page and sends nothing", async () => {
  // The wallet is on another chain and stays there.
  walletChain = "0x1";
  const sends = sent.length;
  let failure: unknown;
  await act(async () => {
    await admin.sendTransaction(transaction).catch((error: unknown) => {
      failure = error;
    });
  });
  expect(String(failure)).toContain("Switch the operator wallet to Anvil");
  expect(sent).toHaveLength(sends);
  expect(shown()).toBe("Operator authentication required");
  expect(page.unmounts).toBe(1);
});
