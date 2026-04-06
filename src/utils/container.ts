import { MetaClient, ClientResponse } from "../services/meta-client.js";

type ApiCallFn = (method: string, path: string, params?: Record<string, unknown>) => Promise<ClientResponse>;

export interface PollContainerOptions {
  apiCall: ApiCallFn;
  statusField: "status" | "status_code";
  label: string;
  maxWait?: number;
  interval?: number;
}

/** Poll container status until FINISHED or terminal status */
export async function pollContainerStatus(containerId: string, options: PollContainerOptions): Promise<void> {
  const { apiCall, statusField, label, maxWait = 30, interval = 2000 } = options;
  const maxAttempts = Math.ceil((maxWait * 1000) / interval);
  let lastStatus: string | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await apiCall("GET", `/${containerId}`, { fields: statusField });
    const status = data[statusField] as string | undefined;
    lastStatus = status;
    if (status === "FINISHED") return;
    if (status === "ERROR") throw new Error(`${label} processing failed (ERROR status)`);
    if (status === "EXPIRED") throw new Error(`${label} expired — it was not published within 24 hours and must be recreated`);
    if (status === "PUBLISHED") throw new Error(`${label} already published`);
    if (!status) throw new Error(`${label} status field missing from API response`);
    if (status !== "IN_PROGRESS") throw new Error(`Unexpected ${label.toLowerCase()} status: ${status}`);
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`${label} processing timed out after ${maxWait}s (last status: ${lastStatus ?? "unknown"})`);
}

/** Instagram container polling — uses client.ig() and status_code field */
export async function waitForIgContainer(client: MetaClient, containerId: string, maxWait = 30): Promise<void> {
  return pollContainerStatus(containerId, {
    apiCall: client.ig.bind(client),
    statusField: "status_code",
    label: "Container",
    maxWait,
  });
}

/** Threads container polling — uses client.threads() and status field */
export async function waitForThreadsContainer(client: MetaClient, containerId: string, maxWait = 30): Promise<void> {
  return pollContainerStatus(containerId, {
    apiCall: client.threads.bind(client),
    statusField: "status",
    label: "Threads container",
    maxWait,
  });
}
