'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {AlbumGlowSerial} = require('../serial.js');
const {AlbumGlowControllers} = require('../controller-protocols.js');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

function fixture(t, options={}) {
  const calls=[],writes=[],messages=[],states=[],events=new Set();
  let input,blocked=null,ended=false,ready=0,cleared=0,probes=0;
  const reply=JSON.stringify({info:{ver:'0.16.0'},state:{on:true,bri:255,seg:[{col:[[12,34,56]]}]}})+'\n';
  const feed=text=>{if(!ended)input.enqueue(new TextEncoder().encode(text));};
  const port={
    getInfo:()=>({usbVendorId:0x1a86,usbProductId:0x7523}),readable:null,writable:null,
    async open(settings){
      calls.push(['open',settings]);if(options.open)await options.open();
      ended=false;
      this.readable=new ReadableStream({start(controller){input=controller;},cancel(){calls.push(['cancel-read']);ended=true;}});
      this.writable=new WritableStream({async write(value){
        const text=new TextDecoder().decode(value);writes.push(text);calls.push(['write',text]);
        if(blocked){const pending=blocked;blocked=null;await pending.promise;}
        if(text==='{\"v\":true}\n'&&++probes>=(options.respondAfter||1)&&options.respond!==false){feed('Boot message ignored\n');feed(reply.slice(0,20));feed(reply.slice(20));}
      }});
    },
    async close(){
      calls.push(['close']);assert.equal(this.readable.locked,false);assert.equal(this.writable.locked,false);
      if(options.close)await options.close();this.readable=null;this.writable=null;
    }
  };
  const serial={addEventListener:(n,f)=>events.add(f),removeEventListener:(n,f)=>events.delete(f)};
  const usb=new AlbumGlowSerial({serial,writeGap:0,ownership:null,log:s=>messages.push(s),onState:s=>states.push(s),
    onReady:()=>ready++,onClear:()=>cleared++,...options.controller});
  t.after(async()=>{try{await usb.disconnect()}catch{}});
  return {usb,port,calls,writes,messages,states,events,feed,
    blockNext(){blocked=deferred();return blocked;},
    failRead(){input.error(new DOMException('Device removed','NetworkError'));},
    drop(){for(const listener of [...events])listener({port});},
    get ready(){return ready;},get cleared(){return cleared;}};
}

test('USB identifies WLED from fragmented replies before ready, without a color or power change', async t=>{
  const f=fixture(t);assert.equal(await f.usb.usePort(f.port),true);
  assert.equal(f.ready,1);assert.equal(f.usb.session.ready,true);
  assert.deepEqual(f.writes,['{"v":true}\n']);
  assert.deepEqual(f.calls[0],['open',{baudRate:115200,flowControl:'none'}]);
  assert.equal(f.usb.session.id,'usb-wled:6790:29987');
  f.feed('a WiFi password or other arbitrary boot data\n');await settle();
  assert.doesNotMatch(f.messages.join('\n'),/password|arbitrary boot/);
});

test('a selected serial device without a WLED reply times out and closes before releasing ownership', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const released=[];
  const f=fixture(t,{respond:false,controller:{ownership:{async acquire(){return {supported:true,async release(){released.push('released');}};}}}});
  const connection=assert.rejects(f.usb.usePort(f.port),/No WLED reply/);await settle();
  assert.equal(f.ready,0);assert.deepEqual(f.writes,['{"v":true}\n']);assert.equal(released.length,0);
  for(let i=0;i<5;i++){t.mock.timers.tick(1000);await settle();}await connection;
  assert.equal(f.usb.session,null);assert.equal(f.port.readable,null);assert.equal(released.length,1);
  assert.deepEqual(f.calls.slice(-2),[['cancel-read'],['close']]);
});

test('JSON without WLED identity does not enable LED commands', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t,{respond:false});
  const connection=assert.rejects(f.usb.usePort(f.port),/No WLED reply/);await settle();
  f.feed('{"v":true}\n{"info":{"ver":"other"},"state":{"on":true}}\n');await settle();
  assert.equal(f.ready,0);await assert.rejects(f.usb.write([1]),/not ready/);
  for(let i=0;i<5;i++){t.mock.timers.tick(1000);await settle();}await connection;
});

