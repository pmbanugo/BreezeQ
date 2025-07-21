import { Dealer } from "zeromq";
import hyperid from "hyperid";
import {
  JQP_CLIENT_PROTOCOL,
  JQP_CLIENT_COMMANDS,
  JobOptions,
  JobStatus,
} from "./types.js";

export interface ClientConfig {
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface EnqueueJobRequest {
  job_type: string;
  payload: string;
  options?: JobOptions;
}

export interface JobStatusResponse {
  status: JobStatus;
  result?: string;
}

const generateId = hyperid();

/**
 * JQP Client - implements the client side of the Job Queue Protocol
 *
 * Features:
 * - Asynchronous job submission
 * - Job status checking and result retrieval
 * - Automatic timeout and retry logic for reliability
 * - Idempotent job submission using client-generated UUIDs
 * - Thread-safe concurrent operations
 */
export class JQPClient {
  private socket: Dealer;
  private brokerAddress: string;
  private config: Required<ClientConfig>;
  private connected: boolean = false;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
      retryCount: number;
      originalMessage: Buffer[];
    }
  > = new Map();

  constructor(brokerAddress: string, config: ClientConfig = {}) {
    this.brokerAddress = brokerAddress;
    this.config = {
      timeout: config.timeout || 5000, // 5 seconds default timeout
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000, // 1 second default retry delay
    };
    this.socket = new Dealer();
  }

  /**
   * Connect to the broker
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.socket.connect(this.brokerAddress);
    this.connected = true;

    // Start message handling loop
    this.messageLoop();
  }

  /**
   * Disconnect from the broker
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.connected = false;

    // Cancel all pending requests
    for (const [requestId, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error("Client disconnected"));
    }
    this.pendingRequests.clear();

    // Use disconnect() to disconnect from the broker endpoint
    // instead of close() which would make the socket unusable
    try {
      await this.socket.disconnect(this.brokerAddress);
    } catch (error) {
      // Ignore disconnect errors as we're shutting down anyway
    }

    // Only close the socket if we're completely done with it
    if (!this.socket.closed) {
      this.socket.close();
    }
  }

  /**
   * Submit a job to the queue (fire-and-forget)
   * Returns with a job UUID for tracking
   *
   * @param request Job submission request
   * @returns Promise resolving to the job unique ID
   */
  async enqueueJob(request: EnqueueJobRequest): Promise<string> {
    const job_uuid = generateId();
    const optionsJson = JSON.stringify(request.options || {});

    const message = [
      Buffer.alloc(0), // Empty delimiter frame
      Buffer.from(JQP_CLIENT_PROTOCOL),
      JQP_CLIENT_COMMANDS.ENQUEUE,
      Buffer.from(job_uuid),
      Buffer.from(request.job_type),
      Buffer.from(request.payload),
      Buffer.from(optionsJson),
    ];

    return this.sendRequestWithRetry(job_uuid, message, (response) => {
      // Validate response structure
      if (response.length < 4) {
        throw new Error("Invalid ENQUEUE_REPLY: insufficient frames");
      }

      const protocol = response[0].toString();
      const command = response[1];
      const statusCode = parseInt(response[2].toString());
      const responseUuid = response[3].toString();

      if (protocol !== JQP_CLIENT_PROTOCOL) {
        throw new Error(`Invalid protocol: ${protocol}`);
      }

      if (!command.equals(JQP_CLIENT_COMMANDS.ENQUEUE_REPLY)) {
        throw new Error(`Invalid command: ${command[0]}`);
      }

      if (responseUuid !== job_uuid) {
        throw new Error(
          `UUID mismatch: expected ${job_uuid}, got ${responseUuid}`
        );
      }

      if (statusCode === 202) {
        return job_uuid; // Success - job accepted
      } else if (statusCode >= 400 && statusCode < 500) {
        throw new Error(`Client error: ${statusCode}`);
      } else if (statusCode >= 500) {
        throw new Error(`Server error: ${statusCode}`);
      } else {
        throw new Error(`Unknown status code: ${statusCode}`);
      }
    });
  }

  /**
   * Check the status of a submitted job
   *
   * @param job_uuid The UUID of the job to check
   * @returns Promise resolving to job status and result
   */
  async getJobStatus(job_uuid: string): Promise<JobStatusResponse> {
    const message = [
      Buffer.alloc(0), // Empty delimiter frame
      Buffer.from(JQP_CLIENT_PROTOCOL),
      JQP_CLIENT_COMMANDS.STATUS,
      Buffer.from(job_uuid),
    ];

    return this.sendRequestWithRetry(
      `status_${job_uuid}`, // Use job_uuid as correlation key for STATUS requests
      message,
      (response) => {
        // Validate response structure
        if (response.length < 3) {
          throw new Error("Invalid STATUS_REPLY: insufficient frames");
        }

        const protocol = response[0].toString();
        const command = response[1];
        const job_status = response[2].toString() as JobStatus;
        const job_result =
          response.length > 3 ? response[3].toString() : undefined;

        if (protocol !== JQP_CLIENT_PROTOCOL) {
          throw new Error(`Invalid protocol: ${protocol}`);
        }

        if (!command.equals(JQP_CLIENT_COMMANDS.STATUS_REPLY)) {
          throw new Error(`Invalid command: ${command[0]}`);
        }

        return {
          status: job_status,
          result: job_result,
        };
      }
    );
  }

