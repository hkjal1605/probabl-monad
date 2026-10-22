import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// OpenNext copies ALL monorepo .env values into this module, including unrelated
// backend secrets. Never ship them: the UI's public settings are already inlined
// by Next, and server settings must come from Worker runtime bindings only.
export const sanitizedEnvironmentModule =
  "export const production = {};\nexport const development = {};\nexport const test = {};\n";

const ADDRESSES = /^0x[0-9a-fA-F]{40}(,0x[0-9a-fA-F]{40})*$/;
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** A run of characters as long as an API key or token. */
const TOKEN = /[A-Za-z0-9_-]{20,}/;
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Whether a setting's value is a credential: any long value except a contract address, a host
 * name, or a URL that carries neither credentials nor a key in its path or query (an RPC URL with
 * its API key is secret; `https://api.probabl.trade` is not). Shorter than 16 characters (ports,
 * flags, chain ids) can't be told from ordinary text, and isn't a credential. */
export function isSecretValue(value: string): boolean {
  if (value.length < 16 || ADDRESSES.test(value) || HOSTNAME.test(value)) return false;
  if (!URL_SCHEME.test(value)) return true;
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password) || TOKEN.test(url.pathname + url.search);
  } catch {
    return true;
  }
}

/** Values no UI build may hold: the secret settings (`isSecretValue`) in the given .env files,
 * except `NEXT_PUBLIC_*` ones and values a public setting also holds, which the UI ships anyway. */
export function secretValues(envFiles: string[]): string[] {
  const entries = envFiles
    .flatMap((text) => text.split("\n"))
    .map((line) => LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, name = "", value = ""]) => [name, unquote(value)] as const);
  const published = new Set(
    entries.filter(([name]) => name.startsWith("NEXT_PUBLIC_")).map(([, value]) => value),
  );
  return [
    ...new Set(
      entries
        .filter(
          ([name, value]) =>
            !name.startsWith("NEXT_PUBLIC_") && !published.has(value) && isSecretValue(value),
        )
        .map(([, value]) => value),
    ),
  ];
}

/** Files under `directory` containing any of `secrets` (paths relative to it). */
export async function filesWithSecrets(directory: string, secrets: string[]): Promise<string[]> {
  if (!secrets.length) return [];
  const needles = secrets.map((secret) => Buffer.from(secret));
  const found: string[] = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const content = await readFile(path);
    if (needles.some((needle) => content.includes(needle)))
      found.push(path.slice(directory.length + 1));
  }
  return found;
}

/** Folders never holding the monorepo's own .env files: dependencies and build output. */
const SKIP = new Set(["node_modules", ".git", ".next", ".open-next", ".wrangler", "dist", "out"]);

/** The monorepo's .env files (`.env`, `.env.local`, backups…), templates aside. */
async function envFiles(directory: string, texts: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !SKIP.has(entry.name)) await envFiles(path, texts);
    else if (entry.isFile() && entry.name.startsWith(".env") && !entry.name.endsWith(".example"))
      texts.push(await readFile(path, "utf8"));
  }
  return texts;
}

// Run by `build:cloudflare` and, through wrangler.jsonc's `build.command`, before every
// `wrangler deploy` (so `opennextjs-cloudflare deploy`), whichever build came first: empty the
// environment module, then refuse to go on while any secret is anywhere in the build.
if (import.meta.main) {
  const directory = new URL("../.open-next/cloudflare/", import.meta.url);
  const init = await readFile(new URL("init.js", directory), "utf8");
  if (!init.includes('"./next-env.mjs"'))
    throw new Error("OpenNext env layout changed; review sanitization before deploying");
  await writeFile(new URL("next-env.mjs", directory), sanitizedEnvironmentModule, { mode: 0o600 });
  console.info("Removed all .env file values from the Worker environment module.");

  const build = new URL("../.open-next", import.meta.url).pathname;
  const secrets = secretValues(await envFiles(new URL("../../..", import.meta.url).pathname));
  const leaks = await filesWithSecrets(build, secrets);
  if (leaks.length) {
    console.error(
      `Secret .env values found in the build, so it must not ship:\n  ${leaks.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.info(`Checked the build for ${secrets.length} secret .env values: none found.`);
}
