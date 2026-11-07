'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const html = fs.readFileSync(require.resolve('../index.html'),'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const helper = fs.readFileSync(require.resolve('../bluetooth.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t, {search='', session={}, saved={}, requestDevice}={}) {
  const elements=new Map(), writes=[], requests=[], redirects=[];
  const storage = (seed={}) => {const data=new Map(Object.entries(seed));return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};};
  const element = id => {
    if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:false,textContent:'',style:{},classList:{toggle(){}},
      children:[],replaceChildren(){this.children=[];this.value='';},append(opt){this.children.push(opt);},select(){}});
    return elements.get(id);
  };
  const c={uuid:'0000ffe1-0000-1000-8000-00805f9b34fb',properties:{writeWithoutResponse:true},async writeValueWithoutResponse(frame){writes.push([...frame]);}};
  const listeners=new Set();
  const device={id:'mock',name:'AP-mock',addEventListener:(n,f)=>listeners.add(f),removeEventListener:(n,f)=>listeners.delete(f),
    gatt:{connected:false,async connect(){this.connected=true;return this;},disconnect(){this.connected=false;for(const f of listeners)f();},
      async getPrimaryServices(){return [{uuid:'0000ffe0-0000-1000-8000-00805f9b34fb',async getCharacteristics(){return [c];}}];},
      async getPrimaryService(){return {uuid:'0000ffe0-0000-1000-8000-00805f9b34fb',async getCharacteristic(){return c;}};}}};
  const sandbox={console,URLSearchParams,URL,TextEncoder,Uint8Array,Date,Math,crypto:globalThis.crypto,
    btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout,clearTimeout,
    document:{getElementById:element,createElement:()=>({}),addEventListener(){},hidden:false},
    localStorage:storage(saved),sessionStorage:storage(session),
    navigator:{bluetooth:{requestDevice:requestDevice|| (async()=>device)}},
    location:{origin:'https://cosmic-snickerdoodle-3a661b.netlify.app',pathname:'/',protocol:'https:',search,assign:url=>redirects.push(url)},
    history:{replaceState(){}},
    fetch:async(url,options)=>{requests.push({url,options});return {ok:true,status:204,headers:{get:()=>null}};}};
  const context=vm.createContext(sandbox);
  vm.runInContext(helper,context);vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  run('bluetooth.writeGap=0');
  t.after(()=>run('btDisconnect()'));
  return {context,run,element,writes,requests,redirects,device,c,async connect(){await run('pickBluetooth()');}};
}

test('production scripts parse and page loads with the same HTTPS redirect and configurable Client ID', t=>{
  const h=harness(t);
  assert.equal(h.element('redirect').value,'https://cosmic-snickerdoodle-3a661b.netlify.app/');
  assert.equal(h.element('clientId').value,'');
  assert.equal(h.element('testBtn').disabled,true);
});

test('RGB tests and brightness still use original color frame with RGB scaling', async t=>{
  const h=harness(t);await h.connect();
  await h.run('testColor(255,0,0)');
  assert.deepEqual(h.writes[0],[0x78,255,0,0,0,0xf0,0xee]);
  h.run('setLedBrightness(50); clearTimeout(brightnessTimer); brightnessTimer=null');
  await h.run('testColor(0,255,0)');
  await h.run('testColor(0,0,255)');
  assert.deepEqual(h.writes.slice(-2),[[0x78,0,128,0,0,0xf0,0xee],[0x78,0,0,128,0,0xf0,0xee]]);
  assert.equal(h.context.localStorage.getItem('albumglow_brightness'),'50');
});

test('power preserves original unverified bytes; colors stay suppressed while off and restore on power on', async t=>{
  const h=harness(t);await h.connect();await h.run('testColor(255,0,0)');
  await h.run('setLedPower(false)');
  assert.deepEqual(h.writes.at(-1),[0xcc,0x24,0x33]);
  const count=h.writes.length;await h.run('sendLedRgb(0,0,255)');assert.equal(h.writes.length,count);
  await h.run('setLedPower(true)');
  assert.deepEqual(h.writes.slice(-2),[[0xcc,0x23,0x33],[0x78,0,0,255,0,0xf0,0xee]]);
  assert.match(h.element('ledControlsStatus').textContent,/unverified/);
});

test('a power-off intent cancels queued old colors rather than relighting the strip', async t=>{
  const h=harness(t);await h.connect();
  let finish;h.c.writeValueWithoutResponse=frame=>{h.writes.push([...frame]);return new Promise(resolve=>{finish=resolve;});};
  const first=assert.rejects(h.run('sendLedRgb(255,0,0)'),{name:'AbortError'});await settle();
  const old=h.run('sendLedRgb(0,255,0)');const cancelled=assert.rejects(old,{name:'AbortError'});
  const off=h.run('setLedPower(false)');
  finish();await first;await cancelled;await settle();finish();await off;
  assert.deepEqual(h.writes,[[0x78,255,0,0,0,0xf0,0xee],[0xcc,0x24,0x33]]);
});

