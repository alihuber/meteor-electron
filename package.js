/* global Package:false, Npm:false */

Package.describe({
  name: 'jarnoleconte:electron',
  summary: 'Electron',
  version: '0.3.0',
  git: 'https://github.com/alihuber/meteor-electron',
});

Npm.depends({
  'electron-packager': '13.1.1',
  'electron-rebuild': '1.8.4',
  'meteor-build-client-only': 'git+https://github.com/alihuber/meteor-build-client#master',
  'lucy-dirsum': '0.1.1',
  mkdirp: '0.5.1',
  ncp: '2.0.0',
  rimraf: '2.4.4',
  semver: '5.1.0',
  'url-join': '4.0.0',
});

Package.onUse(function (api) {
  api.versionsFrom('METEOR@1.3');
  api.use(['mongo-livedata', 'webapp', 'ejson', 'promise', 'ecmascript', 'es5-shim'], 'server');
  api.use(['underscore'], ['server', 'client']);
  api.use(['iron:router@0.9.4||1.0.0'], { weak: true });
  api.use('meteorhacks:picker@1.0.0', 'server', { weak: true });

  api.addFiles(
    [
      'server/createBinaries.js',
      'server/downloadUrls.js',
      'server/launchApp.js',
      'server/serve.js',
      'server/serveDownloadUrl.js',
      'server/serveUpdateFeed.js',
      // Must go last so that its dependencies have been defined.
      'server/index.js',
    ],
    'server'
  );

  const assets = ['app/api.js', 'app/autoUpdater.js', 'app/main.js', 'app/menu.js', 'app/package.json', 'app/proxyWindowEvents.js'];

  // Use Meteor 1.2+ API, but fall back to the pre-1.2 API if necessary
  if (api.addAssets) {
    api.addAssets(assets, 'server');
  } else {
    api.addFiles(assets, 'server', { isAsset: true });
  }

  api.addFiles(['client/index.js'], 'client');

  // Public exports.
  api.export('Electron', ['client']);
});