test('a slow ESP32 boot is probed on the same port before enabling any LED command', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t,{respondAfter:3});
  const connect=f.usb.usePort(f.port);await settle();assert.equal(f.ready,0);
  for(let i=0;i<2;i++){t.mock.timers.tick(1000);await settle();}
  assert.equal(await connect,true);assert.equal(f.ready,1);
  assert.equal(f.calls.filter(c=>c[0]==='open').length,1);
  assert.deepEqual(f.writes,['{"v":true}\n','{"v":true}\n','{"v":true}\n']);
});

test('cancelled late USB open is closed and cannot publish a ready session', async t=>{
  const gate=deferred();const f=fixture(t,{open:()=>gate.promise});
  const connect=f.usb.usePort(f.port);await settle();const close=f.usb.disconnect();
  gate.resolve();assert.equal(await connect,false);await close;
  assert.equal(f.ready,0);assert.equal(f.usb.session,null);assert.equal(f.writes.length,0);
  assert.equal(f.calls.at(-1)[0],'close');
});

test('a replacement serial session waits for cancelled open and cleanup before opening', async t=>{
  const gate=deferred();let first=true;
  const f=fixture(t,{open:()=>{if(first){first=false;return gate.promise;}}});
  const old=f.usb.usePort(f.port);await settle();const next=f.usb.usePort(f.port);await settle();
  assert.equal(f.calls.filter(c=>c[0]==='open').length,1);
  gate.resolve();assert.equal(await old,false);assert.equal(await next,true);
  assert.deepEqual(f.calls.slice(0,3).map(c=>c[0]),['open','close','open']);assert.equal(f.ready,1);
});

test('USB writes serialize, coalesce obsolete colors, and preserve power ordering', async t=>{
  const f=fixture(t);await f.usb.usePort(f.port);const gate=f.blockNext();
  const first=f.usb.write([1]);await settle();
  const obsolete=assert.rejects(f.usb.write([2],{kind:'color'}),{name:'AbortError'});
  const latest=f.usb.write([3],{kind:'color'});const power=f.usb.write([4]);
  gate.resolve();await Promise.all([first,obsolete,latest,power]);
  assert.deepEqual(f.writes.slice(1),['\x01','\x03','\x04']);
});

test('disconnect holds USB ownership through an in-flight write, then closes the port', async t=>{
  let held=false,released=0;
  const f=fixture(t,{controller:{ownership:{async acquire(){held=true;return {supported:true,async release(){held=false;released++;}};}}}});
  await f.usb.usePort(f.port);const gate=f.blockNext();
  const write=assert.rejects(f.usb.write([1]),{name:'AbortError'});await settle();
  const close=f.usb.disconnect();await settle();assert.equal(held,true);assert.equal(released,0);
  gate.resolve();await write;await close;
  assert.equal(held,false);assert.equal(released,1);assert.equal(f.usb.session,null);
  assert.equal(f.calls.at(-1)[0],'close');
});

test('an invalidated intent and disconnected queued command never reach the serial port', async t=>{
  const f=fixture(t);await f.usb.usePort(f.port);
  await assert.rejects(f.usb.write([1],{valid:()=>false}),{name:'AbortError'});
  const gate=f.blockNext();const first=assert.rejects(f.usb.write([2]),{name:'AbortError'});await settle();
  const queued=assert.rejects(f.usb.write([3]),{name:'AbortError'});const close=f.usb.disconnect();
  gate.resolve();await Promise.all([first,queued,close]);assert.deepEqual(f.writes.slice(1),['\x02']);
});

test('serial disconnect and read failure clear readiness and stop further writes', async t=>{
  const f=fixture(t);await f.usb.usePort(f.port);f.drop();await f.usb.operations;
  assert.equal(f.usb.session,null);assert.equal(f.cleared,1);assert.equal(f.events.size,0);
  await f.usb.usePort(f.port);f.failRead();await settle();await f.usb.operations;
  assert.equal(f.usb.session,null);assert.equal(f.cleared,2);
  await assert.rejects(f.usb.write([1]),/not ready/);
});

test('another same-origin USB owner blocks all port operations', async t=>{
  const f=fixture(t,{controller:{ownership:{async acquire(){return null;}}}});
  await assert.rejects(f.usb.usePort(f.port),/Another Album Glow tab/);
  assert.deepEqual(f.calls,[]);assert.equal(f.ready,0);
});

