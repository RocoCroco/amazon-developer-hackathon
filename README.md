# Recall Guardian

An MCP server that turns Alexa+ into a recall guardian for everything in the home.
Built for the Amazon "Build, Ship, Shape" hackathon (Alexa+ track).

> Status: work in progress. See SPEC.md for the product spec and TASKS.md for the plan.

## Layout
- `packages/mcp-server` - MCP server (TypeScript SDK, Streamable HTTP)
- `packages/simulator` - Alexa+ simulator web app
- `infra` - AWS CDK stack (us-east-1, serverless only)

## Develop
    npm install
    npm run build
    npm test

## Run locally
    npm run build
    # terminal 1: MCP server (in-memory inventory, live CPSC lookups) on :8788
    node packages/mcp-server/dist/main.js
    # terminal 2: simulator UI on :8787 (SIM_LLM=mock uses the offline rule-based brain; omit it to use Bedrock)
    SIM_LLM=mock MCP_URL=http://127.0.0.1:8788/mcp node packages/simulator/dist/main.js

On PowerShell set the variables first: `$env:SIM_LLM='mock'`.

## Tests
    npm test            # unit, MCP over HTTP, infra assertions, real-browser UI (Playwright)
    npm run test:live   # opt-in: real CPSC API, deployed MCP server, Bedrock

## License
MIT
