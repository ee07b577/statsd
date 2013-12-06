/*jshint node:true, laxcomma:true */

var util = require('util');

function AlertBackend(startupTime, config, emitter){
  var self = this;
  this.counters = {};
  this.lastCounters = {};
  this.lastFlush = startupTime;
  this.lastException = startupTime;
  this.config = config.console || {};

  // attach
  emitter.on('flush', function(timestamp, metrics) { self.flush(timestamp, metrics); });
  emitter.on('status', function(callback) { self.status(callback); });
}

function clone(p) {
    var s = {};
    for (var k in p) {
        if (p.hasOwnProperty(k)) {
            s[k] = p[k];
        }
    }
    return s;
}

AlertBackend.prototype.flush = function(timestamp, metrics) {

  console.log('Flushing stats at', new Date(timestamp * 1000).toString());
  this.lastCounters = clone(this.counters);
  this.counters = clone(metrics.counters);
  var oldVal, newval;
  for (var key in this.counters) {
      if (this.lastCounters.hasOwnProperty(key)) {
          newVal = this.counters[key];
          oldVal = this.lastCounters[key];
          console.log(key + ' ' + oldVal + ' ' + newVal);
          if (oldVal !== 0 && (newVal-oldVal)/oldVal > 0.2) {
              console.log("alert: " + key);
          }
      }
  }
};

AlertBackend.prototype.status = function(write) {
  ['lastFlush', 'lastException'].forEach(function(key) {
    write(null, 'console', key, this[key]);
  }, this);
};

exports.init = function(startupTime, config, events) {
  var instance = new AlertBackend(startupTime, config, events);
  return true;
};