test('a non-USB serial device is rejected before any port operation', async t=>{
  const f=fixture(t);f.port.getInfo=()=>({bluetoothServiceClassId:'serial-port'});
  await assert.rejects(f.usb.usePort(f.port),/not a USB device/);
  assert.deepEqual(f.calls,[]);assert.equal(f.ready,0);
});

test('failure to open a port never closes a connection held by another application', async t=>{
  const f=fixture(t,{open:async()=>{throw new DOMException('Port is already open','InvalidStateError');}});
  await assert.rejects(f.usb.usePort(f.port),/already open/);
  assert.deepEqual(f.calls.map(c=>c[0]),['open']);assert.equal(f.usb.session,null);
});

test('USB command pacing uses completion time rather than overlapping serial writes', async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const f=fixture(t,{controller:{writeGap:100}});await f.usb.usePort(f.port);
  const a=f.usb.write([1]),b=f.usb.write([2]);await settle();
  assert.equal(f.writes.length,2);t.mock.timers.tick(99);await settle();assert.equal(f.writes.length,2);
  t.mock.timers.tick(1);await Promise.all([a,b]);assert.deepEqual(f.writes.slice(1),['\x01','\x02']);
});

test('a cancelled pending USB ownership grant is released without opening the port', async t=>{
  const gate=deferred();let released=0;
  const f=fixture(t,{controller:{ownership:{acquire:()=>gate.promise}}});
  const connect=f.usb.usePort(f.port);await settle();const close=f.usb.disconnect();
  gate.resolve({supported:true,async release(){released++;}});
  assert.equal(await connect,false);await close;
  assert.equal(released,1);assert.deepEqual(f.calls,[]);
});

test('failed native close keeps ownership and fences later USB connections', async t=>{
  let releases=0;
  const f=fixture(t,{close:async()=>{throw Error('Native close failed');},controller:{ownership:{async acquire(){return {supported:true,async release(){releases++;}};}}}});
  await f.usb.usePort(f.port);await assert.rejects(f.usb.disconnect(),/Native close failed/);
  await assert.rejects(f.usb.usePort(f.port),/Native close failed/);
  assert.equal(f.calls.filter(c=>c[0]==='open').length,1);assert.equal(releases,0);
});

test('failed USB ownership release also fences later connection attempts', async t=>{
  const f=fixture(t,{controller:{ownership:{async acquire(){return {supported:true,async release(){throw Error('Release failed');}};}}}});
  await f.usb.usePort(f.port);await assert.rejects(f.usb.disconnect(),/Release failed/);
  await assert.rejects(f.usb.usePort(f.port),/Release failed/);
  assert.equal(f.calls.filter(c=>c[0]==='open').length,1);
});

test('USB write failure invalidates the session and closes before reconnecting', async t=>{
  const f=fixture(t);await f.usb.usePort(f.port);const gate=f.blockNext();
  const write=assert.rejects(f.usb.write([1]),/Cable lost/);await settle();gate.reject(new Error('Cable lost'));
  await write;await f.usb.operations;
  assert.equal(f.usb.session,null);assert.equal(f.port.readable,null);
  assert.ok(f.states.some(s=>s.includes('USB write failed')));
});

test('oversized serial noise is bounded and malformed command batches are rejected', async t=>{
  const f=fixture(t);await f.usb.usePort(f.port);f.feed('x'.repeat(70000));await settle();
  assert.ok(f.messages.some(s=>s.includes('oversized')));
  await assert.rejects(f.usb.writeBatch([]),/one to four/);
  await assert.rejects(f.usb.writeBatch([[]]),/must not be empty/);
  await assert.rejects(f.usb.writeBatch([[1],[2],[3],[4],[5]]),/one to four/);
  assert.deepEqual(f.writes,['{"v":true}\n']);
});

test('WLED protocol frames travel over USB without Apollo/BanlanX bytes', async t=>{
  const f=fixture(t);await f.usb.usePort(f.port);
  await f.usb.writeBatch(AlbumGlowControllers.color('sp803e',[255,0,0]),{kind:'color'});
  await f.usb.writeBatch(AlbumGlowControllers.power('sp803e',false));
  assert.equal(JSON.parse(f.writes[1]).seg[0].col[0][0],255);
  assert.equal(JSON.parse(f.writes[2]).on,false);
});
