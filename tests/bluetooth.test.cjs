'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {AlbumGlowBluetooth} = require('../bluetooth.js');

const serviceId = '0000ffe0-0000-1000-8000-00805f9b34fb';
const charId = '0000ffe1-0000-1000-8000-00805f9b34fb';
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {resolve = a; reject = b;});
  return {promise, resolve, reject};
}
function clock() {
  let time = 0, id = 0;
  const jobs = new Map();
  return {
    now: () => time,
    setTimeout(fn, ms) {jobs.set(++id, {at: time + ms, fn}); return id;},
    clearTimeout(id) {jobs.delete(id);},
    async advance(ms) {
      const target = time + ms;
      for (;;) {
        const next = [...jobs].sort((a,b) => a[1].at-b[1].at)[0];
        if (!next || next[1].at > target) break;
        time = next[1].at; jobs.delete(next[0]); next[1].fn(); await settle();
      }
      time = target; await settle();
    },
    jobs
  };
}
function fixture(options = {}) {
  const timers = clock(), events = new Set(), messages = [], writes = [], calls = [];
  const storage = new Map();
  const localStorage = {getItem: key => storage.get(key), setItem: (key,v) => storage.set(key,v), removeItem: key => storage.delete(key)};
  let serial = 0;
  const makeChar = () => ({uuid: charId, serial: ++serial, properties: {writeWithoutResponse: true},
    async writeValueWithoutResponse(frame) {writes.push({bytes: [...frame], at: timers.now(), serial: this.serial});}});
  const makeService = () => ({uuid: serviceId,
    async getCharacteristics() {calls.push('characteristics'); return [makeChar()];},
    async getCharacteristic(uuid) {calls.push('saved-characteristic'); assert.equal(uuid,charId); return makeChar();}});
  const device = {id: 'test-device', name: 'AP-test',
    addEventListener(name, fn) {events.add(fn);},
    removeEventListener(name, fn) {events.delete(fn);},
    drop() {this.gatt.connected=false; for (const fn of [...events]) fn();},
    gatt: {
      connected:false,
      async connect() {calls.push('connect'); this.connected=true; return this;},
      disconnect() {calls.push('disconnect'); device.drop();},
      async getPrimaryServices() {calls.push('services'); return [makeService()];},
      async getPrimaryService(uuid) {calls.push('saved-service'); assert.equal(uuid,serviceId); return makeService();}
    }
  };
  let ready = 0, cleared = 0, unconfirmed = 0;
  const bt = new AlbumGlowBluetooth({timers, now: timers.now, storage: localStorage,
    log: s=>messages.push(s), onState: s=>messages.push(s),
    onReady: ()=>ready++, onClear: ()=>cleared++, onUnconfirmed: ()=>unconfirmed++, ...options});
  return {bt, device, timers, messages, writes, calls, events, storage,
    get ready() {return ready;}, get cleared() {return cleared;}, get unconfirmed() {return unconfirmed;}};
}

test('initial discovery logs each stage and never sends speculative commands', async () => {
  const f=fixture(); await f.bt.useDevice(f.device);
  assert.equal(f.ready,1); assert.equal(f.writes.length,0);
  assert.deepEqual(f.calls,['connect','services','characteristics']);
  assert.ok(f.messages.some(x=>x.includes('completed GATT connect')));
  assert.ok(f.messages.some(x=>x.includes('completed characteristic discovery')));
  assert.throws(()=>f.bt.confirm(), /manual color test/);
});

test('confirmed endpoint reconnects directly with freshly acquired characteristic', async () => {
  const f=fixture(); await f.bt.useDevice(f.device);
  const before=f.bt.session.characteristic;
  await f.bt.write([1],{kind:'test'}); f.bt.confirm();
  assert.equal(f.bt.cachedEndpoint().characteristic,charId);
  f.device.drop(); assert.equal(f.bt.session.characteristic,null);
  await f.timers.advance(1000);
  assert.notEqual(f.bt.session.characteristic,before);
  assert.deepEqual(f.calls.slice(-3),['connect','saved-service','saved-characteristic']);
  assert.equal(f.ready,2);
});

