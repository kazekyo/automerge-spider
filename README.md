# Automerge-spider
Automerge-spider is a library that enables you to scale servers when using [Automerge](https://github.com/automerge/automerge) for real-time communication.

If you are using Automerge on client/server model, Automerge-spider allows servers to share document changes with each other in real-time via Redis.
Though clients are connected to different servers, they can receive the changes in the document made by other clients.

Autoemrge-Spider can be used in implementations such as collaborative editing where clients and servers communicate with each other in real-time.

## Getting Started
```
npm install @kazekyo/automerge-spider
```

## Usage
At client side, [Automerge.Connection](https://github.com/automerge/automerge#sending-and-receiving-changes) is used. At server side, Automerge-spider is used in place of Automerge.Connection.

First, you create Automerge-spider on server and keep the instance.
This server joins a network of servers after call `joinNodeNetwork()` .
```ts
this.spider = new AutomergeSpider({
  redis: { host: '0.0.0.0', port: 6379 },
  loadDoc: async (docId) => {
    const doc = FIND_YOUR_DOC // e.g. findDoc(docId)
    return doc;
  },
});
await this.spider.joinNodeNetwork();
```

When the server finds a client, call `addClient()` instead of creating Automerge.Connection.
```ts
await this.spider.addClient({
  clientId: client.id,
  docId,
  sendMessage: (msg) => client.emit('message', msg),
});
```
Currently, only one doc can be linked to one client. If you want to link multiple docs to one client, write `clientId` as `${clientId}-${docId}`.

When the server receives a message from the client, call `receiveMessage()`.
```ts
this.spider.receiveMessage({ clientId: client.id, message: msg });
```

When the client leaves the server, call `removeClient()`.
```ts
await this.spider.removeClient({ clientId: client.id, docId });
```


## TODO
- Add example
