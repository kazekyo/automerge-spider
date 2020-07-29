# Automerge-Spider
Automerge-Spiderは、Automergeを使ったリアルタイムな通信を行う時に、サーバーをスケーリング可能にするためのライブラリです。

Automergeをclient/serverモデルで使用している場合、Automerge-Spiderを使用することで、サーバー同士はRedisを経由してリアルタイムにdocumentの変更を共有できます。
これにより異なるサーバーにクライアントが接続しても、クライアントはdocumentの変更をリアルタイムに知ることができます。
例えば、Autoemrge-Spiderは、リアルタイムにclientとserverが通信する共同編集などの実装で使用できます。

## Getting Started
```
npm install @kazekyo/automerge-spider
```

## Usage
クライアントではAutomerge.Connectionを使用し、サーバーではAutomerge-SpiderがAutomerge.Connectionの代わりをします。

AutomergeSpiderをサーバーで生成し、インスタンスを保持します。spiderがサーバーのネットワークに参加します。
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

サーバーがクライアントを見つけた時、Automerge.Connectionを生成する代わりにAutomerge-Spiderにクライアントを登録します。
```
await this.spider.addClientDependInDoc({
  clientId: client.id,
  docId,
  sendMessage: (msg) => client.emit('message', msg),
});
```

サーバーがクライアントからメッセージを受けた時には次のようにします。
```
this.spider.receiveMessage({ clientId: client.id, message: msg });
```

クライアントがサーバーから離れる時には次のようにします。
```
this.spider.removeClientDependInDoc({ clientId: 'clientId2', docId });
```


## TODO
- Add example
