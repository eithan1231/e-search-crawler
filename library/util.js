const util = require('util');

util.promisifyAll = (prototypes) => {
  for(let prototype in prototypes) {
    if(typeof prototypes[prototype] === 'function') {
      prototypes[`${prototype}Async`] = util.promisify(prototypes[prototype]);
    }
  }
};

util.setTimeoutAsync = util.promisify(setTimeout);

module.exports = util;
