'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {AlbumGlowControllers: controllers} = require('../controller-protocols.js');
const bytes = frames => frames.map(frame => [...frame]);

test('Apollo profile preserves the original RGB and unverified power packets', () => {
  assert.deepEqual(bytes(controllers.color('apollo', [18, 52, 86])), [[0x78,18,52,86,0,0xf0,0xee]]);
  assert.deepEqual(bytes(controllers.power('apollo', true)), [[0xcc,0x23,0x33]]);
  assert.deepEqual(bytes(controllers.power('apollo', false)), [[0xcc,0x24,0x33]]);
});

test('SP630E selects static solid color before sending RGB and full controller brightness', () => {
  assert.deepEqual(bytes(controllers.color('sp630e', [255,0,128])), [
    [0x53,0x53,0,1,0,2,1,1],
    [0x53,0x52,0,1,0,4,255,0,128,255]
  ]);
  assert.deepEqual(bytes(controllers.power('sp630e', false)), [[0x53,0x50,0,1,0,1,0]]);
  assert.deepEqual(bytes(controllers.power('sp630e', true)), [[0x53,0x50,0,1,0,1,1]]);
});

test('WLED serial color is a newline-delimited solid JSON command, with app-scaled RGB', () => {
  const packet = controllers.color('sp803e', [0,128,64])[0];
  const line = new TextDecoder().decode(packet);
  assert.ok(line.endsWith('\n'));
  assert.deepEqual(JSON.parse(line), {on:true,bri:255,transition:0,seg:[{id:0,fx:0,col:[[0,128,64]]}]});
  for (const on of [true,false]) assert.deepEqual(JSON.parse(new TextDecoder().decode(controllers.power('sp803e',on)[0])),{on,transition:0});
});

test('profile lookup defaults safely and model-specific commands reject invalid intent', () => {
  assert.equal(controllers.get('unknown'), controllers.profiles.apollo);
  assert.equal(controllers.get('__proto__'), controllers.profiles.apollo);
  for (const id of Object.keys(controllers.profiles)) {
    for (const rgb of [[0,0],[-1,0,0],[0,256,0],[0,0,0.5],[NaN,0,0]]) assert.throws(()=>controllers.color(id,rgb),/RGB/);
    assert.throws(()=>controllers.power(id,1),/Power/);
  }
  assert.throws(()=>controllers.color('unknown',[1,2,3]),/Unknown/);
  assert.throws(()=>controllers.power('unknown',true),/Unknown/);
});
