import { Connection, DocSet, from, Text } from 'automerge';
import { AutomergeSpider } from '..';
import { changeClientDoc, cloneDoc, DocType, generateTestSet, Timer } from '../__test-utils__/utils';

describe('AutomergeSpider', () => {
  describe('e2e', () => {
    const redisOption = { host: '0.0.0.0', port: 6380, namespace: 'Test' };

    const docId = 'docId';

    describe('when changes are made on client 1 connected to server 1', () => {
      let client1: { connection: Connection<DocType>; docSet: DocSet<DocType> };
      let client2: { connection: Connection<DocType>; docSet: DocSet<DocType> };
      let server2: { spider: AutomergeSpider };

      beforeEach(async () => {
        const doc = from({ text: new Text('first') });
        const testSet1 = await generateTestSet({ clientId: 'clientId1', redisOption, docId, doc: cloneDoc(doc) });
        client1 = testSet1.client;
        await Timer.wait(100);

        const testSet2 = await generateTestSet({ clientId: 'clientId2', redisOption, docId, doc: cloneDoc(doc) });
        client2 = testSet2.client;
        server2 = testSet2.server;

        await Timer.wait(100);
      });

      it('should send changes to client 2 connected to server 2', async () => {
        changeClientDoc({ docId, docSet: client1.docSet, connection: client1.connection }, (doc) => {
          doc.text = new Text('changed');
        });
        await Timer.wait(200);

        expect(JSON.stringify(client2.docSet.getDoc(docId))).toBe(JSON.stringify({ text: 'changed' }));
      });

      describe('when removed client 2 from server 2', () => {
        it('should not send changes to client 2', async () => {
          changeClientDoc({ docId, docSet: client1.docSet, connection: client1.connection }, (doc) => {
            doc.text = new Text('1 changed');
          });
          await Timer.wait(100);
          expect(JSON.stringify(client2.docSet.getDoc(docId))).toBe(JSON.stringify({ text: '1 changed' }));

          server2.spider.removeClientDependInDoc({ clientId: 'clientId2', docId });
          changeClientDoc({ docId, docSet: client1.docSet, connection: client1.connection }, (doc) => {
            doc.text = new Text('2 changed');
          });
          await Timer.wait(100);
          expect(JSON.stringify(client2.docSet.getDoc(docId))).toBe(JSON.stringify({ text: '1 changed' }));
        });
      });
    });
  });
});
