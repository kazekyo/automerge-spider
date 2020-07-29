# Automerge-Spider
Automerge-Spider is a library to enable scaling of servers when using [Automerge](https://github.com/automerge/automerge) for real-time communication.

If you are using Automerge on client/server model, Automerge-Spider allows servers to share document changes with each other in real-time via Redis.
Even if the clients are connected to different servers, clients can see the changes they have made to each other.
For example, Autoemrge-Spider can be used in implementations such as collaborative editing where the client and server communicate in real-time.

## Getting Started
```
npm install @kazekyo/automerge-spider
```

## Usage
On the client, keep to use the Automerge.Connection as it is. On the server, Automerge-Spider will take the place of Automerge.Connection.

First, you create an AutomergeSpider instance on a server. Keep the instance created on the server.
You join the instance to the network of servers.
```
this.spider = new AutomergeSpider({
  redis: { host: '0.0.0.0', port: 6379 },
  loadDoc: async (docId) => {
    const doc = FIND_YOUR_DOC // e.g. findDoc(docId)
    return doc;
  },
});
await this.spider.joinNodeNetwork();
```

When the server find a client, instead of creating an Automerge.Connection, you add the client to the spider instance.
```
await this.spider.addClientDependInDoc({
  clientId: client.id,
  docId,
  sendMessage: (msg) => client.emit('message', msg),
});
```

When the server receives a message from the client, you can do the following.
```
this.spider.receiveMessage({ clientId: client.id, message: msg });
```

When the client leaves the server, you can do the following.
```
this.spider.removeClientDependInDoc({ clientId: 'clientId2', docId });
```


## TODO
- Add example
