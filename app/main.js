const { app, protocol } = require('electron');
const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');

// var log = function(msg){
//   fs.appendFile("C:\\Users\\Michael\\electron.log", msg + "\n", function(err){
//     if (err){
//       throw err;
//     }
//   })
// };

const log = function () {};

const installShortcut = function (callback) {
  const updateDotExe = path.resolve(path.dirname(process.execPath), '..', 'update.exe');
  const child = childProcess.spawn(updateDotExe, ['--createShortcut'], { detached: true });
  child.on('close', function () {
    callback();
  });
};

const handleStartupEvent = function () {
  if (process.platform !== 'win32') {
    return false;
  }

  const squirrelCommand = process.argv[1];
  switch (squirrelCommand) {
  case '--squirrel-install':
    log('SQUIRREL INSTALL');
    break;
  case '--squirrel-updated':
    log('SQUIRREL UPDATED');
    // Optionally do things such as:
    //
    // - Install desktop and start menu shortcuts
    // - Add your .exe to the PATH
    // - Write to the registry for things like file associations and
    //   explorer context menus

    // Always quit when done
    installShortcut(function () {
      app.quit();
    });

    return true;
  case '--squirrel-uninstall':
    log('SQUIRREL UNINSTALL');

    // Undo anything you did in the --squirrel-install and
    // --squirrel-updated handlers

    // Always quit when done
    app.quit();

    return true;
  case '--squirrel-obsolete':
    log('SQUIRREL OBSOLETE');
    // This is called on the outgoing version of your app before
    // we update to the new version - it's the opposite of
    // --squirrel-updated
    app.quit();
    return true;
  default:
    break;
  }
};

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

if (handleStartupEvent()) {
  return;
}

const { BrowserWindow } = require('electron'); // Module to create native browser window.
const autoUpdater = require('./autoUpdater');
const createDefaultMenu = require('./menu.js');
const proxyWindowEvents = require('./proxyWindowEvents');

require('electron-debug')({
  showDevTools: false,
});

const electronSettings = JSON.parse(fs.readFileSync(path.join(__dirname, 'electronSettings.json'), 'utf-8'));

let checkForUpdates;
if (electronSettings.updateFeedUrl) {
  autoUpdater.setFeedURL(electronSettings.updateFeedUrl + '?version=' + electronSettings.version);
  autoUpdater.checkForUpdates();
  checkForUpdates = function () {
    autoUpdater.checkForUpdates(true /* userTriggered */);
  };
}

// register custom protocol for packaged apps that rewrite urls to the filesystem
// otherwise use the URL specified in the settings file.
let launchUrl;
if (electronSettings.autoPackage && electronSettings.bundleClient) {
  protocol.registerStandardSchemes(['meteor']);
  launchUrl = 'meteor://bundle/index.html';
} else {
  launchUrl = electronSettings.rootUrl;
  if (electronSettings.launchPath) {
    launchUrl += electronSettings.launchPath;
  }
}

const windowOptions = {
  width: electronSettings.width || 800,
  height: electronSettings.height || 600,
  resizable: true,
  frame: true,
  /**
   * Disable Electron's Node integration so that browser dependencies like `moment` will load themselves
   * like normal i.e. into the window rather than into modules, and also to prevent untrusted client
   * code from having access to the process and file system:
   *  - https://github.com/atom/electron/issues/254
   *  - https://github.com/atom/electron/issues/1753
   */
  webPreferences: {
    nodeIntegration: false,
    // See comments at the top of `preload.js`.
    preload: path.join(__dirname, 'api.js'),
  },
};

if (electronSettings.resizable === false) {
  windowOptions.resizable = false;
}

if (electronSettings.titleBarStyle) {
  windowOptions.titleBarStyle = electronSettings.titleBarStyle;
}

if (electronSettings.minWidth) {
  windowOptions.minWidth = electronSettings.minWidth;
}

if (electronSettings.maxWidth) {
  windowOptions.maxWidth = electronSettings.maxWidth;
}

if (electronSettings.minHeight) {
  windowOptions.minHeight = electronSettings.minHeight;
}

if (electronSettings.maxHeight) {
  windowOptions.maxHeight = electronSettings.maxHeight;
}

if (electronSettings.frame === false) {
  windowOptions.frame = false;
}

// Keep a global reference of the window object so that it won't be garbage collected
// and the window closed.
let mainWindow = null;
const getMainWindow = function () {
  return mainWindow;
};

// Unfortunately, we must set the menu before the application becomes ready and so before the main
// window is available to be passed directly to `createDefaultMenu`.
createDefaultMenu(app, getMainWindow, checkForUpdates);

const hideInsteadofClose = function (e) {
  mainWindow.hide();
  e.preventDefault();
};

app.on('ready', function () {
  mainWindow = new BrowserWindow(windowOptions);
  proxyWindowEvents(mainWindow);

  // Hide the main window instead of closing it, so that we can bring it back
  // more quickly.
  mainWindow.on('close', hideInsteadofClose);

  mainWindow.focus();

  // rewrite webapp requests to filesystem for packaged apps
  if (electronSettings.autoPackage && electronSettings.bundleClient) {
    protocol.registerFileProtocol('meteor', function (request, callback) {
      callback(
        request.url
          .replace('meteor://bundle/', `${__dirname}/web/`)
          .split('?')[0]
          .split('#')[0]
      );
    });
  }

  mainWindow.loadURL(launchUrl);
});

app.on('before-quit', function () {
  // We need to remove our close event handler from the main window,
  // otherwise the app will not quit.
  mainWindow.removeListener('close', hideInsteadofClose);
});

app.on('activate', function () {
  // Show the main window when the customer clicks on the app icon.
  if (!mainWindow.isVisible()) mainWindow.show();
});
