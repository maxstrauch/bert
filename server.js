// Required modules
var http = require('http');
var url = require('url');
var fs = require('fs');
var downloader = require('./NodeDownloader.js');

// --------------------------------------------------------------------
// Configuration section

// Socket port on which the server listens
var SERVER_PORT = 8080;
// IP address or hostname on which the server listens
var SERVER_HOST = "127.0.0.1";
// Path to the directory containing the downloaded files. This path 
// must end with a slash
var DOWNLOAD_DIR = 'downloads/';
// Name of this application (DO NOT CHANGE!)
var APP_NAME = 'Bert';
// Version of this application (DO NOT CHANGE!)
var APP_VERSION = '0.42.1';
// Script to be executed when the user clicks on "Run user script".
// The second argument takes the script name relative to this file
var SCRIPT = require('./ScriptRunner.js').ScriptRunner('./script.sh');
// The 'password' used to trigger a shutdown command of the
// system the server currently runs on
var SHUTDOWN_CODE = 'abby';
// The shell command executed when a shutdown is triggered
var SHUTDOWN_CMD = 'sleep 10';
// Queue database file name (where the waiting downlaods are saved)
var QUEUE_DB_FN = './queue.json';

// --------------------------------------------------------------------

// Download ID counter (only used internally)
var ID_COUNTER = 0;

// List of all downlaods
var ALL = [];

// The current download (or false if there is no current download)
var CURRENT = false;

// Removes a directory and all its content
// @see https://gist.github.com/liangzan/807712
function rmDir(dirPath) { //: boolean
  try {
  	var files = fs.readdirSync(dirPath);
  } catch(e) { 
  	return false;
  }

  if (files.length > 0) {
    for (var i = 0; i < files.length; i++) {
      var filePath = dirPath + '/' + files[i];
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      } else {
        rmDir(filePath);
      }
    }
  }
  fs.rmdirSync(dirPath);
  return true;
}

// Creates the download directory
function createDownloadDir() {
	// Make sure that there is a downloads directory
	try {
		if (fs.statSync(DOWNLOAD_DIR).isDirectory()) {
			return; // Everything fine
		}
	} catch(e) {
		// Don't watch; (re-)create directory
	}

	fs.mkdir(DOWNLOAD_DIR,function(e){
	    if(e && !(e.code === 'EEXIST')){
	        console.log(' *** Error creating dir `' + DOWNLOAD_DIR + '`: ' + e);
	    } else {
	    	console.log(' *** Oops! There was no `' + DOWNLOAD_DIR + '` dir');
	    }
	});
}

// Calculates the used disk space of the downloads 
// by invoking the `du` command
// FIXME: this function might not work properly (test & correct)
function usedDsk() {
	createDownloadDir();

	var result = -1;
	try {
		var result = parseInt(
			require('child_process')
			.execSync('du -ks ./' + DOWNLOAD_DIR)
			.toString()
		) * 1024;
	} catch(e) {
		result = -1; // Nothing fancy here
	}
	return result;
}

// Calculates the free disk space by parsing the `df` output
// FIXME: this function might not work properly (test & correct)
function freeDsk() {
	createDownloadDir();

	var result = -1;
	try {
		var result = 
			require('child_process')
			.execSync('df -Pk ./' + DOWNLOAD_DIR)
			.toString()
			.split(/\n/g)[1]
			.split(/\s+/g);

		var cnt = 0;
		for (var i = 0; i < result.length; i++) {
			if (result[i].match(/^[0-9]+$/g)) {
				if (cnt == 1) {
					result += parseInt(result[i]) * 1024;
					break;
				}
				if (cnt == 2) {
					result += parseInt(result[i]) * 1024;
					break;
				}
				cnt++;
			}
		}
	} catch(e) {
		result = -1; // Nothing fancy here
	}
	return result;
}

// Simple function to provide some MIME types needed by the
// server
function mimeLookup(extension) {
	var list = {
		'htm': 'text/html',
		'html': 'text/html',
		'htmls': 'text/html',
		'css': 'text/css',
		'js': 'text/javascript',
		'svg': 'image/svg+xml',
		'eot': 'application/vnd.ms-fontobject',
		'ttf': 'font/truetype',
		'woff': 'application/font-woff',
		'woff2': 'application/font-woff2',
		'png': 'image/png',
		'ico': 'image/x-icon'
	};
	for (var key in list) {
		if (key === extension) {
			return list[key];
		}
	}
	return 'application/octet-stream';
}

// Very basic HTTP error message assembler
function cry(res, statusCode, message) {
	res.writeHead(statusCode, {'Content-Type': 'text/html'});
	res.write('<!DOCTYPE html><html><head><title>Error report</title>');
	res.write('</head><body>');
	res.write('<h1>HTTP ' + statusCode + '</h1>');
	if (message) {
		res.write('<p>' + message + '</p>');
	}
	res.end('</body></html>');
}

