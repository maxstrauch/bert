// Converts seconds to a more convenient format
// @see: http://stackoverflow.com/a/13368349/2429611
function toHHMMSS(n) {
    var seconds = Math.floor(n),
        hours = Math.floor(seconds / 3600);
    seconds -= hours*3600;
    var minutes = Math.floor(seconds / 60);
    seconds -= minutes*60;

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
}

// Format bytes human read-able
// @see: http://stackoverflow.com/a/18650828/2429611
function bytesToSize(bytes) {
   var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   if (bytes == 0) return '0 Byte';
   var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
   return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}

// Shortcut to get a DOM element by it's id
function $(id) {
  return document.getElementById(id);
}

// Shortcut to make a new DOM element and apply
// different attributes to it
function $make(tag, opts) {
  var elem = document.createElement(tag);

  if (opts && opts.className) {
    elem.className = opts.className;
  }

  if (opts && opts.attr) {
    for (var attr in opts.attr) {
      elem.setAttribute(attr, opts.attr[attr]);
    }
  }

  if (opts && opts.id) {
    elem.id = opts.id;
  }

  if (opts && opts.html) {
    elem.innerHTML = opts.html;
  }

  if (opts && opts.onclick) {
    elem.onclick = opts.onclick;
  }

  if (opts && opts.parent) {
    opts.parent.appendChild(elem);
  }

  return elem;
}

// Simple AJAX function to communicate with the backend
function $ajax(url, cb, get) {
  // Crate the url (with GET parameters if supplied)
  var totalURL = url;
  var params = '?';
  for (var key in get) {
    var value = encodeURIComponent(get[key]).replace(/%20/g,'+');
    params += key + '=' + value + '&';
  }
  if (params.length == 1) {
    params = '';
  } else {
    params = params.substring(0, params.length - 1);
  }
  totalURL = url + params;

  // Run the request
  var xmlhttp;
  if (window.XMLHttpRequest)  {
      xmlhttp=new XMLHttpRequest();
  } else {
      xmlhttp=new ActiveXObject("Microsoft.XMLHTTP");
  }

  xmlhttp.onreadystatechange = function() {
    if (xmlhttp.readyState == 4) {
      if (xmlhttp.status == 200) {
        var data = xmlhttp.responseText;
        if (data.length > 0) {
          cb(JSON.parse(xmlhttp.responseText));
          return;
        }
      }

      // No connection to the backend any more
      cry();
    }
  }       
  xmlhttp.open("GET", totalURL, true);
  xmlhttp.send();
}

// Info board object providing short messages just like
// in OS X
function InfoBoard(id, infoDur, alertDur) {
  var board = $(id);

  var display = function(str, className, dur) {
    // Create the element
    var elem = $make('li', {
      'className': 'mmsg ' + className, 
      'parent': board
    });

    // Append the text
    elem.appendChild(document.createTextNode(str));

    // Delete element after time expired
    window.setTimeout(function() {
      elem.className = elem.className + " fadeOut";
      window.setTimeout(function() {
        elem.parentNode.removeChild(elem);
      }, 420);
    }, dur);
  };

  this.alert = function(str) {
    display(str, "err", alertDur);
  };

  this.info = function(str) {
    display(str, "nfo", infoDur);
  };

  return {
    alert: this.alert,
    info: this.info
  };
}

