import { isPublicAddress } from './public-address'

describe('isPublicAddress (code review R10)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    // IPv4-mapped IPv6, dotted and hexadecimal forms, compressed or not.
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '::FFFF:C0A8:0101',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    'pas-une-adresse',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:5db8:d822'])(
    'accepts %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true)
    },
  )
})
