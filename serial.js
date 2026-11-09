'use strict';

// WLED JSON over USB serial. Open/write/close share a lane; cancelling never
// frees that lane or its tab reservation while a native operation is pending.
class AlbumGlowSerial {
  constructor({serial = globalThis.navigator?.serial, log = () => {}, onState = () => {},
    onReady = () => {}, onClear = () => {}, timers = globalThis, now = () => Date.now(),
    writeGap = 100, replyMs = 5000,
    ownership = typeof AlbumGlowTabOwnership === 'function' ? new AlbumGlowTabOwnership() : null} = {}) {
    Object.assign(this, {serial, log, onState, onReady, onClear, timers, now, writeGap, replyMs, ownership});
    this.session = null;
    this.operations = Promise.resolve();
    this.barrier = Promise.resolve();
    this.pending = [];
    this.pumping = false;
    this.lastWriteAt = -Infinity;
  }

  static portId(port) {
    const info = port.getInfo();
    if (!['usbVendorId', 'usbProductId'].every(key => Number.isInteger(info[key]) && info[key] >= 0 && info[key] <= 65535)) {
      throw new Error('Choose the SP803E USB serial port; this is not a USB device');
    }
    return `usb-wled:${info.usbVendorId}:${info.usbProductId}`;
  }

  cancelled() {
    const error = new Error('USB command cancelled: connection or selection changed');
    error.name = 'AbortError';
    return error;
  }

  exclusive(fn) {
    const result = this.operations.then(fn);
    this.operations = result.catch(() => {});
    return result;
  }

  active(s) { return this.session === s; }

  check(s) { if (!this.active(s)) throw this.cancelled(); }

  fence(error) {
    this.barrier = Promise.reject(error);
    this.barrier.catch(() => {});
    this.log('USB: cleanup could not finish; reconnect is blocked — ' + error.message);
  }

  cancelPending() {
    for (const command of this.pending.splice(0)) command.reject(this.cancelled());
  }

  disconnect(message = 'USB disconnected by you') {
    const s = this.session;
    if (!s) return this.operations;
    this.session = null;
    s.ready = false;
    this.cancelPending();
    s.rejectReply?.(this.cancelled());
    this.onClear();
    this.onState(message);
    const cleanup = this.exclusive(() => this.close(s));
    cleanup.catch(() => {});
    return cleanup;
  }

  close(s) {
    if (s.closing) return s.closing;
    s.closing = (async () => {
      this.timers.clearTimeout(s.replyTimer);
      s.rejectReply?.(this.cancelled());
      this.serial?.removeEventListener?.('disconnect', s.onDrop);
      try {
        if (s.reader) {
          await s.reader.cancel();
          await s.reading;
        }
        if (s.writer) { s.writer.releaseLock(); s.writer = null; }
        if (s.opened) { await s.port.close(); s.opened = false; }
        // Keep ownership if closing the native port fails. Never allow a new
        // controller session to silently run past uncertain cleanup.
        if (s.lease) { await s.lease.release(); s.lease = null; }
      } catch (error) { this.fence(error); throw error; }
    })();
    return s.closing;
  }

