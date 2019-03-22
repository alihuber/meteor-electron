/* global Meteor, Npm */
const electronRebuild = Npm.require('electron-rebuild');
const meteorBuildClient = Meteor.wrapAsync(Npm.require('meteor-build-client-only'));
const fs = Npm.require('fs');
const mkdirp = Meteor.wrapAsync(Npm.require('mkdirp'));
const path = Npm.require('path');
const proc = Npm.require('child_process');
const dirsum = Meteor.wrapAsync(Npm.require('lucy-dirsum'));
const readFile = Meteor.wrapAsync(fs.readFile);
const writeFile = Meteor.wrapAsync(fs.writeFile);
const stat = Meteor.wrapAsync(fs.stat);
const util = Npm.require('util');
const rimraf = Meteor.wrapAsync(Npm.require('rimraf'));
const ncp = Meteor.wrapAsync(Npm.require('ncp'));

const exec = Meteor.wrapAsync(function(command, options, callback) {
  proc.exec(command, options, function(err, stdout, stderr) {
    callback(err, { stdout, stderr });
  });
});

const exists = function(path) {
  try {
    stat(path);
    return true;
  } catch (e) {
    return false;
  }
};

const projectRoot = function() {
  if (process.platform === 'win32') {
    return process.env.METEOR_SHELL_DIR.split('.meteor')[0];
  } else {
    return process.env.PWD;
  }
};

const ELECTRON_VERSION = '4.1.0';
const PACKAGE_NAME = 'jarnoleconte_electron';

const electronSettings = Meteor.settings.electron || {};

const IS_MAC = process.platform === 'darwin';

