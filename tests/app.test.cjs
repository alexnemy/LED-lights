'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const html = fs.readFileSync(require.resolve('../index.html'),'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const helper = fs.readFileSync(require.resolve('../bluetooth.js'),'utf8');
const profiles = fs.readFileSync(require.resolve('../controller-protocols.js'),'utf8');
const serialHelper = fs.readFileSync(require.resolve('../serial.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t, {search='', session={}, saved={}, requestDevice, getDevices, serial, fetch:fetchOverride}={}) {
  const elements=new Map(), writes=[], requests=[], redirects=[], chooserCalls=[];
  const windowEvents={},documentEvents={};
  const listen=(events,type,listener)=>(events[type]??=[]).push(listener);
  const dispatch=(events,type,event={})=>{for(const listener of events[type]||[])listener(event);};
  const storage = (seed={}) => {const data=new Map(Object.entries(seed));return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};};
  const element = id => {
    if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:false,textContent:'',style:{},classList:{toggle(){}},
      attributes:{},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];},focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;},
      children:[],replaceChildren(){this.children=[];this.value='';},append(opt){this.children.push(opt);},select(){}});
    return elements.get(id);
  };
  const c={uuid:'0000ffe1-0000-1000-8000-00805f9b34fb',properties:{writeWithoutResponse:true},async writeValueWithoutResponse(frame){writes.push([...frame]);}};
  const listeners=new Set();
  const device={id:'mock',name:'AP-mock',addEventListener:(n,f)=>listeners.add(f),removeEventListener:(n,f)=>listeners.delete(f),
    gatt:{connected:false,async connect(){this.connected=true;return this;},disconnect(){this.connected=false;for(const f of listeners)f();},
      async getPrimaryServices(){return [{uuid:'0000ffe0-0000-1000-8000-00805f9b34fb',async getCharacteristics(){return [c];}}];},
      async getPrimaryService(){return {uuid:'0000ffe0-0000-1000-8000-00805f9b34fb',async getCharacteristic(){return c;}};}}};
  const sandbox={console,URLSearchParams,URL,TextEncoder,TextDecoder,Uint8Array,Date,Math,crypto:globalThis.crypto,
    btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout,clearTimeout,
    addEventListener:(type,listener)=>listen(windowEvents,type,listener),
    document:{getElementById:element,createElement:()=>({}),querySelectorAll:()=>[],addEventListener:(type,listener)=>listen(documentEvents,type,listener),hidden:false},
    localStorage:storage(saved),sessionStorage:storage(session),
    navigator:{...(serial?{serial}:{}),bluetooth:{requestDevice:(...args)=>{chooserCalls.push(args);return requestDevice?requestDevice(...args):Promise.resolve(device);},...(getDevices?{getDevices:()=>getDevices(device)}:{})}},
    location:{origin:'https://cosmic-snickerdoodle-3a661b.netlify.app',pathname:'/',protocol:'https:',search,assign:url=>redirects.push(url)},
    history:{replaceState(){}},
    fetch:fetchOverride|| (async(url,options)=>{requests.push({url,options});return {ok:true,status:204,headers:{get:()=>null}};})};
  const context=vm.createContext(sandbox);
  vm.runInContext(helper,context);vm.runInContext(profiles,context);vm.runInContext(serialHelper,context);vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  run('bluetooth.writeGap=0');
  t.after(async()=>{run('btDisconnect()');await run('usb.operations');});
  return {context,run,element,writes,requests,redirects,device,c,chooserCalls,
    dispatchWindow:(type,event)=>dispatch(windowEvents,type,event),dispatchDocument:(type,event)=>dispatch(documentEvents,type,event),
    async connect(){await run('pickBluetooth()');}};
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

test('selecting any characteristic clears optional verification and stops sync', async t=>{
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

const savedSpotify=()=>({albumglow_client:'a'.repeat(32),albumglow_tokens:JSON.stringify({access:'mock',expires:Date.now()+100000})});

test('one-click startup reconnects previously permitted lights and starts sync without color confirmation', async t=>{
  const h=harness(t,{saved:{...savedSpotify(),albumglow_device:'mock'},getDevices:device=>Promise.resolve([device])});
  await settle();await h.run('startAlbumGlow()');
  assert.equal(h.chooserCalls.length,0);assert.equal(h.device.gatt.connected,true);
  assert.equal(h.run('syncing'),true);assert.equal(h.element('confirmed').checked,false);
  assert.equal(h.element('settingsDialog').open,undefined);
  assert.equal(h.element('startupBtn').disabled,false);
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(h.requests.length,1);
});

test('startup uses the chooser immediately when saved-device support is absent', async t=>{
  const h=harness(t,{saved:savedSpotify()});
  const startup=h.run('startAlbumGlow()');
  assert.equal(h.chooserCalls.length,1); // Called before the async function yields.
  await startup;assert.equal(h.run('syncing'),true);
});

test('revoked saved-device access falls back to a chooser from the next user click', async t=>{
  const h=harness(t,{saved:{...savedSpotify(),albumglow_device:'mock'},getDevices:()=>Promise.reject(new Error('not allowed'))});
  await settle();await h.run('startAlbumGlow()');
  assert.equal(h.chooserCalls.length,1);assert.equal(h.run('syncing'),true);
});

test('missing Spotify setup opens Settings without a Bluetooth chooser or OAuth redirect', async t=>{
  const h=harness(t);await h.run('startAlbumGlow()');
  assert.equal(h.element('settingsDialog').open,true);assert.equal(h.element('clientId').focused,true);
  assert.equal(h.chooserCalls.length,0);assert.equal(h.redirects.length,0);
  assert.equal(h.device.gatt.connected,false);
});

test('Client ID and custom service save once; invalid ID does not replace an existing saved ID', t=>{
  const h=harness(t,{saved:{albumglow_client:'b'.repeat(32)}});
  assert.equal(h.element('clientId').value,'b'.repeat(32));
  h.element('clientId').value='c'.repeat(32);h.element('customService').value='ffd5';h.run('saveSettings()');
  assert.equal(h.context.localStorage.getItem('albumglow_client'),'c'.repeat(32));
  assert.equal(h.context.localStorage.getItem('albumglow_custom_service'),'ffd5');
  h.element('clientId').value='invalid';h.run('saveSettings()');
  assert.equal(h.context.localStorage.getItem('albumglow_client'),'c'.repeat(32));
  assert.match(h.element('settingsStatus').textContent,/32-character/);
});

test('first-time startup signs into Spotify before attempting Bluetooth and keeps exact redirect', async t=>{
  const h=harness(t,{saved:{albumglow_client:'a'.repeat(32)}});await h.run('startAlbumGlow()');
  assert.equal(h.chooserCalls.length,0);assert.equal(h.redirects.length,1);
  assert.equal(new URL(h.redirects[0]).searchParams.get('redirect_uri'),'https://cosmic-snickerdoodle-3a661b.netlify.app/');
  assert.equal(h.context.sessionStorage.getItem('ag_start_after_login'),'1');
});

test('OAuth startup callback stores tokens and offers a user-gesture continuation without a chooser', async t=>{
  const h=harness(t,{saved:{albumglow_client:'a'.repeat(32)},search:'?code=callback-code&state=state123',
    session:{ag_verifier:'test-verifier',ag_state:'state123',ag_start_after_login:'1'},
    fetch:async()=>({ok:true,json:async()=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600})})});
  await settle();assert.equal(h.run('spotifyToken.access'),'test-access');
  assert.match(h.element('startupStatus').textContent,/Click Start Album Glow/);
  assert.equal(h.context.sessionStorage.getItem('ag_start_after_login'),null);
  assert.equal(h.chooserCalls.length,0);
});

