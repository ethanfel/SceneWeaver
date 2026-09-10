export const api = new EventTarget();
api.fetchApi = (path, options) => fetch(path, options);
const socket = new WebSocket(`${location.origin.replace('http:', 'ws:')}/ws?clientId=native-comfy-client`);
socket.onmessage = event => { const data = JSON.parse(event.data); api.dispatchEvent(new CustomEvent(data.type, { detail: data.data })); };

api.queuePrompt = async (number, { output, workflow }, { partialExecutionTargets } = {}) => {
  const response = await api.fetchApi('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: output, client_id: 'native-comfy-client', partial_execution_targets: partialExecutionTargets, extra_data: { extra_pnginfo: { workflow } } }) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Prompt rejected'), { status: response.status });
  return result;
};
