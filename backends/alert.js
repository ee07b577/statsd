/*jshint node:true, laxcomma:true */

var util = require('util');
var mysql = require('mysql');
var connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'dbweb01'
    });

var TABLE_TEMPLATE = 'fe_statsd_template';
var TABLE_PREFIX = 'fe_statsd_';
var date;

var nodemailer = require('nodemailer');
var transport = nodemailer.createTransport('SMTP', {
                service: "Gmail",
                auth: {
                    user:"ee07b577@gmail.com",
                    pass:"liangfang110"
                    }
                });
var mailOptions = {};

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

function putIntoStorage(fields) {

        connection.query('INSERT INTO ' + table_name + ' SET ? ', fields, function (error) {
            if (error) {
                if (error.code === 'ER_NO_SUCH_TABLE') {
                    createTable(table_name, function() {
                        putIntoStorage(fields);
                    });
                } else {
                 console.log("Failed to insert data into table" + error );
                }
            }
      });
}

function createTable(table_name, callback) {
    connection.query('CREATE TABLE IF NOT EXISTS ' + table_name + ' like ' + TABLE_TEMPLATE, function (error) {
        if(error) {
            console.log ("Failed to create new table. " + error );
        } else {
            console.log("Table has been created: " + table_name );
            callback();
        }
  });
}

var time = -1;
var interval = 10;
var table_name = '';

AlertBackend.prototype.flush = function(timestamp, metrics) {

  // 首先打印出flush 事件的时间，这里用于调试
  var date = new Date(timestamp * 1000);
  console.log('Flushing stats at', date.toString());
  console.log("");
  console.log("");
  console.log("");
  console.log("");

  // 拼出表名
  var year = date.getFullYear();
  var month = date.getMonth() + 1;
  var day = date.getDate();
  table_name = TABLE_PREFIX + year + month + day;

  // 算出时间编号
  if (time<0) {
    time = Math.floor((date.getHours()*60 + date.getMinutes())/interval);
  } else {
    time ++;
  }

  // 更新计数器状态
  this.lastCounters = clone(this.counters);
  this.counters = clone(metrics.counters);
  // 计算每项错误数量的增长比率并发邮件报警
  var oldVal, newVal, ratio;
  for (var key in this.counters) {
      // 如果为statsd 本身统计数据，对定位错误无意义，去掉
      if (key === 'statsd.bad_lines_seen' || key === 'statsd.packets_received') continue;

      newVal = this.counters[key];
      // 拼凑纪录对象，insert 到 mysql 中
      var fields = {};
      fields.time = time;
      fields.name = key;
      fields.count = newVal;
      fields.ratio = 0;

      // 应用报警策略
      if (this.lastCounters.hasOwnProperty(key)) {
          oldVal = this.lastCounters[key];
          console.log(key + ' ' + oldVal + ' ' + newVal);
          if (oldVal !== 0) {
              ratio = (newVal-oldVal)/oldVal;
              fields.ratio = ratio;
          }

          // 将结果存入mysql
          putIntoStorage(fields);
          console.log("put into storage");

          if (oldVal !== 0 && ratio > 5) {
              console.log("alert: " + key);
              mailOptions = {
                  from:"liangfangfang <ee07b577@gmail.com>",
                  to:"liangfangfang <liangfangfang@meituan.com>",
                  subject:key + " alert of fe js error!",
                  text:key + " error increases " + ratio + " in fe www!",
                  html:"<b>" + key + " error increases " + ratio + " in fe www!</b>",
              }
              transport.sendMail(mailOptions, function(error, response){
                  if (error) {
                      console.log(error);
                  } else {
                      console.log(response);
                  }
              });
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