test('duplicate startup clicks issue only one chooser', async t=>{
  let finish;const h=harness(t,{saved:savedSpotify(),requestDevice:()=>new Promise(resolve=>{finish=resolve;})});
  const first=h.run('startAlbumGlow()');await h.run('startAlbumGlow()');
  assert.equal(h.chooserCalls.length,1);finish(h.device);await first;
  assert.equal(h.run('syncing'),true);
});

test('cancelled chooser releases startup button and does not connect or sync', async t=>{
  const h=harness(t,{saved:savedSpotify(),requestDevice:async()=>{throw new DOMException('cancelled','NotFoundError');}});
  await h.run('startAlbumGlow()');
  assert.equal(h.element('startupBtn').disabled,false);assert.equal(h.run('startupRequest'),null);
  assert.equal(h.run('syncing'),false);assert.equal(h.device.gatt.connected,false);
});

test('startup resumes after an automatic connection retry, without a second click', async t=>{
  const h=harness(t,{saved:savedSpotify()});const connect=h.device.gatt.connect;let attempts=0;
  h.device.gatt.connect=async function(){if(++attempts===1)throw new DOMException('lost','NetworkError');return connect.call(this);};
  await h.run('startAlbumGlow()');assert.equal(h.run('syncing'),false);
  assert.equal(h.element('startupBtn').disabled,true);
  await h.run('clearTimeout(bluetooth.session.retryTimer);bluetooth.session.retryTimer=null;bluetooth.connect(bluetooth.session)');
  assert.equal(h.run('syncing'),true);assert.equal(h.element('startupBtn').disabled,false);
  assert.equal(h.chooserCalls.length,1);
});

test('Stop during pending startup prevents late chooser result from starting sync', async t=>{
  let finish;const h=harness(t,{saved:savedSpotify(),requestDevice:()=>new Promise(resolve=>{finish=resolve;})});
  const startup=h.run('startAlbumGlow()');h.element('stopBtn').onclick();finish(h.device);await startup;
  assert.equal(h.run('syncing'),false);assert.equal(h.run('startupRequest'),null);
});

test('manual hex colors send exact RGB without Spotify, even when vivid mode is enabled', async t=>{
  const h=harness(t);await h.connect();h.element('vividColors').checked=true;
  await h.run('applyManualColor("#E82838")');
  assert.deepEqual(h.writes.at(-1),[0x78,232,40,56,0,0xf0,0xee]);
  assert.equal(h.run('syncing'),false);assert.equal(h.requests.length,0);
  assert.equal(h.context.localStorage.getItem('albumglow_manual_color'),'#E82838');
});

test('manual color cancels a pending startup and is applied when Bluetooth becomes ready', async t=>{
  let finish;const h=harness(t,{saved:savedSpotify(),requestDevice:()=>new Promise(resolve=>{finish=resolve;})});
  const startup=h.run('startAlbumGlow()');await h.run('applyManualColor("#0000FF")');finish(h.device);await startup;await settle();
  assert.equal(h.run('syncing'),false);assert.equal(h.requests.length,0);
  assert.deepEqual(h.writes.at(-1),[0x78,0,0,255,0,0xf0,0xee]);
});

test('manual shorthand hex honors saved brightness and pauses Spotify', async t=>{
  const h=harness(t,{saved:{...savedSpotify(),albumglow_brightness:'50'}});await h.connect();
  h.run('startSync()');await h.run('applyManualColor("0f8")');
  assert.equal(h.run('syncing'),false);assert.equal(h.run('syncTimer'),null);
  assert.deepEqual(h.writes.at(-1),[0x78,0,128,68,0,0xf0,0xee]);
  assert.equal(h.element('manualHex').value,'#00FF88');
});

test('invalid hex does not send a command or stop an active Spotify sync', async t=>{
  const h=harness(t,{saved:savedSpotify()});await h.connect();h.run('startSync()');
  await h.run('applyManualColor("#GG0000")');
  assert.equal(h.run('syncing'),true);assert.equal(h.writes.length,0);
  assert.equal(h.element('manualHex').getAttribute('aria-invalid'),'true');
});

test('picker edits update LEDs without an Apply button and keep the hex field in sync', async t=>{
  const h=harness(t);await h.connect();
  h.element('manualPicker').oninput({target:{value:'#124578'}});
  assert.equal(h.element('manualHex').value,'#124578');
  await h.run('flushManualColorInput()');
  assert.deepEqual(h.writes.at(-1),[0x78,18,69,120,0,0xf0,0xee]);
});

