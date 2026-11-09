import { BlockList, isIP } from 'node:net'

// Addresses a Client ID Metadata Document fetch may never reach (SSRF, code review R10). BlockList
// also matches IPv4-mapped IPv6 forms (`::ffff:7f00:1`, `::ffff:127.0.0.1`) against IPv4 rules.
const NON_PUBLIC = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64: embeds an IPv4 address
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: embeds an IPv4 address
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6')
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  return !NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6')
}
