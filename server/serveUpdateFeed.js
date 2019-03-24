/* global Npm, Meteor */
import { serve, serveDir } from './serve';
import { DOWNLOAD_URLS } from './downloadUrls';

const semver = Npm.require('semver');
const urlJoin = Npm.require('url-join');
const electronSettings = Meteor.settings.electron || {};
const latestVersion = electronSettings.version;

export const canServeUpdates = function (platform) {
  if (!latestVersion) {
    return false;
  }

  return !!DOWNLOAD_URLS[platform];
};

export const UPDATE_FEED_PATH = '/app/latest';

export const serveUpdateFeed = function () {
  // https://github.com/Squirrel/Squirrel.Mac#server-support
  if (canServeUpdates('darwin')) {
    serve(UPDATE_FEED_PATH, function (req, res, next) {
      const appVersion = req.query.version;
      if (semver.valid(appVersion) && semver.gte(appVersion, latestVersion)) {
        res.statusCode = 204; // No content.
        res.end();
      } else {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            url: DOWNLOAD_URLS.darwin,
          })
        );
      }
    });
  }

  // https://github.com/squirrel/squirrel.windows
  // (Summary 'cause those docs are scant: the Windows app is going to expect the update feed URL
  // to represent a directory from within which it can fetch the RELEASES file and packages. The
  // above `serve` call serves _just_ '/app/latest', whereas this serves its contents.)
  if (canServeUpdates('win32')) {
    // `path.dirname` works even on Windows.
    const releasesUrl = DOWNLOAD_URLS.win32.releases;
    serveDir(UPDATE_FEED_PATH, function (req, res, next) {
      // first strip off the UPDATE_FEED_PATH
      let path = req.url.split(UPDATE_FEED_PATH)[1];
      res.statusCode = 302;
      // Cache-bust the RELEASES file.
      if (/RELEASES/.test(path)) {
        path += (/\?/.test(path) ? '&' : '?') + 'cb=' + Date.now();
      }
      res.setHeader('Location', urlJoin(releasesUrl, path));
      res.end();
    });
  }
};
