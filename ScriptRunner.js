var spawn = require('child_process').spawn;
var events = require('events');

// Simple script runner wraper to catch all output of the script
// with the script as argument
function ScriptRunner(scriptName) {
	// State of this object where:
	//   0 = Empty/Reset, 1 = Running, 2 = Finished
	var state = 0;

	// Text received from stdout (and also  stderr)
	var stdout = '';

	// The process handle
	var handle;

	function log(str) {
		console.log(' *** [' + scriptName + '] ' + str)
	}

	// Runs the script attached to this object; should return
	// a boolean whether it works or not
	this.run = function() {
		log('Going to run script')

		// Create new process
		handle = spawn(scriptName);
		state = 1; // Assume that it's running
			
		handle.on('exit', function (code) {
			log('event=exit; EXIT_CODE=' + code)
			state = 2; // Now finished
		});
		
		// Pipe stout and stderr output to the buffer
		handle.stdout.on('data', function (data) {
			stdout += data.toString();
		});

		handle.stderr.on('data', function (data) {
			stdout += data.toString();
		});

		handle.stdin.end();

		// FIXME: test if script is really running
		return true;
	};

	// Clear the object (for a 2nd run)
	this.clear = function() {
		state = 0;
		handle = undefined;
		stdout = '';
		log('Clear triggered')
	};

	// Expose API
	return {
		getState: function() { return state; },
		getOutput: function() { return stdout; },
		run: this.run,
		clear: this.clear
	};
}

exports.ScriptRunner = ScriptRunner;
