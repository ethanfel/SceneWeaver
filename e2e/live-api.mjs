export const api = new EventTarget();
api.fetchApi = (path, options) => fetch(path, options);
const socket = new WebSocket(`${location.origin.replace('http:', 'ws:')}/ws?clientId=native-comfy-client`);
socket.onmessage = event => { const data = JSON.parse(event.data); api.dispatchEvent(new CustomEvent(data.type, { detail: data.data })); };
