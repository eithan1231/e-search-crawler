const querystring = require('querystring');

/**
* Manages all cookies.
*/
class CookieContainer
{
  constructor(redisConnector, plugin, cookieDurationLimit)
  {
    this.redisConnector = redisConnector;
    this.plugin = plugin;
    this.cookieDurationLimit = cookieDurationLimit;
  }

  /**
  * Gets cookies associated with a URL
  * @param domain
  * @param path
  * @param secure Whether or not request is doing to be secure.
  */
  async getCookies(domain, path = '/', secure = true)
  {
    // NOTE: It was a design decision to not use sub-domain wildcards. Mainly
    // becuase it makes things simpler, but also due to performance
    // considerations.

    let cookies = [];
    const pattern = CookieContainer._buildScanPattern(domain);
    const scanResults = await this.redisConnector.scanAsync(0, 'MATCH', pattern);

    for (let resultKey of scanResults[1]) {
      const cookie = JSON.parse(await this.redisConnector.getAsync(resultKey));

      if(!secure && cookie.secure) {
        continue;
      }

      if(secure && cookie.httponly) {
        continue;
      }

      if(cookie.path.length > path.length) {
        continue;
      }

      if(path.indexOf(cookie.path) !== 0) {
        continue;
      }

      cookies.push(cookie);
    }

    return cookies;
  }

  /**
  * Sets a cookie (and stores in Redis)
  * @param name Name of cookie
  * @param content Data stored in cookie
  * @param domain Domain of the cookie
  * @param path Path of the cookie (example: '/' or '/blog/')
  * @param secure Whether or not we only send it on secure requests.
  * @param httponly Whether or nto cookie is http only
  * @param duration The duration cookie will persist in seconds.
  */
  async setCookie(name, content, domain, path, secure, httponly, duration = 3600)
  {
    // Unescape then escape. Will make sure everything is properly.
    name = querystring.unescape(name);
    content = querystring.unescape(content);
    name = querystring.escape(name);
    content = querystring.escape(content);

    const key = CookieContainer._buildKey(domain, name);
    const value = JSON.stringify({
      name: name,
      content: content,
      domain: domain,
      path: path,
      secure: secure,
      httponly: httponly
    });

    await this.redisConnector.setAsync(key, value, 'EX', duration);
  }

  /**
  * Sets a cookie from its raw form.
  */
  async setRawCookie(domain, cookie)
  {
    const contents = cookie.split(';').map(x => x.trim());

    // Insert data
    let cookieData = {
      name: null,
      content: null,
      path: '/',
      secure: false,
      httponly: false,
      duration: 3600
    };

    for (const directiveIndex in contents) {
      const directiveValue = contents[directiveIndex];

      const seperator = directiveValue.indexOf('=');
      if(seperator <= 0) {
        const directiveLower = directiveValue.toLowerCase();
        if(directiveLower === 'secure') {
          cookieData.secure = true;
          cookieData.httponly = false;
        }
        if(directiveLower === 'httponly') {
          cookieData.httponly = true;
          cookieData.secure = false;
        }
      }
      else {
        const key = directiveValue.substring(0, seperator);
        const keyLower = key.toLowerCase();
        const value = directiveValue.substring(seperator + 1);

        if(directiveIndex == 0) {
          cookieData.name = key;
          cookieData.content = value;
        }
        else if(keyLower === 'domain') {
          // We have strict domain by the domain that sets the cookie.
        }
        else if(keyLower === 'max-age') {
          // We just follow expires header
        }
        else if(keyLower === 'samesite') {
          // Non-issue.
        }
        else if(keyLower === 'path') {
          cookieData.path = value;
        }
        else if(keyLower === 'expires') {
          const expiry = Math.floor((new Date(value)).getTime() / 1000);
          const currentDate = Math.floor((new Date()).getTime() / 1000);
          cookieData.duration = expiry - currentDate;
          if(cookieData.duration < 1) {
            cookieData.duration = 1;
          }

          // Cookie duration limiter
          if(cookieData.duration > this.cookieDurationLimit) {
            cookieData.duration = this.cookieDurationLimit;
          }
        }
      }
    }

    if(cookieData.name === null || cookieData.content === null) {
      // Failed to fetch of content from cookie.
      return;
    }

    return await this.setCookie(
      cookieData.name,
      cookieData.content,
      domain,
      cookieData.path,
      cookieData.secure,
      cookieData.httponly,
      cookieData.duration
    );
  }

  isValid(string)
  {
    const badCharacters = [
      '(', ')', '<', '>', '@', ',',
      ';', ':', '\\', '\"', '/',
      '[', ']', '?', '=', '{', '}',
      '\t', ' '
    ];

    for(let i = 0; i < string.length; i++) {
      if(string.charCodeAt(i) < 32) {
        // octlets 0-31 are not allowed
        return false;
      }

      if(string.charCodeAt(i) === 127) {
        return false;
      }

      if(badCharacters.includes(string.charAt(i))) {
        return false;
      }
    }

    return true;
  }

  static _buildKey(domain, name)
  {
    return `esearch:cookie:${domain}::${name}`;
  }

  static _buildScanPattern(domain)
  {
    return CookieContainer._buildKey(domain, '*');
  }
}

module.exports = CookieContainer;
