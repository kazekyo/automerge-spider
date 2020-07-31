import { Connection, DocSet, FreezeObject, Message } from 'automerge';
import Redis from 'ioredis';
import { v4 as uuidV4 } from 'uuid';

enum ReferencingDocStatus {
  ON = 'ON',
  OFF = 'OFF',
}

type ReferencingDocStatusMessage = {
  fromNodeId: string;
  docId: string;
  status: ReferencingDocStatus;
};

type DataTransferMessage = {
  fromNodeId: string;
  docId: string;
  message: Message;
};

const SERVER_KEEP_ALIVE_INTERVAL = 1000 * 60; // 1 min
const SERVER_DELETE_CHECK_INTERVAL = 1000 * 60; // 1 min
const SERVER_EXPIRE_INTERVAL = 60 * 3; // 3 min

export class AutomergeSpider<T = unknown> {
  private docSetMap: { [docId: string]: DocSet<T> | undefined };
  private myNodeId: string;
  private nodeConnectionMap: {
    [nodeId: string]: { [docId: string]: Connection<T> | undefined } | undefined;
  };
  private clientConnectionMap: {
    [clientId: string]: Connection<T> | undefined;
  };
  private clientsDependInDoc: { [docId: string]: Array<string> | undefined };
  private readonly redisClient: Redis.Redis;
  private readonly redisSubscriber: Redis.Redis;
  private readonly redisNamespace: string;
  private readonly nodeKeyPrefix: string;
  private readonly loadDoc: ({ docId }: { docId: string }) => Promise<FreezeObject<T>>;

  constructor({
    redis,
    loadDoc,
  }: {
    redis: { host: string; port?: number; namespace?: string };
    loadDoc: ({ docId }: { docId: string }) => Promise<FreezeObject<T>>;
  }) {
    this.myNodeId = uuidV4();
    this.docSetMap = {};
    this.nodeConnectionMap = {};
    this.clientConnectionMap = {};
    this.clientsDependInDoc = {};
    this.loadDoc = loadDoc;

    this.redisNamespace = redis.namespace || 'automerge-spider';
    this.nodeKeyPrefix = `${this.redisNamespace}:nodes`;

    const createRedisClient = () => new Redis({ host: redis.host, port: redis.port });
    this.redisClient = createRedisClient();
    this.redisSubscriber = createRedisClient();

    this.setNodeKeepAliveInterval();
    this.setOtherNodesGCInterval();
  }

  public async joinNodeNetwork(): Promise<void> {
    const referencingDocStatusChannel = this.referencingDocStatusChannel();
    const myDataTransferChannel = this.dataTransferChannel({ nodeId: this.myNodeId });
    this.redisSubscriber.on('message', (channel: string, message: string) => {
      if (channel === referencingDocStatusChannel) {
        this.receiveReferencingDocStatusMessage({ message }).catch((error) => {
          throw error;
        });
      } else if (channel === myDataTransferChannel) {
        this.receiveDataFromOtherNode({ messageString: message });
      }
    });
    await this.redisSubscriber.subscribe(this.dataTransferChannel({ nodeId: this.myNodeId }));
    await this.redisSubscriber.subscribe(referencingDocStatusChannel);
  }

  private setNodeKeepAliveInterval(): void {
    setInterval(() => {
      const key = this.nodeKey({ nodeId: this.myNodeId });
      this.redisClient.set(key, '1').catch((error) => {
        throw error;
      });
      this.redisClient.expire(key, SERVER_EXPIRE_INTERVAL).catch((error) => {
        throw error;
      });
    }, SERVER_KEEP_ALIVE_INTERVAL);
  }

  private setOtherNodesGCInterval(): void {
    setInterval(() => {
      this.deleteGarbageNodeKeys().catch((error) => {
        throw error;
      });
      this.deleteGarbageNodeConnections().catch((error) => {
        throw error;
      });
    }, SERVER_DELETE_CHECK_INTERVAL);
  }

