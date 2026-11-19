import { expect, it } from 'vitest'
import { PermissionRequests } from '../src/remote/permissionRequests'

it('tells the host every time a request arrives or is answered, so the person there sees it at once', () => {
  const seen: number[] = []
  const requests = new PermissionRequests(Date.now, (list) => seen.push(list.length))
  const phone = { id: 'p', name: 'iPhone' } as Parameters<PermissionRequests['ask']>[0]
  requests.ask(phone, 'computer')
  requests.ask(phone, 'terminal')
  const [first] = requests.list()
  requests.take(first!.id)
  // An id already answered changes nothing and tells no one.
  requests.take(first!.id)
  expect(seen).toEqual([1, 2, 1])
})
