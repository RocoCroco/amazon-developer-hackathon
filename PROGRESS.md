# PROGRESS

_Last updated: 2026-10-01_

## Current task
T1.6 - CDK stack in us-east-1 (Lambda + public HTTPS Function URL + DynamoDB on-demand), tagged Project=recall-guardian, demo key required, reserved concurrency/throttling. Deploy and verify with the scripted client against the public URL.

## Done
- Phase 0; T1.1-T1.5. DynamoItemStore (src/dynamo-store.ts: single table PK/SK, TTL attr `expiresAt`, createDocClient, newHouseholdId) with mocked-client tests. 41 tests green.

## Left
- Check AWS CLI profile works (`aws sts get-caller-identity`) and whether CDK is bootstrapped in us-east-1.
- infra/: aws-cdk-lib + constructs + aws-cdk CLI; stack with NodejsFunction (esbuild bundling) for src/lambda.ts; Function URL (auth NONE + demo key check in code); DynamoDB table (PAY_PER_REQUEST, TTL expiresAt); tags; reserved concurrency; demo key from SSM/env at deploy (never committed).
- src/lambda.ts: Function URL event -> Request -> createMcpHandler -> response.

## Next step
Run `aws sts get-caller-identity` and `aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-1` to see the account state.