test('manual color selected while off is restored on power-on without a Spotify request', async t=>{
  const h=harness(t);await h.connect();await h.run('setLedPower(false)');const count=h.writes.length;
  await h.run('applyManualColor("#112233")');assert.equal(h.writes.length,count);
  assert.match(h.element('manualStatus').textContent,/saved for when/);
  await h.run('setLedPower(true)');
  assert.deepEqual(h.writes.at(-1),[0x78,17,34,51,0,0xf0,0xee]);assert.equal(h.requests.length,0);
});

test('manual color can be picked before connecting Bluetooth and applies on connection', async t=>{
  const h=harness(t);await h.run('applyManualColor("#FFCC88")');
  assert.equal(h.writes.length,0);assert.match(h.element('manualStatus').textContent,/connect Bluetooth/);
  await h.connect();await settle();
  assert.deepEqual(h.writes.at(-1),[0x78,255,204,136,0,0xf0,0xee]);
});

test('manual mode ignores stale Spotify playback response and prevents LED override', async t=>{
  const h=harness(t,{saved:savedSpotify()});await h.connect();h.run('syncing=true');
  let finish;h.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
  const poll=h.run('checkSpotify()');await settle();await h.run('applyManualColor("#0000FF")');
  finish({status:204,ok:true,headers:{get:()=>null}});await poll;
  assert.equal(h.element('syncStatus').textContent,'Not syncing');
  assert.deepEqual(h.writes,[[0x78,0,0,255,0,0xf0,0xee]]);
});

test('manual mode cancels an already queued Spotify color', async t=>{
  const h=harness(t,{saved:savedSpotify()});await h.connect();h.run('syncing=true');
  let release;h.c.writeValueWithoutResponse=frame=>{h.writes.push([...frame]);return new Promise(resolve=>{release=resolve;});};
  const first=h.run('sendFrame(new Uint8Array([1]))');await settle();
  const old=h.run('sendLedRgb(255,0,0,{valid:()=>syncing})');const cancelled=assert.rejects(old,{name:'AbortError'});
  const manual=h.run('applyManualColor("#00FF00")');release();await first;await cancelled;await settle();release();await manual;
  assert.deepEqual(h.writes,[[1],[0x78,0,255,0,0,0xf0,0xee]]);
});

test('resume Spotify after a manual color starts a fresh album update without mandatory testing', async t=>{
  const h=harness(t,{saved:savedSpotify()});await h.connect();await h.run('applyManualColor("#FF0000")');
  h.run('currentAlbum="old";startSync()');
  assert.equal(h.run('syncing'),true);assert.equal(h.run('currentAlbum'),'');
  assert.equal(h.run('manualRequested'),false);assert.equal(h.element('confirmed').checked,false);
});

test('retry exhaustion releases one-click startup rather than leaving its button stuck', async t=>{
  const h=harness(t,{saved:savedSpotify()});
  h.device.gatt.connect=async()=>{throw new DOMException('not available','NetworkError');};
  await h.run('startAlbumGlow()');
  await h.run('clearTimeout(bluetooth.session.retryTimer);bluetooth.session.retryTimer=null;bluetooth.session.attempts=4;bluetooth.connect(bluetooth.session)');
  assert.equal(h.element('startupBtn').disabled,false);assert.equal(h.run('startupRequest'),null);
  assert.equal(h.run('syncing'),false);assert.match(h.element('startupStatus').textContent,/Automatic retries stopped/);
});

test('Choose different lights bypasses the stored grant and requests fresh permission', async t=>{
  const h=harness(t,{saved:{albumglow_device:'mock'},getDevices:device=>Promise.resolve([device])});
  await settle();await h.connect();assert.equal(h.chooserCalls.length,0);
  await h.run('pickBluetooth({forceChooser:true})');assert.equal(h.chooserCalls.length,1);
});

test('choosing the already-ready controller keeps its session, characteristics, and Spotify sync', async t=>{
  fakeTime(t);const h=harness(t,{saved:savedSpotify()});await h.connect();
  h.run('startSync()');h.element('confirmed').checked=true;
  const session=h.run('bluetooth.session'),characteristic=h.run('char');
  let connects=0,disconnects=0;
  h.device.gatt.connect=async()=>{connects++;throw Error('Existing connection must be reused');};
  const disconnect=h.device.gatt.disconnect;
  h.device.gatt.disconnect=function(){disconnects++;return disconnect.call(this);};
  // Chrome may return another wrapper for the same permitted device ID.
  const picked={...h.device,gatt:{connected:false,connect:()=>{throw Error('Do not replace the ready wrapper');}}};
  h.context.navigator.bluetooth.requestDevice=async()=>picked;
  assert.equal(await h.run('pickBluetooth({forceChooser:true})'),true);
  assert.equal(h.run('bluetooth.session'),session);assert.equal(h.run('device'),h.device);
  assert.equal(h.run('char'),characteristic);assert.equal(h.run('syncing'),true);
  assert.equal(h.element('confirmed').checked,true);assert.equal(connects,0);assert.equal(disconnects,0);
});

test('an old-session recovery during a pending chooser completes startup without reconnecting again', async t=>{
  fakeTime(t);const h=harness(t,{saved:savedSpotify()});await h.connect();
  const session=h.run('bluetooth.session');let connects=0,finish;
  const connect=h.device.gatt.connect;
  h.device.gatt.connect=function(){connects++;return connect.call(this);};
  h.device.gatt.disconnect();
  h.context.navigator.bluetooth.requestDevice=()=>new Promise(resolve=>{finish=resolve;});
  h.run('startupRequest={deviceId:null}');
  const pick=h.run('pickBluetooth({startup:startupRequest,forceChooser:true})');
  await h.run('clearTimeout(bluetooth.session.retryTimer);bluetooth.session.retryTimer=null;bluetooth.connect(bluetooth.session)');
  assert.notEqual(h.run('startupRequest'),null);
  finish(h.device);assert.equal(await pick,true);
  assert.equal(h.run('bluetooth.session'),session);assert.equal(connects,1);
  assert.equal(h.run('startupRequest'),null);assert.equal(h.run('syncing'),true);
});

