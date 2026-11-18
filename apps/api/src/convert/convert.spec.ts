import { assertPublicUrl, isPublicIp } from "./safe-fetch";
import { assertPdfUpload, assertSafeUpload } from "./upload-check";
import { ConvertLimiter } from "./convert-limiter";

describe("isPublicIp", () => {
  it("accepts ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) expect(isPublicIp(ip)).toBe(true);
  });

  it("refuses loopback, private, link-local and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "64:ff9b::a00:1",
      "not-an-ip",
    ]) {
      expect(isPublicIp(ip)).toBe(false);
    }
  });

  it("keeps 172.32 and 100.63 public (just outside the private ranges)", () => {
    expect(isPublicIp("172.32.0.1")).toBe(true);
    expect(isPublicIp("100.63.0.1")).toBe(true);
  });
});

describe("assertPublicUrl", () => {
  it("accepts normal web addresses", () => {
    expect(assertPublicUrl("https://example.com/page?a=1").hostname).toBe("example.com");
    expect(assertPublicUrl("http://example.com").hostname).toBe("example.com");
  });

  it("refuses everything that could reach our own network", () => {
    for (const u of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "javascript:alert(1)",
      "http://localhost/admin",
      "http://127.0.0.1:3000/",
      "http://[::1]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://intranet/",
      "http://printer.local/",
      "http://db.internal/",
      "https://user:pass@example.com/",
      "https://example.com:8443/",
      "https://example.com:22/",
      "not a url",
    ]) {
      expect(() => assertPublicUrl(u)).toThrow();
    }
  });
});

describe("assertSafeUpload", () => {
  const zip = (extra = Buffer.alloc(0)) => {
    // A minimal valid zip: one empty entry.
    const name = Buffer.from("a.txt");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(name.length, 28);
    const cdOffset = local.length + name.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    return Buffer.concat([local, name, central, name, eocd, extra]);
  };

  it("accepts a well-formed docx and refuses the wrong kind of file", () => {
    expect(() => assertSafeUpload(zip(), "docx", "word")).not.toThrow();
    expect(() => assertSafeUpload(zip(), "pptx", "word")).toThrow(); // PowerPoint file on the Word endpoint
    expect(() => assertSafeUpload(zip(), "exe", "word")).toThrow();
    expect(() => assertSafeUpload(Buffer.from("MZ not a zip at all"), "docx", "word")).toThrow();
  });

  it("refuses a zip that claims to expand into gigabytes", () => {
    const bomb = zip();
    // Patch the central directory entry's uncompressed size to 1 GB.
    const cd = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(1024 * 1024 * 1024, cd + 24);
    expect(() => assertSafeUpload(bomb, "docx", "word")).toThrow();
  });

  it("checks old binary formats, rtf and text", () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => assertSafeUpload(ole, "doc", "word")).not.toThrow();
    expect(() => assertSafeUpload(ole, "ppt", "powerpoint")).not.toThrow();
    expect(() => assertSafeUpload(Buffer.from("{\\rtf1\\ansi hello"), "rtf", "word")).not.toThrow();
    expect(() => assertSafeUpload(Buffer.from("plain text here"), "txt", "word")).not.toThrow();
    expect(() => assertSafeUpload(Buffer.from([1, 2, 0, 4, 5, 6, 7, 8, 9]), "txt", "word")).toThrow();
  });
});

describe("ConvertLimiter", () => {
  it("limits conversions per visitor", () => {
    const l = new ConvertLimiter();
    for (let i = 0; i < ConvertLimiter.MAX_PER_WINDOW; i++) l.checkRate("1.2.3.4");
    expect(() => l.checkRate("1.2.3.4")).toThrow();
    expect(() => l.checkRate("5.6.7.8")).not.toThrow();
  });

  it("runs one job at a time, queues a few, and turns the rest away", async () => {
    const l = new ConvertLimiter();
    const order: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = l.run(async () => {
      await gate;
      order.push(1);
    });
    const queued = [2, 3, 4, 5].map((n) => l.run(async () => void order.push(n)));
    await expect(l.run(async () => 0)).rejects.toThrow(); // queue is full
    release();
    await Promise.all([first, ...queued]);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("assertPdfUpload", () => {
  it("accepts a PDF and refuses other files", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 32)]);
    expect(() => assertPdfUpload(pdf)).not.toThrow();
    expect(() => assertPdfUpload(Buffer.alloc(300, 65))).toThrow(); // no header
    expect(() => assertPdfUpload(Buffer.from("%PDF-1.4"))).toThrow(); // too small to be real
  });
});