  async usePort(port) {
    this.disconnect();
    const s = {port, id: AlbumGlowSerial.portId(port), ready: false, opened: false};
    this.session = s;
    s.onDrop = event => {
      if (this.active(s) && (event.port === port || event.target === port)) {
        this.disconnect('USB cable/controller disconnected. Reconnect with Connect USB.');
      }
    };
    this.serial?.addEventListener?.('disconnect', s.onDrop);
    return this.exclusive(async () => {
      try {
        await this.barrier;
        this.check(s);
        if (this.ownership) {
          // Web Serial exposes VID/PID, not a stable unique controller ID.
          // Reserve one WLED USB session per origin rather than pretending
          // identical adapters can be distinguished reliably across tabs.
          s.lease = await this.ownership.acquire('usb-wled');
          this.check(s);
          if (!s.lease) throw new Error('Another Album Glow tab is using USB lights. Disconnect them there first.');
          this.log(s.lease.supported ? 'USB: this tab reserved USB lights on this website' :
            'USB: this browser cannot coordinate USB ownership between tabs');
        }
        this.onState('USB: opening serial port at 115200 baud');
        await port.open({baudRate: 115200, flowControl: 'none'});
        s.opened = true;
        this.check(s);
        if (!port.readable || !port.writable) throw new Error('The selected device has no readable/writable serial port');
        s.writer = port.writable.getWriter();
        s.reader = port.readable.getReader();
        s.reading = this.read(s);
        // Opening a USB/UART bridge may reboot the ESP32. Probe the same open
        // port for up to five reply windows; never reopen it on each attempt.
        for (let attempt = 1; attempt <= 5 && !s.state; attempt++) {
          const reply = new Promise((resolve, reject) => {
            s.resolveReply = value => { s.state = value; this.timers.clearTimeout(s.replyTimer); resolve(); };
            s.rejectReply = error => { this.timers.clearTimeout(s.replyTimer); reject(error); };
            s.expireReply = resolve;
          });
          reply.catch(() => {});
          this.onState('USB: checking WLED identity ' + attempt + '/5 (no color or power change)');
          await s.writer.write(new TextEncoder().encode('{"v":true}\n'));
          this.check(s);
          // Only an application reply is timed out, after native write settles.
          // Cancellation still closes the port before releasing its reservation.
          s.replyTimer = this.timers.setTimeout(() => s.expireReply(), this.replyMs / 5);
          await reply;
          this.timers.clearTimeout(s.replyTimer);
          this.check(s);
        }
        if (!s.state) throw new Error('No WLED reply. Select the SP803E port, use a data cable, and check WLED serial is enabled at 115200 baud.');
        s.resolveReply = null;
        s.rejectReply = null;
        this.check(s);
        s.ready = true;
        this.log('USB: WLED identity response received');
        this.onReady({id: s.id, state: s.state});
        this.onState('Ready: SP803E / WLED over USB');
        return true;
      } catch (error) {
        const current = this.active(s);
        if (current) { this.session = null; this.cancelPending(); this.onClear(); }
        await this.close(s);
        if (error.name === 'AbortError' && !current) return false;
        this.log('USB: setup failed — ' + error.name + ': ' + error.message);
        if (current) this.onState('USB setup failed: ' + error.message);
        throw error;
      }
    });
  }

  async read(s) {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (this.active(s)) {
        const {value, done} = await s.reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        if (buffer.length > 65536) {
          buffer = '';
          this.log('USB: discarded an oversized serial line');
          continue;
        }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!this.active(s)) break;
          try {
            const message = JSON.parse(line);
            if (typeof message.info?.ver === 'string' && typeof message.state?.on === 'boolean' && Array.isArray(message.state.seg)) {
              s.resolveReply?.(message.state);
            }
          } catch { /* Ignore boot/debug text. Never log arbitrary serial data. */ }
        }
      }
    } catch (error) {
      if (this.active(s)) this.log('USB: reading stopped — ' + error.name);
    } finally {
      s.reader.releaseLock();
      s.reader = null;
      if (this.active(s)) this.disconnect('USB connection lost. Use Connect USB to reconnect.');
    }
  }

  write(frame, options) { return this.writeBatch([frame], options); }

  writeBatch(frames, {kind = 'command', valid = () => true} = {}) {
    const s = this.session;
    if (!s?.ready) return Promise.reject(new Error('USB is not ready; connect the WLED controller first'));
    if (!Array.isArray(frames) || !frames.length || frames.length > 4) return Promise.reject(new TypeError('Expected one to four command frames'));
    const copies = frames.map(frame => new Uint8Array(frame));
    if (copies.some(frame => !frame.length)) return Promise.reject(new TypeError('Command frames must not be empty'));
    return new Promise((resolve, reject) => {
      if (kind === 'color' && this.pending.at(-1)?.kind === 'color') this.pending.pop().reject(this.cancelled());
      if (this.pending.length >= 16) { reject(new Error('USB queue full; wait before sending more commands')); return; }
      this.pending.push({s, frames: copies, kind, valid, resolve, reject});
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
            const check = () => {
              this.check(command.s);
              if (!command.s.ready || !command.valid()) throw this.cancelled();
            };
            for (const frame of command.frames) {
              check();
              const wait = this.writeGap - (this.now() - this.lastWriteAt);
              if (wait > 0) await new Promise(resolve => this.timers.setTimeout(resolve, wait));
              check();
              this.log('USB: write start (' + command.kind + ', ' + frame.length + ' bytes)');
              try { await command.s.writer.write(frame); }
              finally { this.lastWriteAt = this.now(); }
              check();
              this.log('USB: write complete (browser accepted; verify the LEDs visually)');
            }
          });
          command.resolve();
        } catch (error) {
          if (error.name !== 'AbortError') {
            this.log('USB: write failed — ' + error.name + ': ' + error.message);
            if (this.active(command.s)) this.disconnect('USB write failed; reconnect with Connect USB.');
          }
          command.reject(error);
        }
      }
    } finally { this.pumping = false; }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = {AlbumGlowSerial};
else globalThis.AlbumGlowSerial = AlbumGlowSerial;
