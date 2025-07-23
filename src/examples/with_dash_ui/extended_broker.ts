import { EventEmitter } from "node:events";
import { JQPBroker } from "../../broker.js";
import { BrokerConfig, PersistenceBase, WorkerInfo, Job } from "../../types.js";

// Statistics interface for the dashboard
export interface BrokerStats {
  workers: {
    total: number;
    ready: number;
    busy: number;
    byType: Record<string, number>;
  };
  jobs: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  };
  uptime: number;
  timestamp: number;
}

// Event types for the extended broker
export interface ExtendedBrokerEvents {
  'stats_updated': [BrokerStats];
  'worker_connected': [WorkerInfo];
  'worker_disconnected': [string];
  'job_enqueued': [Job];
  'job_dispatched': [string, string]; // job_uuid, worker_id
  'job_completed': [string, string, string]; // job_uuid, worker_id, status
}

/**
 * Extended broker that emits events for dashboard monitoring
 */
export class ExtendedBroker extends JQPBroker {
  private events: EventEmitter = new EventEmitter();
  private startTime: number = Date.now();
  private statsTimer?: NodeJS.Timeout;
  private persistence: PersistenceBase;

  constructor(config: BrokerConfig, persistence: PersistenceBase) {
    super(config, persistence);
    this.persistence = persistence;
  }

  // Event emitter interface
  on<K extends keyof ExtendedBrokerEvents>(
    event: K,
    listener: (...args: ExtendedBrokerEvents[K]) => void
  ): this {
    this.events.on(event, listener);
    return this;
  }

  off<K extends keyof ExtendedBrokerEvents>(
    event: K,
    listener: (...args: ExtendedBrokerEvents[K]) => void
  ): this {
    this.events.off(event, listener);
    return this;
  }

  private emit<K extends keyof ExtendedBrokerEvents>(
    event: K,
    ...args: ExtendedBrokerEvents[K]
  ): boolean {
    return this.events.emit(event, ...args);
  }



  async stop(): Promise<void> {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
    }
    await super.stop();
  }

  /**
   * Get current broker statistics
   */
  async getStats(): Promise<BrokerStats> {
    const state = this.getState();
    
    // Count workers by status
    let readyWorkers = 0;
    let busyWorkers = 0;
    const workersByType: Record<string, number> = {};

    for (const worker of state.workers.values()) {
      if (worker.is_ready) {
        readyWorkers++;
      } else {
        busyWorkers++;
      }
      
      workersByType[worker.job_type] = (workersByType[worker.job_type] || 0) + 1;
    }

    // Get job counts from persistence
    const allJobs = await (this.persistence as any).getAllJobs?.() || [];
    const jobStats = {
      queued: allJobs.filter((job: Job) => job.status === 'queued').length,
      processing: allJobs.filter((job: Job) => job.status === 'processing').length,
      completed: allJobs.filter((job: Job) => job.status === 'completed').length,
      failed: allJobs.filter((job: Job) => job.status === 'failed').length,
      total: allJobs.length,
    };

    return {
      workers: {
        total: state.workers.size,
        ready: readyWorkers,
        busy: busyWorkers,
        byType: workersByType,
      },
      jobs: jobStats,
      uptime: Date.now() - this.startTime,
      timestamp: Date.now(),
    };
  }

  /**
   * Monitor broker state changes by wrapping method calls
   */

  async start(): Promise<void> {
    await super.start();
    
    // Start periodic stats updates
    this.statsTimer = setInterval(async () => {
      const stats = await this.getStats();
      this.emit('stats_updated', stats);
    }, 1000);

    // Hook into broker events by monitoring state changes
    this.setupStateMonitoring();
  }

  private setupStateMonitoring(): void {
    // Monitor worker connections by checking state periodically
    let lastWorkerCount = 0;
    let lastWorkers = new Set<string>();

    const monitorWorkers = () => {
      const state = this.getState();
      const currentWorkers = new Set(state.workers.keys());
      
      // Check for new workers
      for (const workerId of currentWorkers) {
        if (!lastWorkers.has(workerId)) {
          const worker = state.workers.get(workerId);
          if (worker) {
            this.emit('worker_connected', worker);
          }
        }
      }
      
      // Check for disconnected workers
      for (const workerId of lastWorkers) {
        if (!currentWorkers.has(workerId)) {
          this.emit('worker_disconnected', workerId);
        }
      }
      
      lastWorkers = currentWorkers;
      lastWorkerCount = currentWorkers.size;
    };

    // Monitor job state changes
    let lastJobCount = 0;
    
    const monitorJobs = async () => {
      try {
        const allJobs = await (this.persistence as any).getAllJobs?.() || [];
        const currentJobCount = allJobs.length;
        
        if (currentJobCount > lastJobCount) {
          // New jobs were added
          const newJobs = allJobs.slice(lastJobCount);
          for (const job of newJobs) {
            if (job.status === 'queued') {
              this.emit('job_enqueued', job);
            } else if (job.status === 'processing') {
              // Find the worker processing this job
              const state = this.getState();
              const processingInfo = state.processingJobs.get(job.uuid);
              if (processingInfo) {
                this.emit('job_dispatched', job.uuid, processingInfo.worker_id);
              }
            } else if (job.status === 'completed' || job.status === 'failed') {
              this.emit('job_completed', job.uuid, 'unknown', job.status === 'completed' ? '200' : '500');
            }
          }
        }
        
        lastJobCount = currentJobCount;
      } catch (error) {
        console.error('Error monitoring jobs:', error);
      }
    };

    // Set up monitoring intervals
    setInterval(monitorWorkers, 1000);
    setInterval(monitorJobs, 1000);
  }
}
