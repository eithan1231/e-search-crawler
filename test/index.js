const assert = require('assert');

const PageQueue = require('../library/PageQueue');

describe('PageQueue', () => {
  describe('#stripSubDomains', () => {
    it('should return \'com.au\' when passed \'com.au\'', () => {
      assert.equal(PageQueue.stripSubDomains('com.au'), 'com.au');
    });

    it('should return \'hello.com.au\' when passed \'hello.com.au\'', () => {
      assert.equal(PageQueue.stripSubDomains('hello.com.au'), 'hello.com.au');
    });

    it('should return \'hello.com.au\' when passed \'test.hello.com.au\'', () => {
      assert.equal(PageQueue.stripSubDomains('test.hello.com.au'), 'hello.com.au');
    });

    it('should return \'hello.com\' when passed \'test.hello.com\'', () => {
      assert.equal(PageQueue.stripSubDomains('test.hello.com'), 'hello.com');
    });

    it('should return \'hello.com\' when passed \'hello.com\'', () => {
      assert.equal(PageQueue.stripSubDomains('hello.com'), 'hello.com');
    });
  });
});
