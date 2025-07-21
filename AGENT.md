# AGENT.md - Majordomo ZeroMQ Broker

## Commands

- **Dev**: `pnpm run dev` - Run with tsx (main entry: src/index.ts)
- **Dev Watch**: `pnpm run dev:watch` - Run with tsx in watch mode
- **Install**: `pnpm add` - Install dependencies
- **Main Command**: `pnpm run dev` - Run the full broker example

## Architecture

- Uses Node.js version 24 and targets ES2024
- **ZeroMQ**: Uses `zeromq` library for ZeroMQ messaging. If you need more `zeromq` library type information, You can look at the github repository at [the url](https://github.com/zeromq/zeromq.js) or the documentation at the [website url](https://zeromq.github.io/zeromq.js/).
- **Protocol**: implementing a job queue system based on a custom zeromq protocol which evolved from Majordomo protocol (MDP). See my JQP protocol specification in the file specification-rfc/ZeroMQ-based-Job-Queue-System-Protocol.md.
- **Examples**: `src/examples/` contains various examples of how to use the program either as a client or a worker, or all together verifying the full system by simple integration samples.
- **Tests**: when needed, tests files should be placed beside the implementation files, following the same directory structure. use `node:test` and Node.js test runner.

## Code Style

- **TypeScript**: Strict mode, ES2024 target, NodeNext modules
- **Imports**: Use ES modules (`import`/`export`)
- **Avoid Enums**: Use `as const` for JS-style enums
- **Naming**: PascalCase for enums/types, camelCase for variables, and snake_case for file names
- **No JavaScript Classes**: Prefer functional programming style, avoid classes
- **Tests**: Use `node:test` for testing, no external test libraries. More info about node:test can be found in the [Node.js documentation](https://nodejs.org/api/test.html).
- Use `const` assertions and `readonly` modifiers where they can help V8 optimize
- Use type guards efficiently to avoid runtime type checking overhead
- Consider using `Buffer.allocUnsafe()` when safety can be guaranteed.
