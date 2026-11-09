'use strict';

// Wire formats only. Neither a successful browser write nor these profiles
// establish that a physical controller accepted the command. See docs/CONTROLLERS.md.
const AlbumGlowControllers = (() => {
  const uuid = part => `0000${part}-0000-1000-8000-00805f9b34fb`;
  const profiles = Object.freeze({
    apollo: Object.freeze({name: 'Apollo · Bluetooth', transport: 'bluetooth',
      cacheKey: 'albumglow_ble_endpoint_v1', deviceKey: 'albumglow_device'}),
    sp630e: Object.freeze({name: 'SP630E · Bluetooth', transport: 'bluetooth',
      cacheKey: 'albumglow_sp630e_endpoint_v1', deviceKey: 'albumglow_sp630e_device',
      services: Object.freeze([uuid('e0ff'), uuid('ffe0')]), characteristic: uuid('ffe1')}),
    sp803e: Object.freeze({name: 'SP803E · USB / WLED', transport: 'serial'})
  });
  const get = id => Object.hasOwn(profiles, id) ? profiles[id] : profiles.apollo;
  function banlanx(command, payload) {
    // SP630E's unencrypted BanlanX SP6xxE packet: marker, command, key=0,
    // packet count/index, payload length, payload. No UUID/protocol guessing.
    return new Uint8Array([0x53, command, 0, 1, 0, payload.length, ...payload]);
  }
  const json = value => new TextEncoder().encode(JSON.stringify(value) + '\n');
  function color(id, rgb) {
    if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(v => !Number.isInteger(v) || v < 0 || v > 255)) {
      throw new TypeError('RGB must contain three integers from 0 to 255');
    }
    if (id === 'sp630e') {
      // Explicit color intent selects static color / solid effect, then sends
      // RGB with controller brightness 255: the page already scaled RGB.
      return [banlanx(0x53, [1, 1]), banlanx(0x52, [...rgb, 255])];
    }
    if (id === 'sp803e') return [json({on: true, bri: 255, transition: 0,
      seg: [{id: 0, fx: 0, col: [rgb]}]})];
    if (id !== 'apollo') throw new Error('Unknown controller profile');
    return [new Uint8Array([0x78, ...rgb, 0, 0xf0, 0xee])];
  }
  function power(id, on) {
    if (typeof on !== 'boolean') throw new TypeError('Power must be true or false');
    if (id === 'sp630e') return [banlanx(0x50, [on ? 1 : 0])];
    if (id === 'sp803e') return [json({on, transition: 0})];
    if (id !== 'apollo') throw new Error('Unknown controller profile');
    return [new Uint8Array(on ? [0xcc, 0x23, 0x33] : [0xcc, 0x24, 0x33])];
  }
  return Object.freeze({profiles, get, color, power});
})();

if (typeof module !== 'undefined' && module.exports) module.exports = {AlbumGlowControllers};
else globalThis.AlbumGlowControllers = AlbumGlowControllers;
