'use strict';

// No controller UUID or command protocol is assumed here. The UI supplies frames.
class AlbumGlowBluetooth {
  constructor({log = () => {}, onState = () => {}, onReady = () => {},
    onClear = () => {}, onUnconfirmed = () => {}, storage = null,
    timers = globalThis, now = () => Date.now(), writeGap = 100,
    stableMs = 30000,
    ownership = typeof AlbumGlowTabOwnership === 'function' ? new AlbumGlowTabOwnership() : null} = {}) {
    Object.assign(this, {log, onState, onReady, onClear, onUnconfirmed,
      storage, timers, now, writeGap, stableMs, ownership});
    this.session = null;
    this.operations = Promise.resolve();
    this.pending = [];
    this.pumping = false;
    this.lastWriteAt = -Infinity;
    this.cacheKey = 'albumglow_ble_endpoint_v1';
    this.ownerBarrier = Promise.resolve();
    this.acquisition = Promise.resolve();
  }

  cachedEndpoint() {
    try {
      const value = JSON.parse(this.storage?.getItem(this.cacheKey) || 'null');
      const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
      return value && typeof value.deviceId === 'string' &&
        uuid.test(value.service) && uuid.test(value.characteristic) ? value : null;
    } catch { return null; }
  }

  // All GATT calls, including connect/discovery and writes, share this lane.
  exclusive(fn) {
    const result = this.operations.then(fn);
    this.operations = result.catch(() => {});
    return result;
  }

  active(s, generation = s.generation) {
    return this.session === s && s.generation === generation;
  }

  assertActive(s, generation) {
    if (!this.active(s, generation)) throw this.cancelled();
    if (!s.device.gatt.connected) throw new Error('Controller disconnected during GATT initialization');
  }

  cancelled() {
    const error = new Error('Bluetooth command cancelled: connection or selection changed');
    error.name = 'AbortError';
    return error;
  }

  clear(s) {
    s.ready = false;
    s.entries = [];
    s.characteristic = null;
    s.lastSuccessful = null;
    s.generation++;
    this.timers.clearTimeout(s.stableTimer);
    this.cancelPending();
    this.onClear();
  }

  cancelPending() {
    for (const command of this.pending.splice(0)) command.reject(this.cancelled());
  }

  acquireOwnership(s) {
    // A superseded acquisition must release its lease before the next one tries
    // ifAvailable. Otherwise this page can accidentally contend with itself.
    const acquire = this.acquisition.then(async () => {
      await this.ownerBarrier;
      if (!this.active(s)) return null;
      const lease = await this.ownership.acquire(s.device.id);
      if (!this.active(s)) {
        if (lease) {
          s.lease = lease;
          await this.releaseOwnership(s);
        }
        return null;
      }
      s.lease = lease;
      return lease;
    });
    this.acquisition = acquire.then(() => {}, () => {});
    return acquire;
  }

  releaseOwnership(s) {
    const lease = s.lease;
    if (!lease) return this.ownerBarrier;
    s.lease = null;
    // Disconnect invalidates pending work immediately, but a native promise may
    // still settle late. Keep ownership until its cleanup has finished; never
    // let a second page connect while that native operation is outstanding.
    const release = this.operations.then(() => lease.release());
    this.ownerBarrier = Promise.all([this.ownerBarrier, release]).then(() => {});
    // Keep a failed barrier rejected so we cannot silently bypass ownership,
    // while also handling it if the user simply disconnects and leaves.
    this.ownerBarrier.catch(error => this.log('BT: controller ownership could not be released — ' + error.message));
    return release;
  }