test('choosing a different controller still replaces the old session and stops its Spotify sync', async t=>{
  fakeTime(t);const h=harness(t,{saved:savedSpotify()});await h.connect();h.run('startSync()');
  const oldSession=h.run('bluetooth.session');h.element('confirmed').checked=true;
  const picked={...h.device,id:'second-controller',gatt:{...h.device.gatt,connected:false}};
  h.context.navigator.bluetooth.requestDevice=async()=>picked;
  assert.equal(await h.run('pickBluetooth({forceChooser:true})'),true);
  assert.notEqual(h.run('bluetooth.session'),oldSession);assert.equal(h.run('device'),picked);
  assert.equal(h.device.gatt.connected,false);assert.equal(picked.gatt.connected,true);
  assert.equal(h.run('syncing'),false);assert.equal(h.element('confirmed').checked,false);
});

test('a late saved-device preload preserves newer chooser grants and device objects', async t=>{
  let finish;const h=harness(t,{getDevices:()=>new Promise(resolve=>{finish=resolve;})});
  await h.connect();assert.equal(h.chooserCalls.length,1);
  const olderWrapper={...h.device,gatt:{connected:false}};
  finish([olderWrapper,{id:'another-approved-device'}]);await settle();
  assert.equal(h.run('grantedDevices.find(d=>d.id==="mock")'),h.device);
  assert.equal(h.run('grantedDevices.length'),2);
  h.run('btDisconnect()');await h.connect();
  assert.equal(h.chooserCalls.length,1);assert.equal(h.device.gatt.connected,true);
});

test('leaving the page cancels pending startup and ignores a late chooser result', async t=>{
  let finish;const h=harness(t,{saved:savedSpotify(),requestDevice:()=>new Promise(resolve=>{finish=resolve;})});
  const startup=h.run('startAlbumGlow()');assert.notEqual(h.run('startupRequest'),null);
  h.dispatchWindow('pagehide',{persisted:true});
  assert.equal(h.run('startupRequest'),null);assert.equal(h.run('syncing'),false);
  finish(h.device);await startup;
  assert.equal(h.device.gatt.connected,false);assert.equal(h.run('bluetooth.session'),null);
});

test('leaving a connected page cancels live color and brightness timers without retrying', async t=>{
  fakeTime(t);const h=harness(t);await h.connect();
  h.run('setLedBrightness(40);queueManualColor("#00FF00")');
  assert.notEqual(h.run('brightnessTimer'),null);assert.notEqual(h.run('manualInputTimer'),null);
  h.dispatchWindow('pagehide');t.mock.timers.tick(60000);await settle();
  assert.equal(h.run('brightnessTimer'),null);assert.equal(h.run('manualInputTimer'),null);
  assert.equal(h.run('pendingManualInput'),null);assert.equal(h.run('char'),null);
  assert.equal(h.run('bluetooth.session'),null);assert.equal(h.device.gatt.connected,false);
  assert.equal(h.writes.length,0);
});

test('leaving a syncing page clears its poll while visibility changes keep Bluetooth connected', async t=>{
  fakeTime(t);const h=harness(t,{saved:savedSpotify()});await h.connect();h.run('startSync()');
  const characteristic=h.run('char');
  h.context.document.hidden=true;h.dispatchDocument('visibilitychange');
  h.context.document.hidden=false;h.dispatchDocument('visibilitychange');
  assert.equal(h.device.gatt.connected,true);assert.equal(h.run('char'),characteristic);
  assert.equal(h.run('syncing'),true);assert.notEqual(h.run('syncTimer'),null);
  h.dispatchWindow('pagehide');
  assert.equal(h.run('syncing'),false);assert.equal(h.run('syncTimer'),null);
  assert.equal(h.device.gatt.connected,false);
});

test('stale JSON decoding cannot mark manual mode as Spotify syncing', async t=>{
  const h=harness(t,{saved:savedSpotify()});await h.connect();h.run('syncing=true');
  let finish;h.context.fetch=async()=>({status:200,ok:true,headers:{get:()=>null},json:()=>new Promise(resolve=>{finish=resolve;})});
  const poll=h.run('checkSpotify()');await settle();await h.run('applyManualColor("#00FF00")');finish({});await poll;
  assert.equal(h.element('syncStatus').textContent,'Not syncing');assert.equal(h.run('syncing'),false);
});

test('repeated first-time startup clicks cannot race OAuth state and PKCE verifier storage', async t=>{
  const h=harness(t,{saved:{albumglow_client:'a'.repeat(32)}});
  const first=h.run('startAlbumGlow()');await h.run('startAlbumGlow()');await h.run('spotifyConnect()');await first;
  assert.equal(h.redirects.length,1);assert.equal(h.chooserCalls.length,0);
  const params=new URL(h.redirects[0]).searchParams;
  assert.equal(params.get('state'),h.context.sessionStorage.getItem('ag_state'));
  assert.equal(h.element('startupBtn').disabled,true);assert.equal(h.element('spotifyBtn').disabled,true);
});

test('a blocked frame permissions policy prevents Bluetooth selection and gives direct-tab guidance', async t=>{
  const h=harness(t,{saved:savedSpotify()});
  h.context.document.permissionsPolicy={allowsFeature:feature=>feature!=='bluetooth'};
  await h.run('startAlbumGlow()');
  assert.equal(h.chooserCalls.length,0);assert.equal(h.device.gatt.connected,false);
  assert.match(h.element('alert').textContent,/own Chrome tab/);
  assert.equal(h.element('startupBtn').disabled,false);
});

test('Chrome featurePolicy fallback detects a blocked Bluetooth context', async t=>{
  const h=harness(t);h.context.document.featurePolicy={allowsFeature:()=>false};
  await h.connect();assert.equal(h.chooserCalls.length,0);
  assert.match(h.element('alert').textContent,/Embedded previews/);
});

test('an unrecognized policy feature does not produce a false Bluetooth-blocked message', async t=>{
  const h=harness(t);h.context.document.featurePolicy={features:()=>['camera'],allowsFeature:()=>false};
  await h.connect();assert.equal(h.chooserCalls.length,1);assert.equal(h.device.gatt.connected,true);
});

function fakeTime(t){t.mock.timers.enable({apis:['setTimeout','Date'],now:0});}

