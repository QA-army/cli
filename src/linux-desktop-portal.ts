// SPDX-License-Identifier: MIT
import { createConnection, type Socket } from "node:net";

const timeoutMs = 5_000;
const maximumBusFrameBytes = 1024 * 1024;
const maximumAuthLineBytes = 4 * 1024;

/** Opens a URI through xdg-desktop-portal without passing it to a child process. */
export async function openLinuxDesktopPortal(uri: string): Promise<void> {
  const address = sessionBusPath(process.env.DBUS_SESSION_BUS_ADDRESS);
  const socket = createConnection({ path: address });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error("timeout")));
  const reader = new SocketReader(socket);
  try {
    await connected(socket);
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("uid unavailable");
    socket.write(Buffer.concat([
      Buffer.from([0]),
      Buffer.from(`AUTH EXTERNAL ${Buffer.from(String(uid)).toString("hex")}\r\n`, "ascii"),
    ]));
    if (!/^OK [0-9a-f]+$/i.test((await reader.line()).toString("ascii"))) {
      throw new Error("session bus authentication failed");
    }
    socket.write("BEGIN\r\n", "ascii");

    socket.write(methodCall(1, {
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interfaceName: "org.freedesktop.DBus",
      member: "Hello",
    }));
    await successfulMethodReturn(reader);

    socket.write(methodCall(2, {
      destination: "org.freedesktop.portal.Desktop",
      path: "/org/freedesktop/portal/desktop",
      interfaceName: "org.freedesktop.portal.OpenURI",
      member: "OpenURI",
      bodySignature: "ssa{sv}",
      body: openUriBody(uri),
    }));
    await successfulMethodReturn(reader);
  } catch {
    throw new Error("The agent claim link could not be opened through the Linux desktop portal");
  } finally {
    socket.destroy();
  }
}

function sessionBusPath(value: string | undefined): string {
  const candidate = value?.split(";").find((entry) => entry.startsWith("unix:"));
  const fields = new URLSearchParams(candidate?.slice("unix:".length).replaceAll(",", "&"));
  const path = fields.get("path");
  if (path) return path;
  const abstract = fields.get("abstract");
  if (abstract) return `\0${abstract}`;
  throw new Error("Linux desktop session bus unavailable");
}

function connected(socket: Socket): Promise<void> {
  if (socket.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
}

interface MethodCall {
  readonly destination: string;
  readonly path: string;
  readonly interfaceName: string;
  readonly member: string;
  readonly bodySignature?: string;
  readonly body?: Buffer;
}

function methodCall(serial: number, call: MethodCall): Buffer {
  const fields = new DbusWriter();
  fields.headerString(1, "o", call.path);
  fields.headerString(2, "s", call.interfaceName);
  fields.headerString(3, "s", call.member);
  fields.headerString(6, "s", call.destination);
  if (call.bodySignature) fields.headerSignature(8, call.bodySignature);
  const header = fields.buffer();
  const body = call.body ?? Buffer.alloc(0);
  const fixed = Buffer.alloc(16);
  fixed.writeUInt8("l".charCodeAt(0), 0);
  fixed.writeUInt8(1, 1);
  fixed.writeUInt8(0, 2);
  fixed.writeUInt8(1, 3);
  fixed.writeUInt32LE(body.length, 4);
  fixed.writeUInt32LE(serial, 8);
  fixed.writeUInt32LE(header.length, 12);
  return Buffer.concat([fixed, header, Buffer.alloc(padding(16 + header.length, 8)), body]);
}

function openUriBody(uri: string): Buffer {
  const body = new DbusWriter();
  body.string("");
  body.string(uri);
  body.align(4);
  body.uint32(0);
  return body.buffer();
}

async function successfulMethodReturn(reader: SocketReader): Promise<void> {
  for (;;) {
    const fixed = await reader.bytes(16);
    if (fixed[0] !== "l".charCodeAt(0) || fixed[3] !== 1) throw new Error("invalid D-Bus reply");
    const type = fixed[1];
    const bodyLength = fixed.readUInt32LE(4);
    const headerLength = fixed.readUInt32LE(12);
    if (bodyLength + headerLength > maximumBusFrameBytes) throw new Error("oversized D-Bus reply");
    await reader.bytes(headerLength + padding(16 + headerLength, 8) + bodyLength);
    if (type === 2) return;
    if (type === 3) throw new Error("desktop portal rejected URI");
  }
}

class DbusWriter {
  private readonly chunks: number[] = [];

  align(boundary: number): void {
    while (this.chunks.length % boundary !== 0) this.chunks.push(0);
  }

  uint32(value: number): void {
    this.align(4);
    this.chunks.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  }

  string(value: string): void {
    this.align(4);
    const bytes = Buffer.from(value, "utf8");
    this.uint32(bytes.length);
    this.chunks.push(...bytes, 0);
  }

  signature(value: string): void {
    const bytes = Buffer.from(value, "ascii");
    this.chunks.push(bytes.length, ...bytes, 0);
  }

  headerString(code: number, type: "o" | "s", value: string): void {
    this.align(8);
    this.chunks.push(code);
    this.signature(type);
    this.string(value);
  }

  headerSignature(code: number, value: string): void {
    this.align(8);
    this.chunks.push(code);
    this.signature("g");
    this.signature(value);
  }

  buffer(): Buffer {
    return Buffer.from(this.chunks);
  }
}

class SocketReader {
  private buffer = Buffer.alloc(0);
  private readonly iterator: AsyncIterator<Buffer>;

  constructor(socket: Socket) {
    this.iterator = socket[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  async line(): Promise<Buffer> {
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end >= 0) {
        const value = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end + 2);
        return value;
      }
      if (this.buffer.length > maximumAuthLineBytes) throw new Error("oversized session bus response");
      await this.more();
    }
  }

  async bytes(length: number): Promise<Buffer> {
    while (this.buffer.length < length) await this.more();
    const value = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return value;
  }

  private async more(): Promise<void> {
    const next = await this.iterator.next();
    if (next.done) throw new Error("session bus closed");
    this.buffer = Buffer.concat([this.buffer, next.value]);
  }
}

function padding(length: number, boundary: number): number {
  return (boundary - (length % boundary)) % boundary;
}
