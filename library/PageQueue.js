const url = require('url');
const querystring = require('querystring');

/**
* Manages which pages to crawl and stuff.
*/
class PageQueue
{
  constructor(redisConnector)
  {
    this.redisConnector = redisConnector;
    this.localQueue = [];
  }

  /**
  * Forces URL back into queue. Why would we need to force it? perhaps the
  * remote server is experiencing an error. This will force it to retry again
  * later.
  * @param url URL to push to queue.
  * @param options Additional information about the URL. You may set referer and
  * other things.
  */
  async forceQueue(url, options)
  {
    url = this._checkUrl(url);
    if(!url) {
      return false;
    }

    const keyList = PageQueue._buildKey();
    const key = PageQueue._buildKey(url);

    const keyValue = JSON.stringify({
      url: url,
      options: this._buildOptions(options)
    });

    await this.redisConnector.setAsync(key, keyValue);
    await this.redisConnector.lpushAsync(keyList, key);

    return true;
  }

  /**
  * Trys adding a URL to queue. This returns false when rejected.
  * @param url URL to push to queue.
  * @param options Additional information about the URL. You may set referer and
  * other things.
  */
  async pushQueue(url, options)
  {
    url = this._checkUrl(url);
    if(!url) {
      return false;
    }

    const keyList = PageQueue._buildKey();
    const key = PageQueue._buildKey(url);

    // checking if key exists
    if(await this.redisConnector.existsAsync(key) === 0) {

      const keyValue = JSON.stringify({
        url: url,
        options: this._buildOptions(options)
      });

      // creating key
      await this.redisConnector.setAsync(key, keyValue);

      // pushing key to queue
      await this.redisConnector.lpushAsync(keyList, key);

      return true;
    }

    // key exists
    return false;
  }

  /**
  * Gets a page that reqires crawling. Selects at random.
  */
  async getToCrawl()
  {
    const keyList = PageQueue._buildKey();

    if(this.localQueue.length > 0) {
      return this.localQueue.pop();
    }

    for(let i = 0; i < 32; i++) {
      const listPopResult = await this.redisConnector.lpopAsync(keyList);
      if(!listPopResult) {
        break;
      }

      // the value of key is stored in JSON. It has two parts, 'url' and 'key'
      const keyValue = await this.redisConnector.getAsync(listPopResult);
      if(!keyValue) {
        continue;
      }

      const keyValueParsed = JSON.parse(keyValue);

      // Setting the key to expire in 15 days. This is so we dont recrawl
      // within 15 days.
      await this.redisConnector.setAsync(listPopResult, keyValue, 'EX', 60*60*24*15);
      this.localQueue.push(keyValueParsed);
    }

    if(this.localQueue.length > 0) {
      return this.localQueue.pop();
    }

    return null;
  }

  /**
  * Gets amount of pages a particular domain has in queue.
  * @param domain
  */
  async domainQueueCount(domain)
  {
    const key = PageQueue.queueCountKey(domain);
    const value = await this.redisConnector.getAsync(key);
    if(value) {
      return parseInt(value) || 0;
    }
    return 0;
  }

  /**
  * Increments the amount of url's a domain has in queue
  * @param domain
  */
  async incrementDomainQueueCount(domain)
  {
    const key = PageQueue.queueCountKey(domain);
    return await this.redisConnector.incrAsync(key);
  }

  /**
  * decrements the amount of url's a domain has in queue
  * @param domain
  */
  async decrementDomainQueueCount(domain)
  {
    return await this.redisConnector.decrAsync(
      PageQueue.queueCountKey(domain)
    );
  }

  /**
  * Checks and returns a correct version of a url.
  */
  _checkUrl(subject)
  {
    let parsed = url.parse(subject);

    if(
      parsed.protocol != 'http:' &&
      parsed.protocol != 'https:'
    ) {
      return false;
    }

    // Removing any white spaces from pathname
    parsed.pathname = querystring.unescape(parsed.pathname);
    parsed.pathname = parsed.pathname.split('/').map(
      part => querystring.escape(part)
    ).join('/');

    // Process querystring
    if(parsed.search && parsed.search.length > 1) {
      parsed.search = querystring.encode(
        querystring.decode(parsed.search.substring(1))
      );
    }

    // We don't want a hash. lol.
    parsed.hash = '';

    return url.format(parsed);
  }

  /**
  * fills in the default options
  */
  _buildOptions(options)
  {
    if(typeof options === 'undefined') {
      options = {};
    }

    if(typeof options.redirectCount === 'undefined') {
      options.redirectCount = 0
    }

    if(typeof options.referer === 'undefined') {
      options.referer = null;
    }

    if(typeof options.errorRetryCount === 'undefined') {
      options.errorRetryCount = 0;
    }

    return options;
  }

  static queueCountKey(domain)
  {
    return `esearch:queue-count:${domain}`;
  }

  static _buildKey(url = null)
  {
    if(url) {
      return `esearch:queue:${url}`;
    }
    else {
      return `esearch:queue-list`;
    }
  }
}

module.exports = PageQueue;
