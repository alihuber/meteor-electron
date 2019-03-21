/* global Meteor */
const electronSettings = Meteor.settings.electron || {};

if (process.env.NODE_ENV === 'development' && electronSettings.autoBuild !== false) {
  const buildResults = createBinaries();
  let buildResultForThisPlatform = buildResults[process.platform + '-' + process.arch];

  // if no build could be found, check if we build for mas
  if (!buildResultForThisPlatform && process.platform === 'darwin') {
    buildResultForThisPlatform = buildResults['mas' + '-' + process.arch];
  }

  if (buildResultForThisPlatform) {
    launchApp(buildResultForThisPlatform.app, buildResultForThisPlatform.buildRequired);
  }
}

serveDownloadUrl();
serveUpdateFeed();
