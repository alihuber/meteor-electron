/* eslint-disable default-case */
const {app, protocol, BrowserWindow, autoUpdater, dialog} = require('electron');
const path = require('path');
const fs = require('fs');
const ChildProcess = require('child_process');

let dev = false;
if (process.defaultApp || /[\\/].meteor-electron[\\/]/.test(process.execPath)) {
  dev = true;
}

function handleSquirrelEvent() {
  if (process.argv.length === 1) {
    return false;
  }

  const appFolder = path.resolve(process.execPath, '..');
  const rootAtomFolder = path.resolve(appFolder, '..');
  const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
  const exeName = path.basename(process.execPath);

  const spawn = function(command, args) {
    let spawnedProcess;
    try {
      spawnedProcess = ChildProcess.spawn(command, args, {detached: true});
    } catch (error) {
      console.warn(error);
    }

    return spawnedProcess;
  };

  const spawnUpdate = function(args) {
    return spawn(updateDotExe, args);
  };

  const squirrelEvent = process.argv[1];
  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      // Optionally do things such as:
      // - Add your .exe to the PATH
      // - Write to the registry for things like file associations and
      //   explorer context menus

      // Install desktop and start menu shortcuts
      spawnUpdate(['--createShortcut', exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-uninstall':
      // Undo anything you did in the --squirrel-install and
      // --squirrel-updated handlers

      // Remove desktop and start menu shortcuts
      spawnUpdate(['--removeShortcut', exeName]);

      setTimeout(app.quit, 1000);
      return true;

    case '--squirrel-obsolete':
      // This is called on the outgoing version of your app before
      // we update to the new version - it's the opposite of
      // --squirrel-updated

      app.quit();
      return true;
  }
}

// this should be placed at top of main.js to handle setup events quickly
if (!dev) {
  if (handleSquirrelEvent()) {
    // squirrel event handled and app will exit in 1000ms, so don't do anything else
    return;
  }
}

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const createDefaultMenu = require('./menu.js');
const proxyWindowEvents = require('./proxyWindowEvents');

const electronSettings = JSON.parse(fs.readFileSync(path.join(__dirname, 'electronSettings.json'), 'utf-8'));

require('electron-debug')({
  showDevTools: dev && electronSettings.openDevTools,
});

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
const getMainWindow = function() {
  return mainWindow;
};

// Unfortunately, we must set the menu before the application becomes ready and so before the main
// window is available to be passed directly to `createDefaultMenu`.
createDefaultMenu(app, getMainWindow);

function createWindow() {
  mainWindow = new BrowserWindow(windowOptions);
  proxyWindowEvents(mainWindow);
  // rewrite webapp requests to filesystem for packaged apps
  if (electronSettings.autoPackage && electronSettings.bundleClient) {
    protocol.registerFileProtocol('meteor', function(request, callback) {
      callback(
        request.url
          .replace('meteor://bundle/', `${__dirname}/web/`)
          .split('?')[0]
          .split('#')[0]
      );
    });
  }
  mainWindow.loadURL(launchUrl);
  // Don't show until we are ready and loaded
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Emitted when the window is closed.
  mainWindow.on('closed', function() {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});

const domain = electronSettings.updateFeedUrl;
const suffix = process.platform === 'darwin' ? `/RELEASES.json?method=JSON&version=${app.getVersion()}` : '';
// this just has to point to an HTTP server containing the "releases" and nupkg files
if (!dev) {
  autoUpdater.setFeedURL({
    url: `${domain}/${process.platform}/${process.arch}${suffix}`,
    serverType: 'json',
  });
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 60000); // minutely
  autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
    const dialogOpts = {
      type: 'info',
      buttons: ['Restart', 'Later'],
      title: 'Application Update',
      message: process.platform === 'win32' ? releaseNotes : releaseName,
      detail: 'A new version has been downloaded. Restart the application to apply the updates.',
    };

    dialog.showMessageBox(dialogOpts, response => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });
}
