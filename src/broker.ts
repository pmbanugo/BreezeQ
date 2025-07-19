import { Router } from "zeromq";
import {
  JQP_WORKER_PROTOCOL,
  JQP_WORKER_COMMANDS,
  WorkerInfo,
  BrokerState,
  BrokerConfig,
  PersistenceBase,
  BatchUpdateOperation,
  Job,
  JobOptions,
} from "./types.js";

export class JQPBroker {
  private backendSocket: Router;
  private state: BrokerState;
  private config: BrokerConfig;
  private persistence: PersistenceBase;
  private running: boolean = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private jobTimeoutTimer?: NodeJS.Timeout;

  constructor(config: BrokerConfig, persistence: PersistenceBase) {
    this.config = config;
    this.persistence = persistence;
    this.backendSocket = new Router();
    this.state = {
      workers: new Map(),
      processingJobs: new Map(),
      ready_workers: new Map(),
    };
  }

  async start(): Promise<void> {
    console.log(`Starting JQP broker on port ${this.config.backend_port}`);

    // Check if socket is already closed - this indicates improper usage
    if (this.backendSocket.closed) {
      // TODO: instead of the user instantiating a new instance, maybe have a restart method that will setup a new Dealer/Router instance that we can bind to and reuse the current object's data/state?
      // But for now, we will just throw an error because it is a misuse of the API. Stopping the broker means something terribly wrong happened, and the user should be aware of it.
      throw new Error(
        "Cannot start broker: socket is closed. Create a new broker instance instead of reusing a stopped one."
      );
    }

    // Perform recovery routine
    await this.recoverFromRestart();

    // Bind backend socket for workers
    await this.backendSocket.bind(`tcp://*:${this.config.backend_port}`); // TODO: don't limit to TCP, allow other sockets transports like IPC, etc.

    this.running = true;

    // Start heartbeat and timeout checks
    this.startHeartbeatTimer();
    this.startJobTimeoutTimer();

    // Main message loop
    this.messageLoop();
  }

  async stop(): Promise<void> {
    console.log("Stopping JQP broker");
    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    if (this.jobTimeoutTimer) {
      clearInterval(this.jobTimeoutTimer);
    }

    // Send disconnect to all workers
    for (const [workerId] of this.state.workers) {
      await this.sendDisconnect(workerId);
    }

    if (!this.backendSocket.closed) {
      this.backendSocket.close();
    }
  }

  private async messageLoop(): Promise<void> {
    try {
      for await (const [sender, blank, protocol, command, ...rest] of this
        .backendSocket) {
        if (!this.running) break;

        // Validate message structure
        if (!sender || !protocol || !command) {
          console.error("Invalid message structure");
          continue;
        }

        const workerId = sender.toString("hex");
        const protocolStr = protocol.toString();

        // Validate protocol
        if (protocolStr !== JQP_WORKER_PROTOCOL) {
          console.error(
            `Invalid or unsupported protocol from worker ${workerId}: ${protocolStr}`
          );
          await this.sendDisconnect(workerId);
          continue;
        }

        // Update worker's last heartbeat
        this.updateWorkerHeartbeat(workerId);

        // Handle command
        await this.handleWorkerCommand(
          workerId,
          command as Buffer,
          rest as Buffer[]
        );
      }
    } catch (error) {
      console.error("Error in message loop:", error);
      if (this.running) {
        // Restart message loop
        setTimeout(() => this.messageLoop(), 1000);
      }
    }
  }

  private async handleWorkerCommand(
    workerId: string,
    command: Buffer,
    args: Buffer[]
  ): Promise<void> {
    const commandCode = command[0];

    switch (commandCode) {
      case JQP_WORKER_COMMANDS.READY[0]:
        await this.handleReady(workerId, args);
        break;

      case JQP_WORKER_COMMANDS.HEARTBEAT[0]:
        // Heartbeat already handled by updateWorkerHeartbeat
        break;

      case JQP_WORKER_COMMANDS.JOB_REQUEST[0]:
        console.error(
          `Invalid JOB_REQUEST from worker ${workerId}: Workers should not send JOB_REQUEST`
        );
        await this.sendDisconnect(workerId);
        break;

      case JQP_WORKER_COMMANDS.JOB_REPLY[0]:
        await this.handleJobReply(workerId, args);
        break;

      case JQP_WORKER_COMMANDS.DISCONNECT[0]:
        await this.handleDisconnect(workerId);
        break;

      default:
        console.error(
          `Invalid command from worker ${workerId}: ${commandCode}`
        );
        await this.sendDisconnect(workerId);
    }
  }

