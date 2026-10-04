// SPDX-License-Identifier: MIT
import { readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export type RunWebCommand =
  | { readonly kind: "open"; readonly url: string }
  | { readonly kind: "snapshot" }
  | { readonly kind: "click"; readonly locator: string }
  | { readonly kind: "fill"; readonly locator: string; readonly valueHandle: string }
  | { readonly kind: "tabs"; readonly operation: "list" | "select"; readonly tab?: string }
  | { readonly kind: "wait"; readonly condition: string }
  | { readonly kind: "scroll"; readonly mode: "inspect" | "page" | "fling"; readonly direction: "up" | "down" | "left" | "right" }
  | { readonly kind: "scroll"; readonly mode: "to"; readonly locator: string }
  | { readonly kind: "swipe"; readonly direction: "up" | "down" | "left" | "right"; readonly distance: "short" | "medium" | "long" }
  | { readonly kind: "screenshot"; readonly label?: string }
  | { readonly kind: "console"; readonly errorsOnly: boolean }
  | { readonly kind: "network"; readonly failedOnly: boolean }
  | { readonly kind: "evaluate"; readonly script: string; readonly scriptName: string };

export interface RunWebTransport {
  execute(binding: string, command: RunWebCommand): Promise<unknown>;
}

export class ExecutorInlineFunctionOnlyTransport implements RunWebTransport {
  async execute(): Promise<never> {
    throw new Error("Run Browser commands are executor-owned AgentCore inline functions; no CLI transport is available");
  }
}

export async function parseRunWebCommand(args: readonly string[], workspace = process.cwd()): Promise<RunWebCommand> {
  const [action, ...rest] = args;
  switch (action) {
    case "open": exact(rest, 1); return { kind: "open", url: required(rest[0]) };
    case "snapshot": exact(rest, 0); return { kind: "snapshot" };
    case "click": exact(rest, 1); return { kind: "click", locator: safeLocator(required(rest[0])) };
    case "fill": exact(rest, 2); return { kind: "fill", locator: safeLocator(required(rest[0])), valueHandle: valueHandle(required(rest[1])) };
    case "tabs": {
      if (rest[0] === undefined || rest[0] === "list") { exact(rest, rest[0] ? 1 : 0); return { kind: "tabs", operation: "list" }; }
      if (rest[0] === "select") { exact(rest, 2); return { kind: "tabs", operation: "select", tab: tab(required(rest[1])) }; }
      throw new Error("Usage: qa-army web tabs [list|select <tab>]");
    }
    case "wait": exact(rest, 1); return { kind: "wait", condition: required(rest[0]) };
    case "scroll": {
      const mode = rest[0];
      if (mode === "to") { exact(rest, 2); return { kind: "scroll", mode, locator: safeLocator(required(rest[1])) }; }
      if (mode === "inspect" || mode === "page" || mode === "fling") {
        if (rest[1] !== "--direction") throw new Error("Usage: qa-army web scroll <inspect|page|fling> --direction <up|down|left|right>");
        exact(rest, 3); return { kind: "scroll", mode, direction: direction(required(rest[2])) };
      }
      throw new Error("Usage: qa-army web scroll <inspect|page|fling|to>");
    }
    case "swipe": {
      if (rest[1] === undefined) { exact(rest, 1); return { kind: "swipe", direction: direction(required(rest[0])), distance: "medium" }; }
      if (rest[1] !== "--distance") throw new Error("Usage: qa-army web swipe <direction> [--distance <short|medium|long>]");
      exact(rest, 3); return { kind: "swipe", direction: direction(required(rest[0])), distance: distance(required(rest[2])) };
    }
    case "screenshot": {
      if (rest.length > 1) throw new Error("Usage: qa-army web screenshot [label]");
      return { kind: "screenshot", ...(rest[0] ? { label: label(rest[0]) } : {}) };
    }
    case "console": {
      if (rest.length > 1 || rest[0] && rest[0] !== "--errors") throw new Error("Usage: qa-army web console [--errors]");
      return { kind: "console", errorsOnly: rest[0] === "--errors" };
    }
    case "network": {
      if (rest.length > 1 || rest[0] && rest[0] !== "--failed") throw new Error("Usage: qa-army web network [--failed]");
      return { kind: "network", failedOnly: rest[0] === "--failed" };
    }
    case "evaluate": {
      exact(rest, 1);
      const supplied = required(rest[0]);
      const workspaceRoot = await realpath(resolve(workspace));
      const candidate = resolve(workspaceRoot, supplied);
      const lexicalChild = relative(workspaceRoot, candidate);
      if (outside(lexicalChild)) throw new Error("Script file must be a .js file inside the run workspace");
      const scriptPath = await realpath(candidate);
      const child = relative(workspaceRoot, scriptPath);
      if (outside(child)
        || basename(scriptPath).length > 128 || !basename(scriptPath).endsWith(".js")) {
        throw new Error("Script file must be a .js file inside the run workspace");
      }
      const script = await readFile(scriptPath, "utf8");
      if (Buffer.byteLength(script, "utf8") > 32_768 || script.includes("\0")) throw new Error("Script file is invalid");
      return { kind: "evaluate", script, scriptName: basename(scriptPath) };
    }
    default: throw new Error("Unknown qa-army web command");
  }
}

function exact(values: readonly string[], count: number): void { if (values.length !== count) throw new Error("Invalid qa-army web arguments"); }
function outside(child: string): boolean { return isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`); }
function required(value: string | undefined): string { if (!value) throw new Error("Missing qa-army web argument"); return value; }
function safeLocator(value: string): string {
  if (/^text="[^"\\]{1,256}"$/.test(value) || /^testid=[A-Za-z0-9_.:-]{1,128}$/.test(value)
    || /^role=[a-z][a-z0-9-]{0,31}\[name="[^"\\]{1,256}"\]$/.test(value)) return value;
  throw new Error("Safe locator must use role, text, or testid syntax");
}
function valueHandle(value: string): string { if (!/^val_[A-Za-z0-9]{16,128}$/.test(value)) throw new Error("Value handle is invalid"); return value; }
function tab(value: string): string { if (!/^tab_[A-Za-z0-9]{8,64}$/.test(value)) throw new Error("Tab selector is invalid"); return value; }
function label(value: string): string { if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error("Screenshot label is invalid"); return value; }
function direction(value: string): "up" | "down" | "left" | "right" {
  if (value !== "up" && value !== "down" && value !== "left" && value !== "right") throw new Error("Direction is invalid");
  return value;
}
function distance(value: string): "short" | "medium" | "long" {
  if (value !== "short" && value !== "medium" && value !== "long") throw new Error("Swipe distance is invalid");
  return value;
}
