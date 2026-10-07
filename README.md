# lab-e2e

This repository holds the end-to-end (E2E) test suite of the pipeline lab.
It uses Playwright Test in TypeScript, with Chromium only.

A release runs the suite against the Test environment after it deploys there.
If the suite fails, the release stops and does not go to Staging.
The release workflow is in [lab-workflows](https://github.com/jross24/lab-workflows).

## What the suite tests

The system under test has four applications.

```
browser -> web ----> catalogue API ----> core API (private)
                \--> account API   ----/
```

Web, the catalogue API and the account API are public. The core API is private.

The suite has four tests in three files.

| File | What it checks |
| --- | --- |
| `tests/page.spec.ts` | The page `GET /` of web loads. It shows no error block. The four versions look like versions. It shows at least one product and a profile name. |
| `tests/api.spec.ts` | `GET /products` of catalogue and `GET /profile` of account return HTTP 200 with the documented shape. In both, `core.itemCount` is above 0. |
| `tests/consistency.spec.ts` | The versions on the page equal the versions that web, catalogue and account report. Both APIs report the same version of core, and it equals the one on the page. |

The consistency test is the check that spans all applications and services.
It reads one version from each application, in two ways, and the two ways must agree.
A mix of versions shows that one part of the chain is not at the release that you think.

## How the suite reaches core

The core API is private. Its API Gateway uses IAM authorisation.
A GitHub runner has no permission to call it, so the suite never calls core.

Catalogue and account call core for each request. Both put the version of core and the number of items in their answer.
Web shows the version of core on its page.
So the suite reads the version of core from these answers.
This also proves that the private call works, because an answer has the `core` block only if the call to core worked.

## Why the suite is small

The suite is small on purpose. An E2E test costs more than other tests:

- **It is slow.** A test needs a deployed system, a browser and the network. A unit test needs milliseconds.
- **The environment is shared.** Test serves all four service repositories. A test cannot assume that nobody else changes it.
- **A flaky test blocks every team.** One bad test stops the release of every service. People then learn to ignore red runs, or to press "run again".
- **A failure is hard to explain.** The cause can be in any of four services, in the network or in the cold start of a Lambda function.

So the suite checks only what no other test can check: that the parts connect and that the versions agree.
Other tests belong in other places.

| What to test | Where | Why there |
| --- | --- | --- |
| Logic: prices, the choice of a version, a bad input | Unit tests in the service repository | They are fast and exact, and they run in the pull request. |
| The shape of an API answer, in all its detail | Contract tests in the service repository | A change that breaks the shape fails in the pull request of the owner, not in the shared Test environment. |
| One service with its own database or queue | Integration tests in the service repository | The service owner controls that environment. |

The suite does check the shape of each answer, but only the fields that the page needs.
It is a smoke check of the connections. It is not the contract test.

## The cold start and the warm-up

After a deployment, the first request can take 4 or 5 seconds. Four Lambda functions start cold in a chain.
Web waits only 5 seconds for each API. So the first page can show an error block.
This is a known behaviour (see [lab-platform#17](https://github.com/jross24/lab-platform/issues/17)).

The suite does not hide this with blanket retries. It uses a global setup that warms the chain (`lib/warmup.ts`):

1. It polls `GET /health` of web until it answers. This request calls no other service.
2. It loads `GET /` of web until the page has no error block. This request wakes the whole chain.

The warm-up has a time limit. The default is 90 seconds. Set `WARMUP_TIMEOUT_SECONDS` to change it.
If the limit passes, the warm-up stops the run with the last reason, for example `the page shows catalogue-error`.
So a real failure still fails the run.
The summary shows how many tries the warm-up needed.

## Retries

Locally, a test has no retry. In GitHub Actions (`CI=true`), a test has one retry at most.
The retry is for a rare network error. It is not a way to hide a flaky test.

A retry never passes in silence. The job summary names each test that used a retry.
The log has a warning annotation for it. The summary says `passed with 1 retry`, not `passed`.
Treat a retry as a bug in the test. Fix the test.

## Run the suite

You need Node.js 22.18 or later.

```
npm ci
npx playwright install chromium
npm run lint
npm run typecheck
npm run test:unit
```

`npm run test:unit` tests the helper code: the URL check, the warm-up and the summary. It uses the test runner of Node.js. It needs no network.

To run the E2E suite, give it the URL of each application:

| Variable | Meaning |
| --- | --- |
| `WEB_URL` | The base URL of web. |
| `CATALOGUE_URL` | The base URL of the catalogue API. |
| `ACCOUNT_URL` | The base URL of the account API. |
| `WARMUP_TIMEOUT_SECONDS` | Optional. The time limit of the warm-up. The default is 90. |
| `E2E_ENVIRONMENT`, `E2E_COMMIT` | Optional. Only the summary uses them. |

Each stack publishes its URL as an SSM parameter in its account: `/lab/web/url`, `/lab/catalogue/url` and `/lab/account/url`.
With a read-only AWS profile, you can read them and run the suite:

```
profile=lab-test
export WEB_URL="$(aws ssm get-parameter --name /lab/web/url --profile $profile --query Parameter.Value --output text)"
export CATALOGUE_URL="$(aws ssm get-parameter --name /lab/catalogue/url --profile $profile --query Parameter.Value --output text)"
export ACCOUNT_URL="$(aws ssm get-parameter --name /lab/account/url --profile $profile --query Parameter.Value --output text)"
npm test
```

The suite itself calls no AWS API. Only these three commands do.
`npx playwright test --list` needs no URL.

## The summary of a run

The reporter `reporter/summary-reporter.ts` writes a summary to the log and to the job summary of GitHub (`$GITHUB_STEP_SUMMARY`).
It shows:

- the exact version of web, catalogue, account and core that the run tested,
- the commit of lab-e2e,
- the number of tests that passed, failed, were flaky and were skipped,
- the warm-up tries and the tests that used a retry.

The versions come from the consistency test. It attaches them to its result before it compares them, so a failed run has them too.

If the run fails, the workflow uploads the Playwright HTML report and the traces as the artefact `playwright-report`. It keeps them for 7 days.
This repository is public, so everyone can download the artefact. The report holds only URLs and mock data.

## The workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/run.yml` | `workflow_call`, `workflow_dispatch`, and a schedule at 03:17 UTC each night | Runs the suite against one environment. |
| `.github/workflows/ci.yml` | A pull request, and a push to `main` | Checks the code. After a push to `main`, it also calls `run.yml` for Test. |

A pull request gets lint, typecheck, the unit tests and `npx playwright test --list`.
It gets no AWS access, because the environments allow only `main`.
After a merge, the suite runs against Test. So a change to the tests is itself tested against Test.

`run.yml` has the input `environment`. It is `test`, `staging` or `production`, and the default is `test`.
A first job checks the name, because a job that names an unknown environment creates it.
Then the job `suite` does these steps:

1. It checks out lab-e2e.
2. It installs the packages and logs in to AWS with OIDC. The role is `github-deploy` of the environment.
3. It reads the three URLs from SSM with `aws ssm get-parameter`.
4. It installs Chromium and runs the suite.
5. It sets the outputs `web-version`, `catalogue-version`, `account-version`, `core-version` and `commit`.

The role `github-deploy` needs `ssm:GetParameter` on `/lab/*`. The stack in [lab-platform](https://github.com/jross24/lab-platform) gives it.
Without that permission, step 3 fails with an access error.

GitHub disables a scheduled workflow in a public repository after 60 days with no repository activity.
Make a commit, or run the workflow by hand, to start the schedule again.

## Use the suite from a release in another repository

The release workflow of lab-workflows calls `run.yml`. A service repository calls the release workflow.
So `run.yml` runs as a nested reusable workflow:

```
lab-web: release.yml  ->  lab-workflows: release.yml  ->  lab-e2e: run.yml
```

These rules decide which environment, which secrets and which OIDC identity the job has.

- **The environment.** The job `suite` in `run.yml` sets `environment:`. A caller job with `uses:` cannot set it. The environment is the `test` environment of the repository that started the run, for example lab-web. It is not the environment of lab-e2e.
- **The secret.** `secrets.AWS_ACCOUNT_ID` is the secret of that `test` environment in the repository that started the run. `vars.AWS_REGION` is the variable of that repository.
- **The pass-through.** GitHub passes secrets only to the workflow that a job calls directly. So each level must pass them on. Each caller must use `secrets: inherit`. If one level does not, the secret is an empty string, and the login fails.
- **The OIDC identity.** The `sub` claim of the token names the repository that started the run and the environment, for example `repo:jross24@<owner id>/lab-web@<repository id>:environment:test`. It does not name lab-e2e. The token also has the claim `job_workflow_ref` for `run.yml`, but the trust policy of `github-deploy` does not check it. So the role needs no change.
- **The permissions.** The caller job must give `id-token: write` and `contents: read`. A called workflow can lower the permissions of its caller and cannot raise them.
- **The checkout.** In a called workflow, `actions/checkout` checks out the caller repository by default. So `run.yml` names `jross24/lab-e2e`. A run that lab-e2e starts tests its own commit. A call from another repository tests `main`.

The summary shows the commit that the run used. The workflow `@main` and the checkout of `main` can differ if someone merges between the two reads.

The GitHub documentation describes these rules. See [Reusing workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) and [OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc).
The call from a service repository has not run in the lab yet. These rules come from the documentation.
The call from `ci.yml` of this repository to `run.yml` is the same mechanism with one level less. It runs after each merge to `main`.

## What the suite does not do yet

- A run that lab-e2e starts itself (a push, a schedule or a manual run) does not take the Test lock of lab-workflows. A release that deploys to Test at the same time can break that run. See the issue about this in lab-platform.
- Staging and Production have no smoke check yet. The permission and the workflow input are ready for it.
- The suite does not check the data of a service. It checks that the services connect.

## Layout

| Path | Content |
| --- | --- |
| `tests/` | The three test files. |
| `lib/config.ts` | Reads and checks the three base URLs. |
| `lib/api.ts` | Calls `/health`, `/products` and `/profile`, and checks the shape of the answers. |
| `lib/page.ts` | Reads the four versions from the page. |
| `lib/warmup.ts` | The warm-up with a time limit. |
| `lib/summary.ts` | Makes the markdown of the summary. |
| `global-setup.ts` | Runs the warm-up before the first test. |
| `reporter/summary-reporter.ts` | Collects the results, writes the summary and the version file. |
| `unit/` | Unit tests of the helper code. |
| `.github/workflows/` | `run.yml` and `ci.yml`. |

The only dependencies are `@playwright/test`, `typescript`, `eslint`, `typescript-eslint` and `@types/node`.
