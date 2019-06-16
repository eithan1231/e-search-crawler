const micromatch = require('micromatch');
const simpleGet = require('./SimpleGet');
const url = require('url');

/**
* Crawls a websites 'robots.txt' file.
*
* Objective: This class will handle and process all robots files. It will store
* all the results in our database THAT ARE ONLY APPLICABLE TO OUR USERAGENT. So
* ALL cached responses are only valid for OUR user-agent. This is so we  don't
* store information that isn't essential.
*/
class Robots
{
  constructor(redisConnector, userAgent)
  {
    this.redisConnector = redisConnector;
    this.userAgent = userAgent;
    this.emptyList = '{__EMPTY__}';
    this.prefixTypes = {
      init: 'I',
      disallow: 'D',
      allow: 'A',
      sitemap: 'S'
    }
  }

  /**
  * Checks whether we can crawl a url
  * @param url URL to see if we can crawl
  */
  async canCrawl(subjectUrl)
  {
    try {
      const subjectUrlParsed = url.parse(subjectUrl);
      if(!subjectUrlParsed.hostname) {
        // Provided bad hostname. We assume true, unless robots file says
        // otherwise.
        return true;
      }

      const subjectPath = subjectUrlParsed.path;
      const cacheKey = Robots._cacheKey(subjectUrlParsed.hostname);

      if(await this.redisConnector.existsAsync(cacheKey) == 0) {
        await this._scrape(subjectUrl);
      }

      const pathList = await this.redisConnector.lrangeAsync(cacheKey, 0, -1);
      if(pathList.length === 0) {
        return true;
      }

      // First lets sweep the allowed routes.
      for (const pathAndType of pathList) {
        if(pathAndType[0] == this.prefixTypes.allow) {
          // Allow
          const path = pathAndType.substring(1);
          if(path.indexOf('*') > -1) {
            if(micromatch.isMatch(subjectPath, path)) {
              return true;
            }
          }
          else {
            if(
              path.length <= subjectPath.length &&
              subjectPath.indexOf(path) === 0
            ) {
              return true;
            }
          }
        }
      }

      // Now do a sweep of disallowed
      for (const pathAndType of pathList) {
        if(pathAndType[0] == this.prefixTypes.disallow) {
          // Disallow

          const path = pathAndType.substring(1);
          if(path.indexOf('*') > -1) {
            if(micromatch.isMatch(subjectPath, path)) {
              return false;
            }
          }
          else {
            if(
              path.length <= subjectPath.length &&
              subjectPath.indexOf(path) === 0
            ) {
              return false;
            }
          }
        }
      }

      return true;
    }
    catch (ex) {
      console.error(ex);
      return true;
    }
  }

  _scrape(subjectUrl)
  {
    return new Promise(async (resolve, reject) => {
      let urlParsed = url.parse(subjectUrl);
      const key = Robots._cacheKey(urlParsed.hostname);
      urlParsed.pathname = '/robots.txt';
      urlParsed.search = '';

      // Initialize the list.
      await this.redisConnector.lpushAsync(key, this.prefixTypes.init);

      // make the list expire in 3 days
      await this.redisConnector.expire(key, 60*60*24*3);

      const options = {
        url: url.format(urlParsed),
        headers: {
          'User-Agent': this.userAgent
        }
      }

      simpleGet.concat(options, async (err, res, body) => {
        if(err) {
          return reject(err);
        }

        if(res.statusCode === 200) {
          // processing content type
          let contentType = res.headers['content-type'] || 'text/plain';
          const contentTypeParamPos = contentType.indexOf(';');
          if(contentTypeParamPos > 0) {
            contentType = contentType.substring(0, contentTypeParamPos);
          }

          if(contentType === 'text/plain') {
            return resolve(await this._processPage(urlParsed.hostname, body));
          }
          else {
            return reject(`Bad content type.`);
          }
        }
        else {
          return reject(`Unexpected status code ${res.statusCode}`);
        }
      });
    });
  }

  async _processPage(domain, body)
  {
    const lines = body.split('\n').map(line => line.trim());
    let currentUserAgents = [];
    let lastLineAction = 'user-agent';

    if(!lines) {
      return false;
    }

    for(const line of lines) {
      const lineParts = Robots._removeComments(line).split(':', 2).map(parts => parts.trim());
      if(!lineParts || lineParts.length < 2) {
        continue;
      }

      const action = lineParts[0].toLowerCase();
      const parameter = lineParts[1].trim();

      if(parameter.length > 0) {

        // Processing user-agent action
        if(action === 'user-agent') {
          if(lastLineAction === 'user-agent') {
            currentUserAgents.push(parameter);
          }
          else {
            currentUserAgents = [parameter];
          }
        }

        if(parameter.length < 4096) {
          // processing allow action
          if(action === 'allow') {
            await this._handleAllow(domain, currentUserAgents, parameter);
          }

          // processing disallow action
          if(action === 'disallow') {
            await this._handleDisallow(domain, currentUserAgents, parameter);
          }

          // processing sitemap action
          if(action === 'sitemap') {
            await this._handleSitemap(domain, parameter);
          }
        }
      }

      lastLineAction = action;
    }
  }

  async _handleAllow(domain, userAgents, path)
  {
    if(path.trim().length  <= 0) {
      return;
    }

    const key = Robots._cacheKey(domain);
    for (const userAgent of userAgents) {
      if(
        userAgent === '*' ||
        userAgent === this.userAgent ||
        micromatch.isMatch(this.userAgent, userAgent)
      ) {
        await this.redisConnector.lpushAsync(key, `${this.prefixTypes.allow}${path}`);
      }
    }
  }

  async _handleDisallow(domain, userAgents, path)
  {
    if(path.trim().length  <= 0) {
      return;
    }

    const key = Robots._cacheKey(domain);
    for (const userAgent of userAgents) {
      if(
        userAgent === '*' ||
        userAgent === this.userAgent ||
        micromatch.isMatch(this.userAgent, userAgent)
      ) {
        await this.redisConnector.lpushAsync(key, `${this.prefixTypes.disallow}${path}`);
      }
    }
  }

  async _handleSitemap(domain, sitemap)
  {
    const key = Robots._cacheKey(domain);
    await this.redisConnector.lpushAsync(key, `${this.prefixTypes.sitemap}${sitemap}`);
  }

  static _removeComments(s)
  {
    const pos = s.indexOf('#');
    if(pos >= 0) {
      return s.substring(0, pos);
    }
    return s;
  }

  static _cacheKey(domain)
  {
    return `esearch:robot-cache-list:${domain}`;
  }
}

module.exports = Robots;