// Main update function for the list
function update() {
  $ajax('/rest/', function(ret) {      
    if (ret.state != 200) {
      // FIXME: make me nicer
      infoBoard.alert("Can't update the download list (a bug)!");
      return;
    }

    // Sort list by state
    ret.all.sort(function(a, b) {
      if (a.state == 4) {
        return 1;
      }

      if (b.state == 4) {
        return -1;
      }

      if (a.state == 1 || b.state == 1) {
        return (b.state == 1 ? 1 : -1) * 1000;
      }
      
      if (a.state == b.state && b.state == 0) {
        return a.id > b.id ? 1 : -1;          
      }

      if (a.state == 0 || b.state == 0) {
        return (b.state == 0 ? 1 : -1) * 500;
      }
      
      return a.id - b.id;
    });

    // Remove all old entries
    var listNode = $('output');
    while (listNode.firstChild) {
      listNode.removeChild(listNode.firstChild);
    }

    // Create and add new entries
    for (var i = 0; i < ret.all.length; i++) {
      var li = $make('li', {'parent': listNode});
      var e = ret.all[i];

      // Add a progress bar, if downloading
      if (e.state == 1) {
        var prog = $make('div', {
          'className': 'progress',
          'parent': li
        });
        $make('div', {
          'parent': prog
        }).style.width = e.percent + '%';
      }

      // Create the header
      var heading = $make('h1', {'parent': li});
      heading.title = e.name;

      if (e.state == 0) {
        $make('em', {'className': 'icon-hourglass', 'parent': heading});
      } else if (e.state == 1) {
        $make('em', {'className': 'icon-download', 'parent': heading});
      } else if (e.state == 3) {
        $make('em', {'className': 'icon-fail', 'parent': heading});
      } else if (e.state == 4) {
        $make('em', {'className': 'icon-file', 'parent': heading});
      } else {
        if (e.success) {
          $make('em', {'className': 'icon-success', 'parent': heading});
        } else {
          $make('em', {'className': 'icon-fail', 'parent': heading});
        }
      }

      if (e.state == 4) {
        heading.appendChild(document.createTextNode(e.name + " (" + e.state + ")"));
      } else {
        heading.appendChild(document.createTextNode(e.url + " (" + e.state + ")"));
      }
      
      // Add delete action only if not already deleted or downloaded
      if (e.state == 0 || e.state == 1) {
        $make('a', {
          'className': 'action',
          'onclick': function(e) {
            var id = this.getAttribute('data-id');
            $ajax('/rest/', function(ret1) {
              // FIXME: do something useful here
            }, {'cmd': 'stop', 'id': id});
          },
          'attr': {'data-id': e.id},
          'parent': li
        }).href = '#';
      }

      // Render the meta information area
      var div = $make('div', {'className': 'meta', 'parent': li});

      if (e.state == 1) { // Only on download ...
        $make('label', {'html': 'Progress:', 'parent': div});
        $make('strong', {'html': e.percent + '%', 'parent': div});

        $make('label', {'html': 'ETA:', 'parent': div});
        $make('strong', {'html': toHHMMSS(e.eta), 'parent': div});

        $make('label', {'html': 'Speed:', 'parent': div});
        $make('strong', {'html': e.speed, 'parent': div});
      }

      if (e.state == 4) {
        $make('label', {'html': 'Size:', 'parent': div});
        $make('strong', {'html': bytesToSize(e.size), 'parent': div});
      } else {

        if (e.state >= 1 && e.filename.length > 0) {
          $make('label', {'html': 'Filename:', 'parent': div});
          $make('strong', {'html': e.name, 'parent': div});
        } else if (e.state > 1 && e.size > 0) {
          $make('label', {'html': 'Size:', 'parent': div});
          $make('strong', {'html': bytesToSize(e.size), 'parent': div});

          $make('label', {'html': 'Successful?', 'parent': div});
          $make('strong', {'html': e.success ? 'Yes' : 'No', 'parent': div});
        } else if (e.success == false && e.errmsg.length > 0) {
          $make('label', {'html': 'Successful?', 'parent': div});
          $make('strong', {'html': e.success ? 'Yes' : 'No', 'parent': div});

          $make('label', {'html': 'Error message:', 'parent': div});
          $make('strong', {'html': e.errmsg, 'parent': div});
        }
      }
    }
  }, {'cmd': 'list'});
}

// Update system stats (e.g. used disk space)
function updateStats() {
  $ajax('/rest/', function(ret) {
      if (ret.used < 0) {
        $('diskusage').style.width = '0%';
        $('useddsk').innerHTML = 'N/A';
        return;
      }
      $('diskusage').style.width = ret.percent + '%';
      $('useddsk').innerHTML = Math.round(ret.percent*10)/10 + '% (' + bytesToSize(ret.used) + ')';
  }, {'cmd': 'dskstat'});
}

