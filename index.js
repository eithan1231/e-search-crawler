const redis = require('redis');

const fs = require('fs');
const yaml = require('js-yaml');
const redisConfig = yaml.safeLoad(fs.readFileSync('config/redis.yaml'));
const crawlerConfig = yaml.safeLoad(fs.readFileSync('config/crawler.yaml'));

const WikipediaProcessor = require('./library/Processors/WikipediaProcessor');
const WikidataProcessor = require('./library/Processors/WikidataProcessor');
const HtmlPageProcessor = require('./library/Processors/HtmlPageProcessor');
const SchemaProcessor = require('./library/Processors/SchemaProcessor');
const CookieContainer = require('./library/CookieContainer');
const PageQueue = require('./library/PageQueue');
const Plugins = require('./library/Plugins');
const Crawler = require('./library/Crawler');
const Robots = require('./library/Robots');
const util = require('./library/util');

util.promisifyAll(redis.RedisClient.prototype);
util.promisifyAll(redis.Multi.prototype);

// Our user agent.
// NOTE: Changing this is not reommended. We would advise leaving as is. If you
// do want to change it, make sure you change it before you start crawling, and
// not after. Changing after you've crawled some pages, will result in a invalid
// robots.txt cache.
const userAgent = "Mozilla/5.0 (compatible; esearch)";

async function main()
{
  try {
    const redisConfigSelection = redisConfig[
      Math.floor(Math.random() * redisConfig.length)
    ];

    const redisClient = redis.createClient({
      host: redisConfigSelection.hostname,
      port: redisConfigSelection.port,
      password: redisConfigSelection.password || undefined,
      retry_strategy: redisRetryStrategy
    });

    redisClient.on('reconnecting', () => console.log('Rediis lost connection. Reconnecting.'));
    redisClient.on('connect', () => console.log('Redis connected.'));

    const plugins = new Plugins();
    const pageQueue = new PageQueue(redisClient);
    const robots = new Robots(redisClient, userAgent);
    const schemaProcessor = new SchemaProcessor();
    const htmlPageProcessor = new HtmlPageProcessor(pageQueue, crawlerConfig, schemaProcessor);
    const cookieContainer = new CookieContainer(
      redisClient,
      plugins,
      crawlerConfig.cookieDurationLimit
    );

    pageQueue.pushQueue('http://dmozlive.com');
    pageQueue.pushQueue('http://google.com');
    pageQueue.pushQueue('http://mpgh.net');

    // Starting the crawler.
    const crawler = new Crawler({
      concurrency: crawlerConfig.concurrency,
      retryThreshold: crawlerConfig.retryThreshold,
      redirectLimit: crawlerConfig.redirectLimit,
      retryErrorCount: crawlerConfig.retryErrorCount,
      userAgent: userAgent,
      htmlPageProcessor: htmlPageProcessor,
      cookieContainer: cookieContainer,
      pageQueue: pageQueue,
      robots: robots,
    });

    await crawler.start();
  }
  catch(ex) {
    console.error(ex);
  }
}

function redisRetryStrategy(options)
{
  if(options.total_retry_time > 1000 * 60 * 60) {
    return new Error('Retry time exhausted');
  }

  if(options.attempt > 30) {
    return new Error('Retry attempts exceed limit');;
  }

  return Math.min(options.attempt * 100, 3000);
}

main();
