const htmlparser = require('htmlparser2');
const domutils = require('domutils');
const url = require('url');
const querystring = require('querystring');
const he = require('he');
const path = require('path');

/*
getInnerHTML: [Function: bound getInnerHTML],
  getOuterHTML: [Function: bound ],
  getText: [Function: bound getText],
  getChildren: [Function: bound ],
  getParent: [Function: bound ],
  getSiblings: [Function: bound ],
  getAttributeValue: [Function: bound ],
  hasAttrib: [Function: bound ],
  getName: [Function: bound ],
  removeElement: [Function: bound ],
  replaceElement: [Function: bound ],
  appendChild: [Function: bound ],
  append: [Function: bound ],
  prepend: [Function: bound ],
  filter: [Function: bound filter],
  find: [Function: bound find],
  findOneChild: [Function: bound findOneChild],
  findOne: [Function: bound findOne],
  existsOne: [Function: bound existsOne],
  findAll: [Function: bound findAll],
  isTag: [Function: bound isTag],
  testElement: [Function: bound ],
  getElements: [Function: bound ],
  getElementById: [Function: bound ],
  getElementsByTagName: [Function: bound ],
  getElementsByTagType: [Function: bound ],
  removeSubsets: [Function: bound ],
  compareDocumentPosition: [Function: bound ],
  uniqueSort: [Function: bound ] }
*/

/**
* Processes a crawled page
*/
class HtmlPageProcessor
{
  constructor(pageQueue, crawlerSettings, schemaProcessor)
  {
    this.crawlerSettings = crawlerSettings;
    this.pageQueue = pageQueue;
    this.schemaProcessor = schemaProcessor;
  }

  /**
  * Processes a HTML page.
  *
  */
  async processPage(request, response, subject, subjectOptions)
  {
    try {
      response.on('error', console.error);

      const dom = await this._bufferParse(response);
      if(!dom) {
        // Bad Object.
        return;
      }

      const head = domutils.findOne(restraint => restraint.name == 'head', dom);
      const body = domutils.findOne(restraint => restraint.name == 'body', dom);

      if(!body || !head) {
        return;
      }

      let permissions = {
        permitIndex: true,
        permitFollow: true,
        permitImageIndex: true,
        permitArchive: true,
        permitTranslate: true,
        permitSnippet: true,
      };

      // getting metadata about robot permissions
      await this._handleRobotsMetadata(permissions, response, head);

      if(!permissions.permitIndex) {
        // No indexing is allowed.
        return;
      }

      if(permissions.permitFollow) {
        const anchorElements = domutils.find(
          restraint => {
            return restraint.name == 'a'
          }, body.children, true
        );

        await this._handleAnchors(anchorElements, subject, subjectOptions);
      }

      // Classifying page
      const classification = await this._classifyPage(head, body, response, subject, subjectOptions);
      const processedSchemas = await this.schemaProcessor.processDom(dom, subject);
      console.log(processedSchemas);

      //console.log(classification);

      if(permissions.permitImageIndex) {
        // TODO: Scan and index images.
      }

      //console.log(head.name);
      /*for (const child of head.children) {
        if(['script', 'link'].includes(child.type)) {
          //console.log(child);
        }
      }*/
    }
    catch(ex) {
      console.log(`Error for ${subject}`);
      console.error(ex);
    }
  }

  /**
  * Gets information about the page for the index. Keywords, title, locale,
  * description, and much more.
  */
  async _classifyPage(domHead, domBody, response, subject, subjectOptions)
  {
    const subjectParsed = url.parse(subject);
    const openGraphElements = domutils.find(
      restraint => (
        restraint.type === 'tag' &&
        restraint.name == 'meta' &&
        typeof restraint.attribs.property === 'string' &&
        restraint.attribs.property.substring(0, 3) == 'og:'
      ), domHead.children
    );

    let title = domutils.findOne(
      restraint => (
        restraint.type === 'tag' &&
        restraint.name == 'title'
      ), domHead.children
    );

    // Try find a H1 in document, if failed to get title.
    title = title || domutils.findOne(
      restraint => (
        restraint.type === 'tag' &&
        restraint.name == 'h1' &&
        restraint.children.length > 0 &&
        restraint.children[0].type === 'text' &&
        restraint.children[0].data.length > 0
      ), domBody.children
    );

    // Try find title from URL, as we failed to get from body and title
    // element
    title = title || `${path.basename(subjectParsed.pathname)} - ${subjectParsed.hostname}`;

    let description = domutils.findOne(
      restraint => (
        restraint.name == 'meta' &&
        typeof restraint.attribs === 'object' &&
        typeof restraint.attribs.name === 'string' &&
        typeof restraint.attribs.content === 'string'
      ), domHead.children
    );

    description = description || domutils.findOne(
      restraint => (
        restraint.name == 'p'
      ), domBody.children
    );

    return {
      title: (typeof title == 'string'
        ? title
        : he.decode(domutils.getInnerHTML(title)).trim()
      ),

      description: (typeof title == 'string'
        ? title
        : he.decode(domutils.getInnerHTML(title)).trim()
      )
    };
  }

