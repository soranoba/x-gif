(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";

var StreamReader = require('./stream_reader.js'),
  Gif = require('./gif.sjs'),
  url = (URL && URL.createObjectURL) ? URL : webkitURL;

var Exploder = function (file, cb) {
  this.file = file;
  this.doneCallback = cb;
  this.loadAndExplode();
};

Exploder.prototype.loadAndExplode = function () {
  var loader = new XMLHttpRequest(),
    exploder = this.explode.bind(this);
  loader.open('GET', this.file, true);
  loader.responseType = 'arraybuffer';
  loader.onload = function () {
    exploder(this.response);
  };
  loader.send();
}

Exploder.prototype.explode = function (buffer) {
  var frames = [],
    streamReader = new StreamReader(buffer);

  // Ensure this is an animated GIF
  if (streamReader.readAscii(6) != "GIF89a") {
//    deferred.reject();
    return;
  }

  streamReader.skipBytes(4); // Height & Width
  if (streamReader.peekBit(1)) {
    streamReader.log("GLOBAL COLOR TABLE")
    var colorTableSize = streamReader.readByte() & 0x07;
    streamReader.log("GLOBAL COLOR TABLE IS " + 3 * Math.pow(2, colorTableSize + 1) + " BYTES")
    streamReader.skipBytes(2);
    streamReader.skipBytes(3 * Math.pow(2, colorTableSize + 1));
  } else {
    streamReader.log("NO GLOBAL COLOR TABLE")
  }
  // WE HAVE ENOUGH FOR THE GIF HEADER!
  var gifHeader = buffer.slice(0, streamReader.index);

  var spinning = true, expectingImage = false;
  while (spinning) {

    if (streamReader.isNext([0x21, 0xFF])) {
      streamReader.log("APPLICATION EXTENSION")
      streamReader.skipBytes(2);
      var blockSize = streamReader.readByte();
      streamReader.log(streamReader.readAscii(blockSize));

      if (streamReader.isNext([0x03, 0x01])) {
        // we cool
        streamReader.skipBytes(5)
      } else {
        streamReader.log("A weird application extension. Skip until we have 2 NULL bytes");
        while (!(streamReader.readByte() === 0 && streamReader.peekByte() === 0));
        streamReader.log("OK moving on")
        streamReader.skipBytes(1);
      }
    } else if (streamReader.isNext([0x21, 0xFE])) {
      streamReader.log("COMMENT EXTENSION")
      streamReader.skipBytes(2);

      while (!streamReader.isNext([0x00])) {
        var blockSize = streamReader.readByte();
        streamReader.log(streamReader.readAscii(blockSize));
      }
      streamReader.skipBytes(1); //NULL terminator

    } else if (streamReader.isNext([0x2c])) {
      streamReader.log("IMAGE DESCRIPTOR!");
      if (!expectingImage) {
        // This is a bare image, not prefaced with a Graphics Control Extension
        // so we should treat it as a frame.
        frames.push({ index: streamReader.index, delay: 0 });
      }
      expectingImage = false;

      streamReader.skipBytes(9);
      if (streamReader.peekBit(1)) {
        streamReader.log("LOCAL COLOR TABLE");
        var colorTableSize = streamReader.readByte() & 0x07;
        streamReader.log("LOCAL COLOR TABLE IS " + 3 * Math.pow(2, colorTableSize + 1) + " BYTES")
        streamReader.skipBytes(2);
        streamReader.skipBytes(3 * Math.pow(2, colorTableSize + 1));
      } else {
        streamReader.log("NO LOCAL TABLE PHEW");
        streamReader.skipBytes(1);
      }

      streamReader.log("MIN CODE SIZE " + streamReader.readByte());
      streamReader.log("DATA START");

      while (!streamReader.isNext([0x00])) {
        var blockSize = streamReader.readByte();
//        streamReader.log("SKIPPING " + blockSize + " BYTES");
        streamReader.skipBytes(blockSize);
      }
      streamReader.log("DATA END");
      streamReader.skipBytes(1); //NULL terminator
    } else if (streamReader.isNext([0x21, 0xF9, 0x04])) {
      streamReader.log("GRAPHICS CONTROL EXTENSION!");
      // We _definitely_ have a frame. Now we're expecting an image
      var index = streamReader.index;

      streamReader.skipBytes(3);
      var disposalMethod = streamReader.readByte() >> 2;
      streamReader.log("DISPOSAL " + disposalMethod);
      var delay = streamReader.readByte() + streamReader.readByte() * 256;
      frames.push({ index: index, delay: delay, disposal: disposalMethod });
      streamReader.log("FRAME DELAY " + delay);
      streamReader.skipBytes(2);
      expectingImage = true;
    } else {
      var maybeTheEnd = streamReader.index;
      while (!streamReader.finished() && !streamReader.isNext([0x21, 0xF9, 0x04])) {
        streamReader.readByte();
      }
      if (streamReader.finished()) {
        streamReader.index = maybeTheEnd;
        streamReader.log("WE END");
        spinning = false;
      } else {
        streamReader.log("UNKNOWN DATA FROM " + maybeTheEnd);
      }
    }
  }
  var endOfFrames = streamReader.index;

  var gifFooter = buffer.slice(-1); //last bit is all we need
  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    var nextIndex = (i < frames.length - 1) ? frames[i + 1].index : endOfFrames;
    frame.blob = new Blob([ gifHeader, buffer.slice(frame.index, nextIndex), gifFooter ], {type: 'image/gif'});
    frame.url = url.createObjectURL(frame.blob);
  }

  this.doneCallback(new Gif(frames));
}

