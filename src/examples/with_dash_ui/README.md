# BreezeQ Dashboard Example

This example demonstrates an extended job queue system with a real-time web dashboard. The system includes:

- **Extended Broker** - Enhanced broker with event emission and statistics tracking
- **Web Dashboard** - Real-time HTML dashboard with WebSocket updates
- **Multi-Process Workers** - Multiple JQP workers running in the same process for efficiency
- **Demo Client** - Automated client that submits jobs for testing

## Features

### 🎛️ Real-time Dashboard

- Live statistics display (workers, jobs, completion rates)
- WebSocket-based real-time updates
- Worker status and job type distribution
- Recent activity log
- Built with vanilla HTML, HTMX, and Tailwind CSS

### 🔧 Multi-Process Workers

- Multiple JQP workers running in the same process (configurable count)
- Built-in job processors for math, data processing, and image operations
- Automatic connection retry and graceful shutdown
- Support for multiple job types simultaneously
- Simpler than worker threads with no inter-thread communication overhead

### 📊 Extended Broker

- Event-driven architecture with real-time monitoring
- Statistics collection and broadcasting
- Graceful shutdown handling
- Web server integration with uWebSockets.js

## Quick Start

### Start Everything at Once

```bash
cd src/examples/with_dash_ui
pnpm install
pnpm start
```

This will start:

- Broker with dashboard on port 3000
- Math workers (3 workers in same process)
- Data processing workers (3 workers in same process)
- Image resize workers (3 workers in same process)
- Demo client submitting jobs

Visit **http://localhost:3000** to see the dashboard.

### Start Components Individually

#### 1. Start the Broker with Dashboard

```bash
pnpm run broker
```

The broker will run on:

- Frontend (clients): `tcp://*:5555`
- Backend (workers): `tcp://*:5556`
- Dashboard: `http://localhost:3000`

#### 2. Start Workers

For math operations:

```bash
pnpm run workers:math
```

For data processing:

```bash
pnpm run workers:data
```

For image processing:

```bash
pnpm run workers:image
```

#### 3. Start Demo Client

```bash
pnpm run client
```

## Configuration

All components can be configured via environment variables:

### Broker Configuration

```bash
FRONTEND_PORT=5555          # Client connection port
BACKEND_PORT=5556           # Worker connection port
WEB_PORT=3000              # Dashboard web server port
WEB_HOST=localhost         # Dashboard host
```

### Worker Configuration

```bash
JOB_TYPE=math              # Job type to process
WORKER_COUNT=3             # Number of workers in the same process
BROKER_HOST=localhost      # Broker hostname
BACKEND_PORT=5556          # Broker backend port
```

### Client Configuration

```bash
BROKER_HOST=localhost               # Broker hostname
FRONTEND_PORT=5555                  # Broker frontend port
SUBMISSION_INTERVAL_MS=2000         # Job submission interval
MAX_JOBS=1000                      # Maximum jobs to submit
JOB_TYPES=math,data-processing     # Job types to submit
```

## Job Types

The example includes three built-in job processors:

### Math Operations

- **add**: Sum of numbers
- **multiply**: Product of numbers
- **fibonacci**: Fibonacci number calculation
- **factorial**: Factorial calculation

Example payload:

```json
{
  "operation": "add",
  "values": [10, 20, 30]
}
```

### Data Processing

- **sort**: Sort array of numbers
- **filter**: Filter numbers above threshold
- **transform**: Apply mathematical transformation
- **aggregate**: Calculate sum, average, min, max

Example payload:

```json
{
  "action": "aggregate",
  "data": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
}
```

### Image Processing (Simulated)

- **resize**: Simulates image resizing operations

Example payload:

```json
{
  "imageUrl": "https://picsum.photos/800/600",
  "targetWidth": 400,
  "targetHeight": 300,
  "format": "jpg"
}
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Demo Client   │    │  Extended       │    │  Multi-Process  │
│                 │    │  Broker         │    │  Workers        │
│  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌───────────┐  │
│  │ Auto Job  │──┼────┤  │ JQP Broker│  │    │  │ Math      │  │
│  │ Submitter │  │    │  │           │  │    │  │ Workers   │  │
│  └───────────┘  │    │  └───────────┘  │    │  └───────────┘  │
└─────────────────┘    │  ┌───────────┐  │    │  ┌───────────┐  │
                       │  │ Web Server│  │    │  │ Data      │  │
┌─────────────────┐    │  │ (uWS.js)  │  │    │  │ Workers   │  │
│   Dashboard     │    │  └───────────┘  │    │  └───────────┘  │
│   (Browser)     │────┘                 │    │  ┌───────────┐  │
│                 │    WebSocket          │    │  │ Image     │  │
│  Real-time UI   │    Updates           │    │  │ Workers   │  │
└─────────────────┘                      │    │  └───────────┘  │
                                         │    └─────────────────┘
                       ZeroMQ (TCP)      │
                       Frontend: 5555    │
                       Backend: 5556     │
```