/* Entry Point */
createBinaries = function() {
  const results = {};
  let builds;
  if (electronSettings.builds) {
    builds = electronSettings.builds;
  } else {
    // just build for the current platform/architecture
    if (process.platform === 'darwin') {
      builds = [{ platform: process.platform, arch: process.arch }];
    } else if (process.platform === 'win32') {
      // arch detection doesn't always work on windows, and ia32 works everywhere
      builds = [{ platform: process.platform, arch: 'ia32' }];
    } else {
      console.error('You must specify one or more builds in Meteor.settings.electron.');
      return results;
    }
  }

  if (_.isEmpty(builds)) {
    console.error('No builds available for this platform.');
    return results;
  }

  builds.forEach(function(buildInfo) {
    let buildRequired = false;

    const buildDirs = createBuildDirectories(buildInfo);

    /* Write out Electron application files */
    const appVersion = electronSettings.version;
    const appName = electronSettings.name || 'electron';
    const appDescription = electronSettings.description;

    let resolvedAppSrcDir;
    if (electronSettings.appSrcDir) {
      resolvedAppSrcDir = path.join(projectRoot(), electronSettings.appSrcDir);
    } else {
      // See http://stackoverflow.com/a/29745318/495611 for how the package asset directory is derived.
      // We can't read this from the project directory like the user-specified app directory since
      // we may be loaded from Atmosphere rather than locally.
      resolvedAppSrcDir = path.join(process.cwd(), 'assets', 'packages', PACKAGE_NAME, 'app');
    }

    // Check if the package.json has changed before copying over the app files, to account for
    // changes made in the app source dir.
    const packagePath = packageJSONPath(resolvedAppSrcDir);
    let packageJSON = Npm.require(packagePath);

    // Fill in missing package.json fields (note: before the comparison).
    // This isn't just a convenience--`Squirrel.Windows` requires the description and version.
    packageJSON = _.defaults(packageJSON, {
      name: appName && appName.toLowerCase().replace(/\s/g, '-'),
      productName: appName,
      description: appDescription,
      version: appVersion,
    });
    // Check if the package has changed before we possibly copy over the app source since that will
    // of course sync `package.json`.
    const packageHasChanged = packageJSONHasChanged(packageJSON, buildDirs.app);

    let didOverwriteNodeModules = false;

    if (appHasChanged(resolvedAppSrcDir, buildDirs.checksum)) {
      buildRequired = true;

      // Copy the app directory over while also pruning old files.
      if (IS_MAC) {
        // Ensure that the app source directory ends in a slash so we copy its contents.
        // Except node_modules from pruning since we prune that below.
        // TODO(wearhere): `rsync` also uses checksums to only copy what's necessary so theoretically we
        // could always `rsync` rather than checking if the directory's changed first.
        exec(
          util.format('rsync -a --delete --force --filter="P node_modules" "%s" "%s"', path.join(resolvedAppSrcDir, '/'), buildDirs.app)
        );
      } else {
        // TODO(wearhere): More efficient sync on Windows (where `rsync` isn't available.)
        rimraf(buildDirs.app);
        mkdirp(buildDirs.app);
        ncp(resolvedAppSrcDir, buildDirs.app);
        didOverwriteNodeModules = true;
      }
    }

    /* Write out the application package.json */
    // Do this after writing out the application files, since that will overwrite `package.json`.
    // This logic is a little bit inefficient: it's not the case that _every_ change to package.json
    // means that we have to reinstall the node modules; and if we overwrote the node modules, we
    // don't necessarily have to rewrite `package.json`. But doing it altogether is simplest.
    if (packageHasChanged || didOverwriteNodeModules) {
      buildRequired = true;

      // For some reason when this file isn't manually removed it fails to be overwritten with an
      // EACCES error.
      rimraf(packageJSONPath(buildDirs.app));
      writeFile(packageJSONPath(buildDirs.app), JSON.stringify(packageJSON));

      exec('npm install && npm prune', { cwd: buildDirs.app });

      /*
        THERE IS A PROBLEM WITH BUILDING NATIVE MODULES, SKIP FOR NOW
      */
      // // Rebuild native modules if any.
      // // TODO(jeff): Start using the pre-gyp fix if someone asks for it, so we can make sure it works:
      // // https://github.com/electronjs/electron-rebuild#node-pre-gyp-workaround
      // Promise.await(electronRebuild.installNodeHeaders(ELECTRON_VERSION, null /* nodeDistUrl */,
      //   null /* headersDir */, buildInfo.arch));
      // Promise.await(electronRebuild.rebuildNativeModules(ELECTRON_VERSION,
      //   path.join(buildDirs.app, 'node_modules'), null /* headersDir */, buildInfo.arch));
    }

    /* Write out Electron Settings */
    const settings = _.defaults({}, electronSettings, {
      rootUrl: process.env.ROOT_URL,
    });

    const signingIdentity = electronSettings.sign;
    let signingIdentityRequiredAndMissing = false;
    if (canServeUpdates(buildInfo.platform)) {
      // Enable the auto-updater if possible.
      if (buildInfo.platform === 'darwin' && !signingIdentity) {
        // If the app isn't signed and we try to use the auto-updater, it will
        // throw an exception. Log an error if the settings have changed, below.
        signingIdentityRequiredAndMissing = true;
      } else {
        settings.updateFeedUrl = settings.rootUrl + UPDATE_FEED_PATH;
      }
    }

    // check for settings changes
    if (settingsHaveChanged(settings, buildDirs.app)) {
      if (signingIdentityRequiredAndMissing) {
        console.error('Developer ID signing identity is missing: remote updates will not work.');
      }
      buildRequired = true;
      writeFile(settingsPath(buildDirs.app), JSON.stringify(settings));
    }

    /* check for resource file changes */
    const packagerSettings = getPackagerSettings(buildInfo, buildDirs);

    if (packagerSettings.icon && iconHasChanged(packagerSettings.icon, buildDirs.checksum)) {
      buildRequired = true;
    }

    if (packagerSettings['extend-info'] && fileHasChanged('plist', packagerSettings['extend-info'], buildDirs.checksum)) {
      buildRequired = true;
    }
    const sign = packagerSettings['osx-sign'];
    if (sign.entitlements && fileHasChanged('sandboxParent', sign.entitlements, buildDirs.checksum)) {
      buildRequired = true;
    }
    if (sign['entitlements-inherit'] && fileHasChanged('sandboxChild', sign['entitlements-inherit'], buildDirs.checksum)) {
      buildRequired = true;
    }

    // TODO(wearhere): If/when the signing identity expires, does its name change? If not, we'll need
    // to force the app to be rebuilt somehow.

    if (packagerSettingsHaveChanged(packagerSettings, buildDirs.working)) {
      buildRequired = true;
    }

    const app = appPath(appName, buildInfo.platform, buildInfo.arch, buildDirs.build);
    if (!exists(app)) {
      buildRequired = true;
    }

    if (electronSettings.autoPackage && electronSettings.bundleClient) {
      console.error('Bundling meteor client to package offline app. This will take a while...');
      meteorBuildClient({
        input: projectRoot(),
        output: buildDirs.web,
        path: '/',
        settings: _.pick(Meteor.settings, 'public'),
      });
      buildRequired = true;
    } else {
      // remove bundled meteor client
      rimraf(buildDirs.web);
    }

    /* Create Build */
    if (buildRequired) {
      const sourcedir = packagerSettings.dir;
      const appname = packagerSettings.name;
      const platform = packagerSettings.platform;
      const arch = packagerSettings.arch;
      const out = packagerSettings.out;
      const overwrite = packagerSettings.overwrite ? '--overwrite' : '';
      const downloadCache = packagerSettings.download.cache;
      // const osxSign = packagerSettings['osx-sign'];
      // const versionStringProductName = packagerSettings['version-string'];

      // all options:
      //  dir: '/Users/ali/test/meteor_offline2/.meteor-electron/darwin-x64/apps',
      //  name: 'my-app-name',
      //  platform: 'darwin',
      //  arch: 'x64',
      //  version: '4.1.0',
      //  out: '/Users/ali/test/meteor_offline2/.meteor-electron/darwin-x64/builds',
      //  download:
      //   { cache: '/Users/ali/test/meteor_offline2/.meteor-electron/darwin-x64/releases' },
      //  overwrite: true,
      //  'osx-sign': {},
      //  'version-string': { ProductName: 'my-app-name' },
      //  'app-version': '4.1.0' }
      exec(
        `npx electron-packager ${sourcedir} ${appname} --platform=${platform} --arch=${arch} --out=${out} ${overwrite} --download.cache=${downloadCache}`
      );
      console.log('Build created for ', buildInfo.platform, buildInfo.arch, 'at', out);
    }

    /* Package the build for download if specified. */
    // TODO(rissem): make this platform independent

    if (electronSettings.autoPackage && _.contains(['darwin', 'mas'], buildInfo.platform)) {
      // The auto-updater framework only supports installing ZIP releases:
      // https://github.com/Squirrel/Squirrel.Mac#update-json-format
      const downloadName = (appName || 'app') + '.zip';
      const compressedDownload = path.join(buildDirs.final, downloadName);

      if (buildRequired || !exists(compressedDownload)) {
        // Use `ditto` to ZIP the app because I couldn't find a good npm module to do it and also that's
        // what a couple of other related projects do:
        // - https://github.com/Squirrel/Squirrel.Mac/blob/8caa2fa2007b29a253f7f5be8fc9f36ace6aa30e/Squirrel/SQRLZipArchiver.h#L24
        // - https://github.com/jenslind/electron-release/blob/4a2a701c18664ec668c3570c3907c0fee72f5e2a/index.js#L109
        exec('ditto -ck --sequesterRsrc --keepParent "' + app + '" "' + compressedDownload + '"');
        console.log('Downloadable created at', compressedDownload);
      }
    }

    results[buildInfo.platform + '-' + buildInfo.arch] = {
      app,
      buildRequired,
    };
  });

  return results;
};