module.exports = Exploder;

},{"./gif.sjs":3,"./stream_reader.js":6}],2:[function(require,module,exports){
"use strict";

var Playback = require('./playback.sjs'),
  Strategies = require('./strategies.js');

var XGif = function () {
  this.ready = function () {
    // Better than using a default attribute, since this
    // triggers change detectors below.
    this.src = this.src || "../gifs/nope.gif";
    if (this.exploded != null) {
      this.playbackStrategy = 'noop'
    } else if (this.sync != null) {
      this.playbackStrategy = 'noop';
    } else if (this['hard-bpm']) {
      this.playbackStrategy = 'hardBpm';
    } else if (this.bpm) {
      this.playbackStrategy = 'bpm';
    } else {
      this.speed = this.speed || 1.0;
      this.playbackStrategy = 'speed';
    }
  };

  this.srcChanged = function () {
    var playbackStrategy = Strategies[this.playbackStrategy].bind(this);
    console.log("GO TIME")
    console.log(this.fill != null)
    this.playback = new Playback(this, this.$.frames, this.src, {
      onReady: playbackStrategy,
      pingPong: this['ping-pong'] != null,
      fill: this.fill != null,
      stopped: this.stopped != null
    });
  };

  this.speedChanged = function (oldVal, newVal) {
    console.log("SPEED CHANGED")
    if (this.playback) this.playback.speed = newVal;
  }

  this.stoppedChanged = function (oldVal, newVal) {
    var nowStop = newVal != null;
    if (this.playback && nowStop && !this.playback.stopped) {
      console.log("TIME TO STOP")
      this.playback.stop();
    } else if (this.playback && !nowStop && this.playback.stopped) {
      console.log("TIME TO START")
      this.playback.start();
    }
  }

  this.togglePingPong = function () {
    this['ping-pong'] = (this['ping-pong'] != null) ? null : true;
    if (this.playback) this.playback.pingPong = this['ping-pong'] != null;
  }

  this.clock = function (beatNr, beatDuration, beatFraction) {
    if (this.playback && this.playback.gif) this.playback.fromClock(beatNr, beatDuration, beatFraction);
  };

  this.relayout = function () {
    if (this.fill != null) this.playback.scaleToFill();
  }
}

Polymer('x-gif', new XGif());

},{"./playback.sjs":4,"./strategies.js":5}],3:[function(require,module,exports){
'use strict';
;
var defaultFrameDelay$510 = 10;
var Gif$511 = function (frames$512) {
    this.frames = frames$512;
    this.length = 0;
    this.offsets = [];
    frames$512.forEach(function (frame$515) {
        this.offsets.push(this.length);
        this.length += frame$515.delay || defaultFrameDelay$510;
    }.bind(this));
};
Gif$511.prototype.frameAt = function (fraction$516) {
    var offset$517 = fraction$516 * this.length;
    for (var i$518 = 1, l$519 = this.offsets.length; i$518 < l$519; i$518++) {
        if (this.offsets[i$518] > offset$517)
            break;
    }
    return i$518 - 1;
};
module.exports = Gif$511;

},{}],4:[function(require,module,exports){
'use strict';
;
var Exploder$397 = require('./exploder.js');
// Private functions for setup
function addClasses$398(element$401, frame$402) {
    element$401.classList.add('frame');
    if (frame$402.disposal == 2)
        element$401.classList.add('disposal-restore');
}
var createImage$399 = function (frame$403) {
    var image$404 = new Image();
    image$404.src = frame$403.url;
    addClasses$398(image$404, frame$403);
    return image$404;
};
var Playback$400 = function (xgif$405, element$406, file$407, opts$408) {
    // Set up out instance variables
    this.xgif = xgif$405;
    this.element = element$406;
    this.onReady = opts$408.onReady;
    this.pingPong = opts$408.pingPong;
    this.fill = opts$408.fill;
    this.stopped = opts$408.stopped;
    new Exploder$397(file$407, function (gif$410) {
        // Once we have the GIF data, add things to the DOM
        console.warn('Callbacks will hurt you. I promise.');
        console.log('Received ' + gif$410.frames.length + ' frames of gif ' + file$407);
        this.gif = gif$410;
        this.element.innerHTML = '';
        var createFrameElement$411 = createImage$399;
        //(this.fill) ? createDiv : createImage;
        gif$410.frames.map(createFrameElement$411).forEach(this.element.appendChild, this.element);
        if (this.fill)
            requestAnimationFrame(this.scaleToFill.bind(this));
        this.onReady();
    }.bind(this));
};
Playback$400.prototype.scaleToFill = function () {
    if (!(this.element.offsetWidth && this.element.offsetHeight)) {
        requestAnimationFrame(this.scaleToFill.bind(this));
    } else {
        var xScale$412 = this.element.parentElement.offsetWidth / this.element.offsetWidth, yScale$413 = this.element.parentElement.offsetHeight / this.element.offsetHeight;
        this.element.style.webkitTransform = 'scale(' + 1.1 * Math.max(xScale$412, yScale$413) + ')';
    }
};
Playback$400.prototype.setFrame = function (fraction$414, repeatCount$415) {
    var frameNr$416 = this.pingPong && repeatCount$415 % 2 >= 1 ? this.gif.frameAt(1 - fraction$414) : this.gif.frameAt(fraction$414);
    var children$417 = this.element.childNodes;
    var previousFrameNr$418 = Number(this.element.dataset['frame']);
    if (previousFrameNr$418 < frameNr$416) {
        for (var i$419 = previousFrameNr$418 + 1; i$419 <= frameNr$416; ++i$419) {
            children$417[i$419].setAttribute('style', 'opacity:1');
        }
    } else {
        for (var i$419 = frameNr$416 + 1; i$419 <= previousFrameNr$418; ++i$419) {
            children$417[i$419].setAttribute('style', 'opacity:0');
        }
    }
    this.element.dataset['frame'] = frameNr$416;
};
Playback$400.prototype.start = function () {
    this.stopped = false;
    this.startTime = performance.now();
    if (this.animationLoop)
        this.animationLoop();
};
Playback$400.prototype.stop = function () {
    this.stopped = true;
};
Playback$400.prototype.startSpeed = function (speed$420, nTimes$421) {
    this.speed = speed$420;
    this.animationLoop = function () {
        var gifLength$423 = 10 * this.gif.length / this.speed, duration$424 = performance.now() - this.startTime, repeatCount$425 = duration$424 / gifLength$423, fraction$426 = repeatCount$425 % 1;
        if (!nTimes$421 || repeatCount$425 < nTimes$421) {
            this.setFrame(fraction$426, repeatCount$425);
            if (!this.stopped)
                requestAnimationFrame(this.animationLoop);
        } else {
            this.setFrame(nTimes$421 % 1 || 1, repeatCount$425);
            this.xgif.fire('x-gif-finished');
        }
    }.bind(this);
    if (!this.stopped)
        this.start();
};
Playback$400.prototype.fromClock = function (beatNr$427, beatDuration$428, beatFraction$429) {
    var speedup$430 = 1.5, lengthInBeats$431 = Math.max(1, Math.round(1 / speedup$430 * 10 * this.gif.length / beatDuration$428)), subBeat$432 = beatNr$427 % lengthInBeats$431, repeatCount$433 = beatNr$427 / lengthInBeats$431, subFraction$434 = beatFraction$429 / lengthInBeats$431 + subBeat$432 / lengthInBeats$431;
    this.setFrame(subFraction$434, repeatCount$433);
};
Playback$400.prototype.startHardBpm = function (bpm$435) {
    var beatLength$436 = 60 * 1000 / bpm$435;
    this.animationLoop = function () {
        var duration$438 = performance.now() - this.startTime, repeatCount$439 = duration$438 / beatLength$436, fraction$440 = repeatCount$439 % 1;
        this.setFrame(fraction$440, repeatCount$439);
        if (!this.stopped)
            requestAnimationFrame(this.animationLoop);
    }.bind(this);
    if (!this.stopped)
        this.start();
};
Playback$400.prototype.startBpm = function (bpm$441) {
    var beatLength$442 = 60 * 1000 / bpm$441;
    this.animationLoop = function () {
        var duration$444 = performance.now() - this.startTime, beatNr$445 = Math.floor(duration$444 / beatLength$442), beatFraction$446 = duration$444 % beatLength$442 / beatLength$442;
        this.fromClock(beatNr$445, beatLength$442, beatFraction$446);
        if (!this.stopped)
            requestAnimationFrame(this.animationLoop);
    }.bind(this);
    if (!this.stopped)
        this.start();
};
module.exports = Playback$400;

},{"./exploder.js":1}],5:[function(require,module,exports){
"use strict";

var Strategies = {
  speed: function () {
    this.playback.startSpeed(this.speed, this['n-times']);
  },
  hardBpm: function () {
    this.playback.startHardBpm(this['hard-bpm']);
  },
  bpm: function () {
    this.playback.startBpm(this.bpm);
  },
  noop: function () {
  }
};

module.exports = Strategies;

},{}],6:[function(require,module,exports){
"use strict";

var StreamReader = function (arrayBuffer) {
  this.data = new Uint8Array(arrayBuffer);
  this.index = 0;
  this.log("TOTAL LENGTH: " + this.data.length);
}

StreamReader.prototype.finished = function () {
  return this.index >= this.data.length;
}
StreamReader.prototype.readByte = function () {
  return this.data[this.index++];
};
StreamReader.prototype.peekByte = function () {
  return this.data[this.index];
};
StreamReader.prototype.skipBytes = function (n) {
  this.index += n;
};
StreamReader.prototype.peekBit = function (i) {
  return !!(this.peekByte() & (1 << 8 - i));
};
StreamReader.prototype.readAscii = function (n) {
  var s = '';
  for (var i = 0; i < n; i++) {
    s += String.fromCharCode(this.readByte());
  }
  return s;
};
StreamReader.prototype.isNext = function (array) {
  for (var i = 0; i < array.length; i++) {
    if (array[i] !== this.data[this.index + i]) return false;
  }
  return true;
};
StreamReader.prototype.log = function (str) {
//  console.log(this.index + ": " + str);
};
StreamReader.prototype.error = function (str) {
  console.error(this.index + ": " + str);
}

module.exports = StreamReader;

},{}]},{},[2])