const url = require('url');
const querystring = require('querystring');

/**
* Processes a crawled image page
*/
class ImagePageProcessor
{
  constructor(pageQueue, crawlerSettings)
  {
    this.crawlerSettings = crawlerSettings;
    this.pageQueue = pageQueue;
  }

  /**
  * Processes a HTML page.
  *
  */
  async processPage(request, response, subject, subjectOptions)
  {
    try {
      response.on('error', console.error);

      // Buffering the server response.
      const imageParts = await this._bufferParse(response);

      // TODO: this.
    }
    catch(ex) {
      console.log(`Error for ${subject}`);
      console.error(ex);
    }
  }

  /**
  * Buffer amd parse response
  */
  _bufferParse(response)
  {
    return new Promise((resolve, reject) => {
      response.on('error', reject);

      let dataBuffer = [];

      response.on('data', (data) => {
        dataBuffer.push(data);
      });

      response.on('end', () => resolve(dataBuffer));
    });
  }
}

module.exports = ImagePageProcessor;
