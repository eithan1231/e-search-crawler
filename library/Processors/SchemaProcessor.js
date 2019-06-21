const domutils = require('domutils');


/**
* Processes schemas from schema.org
*/
class SchemaProcessor
{
  /**
  * Processes a dom object extracting all schemas
  * @param dom The docuemnt we're processing
  * @param subject The url we crawled to get the dom
  */
  async processDom(dom, subject)
  {
    const schemas = domutils.find(cond => (
      cond.type === 'tag' &&
      typeof cond.attribs === 'object' &&
      typeof cond.attribs.itemscope !== 'undefined'
    ), dom, true);
    console.log(schemas);

  }
}

module.exports = SchemaProcessor;