  private async handleReady(workerId: string, args: Buffer[]): Promise<void> {
    if (!args[0]) {
      console.error(`Invalid READY from worker ${workerId}: missing job_type`);
      await this.sendDisconnect(workerId);
      return;
    }

    const jobType = args[0].toString();

    // Check if worker is already registered
    if (this.state.workers.has(workerId)) {
      console.info(`Worker ${workerId} already registered`);
      await this.sendDisconnect(workerId);
      return;
    }

    // Register worker
    const worker: WorkerInfo = {
      id: workerId,
      job_type: jobType,
      last_heartbeat: new Date(),
      is_ready: true,
    };

    this.state.workers.set(workerId, worker);

    // Add to ready workers for this job type
    const jobWorkers = this.state.ready_workers.get(jobType);
    jobWorkers
      ? jobWorkers.push(workerId)
      : this.state.ready_workers.set(jobType, [workerId]);

    console.log(`Worker ${workerId} registered for job type: ${jobType}`);

    // Try to dispatch pending jobs for this job type
    await this.dispatchJobsForType(jobType);
  }

  private async handleDisconnect(workerId: string): Promise<void> {
    await this.removeWorker(workerId);
    console.log(`Worker ${workerId} disconnected`);
  }

  private async handleJobReply(
    workerId: string,
    args: Buffer[]
  ): Promise<void> {
    if (args.length < 3 || !args[0] || !args[1] || !args[2]) {
      console.error(
        `Invalid JOB_REPLY from worker ${workerId}: insufficient arguments`
      );
      await this.sendDisconnect(workerId);
      return;
    }

    const job_uuid = args[0].toString();
    const statusCode = args[1].toString();
    const resultPayload = args[2].toString();

    // Remove from processing jobs
    this.state.processingJobs.delete(job_uuid);

    // Update job in persistence
    const status = statusCode === "200" ? "completed" : "failed";
    await this.persistence.update(job_uuid, {
      status,
      result: resultPayload,
      updated_at: new Date(),
    });

    console.log(
      `Job ${job_uuid} completed by worker ${workerId} with status ${statusCode}`
    );

    // Mark worker as ready again
    const worker = this.state.workers.get(workerId);
    if (worker) {
      worker.is_ready = true;

      // Add worker back to ready workers for its job type
      const readyWorkers = this.state.ready_workers.get(worker.job_type);
      if (!readyWorkers?.includes(workerId)) {
        readyWorkers!.push(workerId);
      }

      // Try to dispatch more jobs for this job type
      await this.dispatchJobsForType(worker.job_type);
    }
  }

  private updateWorkerHeartbeat(workerId: string): void {
    const worker = this.state.workers.get(workerId);
    if (worker) {
      worker.last_heartbeat = new Date();
    }
  }

  private async sendDisconnect(workerId: string): Promise<void> {
    try {
      await this.backendSocket.send([
        Buffer.from(workerId, "hex"),
        Buffer.alloc(0),
        JQP_WORKER_PROTOCOL,
        JQP_WORKER_COMMANDS.DISCONNECT,
      ]);
    } catch (error) {
      console.error(`Failed to send disconnect to worker ${workerId}:`, error);
    }

    await this.removeWorker(workerId);
  }

