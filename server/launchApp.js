/* global Npm, Mongo, Meteor */
const path = Npm.require('path');
const proc = Npm.require('child_process');

const ElectronProcesses = new Mongo.Collection('processes');

const electronSettings = Meteor.settings.electron || {};

const isRunning = function (pid) {
  try {
    return process.kill(pid, 0);
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const ProcessManager = {
  add(pid) {
    ElectronProcesses.insert({ pid });
  },

  running() {
    let runningProcess;
    ElectronProcesses.find().forEach(function (p) {
      if (isRunning(p.pid)) {
        runningProcess = p.pid;
      } else {
        ElectronProcesses.remove({ _id: p._id });
      }
    });
    return runningProcess;
  },

  stop(pid) {
    process.kill(pid);
    ElectronProcesses.remove({ pid });
  },
};

export const launchApp = function (app, appIsNew) {
  // Safeguard.
  if (process.env.NODE_ENV !== 'development') return;

  const runningProcess = ProcessManager.running();
  if (runningProcess) {
    if (!appIsNew) {
      return;
    } else {
      ProcessManager.stop(runningProcess);
    }
  }

  let electronExecutable;
  let child;
  if (process.platform === 'win32') {
    electronExecutable = app;
    child = proc.spawn(electronExecutable);
  } else {
    const appName = electronSettings.name || 'Electron';
    electronExecutable = path.join(app, 'Contents', 'MacOS', appName);
    const appDir = path.join(app, 'Contents', 'Resources', 'app');

    // TODO figure out how to handle case where electron executable or
    // app dir don't exist
    child = proc.spawn(electronExecutable, [appDir]);
  }

  child.stdout.on('data', function (data) {
    console.log('ATOM:', data.toString());
  });

  child.stderr.on('data', function (data) {
    console.log('ATOM:', data.toString());
  });

  ProcessManager.add(child.pid);
};