test('missing saved endpoint falls back to discovery and requires visual confirmation again', async () => {
  const f=fixture(); await f.bt.useDevice(f.device);
  await f.bt.write([1],{kind:'test'}); f.bt.confirm();
  f.device.gatt.getPrimaryService=async()=>{throw new DOMException('gone','NotFoundError');};
  f.device.drop(); await f.timers.advance(1000);
  assert.equal(f.ready,2); assert.equal(f.unconfirmed,1);
  assert.deepEqual(f.calls.slice(-3),['connect','services','characteristics']);
});

test('network failure on saved service does not trigger a broad discovery', async () => {
  const f=fixture(); await f.bt.useDevice(f.device);
  await f.bt.write([1],{kind:'test'}); f.bt.confirm();
  f.device.gatt.getPrimaryService=async()=>{throw new DOMException('lost','NetworkError');};
  f.device.drop(); await f.timers.advance(1000);
  assert.equal(f.ready,1);
  assert.equal(f.calls.filter(x=>x==='services').length,1);
  assert.ok(f.messages.some(x=>x.includes('FAILED at saved service')));
});

test('GATT connect failure identifies the stage and never starts discovery', async () => {
  const f=fixture(); f.device.gatt.connect=async()=>{throw new DOMException('unknown','NetworkError');};
  await f.bt.useDevice(f.device);
  assert.equal(f.ready,0); assert.equal(f.calls.length,0);
  assert.ok(f.messages.some(x=>x.includes('FAILED at GATT connect')));
  assert.equal(f.bt.session.attempts,1);
});

test('drop during characteristic discovery cannot publish stale objects', async () => {
  const f=fixture(); const gate=deferred();
  f.device.gatt.getPrimaryServices=async()=>[{uuid:serviceId,getCharacteristics:()=>gate.promise}];
  const connect=f.bt.useDevice(f.device); await settle();
  f.device.drop(); gate.resolve([{uuid:charId,properties:{write:true}}]); await connect;
  assert.equal(f.ready,0); assert.equal(f.bt.session.characteristic,null);
  assert.equal(f.timers.jobs.size,1);
});

test('duplicate connection attempts are serialized; cancelled late connect is closed', async () => {
  const f=fixture(); const gate=deferred(); let count=0;
  f.device.gatt.connect=async function() {count++; await gate.promise; this.connected=true; return this;};
  const first=f.bt.useDevice(f.device); await settle();
  await f.bt.connect(f.bt.session); assert.equal(count,1);
  f.bt.disconnect(); gate.resolve(); await first;
  assert.equal(f.device.gatt.connected,false); assert.equal(f.ready,0); assert.equal(f.events.size,0);
});

test('a replacement session for the same device waits for old GATT work', async () => {
  const f=fixture(); const gate=deferred(); const connect=f.device.gatt.connect; let count=0;
  f.device.gatt.connect=async function() {count++; if(count===1) await gate.promise; return connect.call(this);};
  const first=f.bt.useDevice(f.device); await settle();
  const second=f.bt.useDevice(f.device); await settle(); assert.equal(count,1);
  gate.resolve(); await Promise.all([first,second]);
  assert.equal(count,2); assert.equal(f.ready,1); assert.equal(f.device.gatt.connected,true); assert.equal(f.events.size,1);
});

test('brief successful connections do not create an unlimited reconnect loop', async () => {
  const f=fixture(); await f.bt.useDevice(f.device);
  for (const delay of [1000,2000,4000,8000]) {f.device.drop(); await f.timers.advance(delay);}
  assert.equal(f.ready,5); f.device.drop();
  assert.equal(f.timers.jobs.size,0);
  assert.ok(f.messages.at(-1).includes('Automatic retries stopped'));
});

test('a stable connection restores the retry budget', async () => {
  const f=fixture(); await f.bt.useDevice(f.device); f.device.drop(); await f.timers.advance(1000);
  assert.equal(f.bt.session.attempts,1); await f.timers.advance(30000);
  assert.equal(f.bt.session.attempts,0);
});