  private async removeWorker(workerId: string): Promise<void> {
    const worker = this.state.workers.get(workerId);
    if (!worker) return;

    // Remove from workers map
    this.state.workers.delete(workerId);

    // Remove from ready workers
    const readyWorkers = this.state.ready_workers.get(worker.job_type);
    if (readyWorkers) {
      const index = readyWorkers.indexOf(workerId);
      if (index > -1) {
        readyWorkers.splice(index, 1);
      }
    }

    // Handle any jobs this worker was processing
    const processingJobs = Array.from(
      this.state.processingJobs.entries()
    ).filter(([_, info]) => info.worker_id === workerId);

    if (processingJobs.length > 0) {
      // Prepare batch data operations for all jobs this worker was processing
      const batchOperations: BatchUpdateOperation[] = [];

      for (const [job_id, _] of processingJobs) {
        this.state.processingJobs.delete(job_id);

        const job = await this.persistence.get(job_id);
        if (job?.retries_left && job.retries_left > 0) {
          batchOperations.push({
            uuid: job_id,
            data: {
              status: "queued",
              retries_left: job.retries_left - 1,
              updated_at: new Date(),
            },
          });
        } else if (job) {
          batchOperations.push({
            uuid: job_id,
            data: {
              status: "failed",
              result: "Worker failed and no retries left",
              updated_at: new Date(),
            },
          });
        }
      }

      if (batchOperations.length > 0) {
        const result = await this.persistence.updateMany(batchOperations);

        if (result.failed > 0) {
          console.error(
            `Batch update failed for ${result.failed} jobs:`,
            result.errors
          );
        }
      }
    }
  }

  private startHeartbeatTimer(): void {
    this.heartbeatTimer = setInterval(async () => {
      await this.checkWorkerLiveness();
      await this.sendHeartbeatsToWorkers();
    }, this.config.heartbeat_interval);
  }

  private async sendHeartbeatsToWorkers(): Promise<void> {
    for (const [workerId] of this.state.workers) {
      try {
        await this.backendSocket.send([
          Buffer.from(workerId, "hex"),
          Buffer.alloc(0),
          JQP_WORKER_PROTOCOL,
          JQP_WORKER_COMMANDS.HEARTBEAT,
        ]);
      } catch (error) {
        console.error(`Failed to send heartbeat to worker ${workerId}:`, error);
        // Don't remove worker here - let the liveness check handle it
      }
    }
  }

  private startJobTimeoutTimer(): void {
    this.jobTimeoutTimer = setInterval(async () => {
      await this.checkJobTimeouts();
    }, this.config.heartbeat_interval);
  }

  private async checkWorkerLiveness(): Promise<void> {
    const now = new Date();
    const maxHeartbeatAge =
      this.config.heartbeat_interval * this.config.liveness_factor;

    for (const [workerId, worker] of this.state.workers) {
      const timeSinceHeartbeat =
        now.getTime() - worker.last_heartbeat.getTime();

      if (timeSinceHeartbeat > maxHeartbeatAge) {
        console.log(`Worker ${workerId} missed heartbeat, removing`);
        await this.removeWorker(workerId);
      }
    }
  }

  private async checkJobTimeouts(): Promise<void> {
    const now = new Date();

    for (const [job_uuid, info] of this.state.processingJobs) {
      const processingTime = now.getTime() - info.dispatch_timestamp.getTime();

      if (processingTime > this.config.default_job_timeout) {
        console.log(
          `Job ${job_uuid} timed out, removing worker ${info.worker_id}`
        );

        // TODO: Should it instead just handle the job (re-queue or send to poison pill queue), and not remove the worker? The heartbeat timers should handle the worker removal if it is considered dead.
        // We will consider that for the next iteration of the protocol specification. It could be part of the spec or just implementation detail outside the spec.
        // For now:
        // Remove worker and handle job
        await this.removeWorker(info.worker_id);
      }
    }
  }

  private async recoverFromRestart(): Promise<void> {
    console.log("Performing broker restart recovery");

    // Get all jobs that were processing when broker stopped
    const processingJobs = await this.persistence.getProcessingJobs();

    if (processingJobs.length > 0) {
      // Prepare batch operations to re-queue all processing jobs
      const batchOperations: BatchUpdateOperation[] = processingJobs.map(
        (job) => ({
          uuid: job.uuid,
          data: {
            status: "queued",
            updated_at: new Date(),
          },
        })
      );

      const result = await this.persistence.updateMany(batchOperations);

      console.log(`Re-queued ${result.successful} jobs from restart recovery`);

      if (result.failed > 0) {
        console.error(
          `Failed to re-queue ${result.failed} jobs during recovery:`,
          result.errors
        );
      }
    }
  }

