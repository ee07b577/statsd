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

var time = -1; // 用整数表示一天中的某个时间段
var interval = 4; // 统计时间间隔，单位为秒
var cur_table = ''; // 当前要插入的数据表
var preday_table = ''; // 前一天的数据表
var preweek_table = ''; // 前一周同一天的数据表

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

function queryAndUpdate(fields, cur_table, preday_table, preweek_table, callback) {
        // 执行查询，返回相应表，相应时间，相应名字的错误数量，查询语句可以在time出适当浮动
        connection.query('SELECT count FROM ' + preday_table + ' WHERE time=' + fields.time + ' AND name="' + fields.name + '"', function (error, rows) {
            if (!error && rows.length > 0 && rows[0]) {
                var preday_count = rows[0].count;
                fields.increm_preday = fields.count - preday_count;
                fields.ratio_preday = fields.increm_preday/preday_count;
            }
            callback(fields, cur_table, preweek_table);
      });
}

function queryPreweekValue(fields, cur_table, preweek_table) {
        // 执行查询，返回相应表，相应时间，相应名字的错误数量，查询语句可以在time出适当浮动
        connection.query('SELECT count FROM ' + preweek_table + ' WHERE time=' + fields.time + ' AND name="' + fields.name + '"', function (error, rows) {
            if (!error && rows.length > 0 && rows[0]) {
                var preweek_count = rows[0].count;
                fields.increm_preweek = fields.count - preweek_count;
                fields.ratio_preweek = fields.increm_preweek/preweek_count;
            }
            putIntoStorage(cur_table, fields);
      });
}

function putIntoStorage(table_name, fields) {

        connection.query('INSERT INTO ' + table_name + ' SET ? ', fields, function (error) {
            if (error) {
                if (error.code === 'ER_NO_SUCH_TABLE') {
                    createTable(table_name, function() {
                        time = -1;
                        putIntoStorage(table_name, fields);
                    });
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

AlertBackend.prototype.flush = function(timestamp, metrics) {

  // 拼出表名，TODO: 抽象出一个函数
  var year, month, day, m, d;

  var date = new Date(timestamp * 1000);

  // 首先打印出flush 事件的时间，这里用于调试
  console.log('Flushing stats at', date.toString());
  console.log("");
  console.log("");
  console.log("");

  year = date.getFullYear();
  var date = new Date(timestamp * 1000);
  m = date.getMonth() + 1;
  d = date.getDate();
  month = m < 10 ? '0' + m : m;
  day = d < 10 ? '0' + d : d;
  cur_table = TABLE_PREFIX + year + month + day;

  date = new Date((timestamp - 24 * 60 * 60) * 1000);
  year = date.getFullYear();
  m = date.getMonth() + 1;
  d = date.getDate();
  month = m < 10 ? '0' + m : m;
  day = d < 10 ? '0' + d : d;
  preday_table = TABLE_PREFIX + year + month + day;

  date = new Date((timestamp - 7 * 24 * 60 * 60) * 1000);
  year = date.getFullYear();
  m = date.getMonth() + 1;
  d = date.getDate();
  month = m < 10 ? '0' + m : m;
  day = d < 10 ? '0' + d : d;
  preweek_table = TABLE_PREFIX + year + month + day;


  // 算出时间编号
  if (time < 0) {
    time = Math.floor((date.getHours()*60 + date.getMinutes())/interval);
  } else {
    time ++;
  }

  // 更新计数器状态
  this.lastCounters = clone(this.counters);
  this.counters = clone(metrics.counters);

  var lastVal, newVal, increm_pre, predayVal, increm_preday, preweekVal, increm_preweek;
  for (var key in this.counters) {
      // 如果为statsd 本身统计数据，对定位错误无意义，去掉
      if (key === 'statsd.bad_lines_seen' || key === 'statsd.packets_received') continue;

      newVal = this.counters[key];
      // 如果该项计数为0，无价值，去掉
      if (newVal === 0) continue;

      // 拼纪录对象，insert 到 mysql 中
      var fields = {};
      fields.name = key;
      fields.time = time;
      fields.count = newVal;
      fields.increm_pre = null;
      fields.ratio_pre = null;
      fields.increm_preday = null;
      fields.ratio_preday = null;
      fields.increm_preweek = null;
      fields.ratio_preweek = null;

      if (this.lastCounters.hasOwnProperty(key)) {
          lastVal = this.lastCounters[key];
      } else {
          lastVal = 0;
      }

      increm_pre = newVal-lastVal;
      fields.increm_pre = increm_pre;
      fields.ratio_pre = (lastVal===0) ? null:(increm_pre/lastVal);

      // 查询前一天和前一周相应时间的纪录，更新fields.increm_preday等，并入库
      queryAndUpdate(fields, cur_table, preday_table, preweek_table, queryPreweekValue);
      
      // 应用报警策略
      if (false) {
          mailOptions = {
              from:"liangfangfang <ee07b577@gmail.com>",
              to:"liangfangfang <liangfangfang@meituan.com>",
              subject:key + " alert of fe js error!",
              text:key + " error increases " + ratio_last + " in fe www!",
              html:"<b>" + key + " error increases " + ratio_last + " in fe www!</b>",
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