test('writes serialize and respect the minimum gap across power and colors', async () => {
  const f=fixture(); await f.bt.useDevice(f.device); const gate=deferred(); let active=0, max=0;
  const c=f.bt.session.characteristic;
  c.writeValueWithoutResponse=async frame=>{active++;max=Math.max(max,active);f.writes.push({bytes:[...frame],at:f.timers.now()});if(frame[0]===1)await gate.promise;active--;};
  const a=f.bt.write([1],{kind:'test'}); await settle();
  const b=f.bt.write([2],{kind:'power'}); const d=f.bt.write([3],{kind:'color'});
  assert.equal(f.writes.length,1); gate.resolve(); await a; await settle();
  await f.timers.advance(100); await b; await f.timers.advance(100); await d;
  assert.equal(max,1); assert.deepEqual(f.writes.map(w=>w.at),[0,100,200]);
  assert.deepEqual(f.writes.map(w=>w.bytes[0]),[1,2,3]);
});

test('unsent colors coalesce, while power commands retain their order', async () => {
  const f=fixture({writeGap:0}); await f.bt.useDevice(f.device); const gate=deferred();
  const original=f.bt.session.characteristic.writeValueWithoutResponse;
  f.bt.session.characteristic.writeValueWithoutResponse=async function(frame){if(frame[0]===1)await gate.promise;await original.call(this,frame);};
  const a=f.bt.write([1]); await settle();
  const b=f.bt.write([2],{kind:'color'}); const dropped=assert.rejects(b,{name:'AbortError'});
  const c=f.bt.write([3],{kind:'color'}); const d=f.bt.write([4],{kind:'power'}); const e=f.bt.write([5],{kind:'color'});
  gate.resolve(); await Promise.all([a,dropped,c,d,e]);
  assert.deepEqual(f.writes.map(w=>w.bytes[0]),[1,3,4,5]);
});

test('disconnect cancels queued writes and rejects in-flight completion', async () => {
  const f=fixture(); await f.bt.useDevice(f.device); const gate=deferred();
  f.bt.session.characteristic.writeValueWithoutResponse=()=>gate.promise;
  const a=assert.rejects(f.bt.write([1]),{name:'AbortError'}); await settle();
  const b=assert.rejects(f.bt.write([2]),{name:'AbortError'});
  f.bt.disconnect(); gate.resolve(); await Promise.all([a,b]);
  assert.equal(f.events.size,0); assert.equal(f.timers.jobs.size,0); assert.equal(f.bt.session,null);
});

test('selection change cancels old writes and clears visual confirmation', async () => {
  const f=fixture(); await f.bt.useDevice(f.device); const gate=deferred();
  const old=f.bt.session.characteristic;
  old.writeValueWithoutResponse=()=>gate.promise;
  const a=assert.rejects(f.bt.write([1]),{name:'AbortError'}); await settle();
  const b=assert.rejects(f.bt.write([2]),{name:'AbortError'});
  f.bt.select(0); gate.resolve(); await Promise.all([a,b]);
  assert.equal(f.unconfirmed,1); assert.throws(()=>f.bt.confirm(),/manual color test/);
});

test('stale sync/power intent predicate cancels a command before writing', async () => {
  const f=fixture(); await f.bt.useDevice(f.device);
  await assert.rejects(f.bt.write([1],{valid:()=>false}),{name:'AbortError'});
  assert.equal(f.writes.length,0);
});

test('write network failure invalidates GATT objects and schedules recovery', async () => {
  const f=fixture(); await f.bt.useDevice(f.device);
  f.bt.session.characteristic.writeValueWithoutResponse=async()=>{throw new DOMException('lost','NetworkError');};
  await assert.rejects(f.bt.write([1]),{name:'NetworkError'});
  assert.equal(f.bt.session.characteristic,null); assert.equal(f.device.gatt.connected,false);
  await f.timers.advance(1000); assert.equal(f.ready,2);
});

test('malformed cached endpoint is ignored', () => {
  const f=fixture(); f.storage.set(f.bt.cacheKey,'{"deviceId":"x","service":"bad","characteristic":"bad"}');
  assert.equal(f.bt.cachedEndpoint(),null);
});