// This function is called when a new download should start.
function onStart() {
	if (CURRENT != false || ALL.length < 1) {
		return; // Nothing to do here
	}

	// Get the next download
	CURRENT = false;
	for (var i = 0; i < ALL.length; i++) {
		if (ALL[i].state == 0) {
			CURRENT = ALL[i];
			break;
		}
	}
	if (CURRENT == false) {
		return; // Nothing to do (?!)
	}

	// Begin the download process
	CURRENT.downloader.downloadFile(CURRENT.url);
	CURRENT.state = 1; // Downloading

	// Event listeners
	CURRENT.downloader.eventEmitter.on('progress', function(percent, speed) {
		CURRENT.percent = percent;
		CURRENT.speed = speed;
		CURRENT.eta = CURRENT.downloader.getETA();
		CURRENT.filename = CURRENT.downloader.getSaveTo();
		CURRENT.name = CURRENT.downloader.getName();
	});
	CURRENT.downloader.eventEmitter.on('finished', function() {
		CURRENT.state = 2;
		CURRENT.success = CURRENT.downloader.wasSuccessfull();
		try {
			var stat = fs.statSync(CURRENT.filename);
			CURRENT.size = stat.size;
		} catch (e) {
			CURRENT.size = 0;
			CURRENT.success = false;
			CURRENT.errmsg = e.toString();
		}
		CURRENT = false;
		persist();

		// Let the next download begin (if any)
		onStart();
	});
}

// Persists the current running download and all waiting
// downloads to the backup file (JSON content)
function persist() {
	var output = [];

	// Pull out all waiting downloads
	for (var i = 0; i < ALL.length; i++) {
		if (ALL[i].state == 0 /* queued */ || 
				ALL[i].state == 1 /* active */) {
			output.push(ALL[i].url);
		}
	}

	// Save data to file
	fs.writeFile(QUEUE_DB_FN, JSON.stringify(output), function(err) {
	    if(err) {
	        console.log(' *** Failed to write: ' + QUEUE_DB_FN + ' (' + err + ')');
	        return;
	    }
	    console.log(' *** Download queue saved to queue.json');
	}); 
}

// Loads (on server start) all downloaded files from the
// download folder and all pending files
function load() {
	// All waiting downloads (from previous run)
	fs.readFile(QUEUE_DB_FN, function read(err, data) {
	    if (err) {
	        console.log(' *** Can\'t read ' + QUEUE_DB_FN + ' (no saved downloads?)');
	        return;
	    }

	    // Get all URLs for waiting downloads
    	var waiting = JSON.parse(data);
    	for (var i = 0; i < waiting.length; i++) {
    		console.log(' *** Restoring `' + waiting[i] + '`');
    		createDownload(waiting[i]);
    	}

    	if (waiting.length > 0) {
    		console.log(' *** ' + waiting.length + ' waiting downloads restored; ' +
    					' resuming download ...');
    		onStart();
    	}
	});

	// Scan the downloads directory for downloaded files and 
	// add them to the view
	createDownloadDir();
	var files = fs.readdirSync(DOWNLOAD_DIR);
	for (var i in files){
	    var stat = fs.statSync(DOWNLOAD_DIR + '/' + files[i]);
	    if (stat.isDirectory()){
	        getFiles(name, files_);
	    } else {
			var entry = {
				'id': ID_COUNTER++,
				'url': undefined, 
				'downloader': undefined,
				'state': 4,
				'percent': 0,
				'speed': 0,
				'eta': 0,
				'filename': DOWNLOAD_DIR + '/' + files[i],
				'success': true,
				'size': stat.size,
				'name': files[i],
				'errmsg': ''
			};
			ALL.push(entry);
	    }
	}
}

function createDownload(url) {
	var entry = {
		'id': ID_COUNTER++,
		'url': url, 
		'downloader': new downloader.NodeDownloader(DOWNLOAD_DIR),
		/* 0 = queued , 1 = active, 2 = finished, 3 = stopped, 4 = file only */
		'state': 0,
		'percent': 0,
		'speed': 0,
		'eta': 0,
		'filename': '',
		'success': true,
		'size': 0,
		'name': '',
		'errmsg': ''
	};
	ALL.push(entry);
}

// --------------------------------------------------------------------
// HTTP server section

