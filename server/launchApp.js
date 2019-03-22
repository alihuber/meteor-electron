var path = Npm.require('path');
var proc = Npm.require('child_process');
var Future = Npm.require('fibers/future');

var ElectronProcesses = new Mongo.Collection('processes');

var electronSettings = Meteor.settings.electron || {};

var isRunning = function(pid) {
  try {
    return process.kill(pid, 0);
  } catch (e) {
    return e.code === 'EPERM';
  }
};

var ProcessManager = {
  add: function(pid) {
    ElectronProcesses.insert({ pid: pid });
  },

  running: function() {
    var runningProcess;
    ElectronProcesses.find().forEach(function(proc) {
      if (isRunning(proc.pid)) {
        runningProcess = proc.pid;
      } else {
        ElectronProcesses.remove({ _id: proc._id });
      }
    });
    return runningProcess;
  },

  stop: function(pid) {
    process.kill(pid);
    ElectronProcesses.remove({ pid: pid });
  },
};

launchApp = function(app, appIsNew) {
  // Safeguard.
  if (process.env.NODE_ENV !== 'development') return;

  var runningProcess = ProcessManager.running();
  if (runningProcess) {
    if (!appIsNew) {
      return;
    } else {
      ProcessManager.stop(runningProcess);
    }
  }

  var electronExecutable, child;
  if (process.platform === 'win32') {
    electronExecutable = app;
    child = proc.spawn(electronExecutable);
  } else {
    const appName = electronSettings.name || 'Electron';
    electronExecutable = path.join(app, 'Contents', 'MacOS', appName);
    var appDir = path.join(app, 'Contents', 'Resources', 'app');

    //TODO figure out how to handle case where electron executable or
    //app dir don't exist
    child = proc.spawn(electronExecutable, [appDir]);
  }

  child.stdout.on('data', function(data) {
    console.log('ATOM:', data.toString());
  });

  child.stderr.on('data', function(data) {
    console.log('ATOM:', data.toString());
  });

  ProcessManager.add(child.pid);
};
