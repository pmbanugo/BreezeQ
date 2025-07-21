import { Dealer } from "zeromq";
import {
  JQP_WORKER_PROTOCOL,
  JQP_WORKER_COMMANDS,
  JobOptions,
} from "./types.js";

export class JQPWorker {
  private socket: Dealer;
  private brokerAddress: string;
  private jobType: string;
  private running: boolean = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private livenessTimer?: NodeJS.Timeout;
  private lastHeartbeat: Date = new Date();
  private heartbeatInterval: number = 2500; // 2.5 seconds
  private livenessFactor: number = 3; // 3 * heartbeat_interval before considering broker dead
  private reconnectDelay: number = 1000; // 1 second

  constructor(
    brokerAddress: string,
    jobType: string,
    options?: { heartbeatInterval?: number; livenessFactor?: number }
  ) {
    this.brokerAddress = brokerAddress;
    this.jobType = jobType;
    this.socket = new Dealer();

    if (options?.heartbeatInterval) {
      this.heartbeatInterval = options.heartbeatInterval;
    }
    if (options?.livenessFactor) {
      this.livenessFactor = options.livenessFactor;
    }

    // Don't auto-connect in constructor - let start() handle connection
  }

  async start(): Promise<void> {
    console.log(`Starting JQP worker for job type: ${this.jobType}`);
    this.running = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    console.log("Stopping JQP worker");
    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
    }

    // Send disconnect message before closing
    try {
      await this.sendDisconnect();
    } catch (error) {
      // Ignore errors when sending disconnect during shutdown
    }

    // Disconnect from broker endpoint
    try {
      await this.socket.disconnect(this.brokerAddress);
    } catch (error) {
      // Ignore disconnect errors during shutdown
    }