  public async addClient({
    clientId,
    docId,
    sendMessage,
  }: {
    clientId: string;
    docId: string;
    sendMessage: (message: Message) => void;
  }): Promise<void> {
    const connection = this.clientConnectionMap[clientId];
    if (connection) return;

    const docSet = this.docSetMap[docId] || this.addDocSet({ docId, doc: await this.loadDoc({ docId }) });

    const newConnection = new Connection(docSet, (msg: Message) => {
      if (msg.docId !== docId) return;
      sendMessage(msg);
    });
    this.clientConnectionMap[clientId] = newConnection;

    this.addClientId({ clientId, docId });

    newConnection.open();

    await this.redisClient.publish(
      this.referencingDocStatusChannel(),
      this.generateReferencingDocStatusMessage({
        fromNodeId: this.myNodeId,
        docId,
        status: ReferencingDocStatus.ON,
      }),
    );
    return;
  }

  public async removeClient({ clientId, docId }: { clientId: string; docId: string }): Promise<void> {
    const clientConnection = this.clientConnectionMap[clientId];
    clientConnection && clientConnection.close();

    const clientIds = this.clientsDependInDoc[docId];
    if (!clientIds) return;
    this.clientsDependInDoc[docId] = clientIds.filter((value) => value !== clientId);

    const newClientIds = this.clientsDependInDoc[docId];
    if (!newClientIds || newClientIds.length === 0) {
      Object.keys(this.nodeConnectionMap).forEach((nodeId) => {
        this.removeNodeConnection({ nodeId, docId });
      });

      await this.redisClient.publish(
        this.referencingDocStatusChannel(),
        this.generateReferencingDocStatusMessage({
          fromNodeId: this.myNodeId,
          docId: docId,
          status: ReferencingDocStatus.OFF,
        }),
      );
      delete this.docSetMap[docId];
    }
  }

  public receiveMessage({ clientId, message }: { clientId: string; message: Message }): void {
    const connection = this.clientConnectionMap[clientId];
    if (connection) {
      connection.receiveMsg(message);
    }
  }

  public getDoc({ docId }: { docId: string }): FreezeObject<T> | undefined {
    return this.docSetMap[docId]?.getDoc(docId);
  }

  public disconnectRedis(): void {
    this.redisClient.disconnect();
    this.redisSubscriber.disconnect();
  }

  private addDocSet({ docId, doc }: { docId: string; doc: FreezeObject<T> }): DocSet<T> {
    const newDocSet = new DocSet<T>();
    newDocSet.setDoc(docId, doc);
    this.docSetMap[docId] = newDocSet;

    return newDocSet;
  }

  private addClientId({ clientId, docId }: { clientId: string; docId: string }): void {
    const clientIds = this.clientsDependInDoc[docId] || [];
    clientIds.push(clientId);
    this.clientsDependInDoc[docId] = clientIds;
  }

  private addNodeConnection({ nodeId, docId }: { nodeId: string; docId: string }): void {
    const connectionMap = this.nodeConnectionMap[nodeId] || {};

    const docSet = this.docSetMap[docId];
    if (!docSet) return;

    const newConnection = new Connection(docSet, (message: Message) => {
      this.sendDataToOtherNode({ nodeId, docId, message }).catch((error) => {
        throw error;
      });
    });
    connectionMap[docId] = newConnection;
    this.nodeConnectionMap[nodeId] = connectionMap;

    newConnection.open();
  }

  private removeNodeConnection({ nodeId, docId }: { nodeId: string; docId: string }): void {
    const connectionMap = this.nodeConnectionMap[nodeId];
    if (!connectionMap) return;

    const connection = connectionMap[docId];
    if (!connection) return;

    connection?.close();
    delete connectionMap[docId];
  }

  private removeNodeConnectionsByNodeId({ nodeId }: { nodeId: string }): void {
    const connectionMap = this.nodeConnectionMap[nodeId];
    if (!connectionMap) return;
    Object.keys(connectionMap).forEach((docId) => this.removeNodeConnection({ nodeId, docId }));
    delete this.nodeConnectionMap[nodeId];
  }

  private existsNodeConnection({ nodeId, docId }: { nodeId: string; docId: string }): boolean {
    const connectionMap = this.nodeConnectionMap[nodeId];
    if (!connectionMap) return false;

    return !!connectionMap[docId];
  }

