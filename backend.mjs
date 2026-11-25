import worker, { CiacpartyGame } from "./worker.mjs";
export { CiacpartyGame };
export default { async fetch(request, env) {
  if (!new URL(request.url).pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
  return worker.fetch(request, env);
}};
