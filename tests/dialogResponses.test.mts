import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DialogRequest } from '../src/shared/protocol.ts'
import {
  buildCancelResponse,
  buildConfirmResponse,
  buildDialogResponse,
  buildEditorResponse,
  buildInputResponse,
  buildSelectResponse
} from '../src/renderer/src/state/dialogResponses.ts'

const SELECT: DialogRequest = { type: 'extension_ui_request', id: 'd1', method: 'select', title: 'Pick', options: ['A', 'B'] }
const CONFIRM: DialogRequest = { type: 'extension_ui_request', id: 'd2', method: 'confirm', title: 'Sure?', message: 'Go ahead' }
const INPUT: DialogRequest = { type: 'extension_ui_request', id: 'd3', method: 'input', title: 'Name' }
const EDITOR: DialogRequest = { type: 'extension_ui_request', id: 'd4', method: 'editor', title: 'Edit' }

test('select maps the chosen option string to the value field, exactly', () => {
  assert.deepEqual(buildSelectResponse('d1', 'A'), { type: 'extension_ui_response', id: 'd1', value: 'A' })
})

test('confirm maps the user choice to the confirmed flag, exactly', () => {
  assert.deepEqual(buildConfirmResponse('d2', true), { type: 'extension_ui_response', id: 'd2', confirmed: true })
  assert.deepEqual(buildConfirmResponse('d2', false), { type: 'extension_ui_response', id: 'd2', confirmed: false })
})

test('input maps the typed text to the value field, exactly', () => {
  assert.deepEqual(buildInputResponse('d3', 'my session'), {
    type: 'extension_ui_response',
    id: 'd3',
    value: 'my session'
  })
})

test('editor maps the edited text to the value field, exactly', () => {
  assert.deepEqual(buildEditorResponse('d4', 'line one\nline two'), {
    type: 'extension_ui_response',
    id: 'd4',
    value: 'line one\nline two'
  })
})

test('cancellation is a cancelled response and carries no answer fields', () => {
  assert.deepEqual(buildCancelResponse('d1'), { type: 'extension_ui_response', id: 'd1', cancelled: true })
})

test('the dispatcher answers each dialog method with its own response shape', () => {
  assert.deepEqual(buildDialogResponse(SELECT, { kind: 'select', option: 'B' }), {
    type: 'extension_ui_response',
    id: 'd1',
    value: 'B'
  })
  assert.deepEqual(buildDialogResponse(CONFIRM, { kind: 'confirm', confirmed: true }), {
    type: 'extension_ui_response',
    id: 'd2',
    confirmed: true
  })
  assert.deepEqual(buildDialogResponse(INPUT, { kind: 'text', value: 'hello' }), {
    type: 'extension_ui_response',
    id: 'd3',
    value: 'hello'
  })
  assert.deepEqual(buildDialogResponse(EDITOR, { kind: 'text', value: 'edited' }), {
    type: 'extension_ui_response',
    id: 'd4',
    value: 'edited'
  })
})

test('the dispatcher cancels any dialog method through one shared shape', () => {
  for (const request of [SELECT, CONFIRM, INPUT, EDITOR]) {
    assert.deepEqual(buildDialogResponse(request, { kind: 'cancel' }), {
      type: 'extension_ui_response',
      id: request.id,
      cancelled: true
    })
  }
})