  private async receiveReferencingDocStatusMessage({ message }: { message: string }): Promise<void> {
    const { fromNodeId, docId, status } = this.parseReferencingDocStatusMessage({ message });
    if (status === ReferencingDocStatus.ON) {
      if (fromNodeId === this.myNodeId) return;
      if (!this.existsClientsDependInDoc({ docId })) return;
      if (this.existsNodeConnection({ nodeId: fromNodeId, docId })) return;

      this.addNodeConnection({ nodeId: fromNodeId, docId: docId });

      await this.redisClient.publish(
        this.referencingDocStatusChannel(),
        this.generateReferencingDocStatusMessage({
          fromNodeId: this.myNodeId,
          docId,
          status: ReferencingDocStatus.ON,
        }),
      );
    } else {
      this.removeNodeConnection({ nodeId: fromNodeId, docId: docId });
    }
  }

  private async sendDataToOtherNode({
    nodeId,
    docId,
    message,
  }: {
    nodeId: string;
    docId: string;
    message: Message;
  }): Promise<void> {
    const msgString = this.generateDataTransferMessage({
      docId,
      message,
      fromNodeId: this.myNodeId,
    });
    const channel = this.dataTransferChannel({ nodeId });

    const connectionMap = this.nodeConnectionMap[nodeId];
    if (!connectionMap) return;

    await this.redisClient.publish(channel, msgString);
  }

  private receiveDataFromOtherNode({ messageString }: { messageString: string }): void {
    const { docId, message, fromNodeId } = this.parseDataTransferMessage({
      message: messageString,
    });

    if (!this.existsClientsDependInDoc({ docId })) return;

    let connectionMap = this.nodeConnectionMap[fromNodeId];
    if (!connectionMap || !connectionMap[docId]) {
      this.addNodeConnection({ nodeId: fromNodeId, docId });
      connectionMap = this.nodeConnectionMap[fromNodeId] || {};
    }

    const connection = connectionMap[docId];
    if (!connection) return;
    connection.receiveMsg(message);
  }

  private async otherNodeIds(): Promise<string[]> {
    const keys = await this.otherNodeKeys();
    return keys.map((value) => this.extractNodeId({ nodeKey: value }));
  }

  private async otherNodeKeys(): Promise<string[]> {
    const keys = await this.redisClient.keys(`${this.nodeKeyPrefix}/*`);
    const myNodeKey = this.nodeKey({ nodeId: this.myNodeId });
    return keys.filter((key) => key !== myNodeKey);
  }

  private existsClientsDependInDoc({ docId }: { docId: string }): boolean {
    const clientIds = this.clientsDependInDoc[docId];
    return !!clientIds && clientIds.length > 0;
  }

  private async deleteGarbageNodeKeys(): Promise<void> {
    const nodeKeys = await this.otherNodeKeys();

    await Promise.all(
      nodeKeys.map(async (value) => {
        const ttl = await this.redisClient.ttl(value);
        if (ttl <= 0 || !ttl) {
          await this.redisClient.del(value);
        }
      }),
    );
  }

  private async deleteGarbageNodeConnections(): Promise<void> {
    const nodeIds = await this.otherNodeIds();
    Object.keys(this.nodeConnectionMap).forEach((nodeId) => {
      if (nodeIds.includes(nodeId)) return;
      this.removeNodeConnectionsByNodeId({ nodeId });
    });
  }

  private nodeKey({ nodeId }: { nodeId: string }): string {
    return `${this.nodeKeyPrefix}:${nodeId}`;
  }

  private extractNodeId({ nodeKey }: { nodeKey: string }): string {
    return nodeKey.split(':')[2];
  }

  private generateReferencingDocStatusMessage(message: ReferencingDocStatusMessage): string {
    return JSON.stringify(message);
  }

  private parseReferencingDocStatusMessage({ message }: { message: string }): ReferencingDocStatusMessage {
    return JSON.parse(message) as ReferencingDocStatusMessage;
  }

  private generateDataTransferMessage(message: DataTransferMessage): string {
    return JSON.stringify(message);
  }

  private parseDataTransferMessage({ message }: { message: string }): DataTransferMessage {
    return JSON.parse(message) as DataTransferMessage;
  }

  private dataTransferChannel({ nodeId }: { nodeId: string }): string {
    return `${this.redisNamespace}:doc-data-transfer:${nodeId}`;
  }

  private referencingDocStatusChannel(): string {
    return `${this.redisNamespace}:doc-referencing-status`;
  }
}