test('brightness uses the unscaled color remembered for this controller after a reload', async t=>{
  fakeTime(t);
  const h=harness(t,{saved:{albumglow_last_rgb_v1:JSON.stringify({deviceId:'mock',rgb:[18,170,238]}),albumglow_brightness:'50'}});
  await h.connect();assert.equal(h.writes.length,0); // No unsolicited initialization color.
  h.run('setLedBrightness(25)');t.mock.timers.tick(250);await settle();
  assert.deepEqual(h.writes.at(-1),[0x78,5,43,60,0,0xf0,0xee]);
  assert.deepEqual(JSON.parse(h.context.localStorage.getItem('albumglow_last_rgb_v1')).rgb,[18,170,238]);
});

test('brightness migrates the previous preview manual color without selecting it again', async t=>{
  fakeTime(t);
  const h=harness(t,{saved:{albumglow_device:'mock',albumglow_manual_color:'#12AAEE'}});await h.connect();
  h.run('setLedBrightness(50)');t.mock.timers.tick(250);await settle();
  assert.deepEqual(h.writes.at(-1),[0x78,9,85,119,0,0xf0,0xee]);
});

test('all successful website RGB commands remember raw color, not brightness-scaled bytes', async t=>{
  const h=harness(t,{saved:{albumglow_brightness:'50'}});await h.connect();await h.run('sendLedRgb(200,100,50)');
  assert.deepEqual(h.writes.at(-1),[0x78,100,50,25,0,0xf0,0xee]);
  assert.deepEqual(JSON.parse(h.context.localStorage.getItem('albumglow_last_rgb_v1')),{deviceId:'mock',rgb:[200,100,50]});
});

test('a cancelled RGB write cannot replace the remembered color', async t=>{
  const h=harness(t);await h.connect();await h.run('sendLedRgb(0,0,255)');
  await assert.rejects(h.run('sendLedRgb(255,0,0,{valid:()=>false})'),{name:'AbortError'});
  assert.deepEqual(JSON.parse(h.context.localStorage.getItem('albumglow_last_rgb_v1')).rgb,[0,0,255]);
});