  disconnect() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.timers.clearTimeout(s.retryTimer);
    s.device.removeEventListener('gattserverdisconnected', s.onDrop);
    this.clear(s);
    // Disconnect also aborts an in-flight connect on Chrome. The lane still waits
    // for that promise before starting a new session, even for the same device.
    if (s.started && (!this.ownership || s.lease)) s.device.gatt.disconnect();
    this.releaseOwnership(s);
    this.onState('Disconnected by you');
  }

  async useDevice(device) {
    this.disconnect();
    const cached = this.cachedEndpoint();
    const s = {device, generation: 0, attempts: 0, busy: false, ready: false,
      retryTimer: null, stableTimer: null, entries: [], characteristic: null, started: false,
      verified: cached?.deviceId === device.id, lease: null,
      endpoint: cached?.deviceId === device.id ? cached : null};
    this.session = s;
    s.onDrop = () => {
      if (!this.active(s) || !s.started || device.gatt.connected) return;
      this.log('BT: unexpected disconnection' + (s.stage ? ' during ' + s.stage : ''));
      this.clear(s);
      this.onState('Connection lost; syncing will wait for Bluetooth');
      if (!s.busy) this.queueReconnect(s);
    };
    device.addEventListener('gattserverdisconnected', s.onDrop);
    if (this.ownership) {
      try {
        const lease = await this.acquireOwnership(s);
        if (!this.active(s)) return;
        if (!lease) throw new Error('Another Album Glow tab is using these lights. Use that tab, or disconnect its lights before connecting here.');
        this.log(lease.supported ? 'BT: this tab reserved the controller on this website' :
          'BT: this browser cannot coordinate Bluetooth ownership between tabs');
      } catch (error) {
        if (!this.active(s)) return;
        this.session = null;
        device.removeEventListener('gattserverdisconnected', s.onDrop);
        this.clear(s);
        this.releaseOwnership(s);
        this.onState(error.message);
        throw error;
      }
    }
    await this.connect(s);
  }

  queueReconnect(s) {
    if (!this.active(s) || s.retryTimer !== null) return;
    if (s.attempts >= 4) {
      s.started = false;
      this.releaseOwnership(s);
      const reason = s.lastFailureStage?.startsWith('GATT connect') ?
        ' Chrome could not establish the controller connection, before Album Glow could discover characteristics or send LED commands.' :
        ' The Bluetooth link could not be kept ready.';
      this.onState('Automatic retries stopped after 4 attempts.' + reason);
      return;
    }
    const seconds = 2 ** s.attempts++;
    this.onState('Retry ' + s.attempts + '/4 in ' + seconds + 's (no device chooser)');
    s.retryTimer = this.timers.setTimeout(() => {
      s.retryTimer = null;
      void this.connect(s);
    }, seconds * 1000);
  }

  async connect(s) {
    if (!this.active(s) || s.busy || (this.ownership && !s.lease)) return;
    s.busy = true;
    const generation = s.generation;
    let failed = false;
    await this.exclusive(async () => {
      if (!this.active(s, generation)) return;
      const stage = async (name, operation) => {
        s.stage = name;
        this.onState(name);
        const result = await operation();
        // A cancelled connect can still resolve on some stacks. Close it while
        // we still own the lane, before any newer session begins GATT work.
        if (this.session !== s && name.startsWith('GATT connect') && result.connected) result.disconnect();
        this.assertActive(s, generation);
        this.log('BT: completed ' + name);
        return result;
      };
      try {
        s.started = true;
        const server = await stage('GATT connect to ' + (s.device.name || 'controller'), () => s.device.gatt.connect());
        let entries = [];
        if (s.endpoint && s.verified) {
          try {
            const service = await stage('saved service ' + s.endpoint.service,
              () => server.getPrimaryService(s.endpoint.service));
            const c = await stage('saved characteristic ' + s.endpoint.characteristic,
              () => service.getCharacteristic(s.endpoint.characteristic));
            if (!c.properties.write && !c.properties.writeWithoutResponse) {
              const error = new Error('Saved characteristic is no longer writable');
              error.name = 'NotFoundError';
              throw error;
            }
            entries = [{c, service: service.uuid}];
          } catch (error) {
            this.assertActive(s, generation);
            // Only a missing endpoint merits broad rediscovery. Network failures
            // must be retried, not followed by yet more GATT calls.
            if (error.name !== 'NotFoundError') throw error;
            this.log('BT: saved endpoint is missing; discovering permitted services again');
            s.endpoint = null;
            s.verified = false;
            this.onUnconfirmed();
            try { this.storage?.removeItem(this.cacheKey); } catch { /* optional cache */ }
          }
        }
        if (!entries.length) {
          const services = await stage('service discovery', () => server.getPrimaryServices());
          for (const service of services) {
            let chars;
            try {
              chars = await stage('characteristic discovery on ' + service.uuid, () => service.getCharacteristics());
            } catch (error) {
              this.assertActive(s, generation);
              if (!['NotFoundError', 'SecurityError'].includes(error.name)) throw error;
              this.log('BT: skipping unavailable characteristics on ' + service.uuid + ' — ' + error.name);
              continue;
            }
            for (const c of chars) {
              this.log('BT: characteristic ' + c.uuid + ' on ' + service.uuid +
                ' write=' + Boolean(c.properties.write) + ' withoutResponse=' + Boolean(c.properties.writeWithoutResponse));
              if (c.properties.write || c.properties.writeWithoutResponse) entries.push({c, service: service.uuid});
            }
          }
        }
        if (!entries.length) throw new Error('No writable characteristic found. A custom service UUID may be needed.');
        this.assertActive(s, generation);
        const previous = s.endpoint;
        let index = entries.findIndex(e => e.service === previous?.service && e.c.uuid === previous?.characteristic);
        if (index < 0) index = entries.findIndex(e => /^(ffe1|fff3|ffd9|fff1|ffe9|ff01)$/i.test(e.c.uuid.slice(4, 8)));
        if (index < 0) index = 0;
        s.entries = entries;
        s.characteristic = entries[index].c;
        s.endpoint = {deviceId: s.device.id, service: entries[index].service, characteristic: s.characteristic.uuid};
        s.ready = true;
        this.log('BT: selected writable characteristic ' + s.characteristic.uuid + ' (selection is not proof the lights respond)');
        this.onReady({device: s.device, entries, index});
        this.onState('Ready: ' + s.device.name);
        s.stage = null;
        s.lastFailureStage = null;
        // Brief successful connections do not reset the failure budget.
        s.stableTimer = this.timers.setTimeout(() => {
          if (this.active(s, generation) && s.ready && s.device.gatt.connected) {
            s.attempts = 0;
            this.log('BT: connection stable for ' + this.stableMs / 1000 + 's; retry budget reset');
          }
        }, this.stableMs);
      } catch (error) {
        if (this.session !== s) return;
        failed = true;
        s.lastFailureStage = s.stage;
        this.log('BT: FAILED at ' + s.stage + ' — ' + error.name + ': ' + error.message);
        this.clear(s);
        // Our intentional cleanup is distinguishable from a remote disconnect.
        s.device.removeEventListener('gattserverdisconnected', s.onDrop);
        if (s.device.gatt.connected) {
          this.log('BT: closing GATT after initialization failure');
          s.device.gatt.disconnect();
        }
        s.device.addEventListener('gattserverdisconnected', s.onDrop);
      }
    });
    s.busy = false;
    if (this.active(s) && (failed || !s.ready)) this.queueReconnect(s);
  }

  select(index) {
    const s = this.session;
    if (!s?.ready || !s.entries[index]) throw new Error('Connect Bluetooth before selecting a characteristic');
    this.cancelPending();
    s.generation++;
    this.timers.clearTimeout(s.stableTimer);
    const generation = s.generation;
    s.stableTimer = this.timers.setTimeout(() => {
      if (this.active(s, generation) && s.ready && s.device.gatt.connected) s.attempts = 0;
    }, this.stableMs);
    s.characteristic = s.entries[index].c;
    s.endpoint = {deviceId: s.device.id, service: s.entries[index].service, characteristic: s.characteristic.uuid};
    s.lastSuccessful = null;
    s.verified = false;
    this.onUnconfirmed();
    this.log('BT: selected ' + s.characteristic.uuid + '; test and confirm this selection');
    return s.characteristic;
  }

  confirm() {
    const s = this.session;
    if (!s?.ready || !s.device.gatt.connected || s.lastSuccessful !== s.characteristic || s.lastKind !== 'test') {
      throw new Error('Send a manual color test successfully, then confirm the lights changed');
    }
    try { this.storage?.setItem(this.cacheKey, JSON.stringify(s.endpoint)); }
    catch { this.log('BT: browser could not remember endpoint; current connection is still usable'); }
    s.verified = true;
    this.log('BT: visually confirmed endpoint remembered for this controller');
  }

  write(frame, {kind = 'command', valid = () => true} = {}) {
    const s = this.session;
    if (!s?.ready || !s.device.gatt.connected) return Promise.reject(new Error('Bluetooth is not ready; wait for reconnection'));
    return new Promise((resolve, reject) => {
      // Only the newest unsent color matters. Power commands remain ordered.
      if (kind === 'color') {
        const previous = this.pending.at(-1);
        if (previous?.kind === 'color') { this.pending.pop(); previous.reject(this.cancelled()); }
      }
      if (this.pending.length >= 16) { reject(new Error('Bluetooth queue full; wait before sending more commands')); return; }
      this.pending.push({s, generation: s.generation, c: s.characteristic,
        frame: new Uint8Array(frame), kind, valid, resolve, reject});
      void this.pump();
    });
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending.length) {
        const command = this.pending.shift();
        try {
          await this.exclusive(async () => {
            const {s, generation, c, frame} = command;
            const check = () => {
              this.assertActive(s, generation);
              if (!s.ready || s.characteristic !== c || !command.valid()) throw this.cancelled();
            };
            check();
            const wait = this.writeGap - (this.now() - this.lastWriteAt);
            if (wait > 0) await new Promise(resolve => this.timers.setTimeout(resolve, wait));
            check();
            const mode = c.properties.writeWithoutResponse && c.writeValueWithoutResponse ? 'writeValueWithoutResponse' :
              c.properties.write && c.writeValueWithResponse ? 'writeValueWithResponse' : 'writeValue';
            this.log('BT: write start (' + command.kind + ', ' + mode + ', ' + frame.length + ' bytes)');
            try { await c[mode](frame); }
            finally { this.lastWriteAt = this.now(); }
            check();
            s.lastSuccessful = c;
            s.lastKind = command.kind;
            this.log('BT: write complete (browser accepted; verify the LEDs visually)');
          });
          command.resolve();
        } catch (error) {
          if (error.name !== 'AbortError') this.log('BT: write FAILED — ' + error.name + ': ' + error.message);
          const {s, generation} = command;
          if (this.active(s, generation) && ['NetworkError', 'InvalidStateError'].includes(error.name)) {
            this.log('BT: invalidating GATT objects after write failure; reconnecting before further writes');
            this.clear(s);
            s.device.removeEventListener('gattserverdisconnected', s.onDrop);
            s.device.gatt.disconnect();
            s.device.addEventListener('gattserverdisconnected', s.onDrop);
            this.queueReconnect(s);
          }
          command.reject(error);
        }
      }
    } finally { this.pumping = false; }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = {AlbumGlowBluetooth};
