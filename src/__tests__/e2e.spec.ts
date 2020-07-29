import { from, Text } from 'automerge';
import { changeClientDoc, cloneDoc, DocType, generateTestSet, TestSetResult, Timer } from '../__test-utils__/utils';

describe('AutomergeSpider', () => {
  describe('e2e', () => {
    const redisPort = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6380;
    const redisOption = {
      host: process.env.REDIS_HOST || '0.0.0.0',
      port: redisPort,
      namespace: 'Test',
    };

    const docId = 'docId';

    describe('when changes are made on client 1 connected to server 1', () => {
      let testSet1: TestSetResult<DocType>;
      let testSet2: TestSetResult<DocType>;

      beforeEach(async () => {
        const doc = from({ text: new Text('first') });
        testSet1 = await generateTestSet({ clientId: 'clientId1', redisOption, docId, doc: cloneDoc(doc) });
        await Timer.wait(100);
        testSet2 = await generateTestSet({ clientId: 'clientId2', redisOption, docId, doc: cloneDoc(doc) });
        await Timer.wait(100);
      });

      afterEach(() => {
        testSet1.server.spider.disconnectRedis();
        testSet2.server.spider.disconnectRedis();
      });

      it('should send changes to client 2 connected to server 2', async () => {
        changeClientDoc({ docId, docSet: testSet1.client.docSet, connection: testSet1.client.connection }, (doc) => {
          doc.text = new Text('changed');
        });
        await Timer.wait(200);

        expect(JSON.stringify(testSet2.client.docSet.getDoc(docId))).toBe(JSON.stringify({ text: 'changed' }));
      });

      describe('when removed client 2 from server 2', () => {
        it('should not send changes to client 2', async () => {
          changeClientDoc({ docId, docSet: testSet1.client.docSet, connection: testSet1.client.connection }, (doc) => {
            doc.text = new Text('1 changed');
          });
          await Timer.wait(200);
          expect(JSON.stringify(testSet2.client.docSet.getDoc(docId))).toBe(JSON.stringify({ text: '1 changed' }));

          await testSet2.server.spider.removeClientDependInDoc({ clientId: 'clientId2', docId });
          changeClientDoc({ docId, docSet: testSet1.client.docSet, connection: testSet1.client.connection }, (doc) => {
            doc.text = new Text('2 changed');
          });
          await Timer.wait(200);
          expect(JSON.stringify(testSet2.client.docSet.getDoc(docId))).toBe(JSON.stringify({ text: '1 changed' }));
        });
      });
    });
  });
});