test('one inaccessible service does not hide other writable characteristics', async()=>{
  const f=fixture();const primary=f.device.gatt.getPrimaryServices;
  f.device.gatt.getPrimaryServices=async()=>[
    {uuid:'0000180a-0000-1000-8000-00805f9b34fb',async getCharacteristics(){throw new DOMException('blocked','SecurityError');}},
    ...(await primary())
  ];
  await f.bt.useDevice(f.device);assert.equal(f.ready,1);
  assert.ok(f.messages.some(x=>x.includes('skipping unavailable')));
});

// Separate helper instances model separate tabs; native counters prove that a
// losing page never attempts to connect or disconnect another page's device.
function owners() {
  const held=new Map(),events=[];
  return {held,events,async acquire(id){
    if(held.has(id))return null;
    const token={};held.set(id,token);events.push('acquire:'+id);
    return {supported:true,async release(){
      if(held.get(id)===token){held.delete(id);events.push('release:'+id);}
    }};
  }};
}

test('a second page is refused before any native GATT operation and can connect after release', async()=>{
  const ownership=owners(),first=fixture({ownership}),second=fixture({ownership});
  await first.bt.useDevice(first.device);
  await assert.rejects(second.bt.useDevice(second.device),/Another Album Glow tab/);
  assert.deepEqual(second.calls,[]);assert.equal(second.events.size,0);assert.equal(second.bt.session,null);
  first.bt.disconnect();await first.bt.ownerBarrier;
  await second.bt.useDevice(second.device);assert.equal(second.ready,1);
  second.bt.disconnect();await second.bt.ownerBarrier;assert.equal(ownership.held.size,0);
});

test('Disconnect keeps ownership until a cancelled native connect and its late cleanup settle', async()=>{
  const ownership=owners(),first=fixture({ownership}),second=fixture({ownership}),gate=deferred();
  first.device.gatt.connect=async function(){first.calls.push('connect');await gate.promise;this.connected=true;return this;};
  const pending=first.bt.useDevice(first.device);await settle();
  first.bt.disconnect();assert.equal(ownership.held.size,1);
  await assert.rejects(second.bt.useDevice(second.device),/Another Album Glow tab/);assert.deepEqual(second.calls,[]);
  gate.resolve();await pending;await first.bt.ownerBarrier;
  assert.equal(first.device.gatt.connected,false);assert.equal(ownership.held.size,0);
  assert.deepEqual(first.calls,['connect','disconnect','disconnect']);
  await second.bt.useDevice(second.device);assert.equal(second.ready,1);
  second.bt.disconnect();await second.bt.ownerBarrier;
});

test('Disconnect holds ownership through an in-flight native write before another page can connect', async()=>{
  const ownership=owners(),first=fixture({ownership}),second=fixture({ownership}),gate=deferred();
  await first.bt.useDevice(first.device);
  first.bt.session.characteristic.writeValueWithoutResponse=()=>gate.promise;
  const write=assert.rejects(first.bt.write([1]),{name:'AbortError'});await settle();
  first.bt.disconnect();assert.equal(ownership.held.size,1);
  await assert.rejects(second.bt.useDevice(second.device),/Another Album Glow tab/);assert.deepEqual(second.calls,[]);
  gate.resolve();await write;await first.bt.ownerBarrier;
  await second.bt.useDevice(second.device);assert.equal(second.ready,1);
  second.bt.disconnect();await second.bt.ownerBarrier;
});

test('cancelling before an ownership grant never touches GATT and releases a late lease', async()=>{
  const ownership=owners(),f=fixture({ownership}),gate=deferred(),acquire=ownership.acquire.bind(ownership);
  ownership.acquire=async id=>{await gate.promise;return acquire(id);};
  const pending=f.bt.useDevice(f.device);await settle();f.bt.disconnect();
  assert.deepEqual(f.calls,[]);gate.resolve();await pending;await f.bt.ownerBarrier;
  assert.equal(ownership.held.size,0);assert.deepEqual(f.calls,[]);
});

