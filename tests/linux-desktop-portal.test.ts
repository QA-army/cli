// SPDX-License-Identifier: MIT
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openLinuxDesktopPortal } from "../src/linux-desktop-portal.js";

const originalAddress = process.env.DBUS_SESSION_BUS_ADDRESS;

afterEach(() => {
  if (originalAddress === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS;
  else process.env.DBUS_SESSION_BUS_ADDRESS = originalAddress;
});

describe("Linux desktop portal", () => {
  it.skipIf(process.platform === "win32")(
    "authenticates to the session bus and sends the claim URI only in the D-Bus body",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "qa-army-portal-"));
      const socketPath = join(directory, "bus");
      const uri = `https://app.qa.army/auth/agent/claim?token=cat_${"A".repeat(24)}_-B6G8`;
      const calls: Buffer[] = [];
      const server = createServer((socket) => {
        let input = Buffer.alloc(0);
        let authenticated = false;
        socket.on("data", (chunk) => {
          input = Buffer.concat([input, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
          if (!authenticated) {
            const end = input.indexOf("\r\n");
            if (end < 0) return;
            expect(input.subarray(0, end).toString("ascii")).not.toContain(uri);
            input = input.subarray(end + 2);
            authenticated = true;
            socket.write("OK 0123456789abcdef\r\n", "ascii");
          }
          if (input.subarray(0, 7).toString("ascii") === "BEGIN\r\n") input = input.subarray(7);
          for (;;) {
            if (input.length < 16) return;
            const bodyLength = input.readUInt32LE(4);
            const headerLength = input.readUInt32LE(12);
            const length = 16 + headerLength + padding(16 + headerLength, 8) + bodyLength;
            if (input.length < length) return;
            calls.push(input.subarray(0, length));
            input = input.subarray(length);
            socket.write(successReply(calls.length));
          }
        });
      });

      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(socketPath, resolve);
        });
        process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${socketPath}`;
        await openLinuxDesktopPortal(uri);

        expect(calls).toHaveLength(2);
        expect(calls[0]?.includes(Buffer.from(uri))).toBe(false);
        expect(calls[1]?.includes(Buffer.from(uri))).toBe(true);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

function successReply(serial: number): Buffer {
  const reply = Buffer.alloc(16);
  reply.writeUInt8("l".charCodeAt(0), 0);
  reply.writeUInt8(2, 1);
  reply.writeUInt8(0, 2);
  reply.writeUInt8(1, 3);
  reply.writeUInt32LE(0, 4);
  reply.writeUInt32LE(serial, 8);
  reply.writeUInt32LE(0, 12);
  return reply;
}

function padding(length: number, boundary: number): number {
  return (boundary - (length % boundary)) % boundary;
}
