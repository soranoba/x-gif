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

angular.module('x-gif', [])
  // Angular strips the 'x' off <x-gif> cause reasons
  .directive('gif', function () {
    return {
      restrict: 'E',
      template: '<div class="frames-wrapper"><div class="x-gif__frames"></div></div>',
      link: function (scope, element, attrs) {
        var xGif = Object.create(attrs, {
          fire: {
            value: function (event) {
              console.log(event);
            }
          }
        });

        if (xGif.exploded != null) {
          xGif.playbackStrategy = 'noop'
        } else if (xGif.sync != null) {
          xGif.playbackStrategy = 'noop';
        } else if (xGif.hardBpm) {
          xGif.playbackStrategy = 'hardBpm';
        } else if (xGif.bpm) {
          xGif.playbackStrategy = 'bpm';
        } else {
          xGif.speed = xGif.speed || 1.0;
          xGif.playbackStrategy = 'speed';
        }

        attrs.$observe('src', function (src) {
          console.log(src)
          if (!src) return;
          var playbackStrategy = Strategies[xGif.playbackStrategy].bind(xGif);
          console.log("GO TIME");
          console.log(xGif.fill != null);
          xGif.playback = new Playback(xGif, element[0].querySelector('.x-gif__frames'), xGif.src, {
            onReady: playbackStrategy,
            pingPong: xGif.pingPong != null,
            fill: xGif.fill != null,
            stopped: xGif.stopped != null
          });
        })

        attrs.$observe('speed', function (speed) {
          if (!speed) return;
          console.log("SPEED CHANGED")
          if (xGif.playback) xGif.playback.speed = speed;
        });

        element[0].clock = function (beatNr, beatDuration, beatFraction) {
          if (xGif.playback && xGif.playback.gif) xGif.playback.fromClock(beatNr, beatDuration, beatFraction);
        }

        element[0].relayout = function () {
          if (xGif.playback && xGif.fill != null) xGif.playback.scaleToFill();
        }
      }
    }
  });

},{"./playback.sjs":4,"./strategies.js":5}],3:[function(require,module,exports){
'use strict';
;
var defaultFrameDelay$730 = 10;
var Gif$731 = function (frames$732) {
    this.frames = frames$732;
    this.length = 0;
    this.offsets = [];
    frames$732.forEach(function (frame$735) {
        this.offsets.push(this.length);
        this.length += frame$735.delay || defaultFrameDelay$730;
    }.bind(this));
};
Gif$731.prototype.frameAt = function (fraction$736) {
    var offset$737 = fraction$736 * this.length;
    for (var i$738 = 1, l$739 = this.offsets.length; i$738 < l$739; i$738++) {
        if (this.offsets[i$738] > offset$737)
            break;
    }
    return i$738 - 1;
};
module.exports = Gif$731;

},{}],4:[function(require,module,exports){
'use strict';
;
var Exploder$618 = require('./exploder.js');
// Private functions for setup
function addClasses$619(element$622, frame$623) {
    element$622.classList.add('frame');
    if (frame$623.disposal == 2)
        element$622.classList.add('disposal-restore');
}
var createImage$620 = function (frame$624) {
    var image$625 = new Image();
    image$625.src = frame$624.url;
    addClasses$619(image$625, frame$624);
    return image$625;
};
var Playback$621 = function (xgif$626, element$627, file$628, opts$629) {
    // Set up out instance variables
    this.xgif = xgif$626;
    this.element = element$627;
    this.onReady = opts$629.onReady;
    this.pingPong = opts$629.pingPong;
    this.fill = opts$629.fill;
    this.stopped = opts$629.stopped;
    new Exploder$618(file$628, function (gif$631) {
        // Once we have the GIF data, add things to the DOM
        console.warn('Callbacks will hurt you. I promise.');
        console.log('Received ' + gif$631.frames.length + ' frames of gif ' + file$628);
        this.gif = gif$631;
        this.element.innerHTML = '';
        var createFrameElement$632 = createImage$620;
        //(this.fill) ? createDiv : createImage;
        gif$631.frames.map(createFrameElement$632).forEach(this.element.appendChild, this.element);
        if (this.fill)
            requestAnimationFrame(this.scaleToFill.bind(this));
        this.onReady();
    }.bind(this));
};
Playback$621.prototype.scaleToFill = function () {
    if (!(this.element.offsetWidth && this.element.offsetHeight)) {
        requestAnimationFrame(this.scaleToFill.bind(this));
    } else {
        var xScale$633 = this.element.parentElement.offsetWidth / this.element.offsetWidth, yScale$634 = this.element.parentElement.offsetHeight / this.element.offsetHeight;
        this.element.style.webkitTransform = 'scale(' + 1.1 * Math.max(xScale$633, yScale$634) + ')';
    }
};
Playback$621.prototype.setFrame = function (fraction$635, repeatCount$636) {
    var frameNr$637 = this.pingPong && repeatCount$636 % 2 >= 1 ? this.gif.frameAt(1 - fraction$635) : this.gif.frameAt(fraction$635);
    var children$638 = this.element.childNodes;
    if (frameNr$637 == 0) {
        // initialize
        for (var i$639 = 1; i$639 < children$638.length; ++i$639) {
            children$638[i$639].setAttribute('style', 'opacity:0');
        }
    } else if (frameNr$637 + 1 < children$638.length) {
        // pingPong
        children$638[frameNr$637 + 1].setAttribute('style', 'opacity:0');
    }
    children$638[frameNr$637].setAttribute('style', 'opacity:1');
    this.element.dataset['frame'] = frameNr$637;
};
Playback$621.prototype.start = function () {
    this.stopped = false;
    this.startTime = performance.now();
    if (this.animationLoop)
        this.animationLoop();
};
Playback$621.prototype.stop = function () {
    this.stopped = true;
};
Playback$621.prototype.startSpeed = function (speed$640, nTimes$641) {
    this.speed = speed$640;
    this.animationLoop = function () {
        var gifLength$643 = 10 * this.gif.length / this.speed, duration$644 = performance.now() - this.startTime, repeatCount$645 = duration$644 / gifLength$643, fraction$646 = repeatCount$645 % 1;
        if (!nTimes$641 || repeatCount$645 < nTimes$641) {
            this.setFrame(fraction$646, repeatCount$645);
            if (!this.stopped)
                requestAnimationFrame(this.animationLoop);
        } else {
            this.setFrame(nTimes$641 % 1 || 1, repeatCount$645);
            this.xgif.fire('x-gif-finished');
        }
    }.bind(this);
    if (!this.stopped)
        this.start();
};
Playback$621.prototype.fromClock = function (beatNr$647, beatDuration$648, beatFraction$649) {
    var speedup$650 = 1.5, lengthInBeats$651 = Math.max(1, Math.round(1 / speedup$650 * 10 * this.gif.length / beatDuration$648)), subBeat$652 = beatNr$647 % lengthInBeats$651, repeatCount$653 = beatNr$647 / lengthInBeats$651, subFraction$654 = beatFraction$649 / lengthInBeats$651 + subBeat$652 / lengthInBeats$651;
    this.setFrame(subFraction$654, repeatCount$653);
};
Playback$621.prototype.startHardBpm = function (bpm$655) {
    var beatLength$656 = 60 * 1000 / bpm$655;
    this.animationLoop = function () {
        var duration$658 = performance.now() - this.startTime, repeatCount$659 = duration$658 / beatLength$656, fraction$660 = repeatCount$659 % 1;
        this.setFrame(fraction$660, repeatCount$659);
        if (!this.stopped)
            requestAnimationFrame(this.animationLoop);
    }.bind(this);
    if (!this.stopped)
        this.start();
};
Playback$621.prototype.startBpm = function (bpm$661) {
    var beatLength$662 = 60 * 1000 / bpm$661;
    this.animationLoop = function () {
        var duration$664 = performance.now() - this.startTime, beatNr$665 = Math.floor(duration$664 / beatLength$662), beatFraction$666 = duration$664 % beatLength$662 / beatLength$662;
        this.fromClock(beatNr$665, beatLength$662, beatFraction$666);
        if (!this.stopped)
            requestAnimationFrame(this.animationLoop);
    }.bind(this);
    if (!this.stopped)
        this.start();
};
module.exports = Playback$621;

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