  /**
  * Scans metadata (in http headers, and html head) and gets data about whether
  * we can or cant index the page -- metadata is set in permissions parameter.
  */
  async _handleRobotsMetadata(permissions, response, head)
  {
    // Checking indexing headers (whether or not we got permission to crawl)
    let robotsPermit = response.headers['x-robots-tag'] || null;

    // If we didn't get any data from the http header 'x-robots-tag', check
    // html header metadata.
    if(!robotsPermit) {
      robotsPermit = domutils.findOne(
        restraint => (
          typeof restraint.attribs === 'object' &&
          typeof restraint.attribs.name === 'string' &&
          restraint.attribs.name.toLowerCase() === 'robots'
        ), head.children
      );

      if(robotsPermit) {
        if(typeof robotsPermit.attribs.content === 'string') {
          robotsPermit = robotsPermit.attribs.content;
        }
        else {
          robotsPermit = null;
        }
      }
    }

    // If robots instructions were found, process them.
    if(robotsPermit) {
      const robotActions = robotsPermit.split(',').map(
        robotAction => robotAction.trim().toLowerCase()
      );

      for(const robotAction of robotActions) {
        switch (robotAction) {
          case 'noindex': {
            permissions.permitIndex = false;
            break;
          }

          case 'nofollow': {
            permissions.permitFollow = false;
            break;
          }

          case 'noimageindex': {
            permissions.permitImageIndex = false;
            break;
          }

          case 'noarchive': {
            permissions.permitArchive = false;
            break;
          }

          case 'nosnippet': {
            permissions.permitSnippet = false;
            break;
          }

          case 'notranslate': {
            permissions.permitTranslate = false;
            break;
          }

          case 'none': {
            permissions.permitIndex = false;
            permissions.permitFollow = false;
            break;
          }

          default: continue;
        }
      }
    }
  }

  /**
  * The purpose of this function is to add somewhat control into what we add
  * to the queue. Rather than spamming it, we are going to be careful with
  * what we add. If we add a site like youtube to the queue, that is soon going
  * to bloat the entire queue. So rather than that, we are going to add strict
  * rules no prioritizing what's added.
  */
  async _handleAnchors(anchors, subject, subjectOptions)
  {
    const subjectParsed = url.parse(subject);
    const subjectInQueue = await this.pageQueue.domainQueueCount(
      subjectParsed.hostname
    );

    // The popularity of a site decreases the amount of url's we can queue from
    // it. This is so we can share the load to other sites.
    const anchorInsertLimit = Math.floor(
      // maxScore - (queue / queueLimit) * maxScore
      this.crawlerSettings.maxPageUrlScrape - (subjectInQueue / this.crawlerSettings.domainQueueLimit) * this.crawlerSettings.maxPageUrlScrape
    );

    // All anchors grouped by their hostname.
    let groupedAnchors = {};

    // Sorted array (sorted by inQueue). This is not done until after we've
    // put all anchors into groupedAnchors.
    let sortedArray = []

    // Final anchors that we will insert.
    let finalAnchors = [];

    // Processing anchors.
    for(const anchor of anchors) {
      if(anchor.attribs.href) {
        const href = url.resolve(subject, he.decode(anchor.attribs.href));
        const parsedHref = url.parse(href);

        if(parsedHref.protocol != 'http:' && parsedHref.protocol != 'https:') {
          // non-http url
          continue;
        }

        if(typeof groupedAnchors[parsedHref.hostname] === 'undefined') {
          groupedAnchors[parsedHref.hostname] = {
            hostname: parsedHref.hostname,
            count: 0,
            inQueue:  await this.pageQueue.domainQueueCount(parsedHref.hostname),
            anchors: []
          };
        }

        groupedAnchors[parsedHref.hostname].anchors.push(href);
        groupedAnchors[parsedHref.hostname].count++;
      }
    }

    // Creating and ordering list by the amount of url's in queue.
    for(const groupedAnchorIndex in groupedAnchors) {
      sortedArray.push(groupedAnchors[groupedAnchorIndex]);
    }
    sortedArray.sort((elem1, elem2) => elem1.inQueue > elem2.inQueue);

    // Now inserting to queue.
    let insertCount = 0;


    // Inserting non-queued pages before queued pages.
    for (const interation of sortedArray) {
      if(insertCount > anchorInsertLimit) {
        break;
      }

      if(interation.inQueue > 0) {
        continue;
      }

      for(const anchor of interation.anchors) {
        if(insertCount > anchorInsertLimit) {
          break;
        }

        if(await this.pageQueue.pushQueue(
          url.resolve(subject, he.decode(anchor))
        ), {
          referer: subject
        }) {
          insertCount++
        }
      }
    }

    // Now inserting pages already in queue that do not include the site we've
    // just scraped.
    if(insertCount < anchorInsertLimit) {
      for (const interation of sortedArray) {
        if(insertCount > anchorInsertLimit) {
          break;
        }

        if(interation.hostname === subjectParsed.hostname) {
          continue;
        }

        for(const anchor of interation.anchors) {
          if(insertCount > anchorInsertLimit) {
            break;
          }

          if(await this.pageQueue.pushQueue(
            url.resolve(subject, he.decode(anchor))
          ), {
            referer: subject
          }) {
            insertCount++
          }
        }
      }
    }

    // If there's any space-left, insert pages for the site we've just crawled
    if(insertCount < anchorInsertLimit) {
      for (const interation of sortedArray) {
        if(insertCount > anchorInsertLimit) {
          break;
        }

        if(interation.hostname !== subjectParsed.hostname) {
          continue;
        }

        for(const anchor of interation.anchors) {
          if(insertCount > anchorInsertLimit) {
            break;
          }

          if(await this.pageQueue.pushQueue(
            url.resolve(subject, he.decode(anchor))
          ), {
            referer: subject
          }) {
            insertCount++
          }
        }
      }
    }
  }

  /**
  * Buffer amd parse response
  */
  _bufferParse(response)
  {
    return new Promise((resolve, reject) => {
      let domHandler = new htmlparser.DomHandler((err, dom) => {
        if(err) {
          return reject(err);
        }
        resolve(dom);
      });
      let parser = new htmlparser.Parser(domHandler);

      response.on('error', reject);

      response.on('data', (data) =>
        parser.write(data.toString())
      );

      response.on('end', () => parser.end());
    });
  }
}

module.exports = HtmlPageProcessor;