    // Close the socket completely when stopping
    if (!this.socket.closed) {
      this.socket.close();
    }
  }

  private async connect(): Promise<void> {
    try {
      console.log(`Connecting to broker at ${this.brokerAddress}`);
      await this.socket.connect(this.brokerAddress);

      // Send READY message
      await this.sendReady();

      // Start heartbeat and liveness timers
      this.startHeartbeatTimer();
      this.startLivenessTimer();

      // Start message loop
      this.messageLoop();
    } catch (error) {
      console.error("Failed to connect to broker:", error);
      if (this.running) {
        setTimeout(() => this.reconnect(), this.reconnectDelay);
      }
    }
  }

  private async reconnect(): Promise<void> {
    if (!this.running) return;

    console.log("Attempting to reconnect to broker");

    // Clean up existing connection
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
    }

    // Try to disconnect from broker endpoint first
    try {
      await this.socket.disconnect(this.brokerAddress);
    } catch (error) {
      // Ignore disconnect errors during reconnection
    }

    // Only create new socket if current one is closed
    if (this.socket.closed) {
      this.socket = new Dealer();
    }

    await this.connect();
  }

  private async messageLoop(): Promise<void> {
    try {
      for await (const [blank, protocol, command, ...rest] of this.socket) {
        if (!this.running) break;

        // Validate message structure
        if (!protocol || !command) {
          console.error("Invalid message structure from broker");
          continue;
        }

        const protocolStr = protocol.toString();

        // Validate protocol
        if (protocolStr !== JQP_WORKER_PROTOCOL) {
          console.error(`Invalid protocol from broker: ${protocolStr}`);
          continue;
        }

        // Update last heartbeat from broker
        this.lastHeartbeat = new Date();

        // Handle command
        await this.handleBrokerCommand(command, rest);
        // await this.handleBrokerCommand(command as Buffer, rest as Buffer[]);
      }
    } catch (error) {
      console.error("Error in message loop:", error);
      if (this.running) {
        // Attempt to reconnect
        setTimeout(() => this.reconnect(), this.reconnectDelay);
      }
    }
  }

  private async handleBrokerCommand(
    command: Buffer,
    args: Buffer[]
  ): Promise<void> {
    const commandCode = command[0];

    switch (commandCode) {
      case JQP_WORKER_COMMANDS.HEARTBEAT[0]:
        // Heartbeat already handled by updating lastHeartbeat
        break;

      case JQP_WORKER_COMMANDS.DISCONNECT[0]:
        await this.handleDisconnect();
        break;

      case JQP_WORKER_COMMANDS.JOB_REQUEST[0]:
        await this.handleJobRequest(args);
        break;

      default:
        console.error(`Invalid command from broker: ${commandCode}`);
        await this.sendDisconnect();
    }
  }

  private async handleDisconnect(): Promise<void> {
    console.log("Received disconnect from broker");
    if (this.running) {
      // Attempt to reconnect
      setTimeout(() => this.reconnect(), this.reconnectDelay);
    }
  }

  private async handleJobRequest(args: Buffer[]): Promise<void> {
    if (args.length < 3 || !args[0] || !args[1] || !args[2]) {
      console.error("Invalid JOB_REQUEST: insufficient arguments");

      await this.sendDisconnect();
      if (this.running) {
        setTimeout(() => this.reconnect(), this.reconnectDelay);
      }
      return;
    }

    const job_uuid = args[0].toString();
    const optionsStr = args[1].toString();
    const jobPayload = args[2].toString(); // TODO: Use a Binary Serialization format instead of JSON string

    let options: JobOptions;
    try {
      options = JSON.parse(optionsStr);
      // TODO: Validate options structure if needed.
    } catch (error) {
      console.error("Invalid job options JSON:", error);
      await this.sendJobReply(
        job_uuid,
        "500",
        "Invalid 'options' frame: Failed to parse JSON."
      );
      return;
    }

    console.log(`Now processing job ${job_uuid} with options: `, options);

    try {
      // Process the job
      const result = await this.processJob(jobPayload, options);
      await this.sendJobReply(job_uuid, "200", result);
    } catch (error) {
      console.error(`Job ${job_uuid} failed:`, error);
      await this.sendJobReply(
        job_uuid,
        "500",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  private async sendReady(): Promise<void> {
    await this.socket.send([
      Buffer.alloc(0),
      JQP_WORKER_PROTOCOL,
      JQP_WORKER_COMMANDS.READY,
      this.jobType,
    ]);
    console.log(`Sent READY for job type: ${this.jobType}`);
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      await this.socket.send([
        Buffer.alloc(0),
        JQP_WORKER_PROTOCOL,
        JQP_WORKER_COMMANDS.HEARTBEAT,
      ]);
    } catch (error) {
      console.error("Failed to send heartbeat:", error);
    }
  }

  private async sendDisconnect(): Promise<void> {
    try {
      await this.socket.send([
        Buffer.alloc(0),
        JQP_WORKER_PROTOCOL,
        JQP_WORKER_COMMANDS.DISCONNECT,
      ]);
    } catch (error) {
      console.error("Failed to send disconnect:", error);
    }
  }

  private async sendJobReply(
    job_uuid: string,
    statusCode: string,
    resultPayload: string
  ): Promise<void> {
    try {
      await this.socket.send([
        Buffer.alloc(0),
        JQP_WORKER_PROTOCOL,
        JQP_WORKER_COMMANDS.JOB_REPLY,
        job_uuid,
        statusCode,
        resultPayload,
      ]);
      console.log(`Sent job reply for ${job_uuid} with status ${statusCode}`);
    } catch (error) {
      console.error(`Failed to send job reply for ${job_uuid}:`, error);
    }
  }

  private startHeartbeatTimer(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);
  }

  private startLivenessTimer(): void {
    this.livenessTimer = setInterval(() => {
      this.checkBrokerLiveness();
    }, this.heartbeatInterval);
  }

  private checkBrokerLiveness(): void {
    const now = new Date();
    const maxHeartbeatAge = this.heartbeatInterval * this.livenessFactor;
    const timeSinceHeartbeat = now.getTime() - this.lastHeartbeat.getTime();

    if (timeSinceHeartbeat > maxHeartbeatAge) {
      console.log("Broker appears to be dead, attempting reconnection");
      if (this.running) {
        setTimeout(() => this.reconnect(), this.reconnectDelay);
      }
    }
  }

  /**
   * Override this method to implement actual job processing logic
   */
  protected async processJob(
    payload: string,
    options: JobOptions
  ): Promise<string> {
    // Default implementation - just echo the payload
    return `Processed: ${payload}`;
  }

  // Public method to get worker state for testing/monitoring
  getState(): {
    jobType: string;
    running: boolean;
    connected: boolean;
    lastHeartbeat: Date;
  } {
    return {
      jobType: this.jobType,
      running: this.running,
      connected: !this.socket.closed,
      lastHeartbeat: this.lastHeartbeat,
    };
  }
}
