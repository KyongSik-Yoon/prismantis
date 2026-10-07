import { expect, mock, test } from 'claude-code/testing'

import { MAC_TABLE_COPY } from '../hooks/clipboard'
import { clipboardEnv, recordCopies, recordToasts, runResult } from './clipboard-env'

const source = '| Name | Value |\n|--|--:|\n| **שלום** | `$(ignored)` |'
const plain = 'Name\tValue\nשלום\t$(ignored)'
const mount = {
  plugin: 'prismantis',
  component: 'AssistantMessage' as const,
  props: { text: source, isFirstOfReply: true },
  viewport: { columns: 120, rows: 40 },
  surface: 'terminal' as const,
}

test('macOS copies HTML and plain text together', async ($, on) => {
  clipboardEnv(on, 'macos')
  const calls: { argv: readonly string[]; input: string }[] = []
  on('process.run', (_, e) => {
    calls.push({ argv: e.argv, input: e.init?.stdin ?? '' })
    return runResult(0)
  })
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  const ui = await $.ui.mount(mount)
  expect(calls).toHaveLength(0)
  await ui.press({ key: 'html0' })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.argv).toEqual(['/usr/bin/osascript', '-l', 'JavaScript', '-e', MAC_TABLE_COPY])
  const payload = JSON.parse(calls[0]!.input)
  expect(payload.text).toBe(plain)
  expect(payload.html).toContain('<strong>שלום</strong>')
  expect(payload.html).toContain('<code style="white-space: pre-wrap">$(ignored)</code>')
  expect(copies).toHaveLength(0)
  expect(toasts).toEqual(['Copied formatted table'])
  await ui.unmount()
})

for (const failure of ['exit', 'refused'] as const) test(`native clipboard ${failure} falls back to plain text`, async ($, on) => {
  clipboardEnv(on, 'macos')
  on('process.run', () => failure === 'refused' ? { deny: 'Cannot start helper' } : runResult(1, 'Clipboard unavailable'))
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  const ui = await $.ui.mount(mount)
  await ui.press({ key: 'html0' })
  expect(toasts).toEqual([`Copied as plain text (${failure === 'exit' ? 'Clipboard unavailable' : 'macOS clipboard helper failed'})`])
  expect(copies).toEqual([plain])
  await ui.unmount()
})

for (const variable of ['SSH_CONNECTION', 'SSH_TTY']) test(`${variable} formatted copying falls back to plain text`, async ($, on) => {
  mock.env(on, { [variable]: 'remote connection' })
  let nativeCalls = 0
  on('process.run', () => {
    nativeCalls++
    return { deny: 'Must not write the remote host clipboard' }
  })
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  const ui = await $.ui.mount(mount)
  await ui.press({ key: 'html0' })
  expect(nativeCalls).toBe(0)
  expect(copies).toEqual([plain])
  expect(toasts).toEqual(['Copied as plain text (HTML needs a local macOS terminal)'])
  await ui.unmount()
})

test('desktop table copying copies plain text without the native helper even on macOS', async ($, on) => {
  clipboardEnv(on, 'macos')
  const surfaces: (string | undefined)[] = []
  let nativeCalls = 0
  on('process.run', () => {
    nativeCalls++
    return { deny: 'Must use the surface clipboard' }
  })
  on('ui.copy', (_, e) => {
    surfaces.push(e.surface)
    expect(e.text).toBe(plain)
    return { value: { isCopied: true as const } }
  })
  const ui = await $.ui.mount({ ...mount, surface: 'desktop' })
  await ui.press({ key: 'html0' })
  expect(nativeCalls).toBe(0)
  expect(surfaces).toEqual(['desktop'])
  await ui.unmount()
})

test('other systems copy plain text without native clipboard processes', async ($, on) => {
  clipboardEnv(on, 'other', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' })
  let processes = 0
  on('process.run', () => {
    processes++
    return { deny: 'Must use the surface clipboard' }
  })
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  const ui = await $.ui.mount(mount)
  await ui.press({ key: 'html0' })
  expect(processes).toBe(0)
  expect(copies).toEqual([plain])
  expect(toasts).toEqual(['Copied as plain text (HTML needs a local macOS terminal)'])
  await ui.unmount()
})

for (const key of ['copy0', 'html0']) for (const failure of ['unavailable', 'refused'] as const) test(`${key} reports a ${failure} surface clipboard`, async ($, on) => {
  clipboardEnv(on, 'macos')
  on('process.run', () => runResult(1))
  on('ui.copy', () => failure === 'refused'
    ? { deny: 'Clipboard denied' }
    : { value: { isCopied: false as const, reason: 'no-clipboard' as const } })
  const toasts = recordToasts(on)
  const ui = await $.ui.mount(mount)
  await ui.press({ key })
  expect(toasts).toEqual([failure === 'refused' ? 'Copy failed' : 'Copy failed: no-clipboard'])
  await ui.unmount()
})