## Dashboard Features

### Statistics Cards

- **Workers**: Total, ready, and busy worker counts
- **Jobs**: Queue status and processing statistics
- **Completed**: Success rate and failure tracking
- **System**: Uptime and connection status

### Real-time Updates

- Worker connections/disconnections
- Job submissions and completions
- Live activity feed
- Automatic reconnection on WebSocket failure

### Visual Indicators

- Color-coded status indicators
- Responsive design with Tailwind CSS
- Smooth animations and transitions
- Real-time charts and metrics

## Development

### Adding New Job Types

1. Add your job processor to `workers.ts`:

```typescript
const jobProcessors = {
  // ... existing processors
  async "my-job-type"(payload: string): Promise<string> {
    const data = JSON.parse(payload);
    // Process the job
    const result = await processMyJob(data);
    return JSON.stringify(result);
  },
};
```

2. Update the client to submit your job type:

```typescript
const JOB_TYPES = ["math", "data-processing", "image-resize", "my-job-type"];
```

### Customizing the Dashboard

The dashboard is a single HTML file with embedded JavaScript. You can:

- Modify the UI layout in `dashboard.html`
- Add new statistics or charts
- Customize the color scheme with Tailwind classes
- Add new WebSocket message handlers

### Extending the Broker

The `ExtendedBroker` class can be enhanced with:

- Additional event types
- Custom statistics collection
- Integration with external monitoring systems
- Persistent storage for statistics

## Troubleshooting

### Common Issues

1. **Port already in use**: Change the port numbers in environment variables
2. **Workers not connecting**: Check that broker is running first
3. **Dashboard not loading**: Verify web server port and firewall settings
4. **Jobs not processing**: Ensure workers are started for the correct job types

### Debugging

Enable debug logging:

```bash
DEBUG=* pnpm start
```

Check individual component logs by running them separately.

### Performance Tuning

- Adjust `WORKER_COUNT` based on CPU cores
- Modify `SUBMISSION_INTERVAL_MS` to control job load
- Tune broker heartbeat and timeout settings
- Monitor memory usage with multiple workers

## Testing the Implementation

### Core Components Testing

1. **Test Broker with Dashboard**:

```bash
cd src/examples/with_dash_ui
pnpm install
pnpm run broker
```

- Visit http://localhost:3000 to see the dashboard
- Press Ctrl+C to stop

2. **Test Client Submission**:

```bash
pnpm run client
```

- Submits demo jobs to the broker
- Press Ctrl+C to stop

### Current Status

✅ **Working Components**:

- Extended Broker with event emission
- Real-time Web Dashboard with WebSocket updates
- Demo Client with job submission
- Process orchestration scripts

✅ **Multi-Process Workers**:

- Multiple JQP workers run in the same process (alternatively you can use worker_threads, but using it with tsx package is a _nightmare_)
- Workers connect successfully and process jobs
- No module resolution issues with tsx

### Testing Individual Components

**Broker starts successfully**:

```bash
pnpm run broker
# ✅ Broker starts, dashboard available at http://localhost:3000
```

**Client works correctly**:

```bash
pnpm run client
# ✅ Submits jobs successfully (will show connection errors without broker)
```

**Workers work correctly**:

```bash
pnpm run workers:math
# ✅ Workers start and connect to broker successfully
```

### Architecture Notes

The system architecture is solid and all components work correctly. The implementation uses multiple JQPWorker instances running in the same process, which provides good performance and simplicity without the complexity of worker threads.

For production scaling, consider:

- Running multiple worker processes for better fault isolation
- Load balancing workers across multiple machines
- Using the existing patterns as a foundation for scaling

### Dashboard Features Confirmed Working

- ✅ Real-time WebSocket connections
- ✅ Statistics tracking and display
- ✅ Event-driven updates from broker
- ✅ Responsive UI with Tailwind CSS
- ✅ Activity logging and monitoring

## License

This example is part of the BreezeQ project and follows the same license terms.
