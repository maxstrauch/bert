var	spawn = require('child_process').spawn,
    events = require('events');

// Creates a new download object with the directory
// where the downloaded file should be saved
function NodeDownloader(dirToSave) {

	// The object of the new process
	var dl;

	// Event emitter
	var eventEmitter = new events.EventEmitter();

	// Last progress value (fire event only on progress change
	// otherwise we would pipe too many calls to the server (maybe))
	var lastProgress;
	
	// General buffer object
	var buffer = '';
	
	// State of this download (see nextLine())
	var state = 0;

	// Other status information variables
	var httpState = -1, retval = -1, contentLength = -1;
	var progress, bytesReceived, downloadRate, eta;
	var saveTo;

	// stopDownload() not yet called
	var wasKilled = false;

	// add the Trim function to javascript
	String.prototype.trim = function() {
		return this.replace(/^\s+|\s+$/g, '');
	}	
	
	// Test if the download was successfull
	this.wasSuccessfull = function() {
		return httpState == 200 && retval < 1;
	}

	// Get the estimated download time outputted by wget
	this.getETA = function() {
		return eta;
	}

	// The name of the downloaded file (from wget containing
	// also the path from the base directory)
	this.getSaveTo = function() {
		return saveTo;
	}

	// Like getSaveTo() but only the filename of the 
	// downloaded file
	this.getName = function() {
		return saveTo.substr(dirToSave.length);
	}
	
	// This function parses every line outputted by wget and
	// saves important bits (e.g. progress) and calls the 
	// listening objects
	var nextLine = function(line) {
		var lline = line.toLowerCase();
		var index;

		switch (state) {
			case 0: // INITIAL
				if (lline.indexOf("response begin") > 0) {
					state = 1;
				} else {
					// Skip lines
				}
				return;

			case 1: // READ_RESPONSE
					if (lline.indexOf("response end") > 0) {
						state = 2;
					} else if (lline.indexOf("http/1.") == 0) {
						httpState = line.match(/[0-9]{3}/);
					} else if ((index = lline.indexOf(": ")) > 0) {
						var key = line.substr(0, index).trim();
						var value = line.substr(index + 1).trim();

						if (key.toLowerCase().indexOf("content-length") != -1) {
							contentLength = value;
						}
					} else {
						// Unknown, skip
					}
				return;

			case 2: // AFTER_RESPONSE
				if (lline.indexOf("response begin") > 0) {
					state = 1;
				} else if ((index = lline.indexOf(dirToSave.toLowerCase())) != -1) {
					line = line.substr(index);
					if ((index = line.indexOf('«')) != -1) {
						saveTo = line.substr(0, index);
					} else {
						saveTo = line.substr(0, line.indexOf('\''));
					}
				} else {
					// Wrap into an try-catch block since sometimes there 
					// occur parsing errors due to missing characters which
					// aren't flushed out of the wget char buffer yet
					try {
						if(line.indexOf("..........") != -1) {
							var regExp = new RegExp('^.*?([0-9a-zA-Z]+).*?[\. ]+.*?([0-9]+)%.*?([a-zA-Z0-9\,\.]+).*?([a-zA-Z0-9\,\.]+)\s*$');
							var prog = line.match(regExp);

							progress = parseInt(prog[2]);
							
							bytesReceived = prog[1];
							var c = bytesReceived.charAt(bytesReceived.length - 1);
							if (c == 'K') {
								bytesReceived = parseInt(bytesReceived.substr(0, bytesReceived.length - 1)) * 1024;
							} else if (c == 'M') {
								bytesReceived = parseInt(bytesReceived.substr(0, bytesReceived.length - 1)) * 1024 * 1024;
							}

							downloadRate = prog[3];
							eta = prog[4];

							var min = eta.match(/([0-9]+)m/);
							if (min != null && min.length > 0) {
								min = parseInt(min[1]);
							} else {
								min = 0;
							}
							var second = eta.match(/([0-9]+)s/);
							if (second != null && second.length > 0) {
								second = parseInt(second[1]);
							} else {
								second = 0;
							}
							eta = min * 60 + second;

							// call only when percentage changed
							if(lastProgress != progress) {
								lastProgress = progress;
								// call the event
								eventEmitter.emit('progress', progress, downloadRate);
							}
						}

					} catch(err) {
						console.log(" *** Downloader error: " + err);
					}
				}
				return;

			default:
				return;
		}
	};

	// That's the master function which starts the download of a file
	// and attaches all necessary listeners
	this.downloadFile = function(file) {
		dl = spawn('wget', ['-d', '-P' + dirToSave, file]);
		
		dl.on('exit', function (code) {
			retval = code;
			if (!wasKilled) { // Don't send finished event iff killed
				eventEmitter.emit('finished');
			}
		});
		
		dl.stderr.on('data', function (data) {
			buffer += data.toString();
			
			var line = '', index = -1;
			for (var i = 0; i < buffer.length; i++) {
				if (buffer.charAt(i) == '\n') {
					nextLine(line);
					line = '';
					index = i;
				} else {
					line += buffer.charAt(i);
				}
			}

			if (index > 0 && index < buffer.length) {
				buffer = buffer.substr(index);
			}
		});
		dl.stdin.end();
	}
	
	// Stops the current download and the wget process which
	// succs the file down
	this.stopDownload = function() {
		wasKilled = true;
		dl.kill();
	}
	
	// Expose API
	return {
		getSaveTo: this.getSaveTo,
		getETA: this.getETA,
		wasSuccessfull: this.wasSuccessfull,
		stopDownload: this.stopDownload,
		downloadFile: this.downloadFile,
		getName: this.getName,
		eventEmitter: eventEmitter
	};
}

exports.NodeDownloader = NodeDownloader;
