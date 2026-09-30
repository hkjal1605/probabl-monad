import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { Journal } from "./execution.ts";

/** A fresh journal for today. */
export const initialJournal = (): Journal => ({
  day: new Date().toISOString().slice(0, 10),
  spent: "0",
  lastBlock: "0",
});
export const integerString = (v: unknown) => typeof v === "string" && /^[0-9]{1,80}$/.test(v);

/** Throws unless `s` holds a well-formed journal: never silently reset gas or risk limits. */
export function validateJournal(s: Journal) {
  if (
    !s ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.day) ||
    !integerString(s.spent) ||
    !integerString(s.lastBlock)
  )
    throw new Error("Invalid bot state; do not silently reset risk limits");
  if (
    s.pending &&
    (!/^0x[0-9a-f]{64}$/.test(s.pending.hash) ||
      !Number.isSafeInteger(s.pending.nonce) ||
      s.pending.nonce < 0 ||
      !/^0x[0-9a-f]+$/.test(s.pending.raw) ||
      !integerString(s.pending.charged))
  )
    throw new Error("Invalid pending transaction journal");
}

/** One host/one dedicated wallet. Atomic, fsynced state is saved BEFORE a signed transaction
 * is broadcast. */
export class StateFile<S> {
  readonly path: string;
  readonly lock: string;
  state: S;
  constructor(path: string, validate: (value: unknown) => S, initial: () => S) {
    this.path = resolve(path);
    this.lock = `${this.path}.lock`;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const directory = lstatSync(dirname(this.path));
    if (directory.isSymbolicLink() || !directory.isDirectory() || (directory.mode & 0o077) !== 0)
      throw new Error("State directory must be private");
    if (existsSync(this.lock)) {
      const info = lstatSync(this.lock);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Invalid bot lock");
      const pid = Number(readFileSync(this.lock, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid bot lock PID");
      try {
        process.kill(pid, 0);
        throw new Error("Another bot process holds this state");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      unlinkSync(this.lock);
    }
    const fd = openSync(this.lock, "wx", 0o600);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    try {
      if (existsSync(this.path)) {
        const info = lstatSync(this.path);
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
          throw new Error("State file must be private");
        this.state = validate(JSON.parse(readFileSync(this.path, "utf8")));
      } else {
        this.state = initial();
      }
      // An interrupted pre-broadcast checkpoint is never silently adopted or overwritten.
      if (existsSync(`${this.path}.next`))
        renameSync(`${this.path}.next`, `${this.path}.abandoned-${Date.now()}`);
      this.save();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  save() {
    const next = `${this.path}.next`;
    const fd = openSync(next, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(this.state));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(next, this.path);
    chmodSync(this.path, 0o600);
    const directory = openSync(dirname(this.path), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
  close() {
    if (existsSync(this.lock)) unlinkSync(this.lock);
  }
}
