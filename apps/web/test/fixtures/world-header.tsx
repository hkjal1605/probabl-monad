import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, type ComponentType, lazy, type ReactNode, Suspense } from "react";

const dom = new Window({ url: "http://localhost:3001/worlds" });
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Element",
  "Node",
  "Document",
  "DocumentFragment",
  "ShadowRoot",
  "MutationObserver",
  "ResizeObserver",
  "Event",
  "InputEvent",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
  "FocusEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: Reflect.get(dom, key),
  });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// Worlds switched on (the build pins its world books).
process.env.NEXT_PUBLIC_WORLD_BOOKS_ADDRESS = "0x00000000000000000000000000000000000000b0";

// The screen: wide enough for the header's portfolio value, or not.
let wide = true;
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: query === "(min-width: 1280px)" ? wide : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }),
});

const OWNER = "0x00000000000000000000000000000000000000a1";
const QUOTE = "0x00000000000000000000000000000000000000c0";
let pathname = "/worlds";
const calls: string[] = [];
const sent: { to: string; data: string; value: string }[] = [];
let credit = 12_500_000n;
const wallet = {
  account: OWNER,
  access: "member",
  chainId: 31337,
  ensureNetwork: async () => {},
  sendTransaction: async (tx: { to: string; data: string; value: string }) => {
    sent.push(tx);
    credit += 40_000_000n;
    return "0xhash";
  },
};

mock.module("next/navigation", () => ({ usePathname: () => pathname }));
mock.module("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
mock.module("next/dynamic", () => ({
  default: <P extends object>(load: () => Promise<ComponentType<P>>) => {
    const Lazy = lazy(async () => ({ default: await load() }));
    return (props: P) => (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  },
}));
mock.module("../../src/components/providers/WalletProvider", () => ({
  useWallet: () => wallet,
  useMemberAccount: () => OWNER,
}));
mock.module("../../src/components/wallet/AccountGate", () => ({ useAccountStep: () => null }));
mock.module("../../src/components/wallet/WalletButton", () => ({
  WalletButton: () => <button type="button">wallet</button>,
}));
mock.module("../../src/components/ui/toast", () => ({
  toast: { add: (t: { title: string }) => calls.push(`toast:${t.title}`) },
}));
// The exchange account's reads: never on a worlds page.
mock.module("../../src/hooks/useProtocolData", () => ({
  useMarkets: () => {
    calls.push("exchange:markets");
    return { markets: [], isError: false, isPending: false, spotPending: false };
  },
  useOrders: () => {
    calls.push("exchange:orders");
    return { orders: [], isDataFresh: true, isPending: false, data: { openTruncated: false } };
  },
  usePositions: () => ({ data: undefined }),
}));
mock.module("../../src/hooks/useWalletAssets", () => ({
  useWalletAssets: () => {
    calls.push("exchange:assets");
    return {
      assets: [],
      balances: [],
      positions: [],
      isDataFresh: true,
      isPending: false,
      refetch: async () => {},
    };
  },
}));
mock.module("../../src/lib/worlds/stream", () => ({ subscribeWorlds: () => () => {} }));
// The exchange's deposit (its own flow, unchanged): only its form is checked here.
mock.module("../../src/hooks/useVaultTransfer", () => ({
  useVaultTransfer: () => ({
    busy: false,
    balance: null,
    maxAmount: () => "12.5",
    submit: async () => {},
  }),
}));
const viemActions = await import("viem/actions");
mock.module("viem/actions", () => ({
  ...viemActions,
  readContract: async () => {
    calls.push("rpc:balanceOf");
    return 75_250_000n;
  },
}));
mock.module("../../src/lib/worlds/account", () => ({
  depositTransactions: async (quote: string, amount: bigint) => {
    calls.push(`prepare:deposit:${quote}:${amount}`);
    return [{ to: "0xbooks", data: `0xdeposit${amount}`, value: "0" }];
  },
}));
mock.module("../../src/services/worlds-api", () => ({
  worldsApi: {
    wallet: async (owner: string) => {
      calls.push(`api:positions:${owner}`);
      return {
        owner,
        credit: credit.toString(),
        grants: [],
        positions: [
          // Worth $7.25 at the makers' marks.
          { book: 1, value: "7250000", minPayout: "0", maxPayout: "20000000" },
          // Unpriced now: counted at the least it pays ($5).
          { book: 2, value: null, minPayout: "5000000", maxPayout: "9000000" },
        ],
      };
    },
    permission: async (owner: string) => {
      calls.push("api:permission");
      return { available: true, delegate: null, owner, active: false, credit: credit.toString() };
    },
    deployment: async () => {
      calls.push("api:deployment");
      return { chainId: 31337, books: "0xbooks", quote: QUOTE, vaults: [] };
    },
  },
}));

const { createRoot } = await import("react-dom/client");
const { WorldAccountProvider, useWorldPositions } = await import(
  "../../src/components/providers/WorldAccountProvider"
);
const { DepositDialog } = await import("../../src/components/wallet/DepositDialog");
const { HeaderAccountControls } = await import("../../src/components/wallet/HeaderAccountControls");

const host = document.createElement("div");
document.body.appendChild(host);
let root = createRoot(host);
const settle = async (ms = 60) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};
const render = async (node: ReactNode) => {
  await act(async () => root.render(<WorldAccountProvider>{node}</WorldAccountProvider>));
  await settle();
};
const text = (selector: string) => document.querySelector(selector)?.textContent ?? null;
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) ?? null;
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
  await settle(80);
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
/** Another part of the page showing the same positions (My worlds). */
function Probe() {
  const positions = useWorldPositions();
  return <span data-testid="probe">{positions.data?.credit ?? ""}</span>;
}

afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  calls.length = 0;
  sent.length = 0;
  credit = 12_500_000n;
  wide = true;
  pathname = "/worlds";
});
afterAll(async () => {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
});

test("on a worlds page the header shows the world account, read once and only that", async () => {
  await render(<HeaderAccountControls />);
  // $12.50 balance + $7.25 marked + $5 floor of the unpriced position.
  expect(text('[data-testid="header-portfolio"]')).toBe("Portfolio$24.75");
  expect(document.querySelector('[data-testid="header-portfolio"]')?.getAttribute("href")).toBe(
    "/worlds/me",
  );
  expect(calls).toEqual([`api:positions:${OWNER}`]);
});

test("the header and My worlds share one positions read", async () => {
  await render(
    <>
      <HeaderAccountControls />
      <Probe />
    </>,
  );
  expect(text('[data-testid="probe"]')).toBe("12500000");
  expect(calls.filter((c) => c.startsWith("api:positions"))).toHaveLength(1);
});

test("where the value isn't shown, nothing is read until Deposit opens", async () => {
  wide = false;
  await render(<HeaderAccountControls />);
  expect(document.querySelector('[data-testid="header-portfolio"]')).toBeNull();
  expect(calls).toEqual([]);
});

test("Deposit on a worlds page takes only USDG, into the world balance", async () => {
  wide = false;
  await render(<HeaderAccountControls />);
  await click(button("Deposit"));
  await settle(150);
  const dialog = document.querySelector('[data-slot="dialog-content"]');
  expect(dialog).not.toBeNull();
  // One token, shown rather than chosen: no asset picker.
  expect(dialog?.querySelector('[data-slot="select-trigger"], [role="combobox"]')).toBeNull();
  expect(text('[data-testid="world-deposit-asset"]')).toContain("USDG");
  expect(dialog?.textContent).toContain("Available 75.25 USDG");
  expect(dialog?.textContent).toContain("Deposit USDG");
  expect(new Set(calls)).toEqual(new Set(["api:permission", "api:deployment", "rpc:balanceOf"]));

  const amount = dialog?.querySelector("#world-deposit-amount") as HTMLInputElement;
  await type(amount, "100");
  expect(dialog?.textContent).toContain("Amount exceeds your wallet balance.");
  expect(button("Deposit USDG")?.hasAttribute("disabled")).toBeTrue();

  await type(amount, "40");
  expect(button("Deposit USDG")?.hasAttribute("disabled")).toBeFalse();
  await click(button("Deposit USDG"));
  for (let i = 0; i < 30 && !calls.includes("toast:Funds added to your world balance"); i++)
    await settle(100);
  expect(calls.map((c) => c.toLowerCase())).toContain(`prepare:deposit:${QUOTE}:40000000`);
  expect(sent).toEqual([{ to: "0xbooks", data: "0xdeposit40000000", value: "0" }]);
  expect(calls).toContain("toast:Funds added to your world balance");
  // Done: the dialog closes.
  await settle(300);
  expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
});

test("Max fills the wallet's whole USDG balance, to the cent and below", async () => {
  wide = false;
  await render(<HeaderAccountControls />);
  await click(button("Deposit"));
  await settle(150);
  await click(button("Max"));
  const amount = document.querySelector("#world-deposit-amount") as HTMLInputElement;
  expect(amount.value).toBe("75.25");
});

test("every other page keeps the exchange account, and reads no world account", async () => {
  pathname = "/markets/1";
  await render(<HeaderAccountControls />);
  expect(document.querySelector('[data-testid="header-portfolio"]')?.getAttribute("href")).toBe(
    "/portfolio",
  );
  expect(calls.some((c) => c.startsWith("exchange:"))).toBeTrue();
  expect(calls.some((c) => c.startsWith("api:") || c.startsWith("rpc:"))).toBeFalse();
});

test("the exchange's deposit keeps its asset picker and amount field", async () => {
  const assets = [
    { token: "0xusdg", symbol: "USDG", decimals: 6, metadata: null },
    { token: "0xnvda", symbol: "NVDAx", decimals: 18, metadata: null },
  ];
  const balances = [
    { token: "0xusdg", balance: { canonicalBalance: "12500000" } },
    { token: "0xnvda", balance: { canonicalBalance: "0" } },
  ];
  await act(async () =>
    root.render(
      <DepositDialog
        open
        onOpenChange={() => {}}
        assets={assets as never}
        balances={balances as never}
        fresh
        refresh={async () => {}}
      />,
    ),
  );
  await settle(150);
  const dialog = document.querySelector('[data-slot="dialog-content"]');
  expect(dialog?.querySelector('[data-slot="select-trigger"], [role="combobox"]')).not.toBeNull();
  // The first asset (alphabetical) is chosen, with what the wallet holds of it.
  expect(dialog?.textContent).toContain("Available 0 NVDAx");
  await click(button("Max"));
  expect((document.querySelector("#header-deposit-amount") as HTMLInputElement).value).toBe("12.5");
});