test('selecting any characteristic requires a fresh visual check and stops sync', async t=>{
  const h=harness(t);await h.connect();await h.run('testColor(255,0,0)');
  h.element('confirmed').checked=true;h.element('confirmed').onchange();
  assert.ok(h.context.localStorage.getItem('albumglow_ble_endpoint_v1'));
  h.run('spotifyToken={access:"mock",expires:Date.now()+100000};startSync()');
  h.element('characteristic').value='0';h.element('characteristic').onchange();
  assert.equal(h.element('confirmed').checked,false);assert.equal(h.run('syncing'),false);
});

test('Spotify PKCE authorization keeps exact production redirect, scope, S256 and state', async t=>{
  const h=harness(t);h.element('clientId').value='a'.repeat(32);
  await h.run('spotifyConnect()');
  const url=new URL(h.redirects[0]);
  assert.equal(url.origin,'https://accounts.spotify.com');
  assert.equal(url.searchParams.get('redirect_uri'),'https://cosmic-snickerdoodle-3a661b.netlify.app/');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('scope'),'user-read-currently-playing');
  assert.equal(url.searchParams.get('state'),h.context.sessionStorage.getItem('ag_state'));
  assert.ok(h.context.sessionStorage.getItem('ag_verifier').length>=43);
});

test('Spotify refresh retains refresh token without putting tokens in logs', async t=>{
  const h=harness(t);h.element('clientId').value='a'.repeat(32);
  h.context.fetch=async(url,options)=>{
    h.requests.push({url,options});return {ok:true,json:async()=>({access_token:'sensitive-new-access',expires_in:3600})};};
  h.run('spotifyToken={access:"expired",refresh:"sensitive-refresh",expires:0}');
  assert.equal(await h.run('spotifyAccess()'),'sensitive-new-access');
  const body=h.requests[0].options.body;
  assert.equal(body.get('grant_type'),'refresh_token');assert.equal(body.get('refresh_token'),'sensitive-refresh');
  assert.equal(h.run('spotifyToken.refresh'),'sensitive-refresh');
  assert.doesNotMatch(h.element('log').textContent,/sensitive-/);
});

test('HTTP 429 respects Retry-After, and overlapping playback polls stay suppressed', async t=>{
  const h=harness(t);h.run('spotifyToken={access:"mock",expires:Date.now()+100000}');
  let finish;h.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const first=h.run('checkSpotify()');await settle();await h.run('checkSpotify()');
  finish({ok:false,status:429,headers:{get:()=> '7'}});await first;
  assert.ok(h.run('rateLimitUntil-Date.now()')>=7000);
  assert.match(h.element('syncStatus').textContent,/Waiting 7s/);
  let count=0;h.context.fetch=async()=>{count++;};await h.run('checkSpotify()');assert.equal(count,0);
});

test('disconnect clears page references but preserves automatic sync intent until user stops', async t=>{
  const h=harness(t);await h.connect();
  h.run('syncing=true');h.device.gatt.disconnect();
  assert.equal(h.run('char'),null);assert.equal(h.run('writable.length'),0);
  assert.equal(h.run('syncing'),true);assert.equal(h.element('testBtn').disabled,true);
  h.run('btDisconnect()');assert.equal(h.run('syncing'),false);
});

test('playback fetched for an old Bluetooth session is ignored after a disconnect', async t=>{
  const h=harness(t);await h.connect();h.run('syncing=true;spotifyToken={access:"mock",expires:Date.now()+100000}');
  let finish;h.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const poll=h.run('checkSpotify()');await settle();h.device.gatt.disconnect();
  finish({ok:true,status:200,headers:{get:()=>null},json:async()=>({item:{name:'Stale',album:{id:'stale'}}})});await poll;
  assert.notEqual(h.element('song').textContent,'Stale');assert.equal(h.writes.length,0);
});

test('vivid color mode preserves saturated red behavior and can be disabled', t=>{
  const h=harness(t);h.element('vividColors').checked=true;
  const vivid=Array.from(h.run('vividColor([232,40,56])'));assert.deepEqual(vivid,[232,0,0]);
  h.element('vividColors').checked=false;assert.deepEqual(Array.from(h.run('vividColor([232,40,56])')),[232,40,56]);
});


test('recovery resumes an enabled sync without reopening the device chooser', async t=>{
  let choosers=0;
  const h=harness(t);const original=h.context.navigator.bluetooth.requestDevice;
  h.context.navigator.bluetooth.requestDevice=async()=>{choosers++;return original();};
  await h.connect();await h.run('testColor(255,0,0)');
  h.element('confirmed').checked=true;h.element('confirmed').onchange();
  h.run('spotifyToken={access:"mock",expires:Date.now()+100000};startSync();clearTimeout(syncTimer);syncTimer=null');
  h.device.gatt.disconnect();
  await h.run('clearTimeout(bluetooth.session.retryTimer);bluetooth.session.retryTimer=null;bluetooth.connect(bluetooth.session)');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(choosers,1);assert.equal(h.run('syncing'),true);
  assert.ok(h.requests.some(r=>r.url.includes('currently-playing')));
});

test('Disconnect while the chooser is open prevents its late result reconnecting', async t=>{
  let finish;const h=harness(t,{requestDevice:()=>new Promise(resolve=>{finish=resolve;})});
  const pick=h.run('pickBluetooth()');h.run('btDisconnect()');finish(h.device);await pick;
  assert.equal(h.device.gatt.connected,false);assert.equal(h.run('bluetooth.session'),null);
});
