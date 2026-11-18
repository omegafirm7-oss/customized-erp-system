import * as dns from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import { BadRequestException } from "@nestjs/common";

/**
 * Web pages are fetched on behalf of anonymous visitors, so every request goes
 * through here: only http(s) on ports 80/443, only to public addresses (never
 * loopback, private ranges or the cloud metadata address), re-checked on every
 * redirect, with the address pinned so a DNS answer can't change between the
 * check and the connection.
 */

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const p = tail[1].split(".").map(Number);
    s = s.slice(0, s.length - tail[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPublicV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  if ([a, b, c].some((n) => Number.isNaN(n))) return false;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, includes the cloud metadata service
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false; // multicast and reserved
  return true;
}

export function isPublicIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  if (kind !== 6) return false;
  const g = expandV6(ip);
  if (!g) return false;
  if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1)) return false; // :: and ::1
  // IPv4-mapped (::ffff:a.b.c.d): judge by the embedded IPv4 address.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicV4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  if ((g[0] & 0xfe00) === 0xfc00) return false; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0064 && g[1] === 0xff9b) return false; // NAT64 can embed private IPv4 addresses
  if (g[0] === 0x2002) return false; // 6to4 can embed private IPv4 addresses
  return true;
}

/** Checks the shape of a URL a visitor typed in. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException("That doesn't look like a valid web address. Start it with https://");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadRequestException("Only http and https addresses can be converted.");
  if (url.username || url.password) throw new BadRequestException("Addresses with a username or password are not allowed.");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "80" && port !== "443") throw new BadRequestException("Only the standard web ports (80 and 443) are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || (!host.includes(".") && net.isIP(host) === 0)) {
    throw new BadRequestException("That address is not a public website.");
  }
  if (net.isIP(host) !== 0 && !isPublicIp(host)) throw new BadRequestException("That address is not a public website.");
  return url;
}

export interface FetchedResource {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

const UA = "Mozilla/5.0 (compatible; UniversaPDF/1.0; +https://universa.omegaprofessionals.com)";

async function once(url: URL, maxBytes: number, timeoutMs: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => !isPublicIp(a.address))) throw new BadRequestException("That address is not a public website.");
  const pick = addrs[0];
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        headers: { "User-Agent": UA, Accept: "*/*", "Accept-Encoding": "identity", Host: url.host },
        timeout: timeoutMs,
        // Pin the connection to the address that was just checked.
        lookup: (_h: string, options: unknown, cb: (...a: unknown[]) => void) => {
          if ((options as { all?: boolean })?.all) cb(null, [{ address: pick.address, family: pick.family }]);
          else cb(null, pick.address, pick.family);
        },
        servername: net.isIP(host) ? undefined : host,
      } as https.RequestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new BadRequestException("A file on that page is too large."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new BadRequestException("That website took too long to respond.")));
    req.on("error", (err) => reject(err instanceof BadRequestException ? err : new BadRequestException("Could not reach that website.")));
    req.end();
  });
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<FetchedResource> {
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const maxRedirects = opts.maxRedirects ?? 5;
  let url = assertPublicUrl(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await once(url, maxBytes, timeoutMs);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      url = assertPublicUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    return { status: res.status, contentType: String(res.headers["content-type"] ?? "application/octet-stream"), body: res.body, finalUrl: url.toString() };
  }
  throw new BadRequestException("That address redirects too many times.");
}