test('replacement during pending ownership acquisition waits for old grant release instead of self-contention', async()=>{
  const ownership=owners(),f=fixture({ownership}),gate=deferred(),acquire=ownership.acquire.bind(ownership);let count=0;
  ownership.acquire=async id=>{if(++count===1)await gate.promise;return acquire(id);};
  const first=f.bt.useDevice(f.device);await settle();const next=f.bt.useDevice(f.device);await settle();
  assert.deepEqual(f.calls,[]);gate.resolve();await Promise.all([first,next]);
  assert.equal(f.ready,1);assert.deepEqual(ownership.events,['acquire:test-device','release:test-device','acquire:test-device']);
  f.bt.disconnect();await f.bt.ownerBarrier;
});

test('same-page replacement waits for cancelled connect and lock release before native reconnect', async()=>{
  const ownership=owners(),f=fixture({ownership}),gate=deferred(),connect=f.device.gatt.connect;let count=0;
  f.device.gatt.connect=async function(){if(++count===1)await gate.promise;return connect.call(this);};
  const first=f.bt.useDevice(f.device);await settle();const next=f.bt.useDevice(f.device);await settle();
  assert.equal(count,1);gate.resolve();await Promise.all([first,next]);
  assert.equal(count,2);assert.equal(f.ready,1);assert.equal(f.device.gatt.connected,true);
  f.bt.disconnect();await f.bt.ownerBarrier;
});

test('repeated native connect failures call zero discovery/write methods and release ownership after exhaustion', async()=>{
  const ownership=owners(),f=fixture({ownership}),other=fixture({ownership});let count=0;
  f.device.gatt.connect=async()=>{count++;throw new DOMException('Unknown error when connecting to the device.','NetworkError');};
  await f.bt.useDevice(f.device);
  for(const delay of [1000,2000,4000,8000])await f.timers.advance(delay);
  await f.bt.ownerBarrier;assert.equal(count,5);assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);
  assert.equal(f.timers.jobs.size,0);assert.equal(ownership.held.size,0);
  assert.match(f.messages.at(-1),/Chrome could not establish/);
  await other.bt.useDevice(other.device);f.bt.disconnect();assert.deepEqual(f.calls,[]);
  assert.equal(other.device.gatt.connected,true);
  other.bt.disconnect();await other.bt.ownerBarrier;
});

test('ownership API denial fails closed before native connect or disconnect and does not retry', async()=>{
  const f=fixture({ownership:{async acquire(){throw new DOMException('Ownership denied','SecurityError');}}});
  await assert.rejects(f.bt.useDevice(f.device),{name:'SecurityError'});
  assert.deepEqual(f.calls,[]);assert.equal(f.events.size,0);assert.equal(f.timers.jobs.size,0);
});

test('independent controllers can be owned by independent pages', async()=>{
  const ownership=owners(),first=fixture({ownership}),second=fixture({ownership});second.device.id='another-controller';
  await Promise.all([first.bt.useDevice(first.device),second.bt.useDevice(second.device)]);
  assert.equal(first.ready,1);assert.equal(second.ready,1);assert.equal(ownership.held.size,2);
  first.bt.disconnect();second.bt.disconnect();await Promise.all([first.bt.ownerBarrier,second.bt.ownerBarrier]);
});

test('an ownership release failure is reported and prevents a silent unsafe reconnect', async()=>{
  const failure=new Error('Release failed'),f=fixture({ownership:{async acquire(){return{supported:true,async release(){throw failure;}};}}});
  await f.bt.useDevice(f.device);f.bt.disconnect();await assert.rejects(f.bt.ownerBarrier,error=>error===failure);
  await assert.rejects(f.bt.useDevice(f.device),error=>error===failure);
  assert.equal(f.calls.filter(c=>c==='connect').length,1);
  assert.ok(f.messages.some(m=>m.includes('ownership could not be released')));
});

test('superseded acquisition release failures fence subsequent claims', async()=>{
  const gate=deferred(),failure=new Error('Stale grant failed to release');let claims=0;
  const f=fixture({ownership:{async acquire(){claims++;await gate.promise;return{supported:true,async release(){throw failure;}};}}});
  const first=f.bt.useDevice(f.device);await settle();const next=f.bt.useDevice(f.device);await settle();
  const failed=assert.rejects(next,error=>error===failure);gate.resolve();await Promise.all([first,failed]);
  assert.equal(claims,1);assert.deepEqual(f.calls,[]);assert.equal(f.bt.session,null);
});
