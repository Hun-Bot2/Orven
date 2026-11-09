import { routeRequest } from "./http/router";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return routeRequest(request, env);
  }
};