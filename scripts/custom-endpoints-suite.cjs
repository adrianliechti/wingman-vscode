const assert = require('node:assert/strict');
const http = require('node:http');
const vscode = require('vscode');

const ids = ['gpt-6.2-astra', 'gpt-6.2-sol', 'claude-sonnet-5-5', 'glm-5.3'];
const key = 'wingman-integration-test-key';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async function () {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: ids.map(id => ({ id })) }));
      return;
    }
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push({ path: req.url, headers: req.headers, body });
      // Match Wingman's static/OIDC auth, including on /v1/messages.
      if (req.headers.authorization !== `Bearer ${key}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Expected Wingman Bearer authentication' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const continuation = JSON.stringify(body).includes('tool-result-ping');
      respond(res, req.url, body.model, continuation);
      res.end();
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const config = vscode.workspace.getConfiguration('wingman');
    await config.update('baseUrl', `http://127.0.0.1:${server.address().port}/v1`, vscode.ConfigurationTarget.Global);
    await config.update('apiKey', key, vscode.ConfigurationTarget.Global);
    // New VS Code profiles initially disable bundled Copilot until chat setup.
    // This affects only the runner's disposable, empty extensions directory.
    await vscode.commands.executeCommand('workbench.extensions.action.enableAll');
    for (let attempt = 0; attempt < 40 && !vscode.extensions.getExtension('GitHub.copilot-chat'); attempt++) await pause(250);
    assert.ok(vscode.extensions.getExtension('GitHub.copilot-chat'), 'Enable bundled GitHub Copilot Chat in the test profile');
    await vscode.commands.executeCommand('wingman.syncModels');
    let models = [];
    for (let attempt = 0; attempt < 60; attempt++) {
      models = await vscode.lm.selectChatModels({ vendor: 'customendpoint' });
      if (ids.every(id => models.some(model => model.id === id))) break;
      await pause(500);
    }
    assert.deepEqual(models.map(model => model.id).sort(), [...ids].sort(), 'Wingman model registration');
    console.log(`Registered all three protocols in VS Code ${vscode.version}`);
    for (const id of ids) {
      const model = models.find(model => model.id === id);
      const user = vscode.LanguageModelChatMessage.User('Call echo with value ping, then report the result.');
      const options = {
        tools: [{ name: 'echo', description: 'Echo a value', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }],
      };
      const first = await collect(model, [user], options);
      const call = first.find(part => part instanceof vscode.LanguageModelToolCallPart);
      assert.ok(call, `${id}: streamed tool call`);
      assert.equal(call.name, 'echo');
      assert.deepEqual(call.input, { value: 'ping' });
      const second = await collect(model, [
        user,
        vscode.LanguageModelChatMessage.Assistant(first),
        vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart('tool-result-ping')])]),
      ], options);
      assert.equal(second.filter(part => part instanceof vscode.LanguageModelTextPart).map(part => part.value).join(''), 'pong');
      const sent = requests.filter(request => request.body.model === id);
      assert.equal(sent.length, 2, `${id}: two HTTP requests`);
      for (const request of sent) {
        assert.equal(request.headers.authorization, `Bearer ${key}`);
        assert.equal(request.body.stream, true);
        assert.ok(request.body.tools?.length);
      }
      const expectedPath = id.startsWith('gpt-') ? '/v1/responses' : id.startsWith('claude-') ? '/v1/messages' : '/v1/chat/completions';
      assert.ok(sent.every(request => request.path === expectedPath));
      if (id.startsWith('gpt-')) {
        assert.equal(sent[1].body.store, false);
        assert.equal(sent[1].body.previous_response_id, undefined);
        assert.ok(sent[1].body.input.some(item => item.type === 'function_call_output'));
      } else if (id.startsWith('claude-')) {
        assert.equal(sent[0].headers['anthropic-version'], '2023-06-01');
        assert.equal(sent[0].headers['x-api-key'], undefined);
        // The LM API (and current agent-host bridge) omits the thinking field.
        // This preserves Claude 5.x's adaptive default; it does not disable it.
        // An explicit request also enables visible thinking summaries.
        assert.equal(sent[0].body.thinking, undefined);
        assert.ok(sent[1].body.messages.some(message => message.content.some?.(part => part.type === 'tool_result')));
        await collect(model, [user], { ...options, modelOptions: { _enableThinking: true } });
        assert.equal(requests.at(-1).body.thinking?.type, 'adaptive');
      } else {
        assert.ok(sent[1].body.messages.some(message => message.role === 'tool'));
      }
      console.log(`PASS ${id}: ${expectedPath}, Bearer auth, streaming tool call and continuation`);
    }
    if (process.env.WINGMAN_LIVE_URL) {
      await config.update('baseUrl', process.env.WINGMAN_LIVE_URL, vscode.ConfigurationTarget.Global);
      await config.update('apiKey', process.env.WINGMAN_LIVE_API_KEY || '-', vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('wingman.syncModels');
      const liveIds = ['gpt-6-luna', 'claude-haiku-5-5', 'gemini-4-argon'];
      for (let attempt = 0; attempt < 40; attempt++) {
        models = await vscode.lm.selectChatModels({ vendor: 'customendpoint' });
        if (liveIds.every(id => models.some(model => model.id === id))) break;
        await pause(250);
      }
      for (const id of liveIds) {
        const model = models.find(model => model.id === id);
        assert.ok(model, `Gateway exposes ${id}`);
        const parts = await collect(model, [vscode.LanguageModelChatMessage.User('Reply with exactly OK. Do not use tools.')], { modelOptions: { max_tokens: 2048 } });
        const text = parts.filter(part => part instanceof vscode.LanguageModelTextPart).map(part => part.value).join('');
        assert.ok(text.includes('OK'), `${id}: expected OK from live gateway, received ${JSON.stringify(text)}`);
        console.log(`LIVE PASS ${id}: streamed response through Copilot and Wingman gateway`);
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
};

async function collect(model, messages, options) {
  const cancellation = new vscode.CancellationTokenSource();
  const timer = setTimeout(() => cancellation.cancel(), 20_000);
  try {
    const response = await model.sendRequest(messages, options, cancellation.token);
    const parts = [];
    for await (const part of response.stream) parts.push(part);
    return parts;
  } finally {
    clearTimeout(timer);
    cancellation.dispose();
  }
}

function respond(res, endpoint, model, continuation) {
  const send = (type, value) => res.write(`${type ? `event: ${type}\n` : ''}data: ${JSON.stringify(value)}\n\n`);
  if (endpoint === '/v1/responses') {
    let sequence = 0;
    const event = (type, value) => send(type, { type, sequence_number: sequence++, ...value });
    const item = continuation
      ? { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'pong', annotations: [] }] }
      : { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'echo', arguments: '{"value":"ping"}', status: 'completed' };
    const response = { id: 'resp_test', object: 'response', model, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', ...(continuation ? { content: [] } : { arguments: '' }) } });
    if (continuation) {
      event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'pong' });
      event('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: 'pong' });
      event('response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] });
    } else {
      event('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
      event('response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments });
    }
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response });
  } else if (endpoint === '/v1/messages') {
    const event = (type, value) => send(type, { type, ...value });
    event('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    event('content_block_start', { index: 0, content_block: continuation ? { type: 'text', text: '' } : { type: 'tool_use', id: 'call_test', name: 'echo', input: {} } });
    event('content_block_delta', { index: 0, delta: continuation ? { type: 'text_delta', text: 'pong' } : { type: 'input_json_delta', partial_json: '{"value":"ping"}' } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: continuation ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } });
    event('message_stop', {});
  } else {
    const chunk = (delta, finish_reason) => send('', { id: 'chatcmpl_test', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason }] });
    chunk({ role: 'assistant', ...(continuation ? { content: 'pong' } : { tool_calls: [{ index: 0, id: 'call_test', type: 'function', function: { name: 'echo', arguments: '{"value":"ping"}' } }] }) }, null);
    chunk({}, continuation ? 'stop' : 'tool_calls');
    res.write('data: [DONE]\n\n');
  }
}