test('a different device color is not treated as the current controller state', async t=>{
  fakeTime(t);
  const h=harness(t,{saved:{albumglow_last_rgb_v1:JSON.stringify({deviceId:'other-device',rgb:[0,0,255]})}});await h.connect();
  h.run('setLedBrightness(20)');assert.match(h.element('ledControlsStatus').textContent,/selected #FF0000/);
  t.mock.timers.tick(250);await settle();assert.deepEqual(h.writes.at(-1),[0x78,51,0,0,0,0xf0,0xee]);
});

test('brightness chosen while disconnected applies the remembered RGB when connecting', async t=>{
  fakeTime(t);
  const h=harness(t,{saved:{albumglow_last_rgb_v1:JSON.stringify({deviceId:'mock',rgb:[0,200,100]})}});
  h.run('setLedBrightness(50)');assert.equal(h.writes.length,0);
  await h.connect();t.mock.timers.tick(250);await settle();
  assert.deepEqual(h.writes.at(-1),[0x78,0,100,50,0,0xf0,0xee]);
});

test('brightness while software-off preserves color for power-on without sending an RGB command', async t=>{
  fakeTime(t);
  const h=harness(t,{saved:{albumglow_last_rgb_v1:JSON.stringify({deviceId:'mock',rgb:[100,200,50]})}});await h.connect();
  await h.run('setLedPower(false)');const count=h.writes.length;
  h.run('setLedBrightness(50)');t.mock.timers.tick(250);await settle();assert.equal(h.writes.length,count);
  await h.run('setLedPower(true)');assert.deepEqual(h.writes.at(-1),[0x78,50,100,25,0,0xf0,0xee]);
});

test('malformed saved RGB cannot generate invalid color bytes', async t=>{
  fakeTime(t);
  const h=harness(t,{saved:{albumglow_last_rgb_v1:JSON.stringify({deviceId:'mock',rgb:[256,-1,'blue']})}});await h.connect();
  assert.equal(h.run('lastLedRgb'),null);
  h.run('setLedBrightness(50)');t.mock.timers.tick(250);await settle();
  assert.deepEqual(h.writes.at(-1),[0x78,128,0,0,0,0xf0,0xee]);
});

test('live picker changes are paced and coalesce to the latest value during a drag', async t=>{
  fakeTime(t);const h=harness(t);await h.connect();
  const at=[];const original=h.c.writeValueWithoutResponse;
  h.c.writeValueWithoutResponse=async function(frame){at.push(Date.now());return original.call(this,frame);};
  h.element('manualPicker').oninput({target:{value:'#FF0000'}});t.mock.timers.tick(0);await settle();
  for(const color of ['#FF8800','#00FF00','#0000FF']){
    t.mock.timers.tick(50);h.element('manualPicker').oninput({target:{value:color}});
  }
  t.mock.timers.tick(49);await settle();assert.equal(h.writes.length,1);
  t.mock.timers.tick(1);await settle();
  assert.deepEqual(at,[0,200]);assert.deepEqual(h.writes.at(-1),[0x78,0,0,255,0,0xf0,0xee]);
});

test('typing six-digit hex preserves the field and applies the final RGB automatically', async t=>{
  fakeTime(t);const h=harness(t);await h.connect();
  for(const value of ['#','#1','#12','#123','#1234','#12345','#123456']){
    h.element('manualHex').value=value;h.element('manualHex').oninput({target:h.element('manualHex')});
    assert.equal(h.element('manualHex').value,value);
  }
  t.mock.timers.tick(0);await settle();
  assert.deepEqual(h.writes,[[0x78,18,52,86,0,0xf0,0xee]]);
  assert.equal(h.element('manualPicker').value,'#123456');
});

test('invalid partial hex cancels unsent input without sending black or malformed bytes', async t=>{
  fakeTime(t);const h=harness(t);await h.connect();
  await h.run('applyManualColor("#0000FF")');
  h.element('manualHex').value='#123';h.element('manualHex').oninput({target:h.element('manualHex')});
  h.element('manualHex').value='#1234';h.element('manualHex').oninput({target:h.element('manualHex')});
  t.mock.timers.tick(500);await settle();assert.equal(h.writes.length,1);
  assert.equal(h.element('manualHex').getAttribute('aria-invalid'),'true');
});

test('picker change/hex blur does not resend a color already applied by input', async t=>{
  fakeTime(t);const h=harness(t);await h.connect();
  h.element('manualPicker').oninput({target:{value:'#12ABEF'}});t.mock.timers.tick(0);await settle();
  h.element('manualPicker').onchange({target:{value:'#12ABEF'}});t.mock.timers.tick(500);await settle();
  assert.equal(h.writes.length,1);
});

test('resuming Spotify cancels a pending live manual color', async t=>{
  fakeTime(t);const h=harness(t,{saved:savedSpotify()});await h.connect();
  h.element('manualPicker').oninput({target:{value:'#FF0000'}});
  h.run('startSync()');t.mock.timers.tick(500);await settle();
  assert.equal(h.run('syncing'),true);assert.equal(h.writes.length,0);
});

test('a preset cancels a pending picker value so it cannot overwrite the preset later', async t=>{
  fakeTime(t);const h=harness(t);await h.connect();
  h.element('manualPicker').oninput({target:{value:'#FF0000'}});
  await h.run('applyManualColor("#00FF00")');t.mock.timers.tick(500);await settle();
  assert.deepEqual(h.writes,[[0x78,0,255,0,0,0xf0,0xee]]);
});

test('Copy log copies the complete current text, including entries outside the visible scroll area', async t=>{
  const h=harness(t);h.run('for(let i=0;i<240;i++)log("Line "+i)');
  const expected=h.element('log').textContent;let copied;
  h.context.navigator.clipboard={writeText:async text=>{copied=text;}};
  await h.element('copyLogBtn').onclick();
  assert.equal(copied,expected);assert.match(copied,/Line 0/);assert.match(copied,/Line 239/);
  assert.match(h.element('logCopyStatus').textContent,/Log copied/);
  assert.equal(h.element('copyLogBtn').disabled,false);
});

test('Copy log exposes a selected manual fallback when browser clipboard access fails', async t=>{
  const h=harness(t);h.context.navigator.clipboard={writeText:async()=>{throw new Error('blocked');}};
  h.context.document.execCommand=()=>false;
  await h.run('copyConnectionLog()');
  assert.equal(h.element('logCopyFallback').hidden,false);
  assert.equal(h.element('logCopyText').value,h.element('log').textContent);
  assert.equal(h.element('logCopyText').focused,true);
  assert.match(h.element('logCopyStatus').textContent,/Ctrl\+C/);
  assert.equal(h.element('copyLogBtn').disabled,false);
});

test('Copy log falls back to browser selection copy when Clipboard API is unavailable', async t=>{
  const h=harness(t);h.context.document.execCommand=command=>command==='copy';
  await h.run('copyConnectionLog()');
  assert.equal(h.element('logCopyFallback').hidden,true);assert.match(h.element('logCopyStatus').textContent,/Log copied/);
});

function serialFixture({granted=true,state={on:true,bri:255,seg:[{col:[[18,52,86]]}]}}={}){
  const writes=[],events={connect:new Set(),disconnect:new Set()};let input,choosers=0,opens=0,closes=0;
  const port={getInfo:()=>({usbVendorId:0x1a86,usbProductId:0x7523}),
    async open(){
      opens++;
      this.readable=new ReadableStream({start(controller){input=controller;}});
      this.writable=new WritableStream({write(bytes){
        const text=new TextDecoder().decode(bytes);writes.push(text);
        if(text==='{\"v\":true}\n')input.enqueue(new TextEncoder().encode(JSON.stringify({info:{ver:'0.16.0'},state})+'\n'));
      }});
    },
    async close(){closes++;this.readable=null;this.writable=null;}
  };
  const serial={getPorts:async()=>granted?[port]:[],requestPort(){choosers++;return Promise.resolve(port);},
    addEventListener:(name,listener)=>events[name].add(listener),removeEventListener:(name,listener)=>events[name].delete(listener)};
  return {serial,port,writes,drop(){for(const listener of [...events.disconnect])listener({port});},
    plug(connected=port){for(const listener of [...events.connect])listener({port:connected});},
    get choosers(){return choosers;},get opens(){return opens;},get closes(){return closes;}};
}
const usbSaved=()=>({albumglow_controller:'sp803e',albumglow_usb_info:JSON.stringify({usbVendorId:0x1a86,usbProductId:0x7523})});

test('the controller choice defaults to Apollo and rejects unknown stored profiles', t=>{
  const h=harness(t,{saved:{albumglow_controller:'__proto__'}});
  assert.equal(h.element('controllerProfile').value,'apollo');assert.equal(h.element('btBtn').textContent,'Connect Bluetooth');
  assert.equal(h.element('controllerSummary').textContent,'Apollo · Bluetooth');
});

test('changing the controller stops sync, disconnects, and keeps Spotify/general settings', async t=>{
  const saved={...savedSpotify(),albumglow_brightness:'40',albumglow_manual_color:'#123456'};
  const h=harness(t,{saved});await h.connect();h.run('startSync()');
  h.element('controllerProfile').value='sp630e';h.element('controllerProfile').onchange();
  assert.equal(h.run('syncing'),false);assert.equal(h.device.gatt.connected,false);
  assert.equal(h.run('bluetooth.session'),null);assert.equal(h.run('lastLedRgb'),null);
  assert.equal(h.context.localStorage.getItem('albumglow_controller'),'sp630e');
  for(const [key,value] of Object.entries(saved))assert.equal(h.context.localStorage.getItem(key),value);
  assert.match(h.element('controllerHelp').textContent,/PWM RGB/);
});

test('SP630E selects its endpoint and sends a complete static-color batch without Apollo bytes', async t=>{
  const h=harness(t,{saved:{albumglow_controller:'sp630e',albumglow_brightness:'50'}});await h.connect();
  assert.equal(h.chooserCalls[0][0].acceptAllDevices,true);
  assert.equal(h.chooserCalls[0][0].optionalServices.length,2);
  assert.equal(h.writes.length,0);await h.run('applyManualColor("#FF0080")');
  assert.deepEqual(h.writes,[[0x53,0x53,0,1,0,2,1,1],[0x53,0x52,0,1,0,4,128,0,64,255]]);
  assert.deepEqual(JSON.parse(h.context.localStorage.getItem('albumglow_last_rgb_v1')),{deviceId:'mock',rgb:[255,0,128],profile:'sp630e'});
  assert.equal(h.run('syncing'),false);
});

test('SP630E power preserves off suppression and restores the manual color on power-on', async t=>{
  const h=harness(t,{saved:{albumglow_controller:'sp630e'}});await h.connect();
  await h.run('setLedPower(false)');assert.deepEqual(h.writes.at(-1),[0x53,0x50,0,1,0,1,0]);
  const count=h.writes.length;await h.run('applyManualColor("#0000FF")');assert.equal(h.writes.length,count);
  await h.run('setLedPower(true)');
  assert.deepEqual(h.writes.slice(-3),[[0x53,0x50,0,1,0,1,1],[0x53,0x53,0,1,0,2,1,1],[0x53,0x52,0,1,0,4,0,0,255,255]]);
});

test('SP630E saved devices and verified endpoints do not replace Apollo settings', async t=>{
  const h=harness(t,{saved:{albumglow_device:'original-apollo',albumglow_controller:'sp630e'}});await h.connect();
  await h.run('testColor(255,0,0)');h.element('confirmed').checked=true;h.element('confirmed').onchange();
  assert.equal(h.context.localStorage.getItem('albumglow_device'),'original-apollo');
  assert.equal(h.context.localStorage.getItem('albumglow_sp630e_device'),'mock');
  assert.ok(h.context.localStorage.getItem('albumglow_sp630e_endpoint_v1'));
  assert.equal(h.context.localStorage.getItem('albumglow_ble_endpoint_v1'),null);
});

test('SP630E connection failure retains bounded retries without sending protocol packets', async t=>{
  const h=harness(t,{saved:{albumglow_controller:'sp630e'}});let attempts=0;
  h.device.gatt.connect=async()=>{attempts++;throw new DOMException('native failure','NetworkError');};
  await h.connect();
  for(let i=0;i<4;i++)await h.run('clearTimeout(bluetooth.session.retryTimer);bluetooth.session.retryTimer=null;bluetooth.connect(bluetooth.session)');
  assert.equal(attempts,5);assert.equal(h.writes.length,0);assert.equal(h.run('char'),null);
  assert.match(h.element('btStatus').textContent,/Automatic retries stopped/);
});

test('USB manual controls identify WLED first and never request Bluetooth', async t=>{
  const f=serialFixture();const h=harness(t,{serial:f.serial,saved:usbSaved()});await settle();
  assert.equal(h.element('btBtn').textContent,'Connect USB');assert.equal(h.element('confirmed').disabled,true);
  await h.run('pickLights()');assert.equal(f.choosers,0);assert.equal(h.chooserCalls.length,0);
  assert.equal(h.run('lightsReady()'),true);assert.equal(h.run('char'),null);
  assert.deepEqual(f.writes,['{"v":true}\n']);
  await h.run('applyManualColor("#00FF80")');
  assert.deepEqual(JSON.parse(f.writes.at(-1)).seg[0].col[0],[0,255,128]);assert.equal(h.writes.length,0);
});

test('USB brightness keeps unscaled color history and power-off suppresses manual writes', async t=>{
  fakeTime(t);const f=serialFixture();const h=harness(t,{serial:f.serial,saved:usbSaved()});await settle();await h.run('pickLights()');
  h.run('usb.writeGap=0');await h.run('applyManualColor("#12AAEE")');
  h.run('setLedBrightness(50)');t.mock.timers.tick(250);await settle();
  assert.deepEqual(JSON.parse(f.writes.at(-1)).seg[0].col[0],[9,85,119]);
  assert.deepEqual(JSON.parse(h.context.localStorage.getItem('albumglow_last_rgb_v1')).rgb,[18,170,238]);
  await h.run('setLedPower(false)');assert.equal(JSON.parse(f.writes.at(-1)).on,false);
  const count=f.writes.length;await h.run('applyManualColor("#0000FF")');assert.equal(f.writes.length,count);
  await h.run('setLedPower(true)');assert.deepEqual(JSON.parse(f.writes.at(-1)).seg[0].col[0],[0,0,128]);
});

test('USB uses reported WLED power state without an initialization power/color command', async t=>{
  const f=serialFixture({state:{on:false,bri:0,seg:[{col:[[1,2,3]]}]}});
  const h=harness(t,{serial:f.serial,saved:usbSaved()});await settle();await h.run('pickLights()');
  assert.equal(h.run('ledIsOn'),false);assert.equal(h.element('ledPowerBtn').textContent,'Turn LEDs on');
  assert.deepEqual(f.writes,['{"v":true}\n']);
  await h.run('applyManualColor("#FF0000")');assert.equal(f.writes.length,1);
});

test('one-click USB startup uses the saved port and starts Spotify after identity succeeds', async t=>{
  fakeTime(t);const f=serialFixture();const h=harness(t,{serial:f.serial,saved:{...savedSpotify(),...usbSaved()}});await settle();
  await h.run('startAlbumGlow()');assert.equal(h.run('syncing'),true);
  assert.equal(f.choosers,0);assert.equal(h.chooserCalls.length,0);
  assert.equal(h.run('startupRequest'),null);assert.equal(h.element('startupBtn').disabled,false);
  assert.equal(h.element('redirect').value,'https://cosmic-snickerdoodle-3a661b.netlify.app/');
});

test('first USB connection requests a port synchronously from the click gesture', async t=>{
  const f=serialFixture({granted:false});const h=harness(t,{serial:f.serial,saved:{albumglow_controller:'sp803e'}});
  const pick=h.run('pickLights()');assert.equal(f.choosers,1);await pick;
  assert.equal(h.run('lightsReady()'),true);assert.equal(h.chooserCalls.length,0);
});

test('multiple permitted USB ports with identical IDs require a chooser instead of guessing', async t=>{
  const f=serialFixture();f.serial.getPorts=async()=>[f.port,{getInfo:f.port.getInfo}];
  const h=harness(t,{serial:f.serial,saved:usbSaved()});await settle();await h.run('pickLights()');
  assert.equal(f.choosers,1);
});

test('USB access errors and frame policy restrictions give guidance without a chooser', async t=>{
  const h=harness(t,{saved:{albumglow_controller:'sp803e'}});await h.run('pickLights()');
  assert.match(h.element('alert').textContent,/USB serial is unavailable/);assert.equal(h.element('btBtn').disabled,false);
  const f=serialFixture();const blocked=harness(t,{serial:f.serial,saved:usbSaved()});
  blocked.context.document.permissionsPolicy={allowsFeature:()=>false};await blocked.run('pickLights()');
  assert.equal(f.choosers,0);assert.equal(f.opens,0);assert.match(blocked.element('alert').textContent,/own Chrome tab/);
});

test('leaving the page invalidates a pending USB chooser and cannot reconnect late', async t=>{
  const f=serialFixture({granted:false});let finish;f.serial.requestPort=()=>new Promise(resolve=>{finish=resolve;});
  const h=harness(t,{serial:f.serial,saved:{albumglow_controller:'sp803e'}});
  const pick=h.run('pickLights()');h.dispatchWindow('pagehide');finish(f.port);await pick;
  assert.equal(f.opens,0);assert.equal(h.run('usb.session'),null);
});

test('a late USB grant preload does not replace the newer chosen port', async t=>{
  const f=serialFixture({granted:false});let finish;f.serial.getPorts=()=>new Promise(resolve=>{finish=resolve;});
  const h=harness(t,{serial:f.serial,saved:usbSaved()});await h.run('pickLights()');
  finish([{getInfo:f.port.getInfo}]);await settle();
  assert.equal(h.run('grantedPorts[0]'),f.port);
  h.run('btDisconnect()');await h.run('usb.operations');await h.run('pickLights()');assert.equal(f.choosers,1);
});

test('USB cable loss pauses Spotify and a user reconnect resumes the previous sync intent', async t=>{
  fakeTime(t);const f=serialFixture();const h=harness(t,{serial:f.serial,saved:{...usbSaved(),...savedSpotify()}});await settle();
  await h.run('startAlbumGlow()');f.drop();await h.run('usb.operations');
  assert.equal(h.run('syncing'),true);assert.equal(h.run('lightsReady()'),false);
  assert.match(h.element('syncStatus').textContent,/waiting for USB/);
  await h.run('pickLights()');assert.equal(h.run('syncing'),true);assert.equal(h.run('lightsReady()'),true);
  h.run('btDisconnect()');assert.equal(h.run('syncing'),false);
});

test('a USB replug refreshes granted ports instead of reopening a stale disconnected wrapper',async t=>{
  const f=serialFixture();const h=harness(t,{serial:f.serial,saved:usbSaved()});await settle();await h.run('pickLights()');
  f.drop();await h.run('usb.operations');assert.equal(h.run('grantedPorts.length'),0);
  const replacement=serialFixture();f.serial.getPorts=async()=>[replacement.port];f.plug(replacement.port);await settle();
  await h.run('pickLights()');
  assert.equal(h.run('usb.session.port'),replacement.port);assert.equal(replacement.opens,1);
  assert.equal(f.opens,1);assert.equal(f.choosers,0);
});

test('switching away from USB clears stale port state and uses the next controller protocol', async t=>{
  const f=serialFixture();const h=harness(t,{serial:f.serial,saved:usbSaved()});await settle();await h.run('pickLights()');
  await h.run('applyManualColor("#FF0000")');const count=f.writes.length;
  h.run('changeController("sp630e")');await h.run('usb.operations');
  assert.equal(f.closes,1);assert.equal(h.run('usb.session'),null);assert.equal(h.run('syncing'),false);
  await h.connect();await h.run('applyManualColor("#00FF00")');
  assert.equal(f.writes.length,count);assert.deepEqual(h.writes.at(-1),[0x53,0x52,0,1,0,4,0,255,0,255]);
});

test('switching profiles during a pending Bluetooth connect ignores its late success', async t=>{
  const f=serialFixture();const h=harness(t,{serial:f.serial});let finish;
  h.device.gatt.connect=function(){return new Promise(resolve=>{finish=()=>{this.connected=true;resolve(this);};});};
  const old=h.run('pickLights()');await settle();h.run('changeController("sp803e")');finish();await old;
  assert.equal(h.device.gatt.connected,false);assert.equal(h.run('char'),null);
  await h.run('pickLights()');assert.equal(h.run('usb.session.ready'),true);assert.equal(h.writes.length,0);
});

const newAlbum=()=>({item:{name:'Controller test song',artists:[{name:'Test artist'}],album:{id:'controller-album',name:'Controller album',images:[{url:'https://i.scdn.co/image/test'}]}}});
for(const model of ['sp630e','sp803e'])test('Spotify playback sends the vivid artwork color through '+model,async t=>{
  const f=serialFixture();const h=harness(t,{serial:f.serial,saved:{...savedSpotify(),albumglow_controller:model},
    fetch:async()=>({status:200,ok:true,headers:{get:()=>null},json:async()=>newAlbum()})});
  await h.run('pickLights()');h.run('usb.writeGap=0;coverLoad=async()=>({});extractColor=()=>[232,40,56];syncing=true');
  await h.run('checkSpotify()');assert.equal(h.run('currentAlbum'),'controller-album');
  assert.equal(h.element('colorCode').textContent,'#E80000 target color');
  if(model==='sp630e')assert.deepEqual(h.writes.at(-1),[0x53,0x52,0,1,0,4,232,0,0,255]);
  else{assert.equal(h.run('char'),null);assert.deepEqual(JSON.parse(f.writes.at(-1)).seg[0].col[0],[232,0,0]);}
});

test('Spotify fetched for a USB session cannot send a late color to the next Bluetooth controller',async t=>{
  const f=serialFixture();let finish;
  const h=harness(t,{serial:f.serial,saved:{...savedSpotify(),...usbSaved()},fetch:()=>new Promise(resolve=>{finish=resolve;})});
  await settle();await h.run('pickLights()');h.run('coverLoad=async()=>({});extractColor=()=>[232,40,56];syncing=true');
  const poll=h.run('checkSpotify()');await settle();h.run('changeController("sp630e")');await h.connect();
  finish({status:200,ok:true,headers:{get:()=>null},json:async()=>newAlbum()});await poll;
  assert.equal(h.writes.length,0);assert.deepEqual(f.writes,['{"v":true}\n']);assert.equal(h.run('syncing'),false);
});
