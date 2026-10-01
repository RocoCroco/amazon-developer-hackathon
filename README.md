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

## License
MIT