  /**
   * Dispatch pending jobs for a specific job type
   */
  private async dispatchJobsForType(jobType: string): Promise<void> {
    const readyWorkers = this.state.ready_workers.get(jobType);
    if (!readyWorkers || readyWorkers.length === 0) {
      return;
    }

    // Get queued jobs for this job type
    const queuedJobs = await this.persistence.getQueuedJobs(jobType);
    if (queuedJobs.length === 0) {
      return;
    }

    // Dispatch jobs to available workers
    const maxJobs = Math.min(readyWorkers.length, queuedJobs.length);

    for (let i = 0; i < maxJobs; i++) {
      const workerId = readyWorkers[i];
      const worker = this.state.workers.get(workerId);

      if (worker && worker.is_ready) {
        await this.dispatchJobToWorker(workerId, queuedJobs[i]);
      }
    }
  }

  /**
   * Dispatch a specific job to a specific worker
   */
  private async dispatchJobToWorker(workerId: string, job: Job): Promise<void> {
    const worker = this.state.workers.get(workerId);
    if (!worker || !worker.is_ready) {
      return;
    }

    try {
      // Update job status to processing
      const updatePromise = this.persistence.update(job.uuid, {
        status: "processing",
        updated_at: new Date(),
      });

      // Add to processing jobs tracking
      this.state.processingJobs.set(job.uuid, {
        worker_id: workerId,
        dispatch_timestamp: new Date(),
      });

      // Mark worker as busy
      worker.is_ready = false;

      // Remove worker from ready workers list
      const readyWorkers = this.state.ready_workers.get(worker.job_type);
      if (readyWorkers) {
        const index = readyWorkers.indexOf(workerId);
        if (index > -1) {
          readyWorkers.splice(index, 1);
        }
      }

      // Send JOB_REQUEST to worker
      const optionsJson = JSON.stringify({
        retries: job.retries_left || 0,
        priority: job.options.priority || 0,
        timeout: job.options.timeout || this.config.default_job_timeout,
      });

      await updatePromise;
      await this.backendSocket.send([
        Buffer.from(workerId, "hex"),
        Buffer.alloc(0),
        JQP_WORKER_PROTOCOL,
        JQP_WORKER_COMMANDS.JOB_REQUEST,
        job.uuid,
        optionsJson,
        job.payload,
      ]);

      console.log(`Dispatched job ${job.uuid} to worker ${workerId}`);
    } catch (error) {
      console.error(
        `Failed to dispatch job ${job.uuid} to worker ${workerId}:`,
        error
      );

      // Rollback: Mark job as queued again and worker as ready
      try {
        await this.persistence.update(job.uuid, {
          status: "queued",
          updated_at: new Date(),
        });
      } catch (rollbackError) {
        console.error(`Failed to rollback job ${job.uuid}:`, rollbackError);
      }

      this.state.processingJobs.delete(job.uuid);
      worker.is_ready = true;

      // Add worker back to ready workers
      const readyWorkers = this.state.ready_workers.get(worker.job_type);
      if (readyWorkers && !readyWorkers.includes(workerId)) {
        readyWorkers.push(workerId);
      }
    }
  }

  /**
   * Add a job to the broker for processing
   */
  async addJob(
    jobType: string,
    payload: string,
    options: JobOptions = {}
  ): Promise<string> {
    const job_uuid = await this.persistence.add({
      job_type: jobType,
      payload,
      options: {
        retries: options.retries || this.config.default_retry_count,
        priority: options.priority || 0,
        timeout: options.timeout || this.config.default_job_timeout,
      },
      status: "queued",
    });

    console.log(`Added job ${job_uuid} of type ${jobType}`);

    // Try to dispatch the job immediately
    await this.dispatchJobsForType(jobType);

    return job_uuid;
  }

  /**
   * Public method to get broker state for testing/monitoring
   * @returns A copy of the current broker state
   */
  getState(): BrokerState {
    return {
      workers: new Map(this.state.workers),
      processingJobs: new Map(this.state.processingJobs),
      ready_workers: new Map(this.state.ready_workers),
    };
  }
}