function createBuildDirectories(build) {
  // Use a predictable directory so that other scripts can locate the builds, also so that the builds
  // may be cached:

  const workingDir = path.join(projectRoot(), '.meteor-electron', build.platform + '-' + build.arch);
  mkdirp(workingDir);

  // TODO consider seeding the binaryDir from package assets so package
  // could work without an internet connection

  // *binaryDir* holds the vanilla electron apps
  const binaryDir = path.join(workingDir, 'releases');
  mkdirp(binaryDir);

  // *checksumDir* holds checksums of resources
  const checksumDir = path.join(workingDir, '.checksum');
  mkdirp(checksumDir);

  // *appDir* holds the electron application that points to a meteor app
  const appDir = path.join(workingDir, 'apps');
  mkdirp(appDir);

  // *webDir* holds the meteor client code which could be packaged for offline use
  const webDir = path.join(appDir, 'web');

  // *buildDir* contains the uncompressed apps
  const buildDir = path.join(workingDir, 'builds');
  mkdirp(buildDir);

  // *finalDir* contains zipped apps ready to be downloaded
  const finalDir = path.join(workingDir, 'final');
  mkdirp(finalDir);

  return {
    working: workingDir,
    binary: binaryDir,
    checksum: checksumDir,
    app: appDir,
    web: webDir,
    build: buildDir,
    final: finalDir,
  };
}

