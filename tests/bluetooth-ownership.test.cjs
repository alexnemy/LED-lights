'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const originalGlobal = Object.getOwnPropertyDescriptor(globalThis, 'AlbumGlowTabOwnership');
const {AlbumGlowTabOwnership} = require('../bluetooth-ownership.js');

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

// Model the browser's lock lifetime, including an optional pause between the
// callback finishing and the request settling/lock actually being released.
function lockManager() {
  const held = new Map(), calls = [];
  return {
    held, calls,
    releaseGate: null,
    async request(name, options, callback) {
      calls.push({name, options});
      const lock = held.has(name) ? null : {name, mode: 'exclusive'};
      if (lock) held.set(name, lock);
      try {
        const result = await callback(lock);
        if (lock && this.releaseGate) await this.releaseGate;
        return result;
      } finally {
        if (lock) held.delete(name);
      }
    }
  };
}

test('only one tab can acquire a device without waiting or stealing', async () => {
  const locks = lockManager();
  const first = new AlbumGlowTabOwnership({locks});
  const second = new AlbumGlowTabOwnership({locks});
  const lease = await first.acquire('controller-one');
  assert.equal(lease.supported, true);
  assert.equal(await second.acquire('controller-one'), null);
  assert.equal(locks.held.size, 1);
  assert.deepEqual(locks.calls[0].options, {ifAvailable: true});
  assert.equal(locks.calls[0].name, locks.calls[1].name);
  await lease.release();
  assert.equal(locks.held.size, 0);
});

test('different devices can be controlled by different tabs concurrently', async () => {
  const locks = lockManager();
  const first = await new AlbumGlowTabOwnership({locks}).acquire('controller-one');
  const second = await new AlbumGlowTabOwnership({locks}).acquire('controller-two');
  assert.equal(first.supported, true);
  assert.equal(second.supported, true);
  assert.equal(locks.held.size, 2);
  assert.notEqual(locks.calls[0].name, locks.calls[1].name);
  await Promise.all([first.release(), second.release()]);
});

test('a released device can immediately be acquired by another tab', async () => {
  const locks = lockManager();
  const first = new AlbumGlowTabOwnership({locks});
  const second = new AlbumGlowTabOwnership({locks});
  const lease = await first.acquire('controller-one');
  await lease.release();
  const replacement = await second.acquire('controller-one');
  assert.equal(replacement.supported, true);
  await replacement.release();
});

test('release is idempotent and waits for actual request completion', async () => {
  const locks = lockManager(), gate = deferred();
  locks.releaseGate = gate.promise;
  const owner = new AlbumGlowTabOwnership({locks});
  const lease = await owner.acquire('controller-one');
  const released = lease.release();
  assert.equal(lease.release(), released);
  let complete = false;
  released.then(() => {complete = true;});
  await settle();
  assert.equal(complete, false);
  assert.equal(locks.held.size, 1);
  assert.equal(await owner.acquire('controller-one'), null);
  gate.resolve();
  await released;
  assert.equal(complete, true);
  assert.equal(locks.held.size, 0);
  assert.equal(lease.release(), released);
  const next = await owner.acquire('controller-one');
  await next.release();
});

test('request permission failures reject acquisition without bypassing ownership', async () => {
  const denied = new DOMException('Web Locks blocked', 'SecurityError');
  const owner = new AlbumGlowTabOwnership({locks: {request: () => Promise.reject(denied)}});
  await assert.rejects(owner.acquire('controller-one'), error => error === denied);
});

test('synchronous request exceptions reject acquisition', async () => {
  const denied = new DOMException('Policy denied', 'SecurityError');
  const owner = new AlbumGlowTabOwnership({locks: {request() {throw denied;}}});
  await assert.rejects(owner.acquire('controller-one'), error => error === denied);
});

test('request failures after acquisition propagate through release', async () => {
  const failure = new Error('Lock manager failed while releasing');
  const owner = new AlbumGlowTabOwnership({locks: {
    async request(name, options, callback) {
      await callback({name});
      throw failure;
    }
  }});
  const lease = await owner.acquire('controller-one');
  await assert.rejects(lease.release(), error => error === failure);
  await assert.rejects(lease.release(), error => error === failure);
});

test('unsupported browsers receive an explicitly unsupported no-op lease', async () => {
  for (const locks of [null, {}]) {
    const owner = new AlbumGlowTabOwnership({locks});
    const lease = await owner.acquire('controller-one');
    assert.equal(lease.supported, false);
    const released = lease.release();
    assert.equal(lease.release(), released);
    await released;
  }
});

test('invalid device IDs fail before requesting any lock or unsupported fallback', async () => {
  const locks = lockManager();
  for (const owner of [new AlbumGlowTabOwnership({locks}), new AlbumGlowTabOwnership({locks: null})]) {
    for (const id of [undefined, null, '', '  ', 12, {}, []]) {
      await assert.rejects(owner.acquire(id), TypeError);
    }
  }
  assert.equal(locks.calls.length, 0);
});

test('CommonJS export does not install or change a Node global', () => {
  assert.equal(typeof AlbumGlowTabOwnership, 'function');
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'AlbumGlowTabOwnership'), originalGlobal);
});

test('browser script exposes its class and defaults to navigator.locks', async () => {
  const locks = lockManager();
  const browser = {navigator: {locks}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../bluetooth-ownership.js'), 'utf8'), browser);
  assert.equal(typeof browser.AlbumGlowTabOwnership, 'function');
  const lease = await new browser.AlbumGlowTabOwnership().acquire('browser-controller');
  assert.equal(lease.supported, true);
  assert.equal(locks.held.size, 1);
  await lease.release();
  assert.equal(locks.held.size, 0);
});
