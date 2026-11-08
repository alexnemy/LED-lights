'use strict';

// Web Locks coordinate tabs on this origin. Separate preview/production origins
// and other Bluetooth applications cannot see these locks.
class AlbumGlowTabOwnership {
  constructor({locks = globalThis.navigator?.locks} = {}) {
    this.locks = locks;
  }

  async acquire(deviceId) {
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      throw new TypeError('A Bluetooth device ID is required to acquire tab ownership');
    }

    if (!this.locks || typeof this.locks.request !== 'function') {
      const released = Promise.resolve();
      return {supported: false, release: () => released};
    }

    return new Promise((resolve, reject) => {
      let releaseHold;
      const hold = new Promise(done => {releaseHold = done;});
      let request;
      const lease = {
        supported: true,
        release() {
          releaseHold();
          // Resolving hold only asks Web Locks to end its callback. Wait for
          // request itself so a subsequent owner cannot race actual release.
          return request;
        }
      };

      // Schedule the API call after request is assigned, including when an
      // injected LockManager invokes its callback synchronously. API errors
      // reject acquisition rather than silently permitting a second owner.
      request = Promise.resolve().then(() => this.locks.request(
        `albumglow.bluetooth.device:${deviceId}`, {ifAvailable: true}, lock => {
          resolve(lock ? lease : null);
          return lock ? hold : undefined;
        }
      ));
      request.catch(reject);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = {AlbumGlowTabOwnership};
else if (typeof globalThis !== 'undefined') globalThis.AlbumGlowTabOwnership = AlbumGlowTabOwnership;
