const _ = require('underscore');
const { app, autoUpdater, dialog } = require('electron');

// Daily.
const SCHEDULED_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

const Updater = function () {
  autoUpdater.on('error', this._onUpdateError.bind(this));
  autoUpdater.on('update-not-available', this._onUpdateNotAvailable.bind(this));
  autoUpdater.on('update-downloaded', this._onUpdateDownloaded.bind(this));
};

_.extend(Updater.prototype, {
  setFeedURL(url) {
    autoUpdater.setFeedURL(url);
  },

  checkForUpdates(userTriggered /* optional */) {
    // Asking the updater to check while it's already checking may result in an error.
    if (this._checkPending) return;

    this._clearScheduledCheck();
    if (this._updatePending) {
      this._askToApplyUpdate();
      return;
    }

    this._checkPending = true;
    if (userTriggered) this._userCheckPending = true;

    autoUpdater.checkForUpdates();
  },

  _onUpdateError() {
    this._checkPending = false;
    if (this._userCheckPending) {
      this._userCheckPending = false;

      dialog.showMessageBox({
        type: 'error',
        message: 'An error occurred while checking for updates.',
        buttons: ['Ok'],
      });
    }

    this._scheduleCheck();
  },

  _onUpdateNotAvailable() {
    this._checkPending = false;
    if (this._userCheckPending) {
      this._userCheckPending = false;

      dialog.showMessageBox({
        type: 'info',
        message: 'An update is not available.',
        buttons: ['Ok'],
      });
    }

    this._scheduleCheck();
  },

  _onUpdateDownloaded() {
    this._checkPending = false;
    this._userCheckPending = false;
    this._updatePending = true;
    this._askToApplyUpdate();
  },

  _askToApplyUpdate() {
    const self = this;

    dialog.showMessageBox(
      {
        type: 'question',
        message: 'An update is available! Would you like to quit to install it? The application will then restart.',
        buttons: ['Ask me later', 'Quit and install'],
      },
      function (result) {
        if (result > 0) {
          // Emit the 'before-quit' event since the app won't quit otherwise
          // (https://app.asana.com/0/19141607276671/74169390751974) and the app won't:
          // https://github.com/atom/electron/issues/3837
          const event = {
            _defaultPrevented: false,
            isDefaultPrevented() {
              return this._defaultPrevented;
            },
            preventDefault() {
              this._defaultPrevented = true;
            },
          };

          app.emit('before-quit', event);
          if (event.isDefaultPrevented()) return;

          autoUpdater.quitAndInstall();
        } else {
          self._scheduleCheck();
        }
      }
    );
  },

  _clearScheduledCheck() {
    if (this._scheduledCheck) {
      clearTimeout(this._scheduledCheck);
      this._scheduledCheck = null;
    }
  },

  _scheduleCheck() {
    this._clearScheduledCheck();
    this._scheduledCheck = setTimeout(this.checkForUpdates.bind(this), SCHEDULED_CHECK_INTERVAL);
  },
});

module.exports = new Updater();