// Handles REST requests
function rest(args) {
	// Add new file to download
	if (args.url) {
		// Check if the given URL is valid
		if (!(args.url.indexOf("http") === 0 || args.url.indexOf("ftp") === 0)) {
			return {'state': 500}; // Unknown URL
		}

		// Check if URL is known
		if (!args.force) { // Omit test if forced
			for (var i = 0; i < ALL.length; i++) {
				if (ALL[i].url == args.url) {
					// URL already seen
					return {'state': 501};
				}
			}
		}

		createDownload(args.url);
		// Add entry and run it (maybe if there is no other running download)
		persist();
		onStart();
		return {'state': 200};
	}

	if (args.cmd && args.cmd == 'list') {
		return {'state': 200, 'all': ALL};
	}

	if (args.cmd && args.cmd == 'stop' && args.id) {
		var elem = false;
		for (var i = ALL.length - 1; i >= 0; i--) {
			if (ALL[i].id == args.id) {
				elem = ALL[i];
				break;
			}
		}

		if (elem == undefined || elem == null) {
			// FIXME: make me nicer (more detailed response code?)
			return {'state': 400};
		}

		// Perform action
		if (elem.state == 1) {
			// Stop the current download
			elem.downloader.stopDownload();
			elem.state = 3;
			elem.success = false;
			elem.percent = 0;
			elem.speed = 0;
			elem.eta = 0;
			// Reset the current element to let a new download start
			CURRENT = false;

			// Let the next download begin (if any)
			onStart();
			persist();
			return {'state': 200};
		} else if (elem.state == 0) {
			// Simply deactivate a queued download
			elem.state = 3;
			elem.success = false;
			elem.percent = 0;
			elem.speed = 0;
			elem.eta = 0;
			persist();
			return {'state': 200};
		}
	}

	if (args.cmd && args.cmd == 'dskstat') {
		var used = usedDsk();
		var free = freeDsk();
		return {
			'state': 200, 
			'used': used, 
			'free': free, 
			'percent': (used/free)*100.0,
		};
	}

	if (args.cmd && args.cmd == 'versions') {
		// Get module versions
		var info = process.versions;
		var str = '';
		for (var key in info) {
			str += key + ' v' + info[key];
		}

		return {
			'state': 200, 
			'node': 'NodeJS v' + info.node + ' (V8 v' + info.v8 + ')',
			'app': APP_NAME + ' v' + APP_VERSION
		};
	}

	if (args.cmd && args.cmd == 'clear-all') {
		if (!rmDir(DOWNLOAD_DIR)) {
			return {'state': 501};
		}
		ALL = [];
		persist();
		return {'state': 200};
	}

	if (args.cmd && args.cmd == 'user-script') {
		// Test only for state
		if (args.test) {
			return {'state': SCRIPT.getState() == 0 ? 500 : 200};
		}

		// Run the script
		if (args.run && SCRIPT.getState() == 0) {
			return {'state': SCRIPT.run() ? 200 : 400};
		}

		if (args.exit) {
			SCRIPT.clear();
		}

		return {'state': 200, 'data': SCRIPT.getOutput(), 'finished': SCRIPT.getState() == 2};
	}

	if (args.cmd && args.cmd == 'halt' && args.code) {
		if (args.code == SHUTDOWN_CODE) {
			// Trigger shutdown
			require('child_process').execSync(SHUTDOWN_CMD);
			console.log(' *** Server will shutdown now (' + new Date().toString() + ')');
			return {'state': 200};	
		}
		return {'state': 500};
	}

	return {'state': 400};
}

// Create the HTTP server
http.createServer(function (req, res) {
	// Parse the requested URL
	var parsedUrl = url.parse(req.url, true);

	// Backend REST API on the path /rest/
	if (parsedUrl.pathname.indexOf('/rest/') == 0) {
		// Get the arguments
		var args = parsedUrl.query;

		// Leth the REST API do the work ...
		var response = rest(args);

		// Return the result
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.end(JSON.stringify(response));
	} else {
		
		// Parse the requested file name to get only the file
		// requested
		var file = parsedUrl.pathname;
		var index = file.lastIndexOf('/');
		if (file.length < 1 && index < 0) {
			cry(res, 500, 'Requested filename invalid.');
			return;
		}
		file = file.substring(index + 1);

		// Empty files are redirected to the index page
		if (file.length < 1) {
			file = "index.html";
		}

		// Get the file extension (for MIME type)
		index = file.lastIndexOf('.');
		var extension = file.substring(index + 1);

		// Check if file exists in the www/ dir and can be served
		if (!fs.existsSync('www/' + file)) {
			cry(res, 404);
		} else {
			try {
				var data = fs.readFileSync('www/' + file);
				res.writeHead(200, {
					'Content-Type': mimeLookup(extension),
					'Content-Length': data.length
				});
				res.end(data);
			} catch (err) {
				cry(res, 500, err);
			}
		}
	}
}).listen(SERVER_PORT, SERVER_HOST);

// Init the server and print logging to the standard output
console.log(' *** Welcome to ' + APP_NAME + ' (v ' + APP_VERSION + ')');
console.log(' *** Server running at http://' + SERVER_HOST + ':' + SERVER_PORT + '/');
console.log(' *** Press CTRL + C to quit')

// Load all previous and possibly pending downloads after
// everything is set-up
load();