  /**
   * Submit a job and wait for completion
   *
   * @param request Job submission request
   * @param pollInterval How often to check status (default: 1000ms)
   * @param maxWaitTime Maximum time to wait for completion (default: 30000ms)
   * @returns Promise resolving to job result
   */
  async submitJobAndWait(
    request: EnqueueJobRequest,
    pollInterval: number = 1000,
    maxWaitTime: number = 30000
  ): Promise<string> {
    const job_uuid = await this.enqueueJob(request);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getJobStatus(job_uuid);

      switch (status.status) {
        case "completed":
          return status.result || "";
        case "failed":
          throw new Error(`Job failed: ${status.result || "Unknown error"}`);
        case "queued":
        case "processing":
          // Continue polling
          await new Promise((resolve) => setTimeout(resolve, pollInterval)); // could use Promise.try syntax here
          break;
        default:
          throw new Error(`Unknown job status: ${status.status}`);
      }
    }

    throw new Error(`Job timed out after ${maxWaitTime}ms`);
  }

  /**
   * Send a request with automatic retry logic
   */
  private async sendRequestWithRetry<T>(
    requestId: string,
    message: Buffer[],
    responseHandler: (response: Buffer[]) => T
  ): Promise<T> {
    // TODO: where possible, make this function's logic simpler.

    // could use Promise.withResolvers syntax, instead of new Promise()?
    return new Promise((resolve, reject) => {
      const executeRequest = (retryCount: number = 0) => {
        // Create timeout for this request
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(requestId);

          if (retryCount < this.config.maxRetries) {
            console.warn(
              `Request ${requestId} timed out, retrying (${retryCount + 1}/${
                this.config.maxRetries
              })`
            );

            // Reconnect and retry
            setTimeout(async () => {
              try {
                await this.reconnect();
                executeRequest(retryCount + 1);
              } catch (error) {
                reject(
                  new Error(
                    `Failed to reconnect for retry: ${
                      error instanceof Error ? error.message : "Unknown error"
                    }`
                  )
                );
              }
            }, this.config.retryDelay);
          } else {
            reject(
              new Error(
                `Request ${requestId} timed out after ${this.config.maxRetries} retries`
              )
            );
          }
        }, this.config.timeout);

        // Store pending request
        this.pendingRequests.set(requestId, {
          resolve: (response: Buffer[]) => {
            try {
              const result = responseHandler(response);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          },
          reject,
          timeout,
          retryCount,
          originalMessage: message,
        });

        // Send the request
        this.socket.send(message).catch((error) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);

          if (retryCount < this.config.maxRetries) {
            setTimeout(async () => {
              try {
                await this.reconnect();
                executeRequest(retryCount + 1);
              } catch (reconnectError) {
                reject(
                  new Error(
                    `Failed to reconnect for retry: ${
                      reconnectError instanceof Error
                        ? reconnectError.message
                        : "Unknown error"
                    }`
                  )
                );
              }
            }, this.config.retryDelay);
          } else {
            reject(
              new Error(
                `Failed to send request: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`
              )
            );
          }
        });
      };

      executeRequest();
    });
  }

  /**
   * Reconnect to the broker (close and create new socket)
   */
  private async reconnect(): Promise<void> {
    if (this.connected && !this.socket.closed) {
      try {
        await this.socket.disconnect(this.brokerAddress);
      } catch (error) {
        // Ignore disconnect errors during reconnection
      }
      // Always close the old socket completely to avoid "busy reading" errors
      // this.socket.close();
    }

    this.connected = false;

    // Always create a new socket for clean reconnection
    // this.socket = new Dealer(); // hint: not needed since we didn't call socket.close(). I'm leaving the code commented out for now, just in case the "busy reading" error happen in the future because I made a wrong assertion. Just don't let it linger for too long and cause confusion.

    await this.connect();
  }

  /**
   * Message handling loop - processes responses from broker
   */
  private async messageLoop(): Promise<void> {
    try {
      for await (const response of this.socket) {
        if (!this.connected) break;

        // Extract the response without the empty delimiter frame
        const frames = response.slice(1); // Skip the empty delimiter frame

        // For ENQUEUE_REPLY, the request ID is the job UUID (frame 3)
        // For STATUS_REPLY, we need to match it differently
        if (frames.length >= 4) {
          const protocol = frames[0].toString();
          const command = frames[1];

          if (protocol === JQP_CLIENT_PROTOCOL) {
            if (command.equals(JQP_CLIENT_COMMANDS.ENQUEUE_REPLY)) {
              const job_uuid = frames[3].toString();
              const pendingRequest = this.pendingRequests.get(job_uuid);

              if (pendingRequest) {
                clearTimeout(pendingRequest.timeout);
                this.pendingRequests.delete(job_uuid);
                pendingRequest.resolve(frames);
              }
            } else if (command.equals(JQP_CLIENT_COMMANDS.STATUS_REPLY)) {
              // For status replies, extract job_uuid from message and match with status request
              if (frames.length >= 3) {
                const job_status = frames[2].toString();
                // Find pending STATUS request - they use "status_${job_uuid}" as request ID
                for (const [requestId, pendingRequest] of this
                  .pendingRequests) {
                  if (requestId.startsWith("status_")) {
                    clearTimeout(pendingRequest.timeout);
                    this.pendingRequests.delete(requestId);
                    pendingRequest.resolve(frames);
                    break;
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error in client message loop:", error);
      if (this.connected) {
        // Attempt to reconnect
        setTimeout(() => this.reconnect(), this.config.retryDelay);
      }
    }
  }

  /**
   * Get client state for monitoring/debugging
   */
  getState(): {
    connected: boolean;
    pendingRequests: number;
    brokerAddress: string;
    config: Required<ClientConfig>;
  } {
    return {
      connected: this.connected,
      pendingRequests: this.pendingRequests.size,
      brokerAddress: this.brokerAddress,
      config: { ...this.config },
    };
  }
}
