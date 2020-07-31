import { Connection, DocSet, load, Message, save, Text, FreezeObject, change, ChangeFn } from 'automerge';
import { AutomergeSpider } from '../index';

export type DocType = { text: Text };

export class Timer {
  public static async wait(ms: number): Promise<unknown> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const cloneDoc = <T>(doc: FreezeObject<T>): FreezeObject<T> => load(save(doc));

export type TestSetResult<T> = {
  server: { spider: AutomergeSpider };
  client: { connection: Connection<T>; docSet: DocSet<T> };
};
export const generateTestSet = async <T>({
  clientId,
  redisOption,
  docId,
  doc,
}: {
  clientId: string;
  redisOption: { host: string; port?: number; namespace?: string };
  docId: string;
  doc: FreezeObject<T>;
}): Promise<TestSetResult<T>> => {
  const spider = new AutomergeSpider({
    redis: redisOption,
    loadDoc: async () => Promise.resolve(cloneDoc(doc)),
  });
  await spider.joinNodeNetwork();
  const clientDocSet = new DocSet<T>();
  clientDocSet.setDoc(docId, cloneDoc(doc));
  const clientConnection = new Connection(clientDocSet, (message: Message) =>
    spider.receiveMessage({ clientId, message }),
  );
  await spider.addClient({
    clientId,
    docId,
    sendMessage: (message) => clientConnection.receiveMsg(message),
  });

  return { server: { spider }, client: { connection: clientConnection, docSet: clientDocSet } };
};

export const changeClientDoc = <T>(
  {
    docId,
    docSet,
    connection,
  }: {
    docId: string;
    docSet: DocSet<T>;
    connection: Connection<T>;
  },
  changeFn: ChangeFn<T>,
): void => {
  const clientChangedDoc = change(docSet.getDoc(docId), changeFn);
  docSet.setDoc(docId, clientChangedDoc);
  connection.maybeSendChanges(docId);
};