// Check for user script execution and display
// the result
function updateScriptExec() {
  $ajax('/rest/', function(ret) {
      if (ret.state == 200) {
        // Disable controls and show overlay
        $('script-data-out').innerHTML = '';
        $('script-exit').className = 'button disabled';
        $('script-out').style.display = 'block';

        // Get the data from stdout
        $ajax('/rest/', function(ret) {
          // Set it
          $('script-data-out').innerHTML = ret.data;

          // If finished ...
          if (ret.finished) {
            $ajax('/rest/', function(ret) {
              // FIXME: really don't care?
            }, {'cmd': 'user-script', 'exit': true});

            // Enable close button of script overlay
            $('script-exit').className = 'button';
            $('script-exit').onclick = function() {
              this.onclick = undefined;
              $('script-out').style.display = 'none';
            };
          }
        }, {'cmd': 'user-script'});
      }
    }, {'cmd': 'user-script', 'test': true}
  );
}

// Reload the entire page
function reload() {
  window.location.href = '/';
}

// When the backend connection is lost execute this function
// and display an error message and show the overlay for this
// case
function cry() {
  infoBoard.alert("Failed to connect to the backend!");
  for (var i = 0; i < intervals.length; i++) {
    clearInterval(intervals[i]);
  }
  $('fail').style.display = 'block';
}

// Download intervals
var intervals = [];

// Message board
var infoBoard;

window.onload = function() {
  infoBoard = new InfoBoard("mmsg-board", 2100, 5000);

  // Attach listener to download field and button
  // and allow for ENTER to start download directly
  // from the text field
  var loadFile = function(e) {
    var opts;
    if ($('force').checked) {
      opts = {'url': $('addr').value, 'force': 1};
    } else {
      opts = {'url': $('addr').value};
    }

    $ajax('/rest/', function(ret) {
      if (ret.state == 200) {
        infoBoard.info("Download added to the list.");
      } else if (ret.state == 501) {
        infoBoard.alert("The same URL was previously added to the downloads list.");
      } else if (ret.state == 500) {
        infoBoard.alert("The given string might not be an URL!");
      } else {
        infoBoard.alert("Couldn't add download to list (error code #" + ret.state + ")!");
      }
    }, opts);
    $('addr').value = '';
    $('force').checked = false;
  };

  $("load").onclick = loadFile;
  $("addr").onkeyup = function(e) {
    if (e.keyCode == 13) {
      loadFile(e);
    }
  };

  // Handle clear all downloads request
  $('on-clear-all').onclick = function(e) {
    if (confirm('Do you really want to remove all downloads?')) {
      $ajax('/rest/', function(ret) {
          if (ret.state == 200) {
            infoBoard.info("Downloads removed, list cleared.");
          } else {
            infoBoard.alert("Error while removing downloads.");
          }
        }, {'cmd': 'clear-all'}
      );
    }
  };

  // Handle user script execution
  $('on-user-script').onclick = function(e) {
    $ajax('/rest/', function(ret) {
        updateScriptExec();
      }, {'cmd': 'user-script', 'run': true}
    );
    return false;
  };

  // Handle shutdown request
  $('on-shutdown').onclick = function(e) {
    var code = prompt('Enter keycode to shutdown the entire server:');
    if (code.length > 0) {
      $ajax('/rest/', function(ret) {
          if (ret.state == 200) {
            infoBoard.info("Server will shutdown now.");
          } else {
            infoBoard.alert("Can't shutdown the server.");
          }
        }, {'cmd': 'halt', 'code': code}
      );
    }

    return false;
  };

  // Create update intervals to keep the download list
  // and stats up-to-date (with different periodicities)
  update();
  intervals.push(setInterval(update, 2500));

  updateStats();
  intervals.push(setInterval(updateStats, 10000));

  updateScriptExec();
  intervals.push(setInterval(updateScriptExec, 2000));

  // Get server version info (only on start up)
  $ajax('/rest/', function(ret) {
    $('versions').innerHTML = ret.app + ' <b>on</b> ' + ret.node;
  }, {'cmd': 'versions'});
}