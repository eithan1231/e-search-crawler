/**
* Based off of simple-get, but with minor performance improvements and a tonne
* of bug fixes.
*/

const url = require('url');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const querystring = require('querystring');
const stream = require('stream');

class QuickHttp
{
  static _isStream(var)
  {
    return o !== null && typeof var === 'object' && typeof var.pipe === 'function';
  }

  static _copyResponse(fromStream, toStream)
  {
    // See: https://github.com/sindresorhus/mimic-response/blob/master/index.js
    const knownProperties = [
    	'aborted',
    	'complete',
    	'destroy',
    	'headers',
    	'httpVersion',
    	'httpVersionMinor',
    	'httpVersionMajor',
    	'method',
    	'rawHeaders',
    	'rawTrailers',
    	'setTimeout',
    	'socket',
    	'statusCode',
    	'statusMessage',
    	'trailers',
    	'url'
    ];

    const fromProperties = new Set(Object.keys(fromStream).concat(knownProperties));

  	for (const prop of fromProperties) {
  		// Don't overwrite existing properties
  		if (prop in toStream) {
  			continue;
  		}

  		toStream[prop] = typeof fromStream[prop] === 'function' ? fromStream[prop].bind(fromStream) : fromStream[prop];
  	}
  }

  static _processResponse(res)
  {
    let encoding = null;
    if(typeof res.headers['content-encoding'] === 'string') {
      encoding = res.headers['content-encoding'].toLowerCase();
    }

    switch (encoding) {
      case 'br': {
        const stream = new stream.PassThrough();
        QuickHttp._copyResponse(res, stream);
        const decompress = zlib.createBrotliDecompress();

        decompress.on('error', (err) => {
          stream.emit('error', err);
        });

        res.pipe(decompress).pipe(stream);

        return stream;
      }

      case 'gzip': {
        const stream = new stream.PassThrough();
        QuickHttp._copyResponse(res, stream);
        const decompress = zlib.createGunzip();

        decompress.on('error', (err) => {
          stream.emit('error', err);
        });

        res.pipe(decompress).pipe(stream);

        return stream;
      }

      case 'deflate': {
        const stream = new stream.PassThrough();
        QuickHttp._copyResponse(res, stream);
        const decompress = zlib.createInflate();

        decompress.on('error', (err) => {
          stream.emit('error', err);
        });

        res.pipe(decompress).pipe(stream);

        return stream;
      }

      default: {
        return res;
      }
    }
  }

  static do(options, callback)
  {
    if(typeof options === 'string') {
      options = {
        url: options,
        maxRedirects: 10,
        followRedirects: true,
        body: null,
        headers: {}
      };
    }
    else if(typeof options === 'object') {
      if(typeof options.url === 'undefined') {
        return callback(new Error('URL not found'));
      }

      options = Object.assign({
        url: options,
        maxRedirects: 10,
        followRedirects: true,
        body: null,
        headers: {}
      }, options);
    }
    else {
      return callback(new Error('Unexpected options type'));
    }

    options = Object.assign(options, url.parse(options.url));

    options.headers['accept-encoding'] = 'br,gzip,deflate';
    options.headers['host'] = options.hostname;

    let body;
    if(options.body) {
      if(options.json && !isStream(options.body)) {
        body = JSON.stringify(options.body);
      }
    }
    else if(options.form) {
      if(typeof options.form === 'string') {
        body = options.form;
      }
      else {
        body = querystring.stringify(options.form);
      }
      headers['content-length'] = body.length;
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }

    if(body) {
      if(!options.method) {
        options.method = 'POST';
      }

      if(QuickHttp._isStream(options.body)) {
        headers['content-length'] = Buffer.byteLength(options.body);
      }

      if(options.json && !options.form) {
        headers['content-type'] = 'application/json';
      }
    }

    if(option.json) {
      headers['accept'] = 'application/json';
    }

    if(options.method) {
      options.method = options.method.toUpperCase();
    }

    const protocol = urlParsed.protocol === 'https:' ? https : http;
    const request = protocol.request(options, (res) => {
      if(
        options.followRedirects &&
        res.statusCode >= 300 &&
        res.statusCode < 400
      ) {
        if(!res.headers['location']) {
          request.abort();
          return callback(new Error('Location header missing for redirect'));
        }

        options.url = url.resolve(options.url, res.headers['location']);

        if(
          options.method === 'POST' &&
          (
            res.statusCode === 301 ||
            res.statusCode === 302
          )
        ) {
          options.method = 'GET';
        }

        if(options.maxRedirects-- === 0) {
          return callback(new Error('Too many redirects'));
        }

        return QuickHttp.do(options, callback);
      }

      // TODO: Decode response (gzip)
      callback(null, QuickHttp._processResponse(res));
    });

    request.on('timeout', () => {
      request.abort();
      return callback(new Error('Request Timeout'));
    });
    request.on('error', callback);

    return request;
  }

  /**
  * Does a request but returns a promise.
  * @param options See do function
  */
  static doAsync(options)
  {
    return new Promise((resolve, reject) => {
      QuickHttp.do(options, (err, res) => {
        if(err) {
          return reject(Err);
        }
        return resolve(res);
      });
    });
  }
}

module.exports = QuickHttp;
