/** @type {typeof browser} */
const api = globalThis.browser ?? globalThis.chrome;

export default api;
