import test from "node:test";
import assert from "node:assert/strict";
import { copyTextToClipboard } from "./clipboardCopy.js";

// V node:test prostředí jsou `navigator` a `document` undefined (nebo částečné).
// Testy ručně přiřazují globální symboly a po sobě uklízí, aby neovlivnily ostatní testy.

type Win = {
  navigator?: { clipboard?: { writeText?: (s: string) => Promise<void> } };
  document?: {
    createElement: (tag: string) => Record<string, unknown> & { value?: string; style: Record<string, string>; setAttribute: (k: string, v: string) => void; select: () => void };
    body: { appendChild: (el: unknown) => void; removeChild: (el: unknown) => void };
    execCommand: (cmd: string) => boolean;
  };
};

function cleanupGlobals() {
  const w = globalThis as unknown as Win;
  delete w.navigator;
  delete w.document;
}

test("copyTextToClipboard: SSR — bez navigator/document vrátí false bez crashe", async () => {
  cleanupGlobals();
  const ok = await copyTextToClipboard("hello");
  assert.equal(ok, false);
});

test("copyTextToClipboard: moderní navigator.clipboard.writeText úspěch", async () => {
  const calls: string[] = [];
  const w = globalThis as unknown as Win;
  w.navigator = {
    clipboard: {
      writeText: async (s: string) => { calls.push(s); },
    },
  };
  w.document = {
    createElement: () => { throw new Error("fallback by neměl být použit"); },
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: () => false,
  };

  const ok = await copyTextToClipboard("foo bar");
  assert.equal(ok, true);
  assert.deepEqual(calls, ["foo bar"]);
  cleanupGlobals();
});

test("copyTextToClipboard: navigator.clipboard chybí → fallback na execCommand", async () => {
  const created: Array<{ value?: string }> = [];
  const w = globalThis as unknown as Win;
  w.navigator = {}; // bez clipboard property
  w.document = {
    createElement: () => {
      const el = {
        value: "",
        style: {} as Record<string, string>,
        setAttribute: () => {},
        select: () => {},
      };
      created.push(el);
      return el;
    },
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: (cmd: string) => cmd === "copy",
  };

  const ok = await copyTextToClipboard("legacy text");
  assert.equal(ok, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].value, "legacy text");
  cleanupGlobals();
});

test("copyTextToClipboard: navigator.clipboard.writeText throw → fallback na execCommand", async () => {
  const w = globalThis as unknown as Win;
  w.navigator = {
    clipboard: {
      writeText: async () => { throw new Error("permission denied"); },
    },
  };
  let execCalled = false;
  w.document = {
    createElement: () => ({
      value: "",
      style: {} as Record<string, string>,
      setAttribute: () => {},
      select: () => {},
    }),
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: () => { execCalled = true; return true; },
  };

  const ok = await copyTextToClipboard("retry");
  assert.equal(ok, true);
  assert.equal(execCalled, true);
  cleanupGlobals();
});

test("copyTextToClipboard: obě metody selžou → vrátí false", async () => {
  const w = globalThis as unknown as Win;
  w.navigator = {
    clipboard: {
      writeText: async () => { throw new Error("permission denied"); },
    },
  };
  w.document = {
    createElement: () => ({
      value: "",
      style: {} as Record<string, string>,
      setAttribute: () => {},
      select: () => {},
    }),
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: () => false,
  };

  const ok = await copyTextToClipboard("nope");
  assert.equal(ok, false);
  cleanupGlobals();
});

test("copyTextToClipboard: fallback execCommand throw → vrátí false bez crashe", async () => {
  const w = globalThis as unknown as Win;
  w.navigator = {}; // forcujeme fallback
  w.document = {
    createElement: () => ({
      value: "",
      style: {} as Record<string, string>,
      setAttribute: () => {},
      select: () => {},
    }),
    body: {
      appendChild: () => { throw new Error("DOM detached"); },
      removeChild: () => {},
    },
    execCommand: () => false,
  };

  const ok = await copyTextToClipboard("crash test");
  assert.equal(ok, false);
  cleanupGlobals();
});
