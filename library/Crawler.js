const util = require('./util');
const simpleGet = require('./SimpleGet');
const url = require('url');
simpleGet.getAsync = util.promisify(simpleGet);

class Crawler
{
  constructor(options)
  {
    this.concurrency = options.concurrency || 32;
    this.retryThreshold = options.retryThreshold || 100;
    this.redirectLimit = options.redirectLimit || 100;
    this.retryErrorCount = options.retryErrorCount || 3;
    this.userAgent = options.userAgent || null;
    this.htmlPageProcessor = options.htmlPageProcessor || null;
    this.cookieContainer = options.cookieContainer || null;
    this.pageQueue = options.pageQueue || null;
    this.robots = options.robots || null;

    this.stopInterrupt = false;
    this.crawlersRunning = 0;
  }

  async start()
  {
    await this.stop();

    this.stopInterrupt = false;
    for(let i = 0; i < this.concurrency; i++) {
      setImmediate(this._crawl.bind(this));
    }
  }

  /**
  * Starts watching the crawlers. Checks for stopped crawlers, etc.
  */
  _startWatcher()
  {
    this._stopWatcher();
    this.watcherInterval = setInterval(async () => {

    }, 1000 * 10);
  }

  /**
  * Stops the watcher.
  */
  _stopWatcher()
  {
    if(this.watcherInterval) {
      clearInterval(this.watcherInterval);
    }
  }

  /**
  * Stops all the crawlers. May take a few seconds to sent interrupts to each
  * crawling instance. It has to wait for the crawler to finish its cycle.
  */
  async stop()
  {
    this.stopInterrupt = true;
    while(this.crawlersRunning > 0) {
      await util.setTimeoutAsync(10);
    }
  }

  /**
  * The function that starts a crawler.
  */
  async _crawl()
  {
    this.crawlersRunning++;
    let retryCount = 0;

    while(!this.stopInterrupt) {
      if(retryCount > this.retryThreshold) {
        break;
      }
      else if(retryCount > 0) {
        await util.setTimeoutAsync(retryCount * 10);
      }

      const subjectObject = await this.pageQueue.getToCrawl();
      if(!subjectObject || !subjectObject.url) {
        // Subjcet returned null. More than likely nothing in queue. wait for
        // another crawler to scrape some stuff.
        retryCount++;
        //console.log(`Queue returned ${subjectObject}`);
        continue;
      }

      try {
        const subject = subjectObject.url;
        const subjectOptions = subjectObject.options;

        // Exceeded maximum redirects
        if(subjectOptions.redirectCount > this.redirectLimit) {
          console.log(`Exceeded redirect count - ${subject}`);
          continue;
        }

        if(subjectOptions.errorRetryCount > this.retryErrorCount) {
          console.log(`Excueeded error count - ${subject}`);
          continue;
        }

        const subjectParsed = url.parse(subject);
        const canCrawl = await this.robots.canCrawl(subject);
        if(!canCrawl) {
          console.log(`Cannot crawl - ${subject}`);
          continue;
        }

        // Request headers.
        let requestHeaders = {
          'user-agent': this.userAgent,
          'dnt': '1',
          'upgrade-insecure-requests': '1',
          'cache-control': 'max-age=0'
        };

        // Setting referer header.
        if(subjectOptions.referer) {
          requestHeaders['Referer'] = subjectOptions;
        }

        let requestCookies = await this.cookieContainer.getCookies(
          subjectParsed.hostname,
          subjectParsed.path,
          subjectParsed.protocol.toLowerCase() === 'https'
        );

        if(requestCookies.length > 0) {
          // NOTE: Everything should be escaped before entering database
          let requestCookieHeader = requestCookies.map(
            cookie => `${cookie.name}=${cookie.content}`
          ).join('; ');

          if(requestCookieHeader) {
            requestHeaders['Cookie'] = requestCookieHeader;
          }
        }

        // Request options
        const options = {
          url: subject,
          followRedirects: false,
          timeout: 10000,
          headers: requestHeaders
        };

        const response = await simpleGet.getAsync(options);
        const statusType = Math.round(response.statusCode / 100);

        // Processing cookies
        if(typeof response.headers['set-cookie'] === 'object') {
          response.headers['set-cookie'].forEach(async cookie => {
            await this.cookieContainer.setRawCookie(
              subjectParsed.hostname,
              cookie
            )
          });
        }
        else if(typeof response.headers['set-cookie'] === 'string') {
          await this.cookieContainer.setRawCookie(
            subjectParsed.hostname,
            response.headers['set-cookie']
          );
        }

        if(statusType === 2) {
          console.log(`Success ${statusType}xx - ${subject}`);

          let contentType = Crawler._cleanContentType(
            response.headers['content-type'] || 'application/x-octet'
          );

          switch (contentType) {
            case 'text/html': {
              await this.htmlPageProcessor.processPage(
                options,
                response,
                subject,
                subjectOptions
              );
              break;
            }
          }
        }
        else if(statusType === 3) {
          // Redirect. Push to queue.
          const redirectLocation = response.headers['location'] || null;
          if(redirectLocation) {
            console.log(`Redirect to ${redirectLocation} - ${subject}`);

            const resolvedRedirectLocation = url.resolve(
              subject,
              redirectLocation
            );

            const redirectOptions = {
              redirectCount: subjectOptions.redirectCount + 1,
              referer: subject
            };

            await this.pageQueue.pushQueue(
              resolvedRedirectLocation,
              redirectOptions
            );
          }
          else {
            // Redirect header not found.
            console.log(`Bad Redirect - ${subject}`);
            continue;
          }
        }
        else if(statusType === 4) {
          // Permanent errors.
          console.log(`Permanent Error ${response.statusCode} - ${subject}`);
          continue;
        }
        else if(statusType === 5) {
          // Temporary errors.
          console.log(`Temporary Error ${response.statusCode} - ${subject}`);

          const errorOptions = {
            redirectCount: subjectOptions.redirectCount,
            errorRetryCount: subjectOptions.errorRetryCount + 1,
            referer: subjectOptions.referer
          };

          await this.pageQueue.forceQueue(subject, errorOptions);
        }
        else {
          console.log(`Returned Unknown Status ${statusType}xx (${response.statusCode}) - ${subject}`);
        }
      }
      catch(ex) {
        if(ex.code) {
          if(ex.code === 'TIMEOUT') {
            console.log(`Timout - ${subjectObject.url}`);
            continue;
          }
          else if(ex.code === 'ECONNRESET') {
            console.log(`Connection reset (ECONNRESET) - ${subjectObject.url}`);
            continue;
          }
          else if(ex.code === 'ENOTFOUND') {
            console.log(`Cannot resolve (ENOTFOUND) - ${subjectObject.url}`);
            continue;
          }
        }

        console.error(ex);
        retryCount++;
        continue;
      }

      // Resetting retry count, as the cycle that just happened was succcessful.
      // Failed cycles increment 'retryCount' and 'continue;' the loop.
      retryCount = 0;
    }

    this.crawlersRunning--;
  }

  static _cleanContentType(ct)
  {
    const pos = ct.indexOf(';');
    if(pos > 0) {
      return ct.substring(0, pos);
    }
    else {
      return ct;
    }
  }
}

module.exports = Crawler;
