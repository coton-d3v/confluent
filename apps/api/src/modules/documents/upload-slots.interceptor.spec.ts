import { UploadSlots } from './upload-slots.interceptor'

// ROADMAP E10.08 (U10): the uploads a process receives at once, per account and in all.
describe('UploadSlots', () => {
  it('gives an account 3 slots at most, and another account its own', () => {
    const slots = new UploadSlots(3, 8)
    const mine = [1, 2, 3].map(() => slots.acquire('a'))
    expect(mine.every(Boolean)).toBe(true)
    expect(slots.acquire('a')).toBeNull()
    expect(slots.acquire('b')).not.toBeNull()
    mine[0]!()
    expect(slots.acquire('a')).not.toBeNull()
  })

  it('bounds the uploads of the whole process, whatever the accounts', () => {
    const slots = new UploadSlots(3, 4)
    const held = ['a', 'b', 'c', 'd'].map((id) => slots.acquire(id))
    expect(held.every(Boolean)).toBe(true)
    expect(slots.acquire('e')).toBeNull()
    held[2]!()
    expect(slots.acquire('e')).not.toBeNull()
  })

  it('counts a slot released twice (response end, then connection close) once', () => {
    const slots = new UploadSlots(1, 2)
    const release = slots.acquire('a')!
    release()
    release()
    expect(slots.inFlight).toBe(0)
    expect(slots.acquire('a')).not.toBeNull()
    expect(slots.acquire('b')).not.toBeNull()
    expect(slots.acquire('c')).toBeNull()
  })
})
