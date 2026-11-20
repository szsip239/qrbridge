/** Reads length-prefixed records; `head` bytes after the length identify each payload. */
export function onRecords(stream, head, onRecord) {
  let pending = Buffer.alloc(0);
  stream.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4 + head && pending.length >= 4 + head + pending.readUInt32BE(0)) {
      const end = 4 + head + pending.readUInt32BE(0);
      onRecord(pending.subarray(4, 4 + head), pending.subarray(4 + head, end));
      pending = pending.subarray(end);
    }
  });
}

export function createMirrorOpener(link) {
  return async (onClose, onClipboard) => {
    const { socket, close } = await link('mirror');
    const mirror = { latest: null, close };
    onRecords(socket, 1, (kind, data) => {
      if (kind[0] === 2) onClipboard(JSON.parse(data.toString('utf8')));
      else if (kind[0] === 0 || kind[0] === 1) mirror.latest = { camera: kind[0] === 1, jpeg: data };
      else throw new Error(`未知镜像记录类型：${kind[0]}`);
    });
    socket.on('close', onClose);
    return mirror;
  };
}

export function createControlOpener(link) {
  return async onClose => {
    const { socket, close } = await link('control');
    const waiting = [];
    let pending = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const response = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        const request = waiting.shift();
        if (response.error) request.reject(new Error(response.error));
        else request.resolve(response);
      }
    });
    const rejectAll = error => { waiting.splice(0).forEach(request => request.reject(error)); };
    socket.on('error', rejectAll);
    socket.on('close', () => { rejectAll(new Error('手机控制连接已断开')); onClose(); });
    return {
      request(payload) {
        const request = Promise.withResolvers();
        waiting.push(request);
        socket.write(`${JSON.stringify(payload)}\n`);
        return request.promise;
      },
      close,
    };
  };
}