function getPackagerSettings(buildInfo, dirs) {
  const packagerSettings = {
    dir: dirs.app,
    name: electronSettings.name || 'Electron',
    platform: buildInfo.platform,
    arch: buildInfo.arch,
    version: ELECTRON_VERSION,
    out: dirs.build,
    // cache: dirs.binary,
    download: {
      cache: dirs.binary,
    },
    overwrite: true,
    'osx-sign': {},
    // The EXE's `ProductName` is the preferred title of application shortcuts created by `Squirrel.Windows`.
    // If we don't set it, it will default to "Electron".
    'version-string': {
      ProductName: electronSettings.name || 'Electron',
    },
  };

  if (electronSettings.version) {
    packagerSettings['app-version'] = electronSettings.version;
  }
  if (electronSettings.copyright) {
    packagerSettings['app-copyright'] = electronSettings.copyright;
  }
  if (electronSettings.bundleId) {
    packagerSettings['app-bundle-id'] = electronSettings.bundleId;
  }
  if (electronSettings.category) {
    packagerSettings['app-category-type'] = electronSettings.category;
  }
  if (electronSettings.extendPlist) {
    packagerSettings['extend-info'] = path.join(projectRoot(), electronSettings.extendPlist);
  }
  if (electronSettings.icon) {
    const icon = electronSettings.icon[buildInfo.platform];
    if (icon) {
      const iconPath = path.join(projectRoot(), icon);
      packagerSettings.icon = iconPath;
    }
  }
  if (_.isString(electronSettings.sign)) {
    packagerSettings['osx-sign'].identity = electronSettings.sign;
  }
  if (electronSettings.sandbox) {
    if (electronSettings.sandbox.parent) {
      packagerSettings['osx-sign'].entitlements = path.join(projectRoot(), electronSettings.sandbox.parent);
    }
    if (electronSettings.sandbox.child) {
      packagerSettings['osx-sign']['entitlements-inherit'] = path.join(projectRoot(), electronSettings.sandbox.child);
    }
  }
  if (electronSettings.protocols) {
    packagerSettings.protocols = electronSettings.protocols;
  }
  return packagerSettings;
}

function settingsPath(appDir) {
  return path.join(appDir, 'electronSettings.json');
}

function settingsHaveChanged(settings, appDir) {
  const electronSettingsPath = settingsPath(appDir);
  let existingElectronSettings;
  try {
    existingElectronSettings = Npm.require(electronSettingsPath);
  } catch (e) {
    // No existing settings.
  }
  return !existingElectronSettings || !_.isEqual(settings, existingElectronSettings);
}

function appHasChanged(appSrcDir, checksumDir) {
  const appChecksumPath = path.join(checksumDir, 'app.checksum.txt');
  let existingAppChecksum;
  try {
    existingAppChecksum = readFile(appChecksumPath, 'utf8');
  } catch (e) {
    // No existing checksum.
  }

  const appChecksum = dirsum(appSrcDir);
  if (appChecksum !== existingAppChecksum) {
    writeFile(appChecksumPath, appChecksum);
    return true;
  } else {
    return false;
  }
}

function packageJSONPath(appDir) {
  return path.join(appDir, 'package.json');
}

function packageJSONHasChanged(packageJSON, appDir) {
  const packagePath = packageJSONPath(appDir);
  let existingPackageJSON;
  try {
    existingPackageJSON = Npm.require(packagePath);
  } catch (e) {
    // No existing package.
  }

  return !existingPackageJSON || !_.isEqual(packageJSON, existingPackageJSON);
}

function packagerSettingsHaveChanged(settings, workingDir) {
  const settingsPath = path.join(workingDir, 'lastUsedPackagerSettings.json');
  let existingPackagerSettings;
  try {
    existingPackagerSettings = Npm.require(settingsPath);
  } catch (e) {
    // No existing settings.
  }

  if (!existingPackagerSettings || !_.isEqual(settings, existingPackagerSettings)) {
    writeFile(settingsPath, JSON.stringify(settings));
    return true;
  } else {
    return false;
  }
}

function iconHasChanged(iconPath, checksumDir) {
  const iconChecksumPath = path.join(checksumDir, 'icon.checksum.txt');
  let existingIconChecksum;
  try {
    existingIconChecksum = readFile(iconChecksumPath, 'utf8');
  } catch (e) {
    // No existing checksum.
  }

  // `dirsum` works for files too.
  const iconChecksum = dirsum(iconPath);
  if (iconChecksum !== existingIconChecksum) {
    writeFile(iconChecksumPath, iconChecksum);
    return true;
  } else {
    return false;
  }
}

function fileHasChanged(resourceName, filePath, checksumDir) {
  const fileChecksumPath = path.join(checksumDir, resourceName + '.checksum.txt');
  let existingFileChecksum;
  try {
    existingFileChecksum = readFile(fileChecksumPath, 'utf8');
  } catch (e) {
    // No existing checksum.
  }

  // `dirsum` works for files too.
  const fileChecksum = dirsum(filePath);
  if (fileChecksum !== existingFileChecksum) {
    writeFile(fileChecksumPath, fileChecksum);
    return true;
  } else {
    return false;
  }
}

function appPath(appName, platform, arch, buildDir) {
  const appExtension = _.contains(['darwin', 'mas'], platform) ? '.app' : '.exe';
  return path.join(buildDir, [appName, platform, arch].join('-'), appName + appExtension);
}
