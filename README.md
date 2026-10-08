# lab-e2e

This repository holds the end-to-end (E2E) test suite of the pipeline lab.
It uses Playwright Test in TypeScript, with Chromium only.

A release runs the suite against the Test environment after it deploys there.
If the suite fails, the release stops and does not go to Staging.
The release workflow is in [lab-workflows](https://github.com/jross24/lab-workflows).

The suite has a small read-only subset, the smoke subset. A deploy job can run it after a deployment to Staging or Production.
The repository has a composite action for this: `actions/suite`.

## What the suite tests

The system under test has four applications.

```
browser -> web ----> catalogue API ----> core API (private)
                \--> account API   ----/
```

Web, the catalogue API and the account API are public. The core API is private.

The suite has seven tests in five files. Five of them are in the smoke subset.

| File | What it checks | Smoke |
| --- | --- | --- |
| `tests/page.spec.ts` | The page `GET /` of web loads. It shows no error block. The four versions look like versions. It shows at least one product and a profile name. | yes |
| `tests/api.spec.ts` | Three tests. The first calls `GET /health` of web, `GET /products` of catalogue and `GET /profile` of account. It checks the shape of each answer and nothing else. The two others check data: `core.itemCount` is above 0 in both APIs, and the catalogue has a product. | the first test only |
| `tests/consistency.spec.ts` | The versions on the page equal the versions that web, catalogue and account report. Both APIs report the same version of core, and it equals the one on the page. | yes |
| `tests/release.spec.ts` | The released service reports the version of the release. See "The release test". | yes |
| `tests/drill.spec.ts` | The fault drill is off. See "The fault drill". | yes |

The consistency test is the check that spans all applications and services.
It reads one version from each application, in two ways, and the two ways must agree.
A mix of versions shows that one part of the chain is not at the release that you think.

## The smoke subset

The smoke subset is the set of tests with the tag `@smoke`. Run it with `npm run smoke`. This is `npx playwright test --grep @smoke`.
The tests use the Playwright option `tag`, for example `test('title', { tag: '@smoke' }, ...)`.

It has five tests:

- `the page shows data from every service`
- `each public API answers with the documented shape`
- `the versions on the page equal the versions that the services report`
- `the released service reports the version of the release`
- `the fault drill is off`

The subset is small and read-only on purpose. It sends GET requests and loads the page. It writes no data and changes no state.
So it is safe to run after a deployment to any environment, also Production.
The two data tests of `tests/api.spec.ts` stay out of it. They check the data of the services, not the connections.
Only the full suite runs them.

The full suite also runs the five smoke tests, because it runs every test.

## The release test

A pipeline that releases one service sets two variables:

| Variable | Meaning |
| --- | --- |
| `E2E_EXPECT_SERVICE` | The released service. One of `web`, `catalogue`, `account`, `core`. |
| `E2E_EXPECT_VERSION` | The version of the release, in the form `1.2.3`. |

The test `the released service reports the version of the release` reads the public answers and compares the version.
It fails with a message that names the service, the expected version and the reported version.

| Service | Where the test reads the version |
| --- | --- |
| `web` | `version` in `GET /health` of web. |
| `catalogue` | `version` in `GET /products` of the catalogue API. |
| `account` | `version` in `GET /profile` of the account API. |
| `core` | `core.version` in `GET /products` and in `GET /profile`. Both must equal the expected version. |

Core is private, so the test cannot ask core. The two public APIs report the version of core that they called.

The test has three cases:

- Both variables are not set. The test is skipped, with a message. A nightly run and a manual run have no release to check. A skipped test does not make a run fail. The rule stays that a run with no passed test is a failed run.
- Only one variable is set, or a value is bad. The test fails with a message that names the variable. A pipeline that passes half of a release must not pass in silence.
- Both variables are good. The test compares the versions.

The logic is in `lib/release.ts`. The unit tests are in `unit/release.test.ts`.
The pipeline passes the two values as the inputs `service` and `version` of `actions/suite` or of `run.yml`. The smoke suite needs both inputs when a release runs it.

## The fault drill

The fault drill proves that a failing suite stops a release. It is a deliberate device, like `injectFault` in the service stacks.
The test `the fault drill is off` is in the smoke subset, so it runs in both suites. It calls no application.

The repository variable `E2E_FAULT_DRILL` holds one token or nothing. A token has the form `<suite>-<environment>`.
These tokens are allowed:

| Token | The run that fails |
| --- | --- |
| `full-test` | The full suite against Test. |
| `full-staging` | The full suite against Staging. |
| `full-production` | The full suite against Production. |
| `smoke-test` | The smoke suite against Test. |
| `smoke-staging` | The smoke suite against Staging. |
| `smoke-production` | The smoke suite against Production. |

The suite sets `E2E_SUITE` and `E2E_ENVIRONMENT` for each run. The test fails on purpose when `E2E_FAULT_DRILL` equals `<E2E_SUITE>-<E2E_ENVIRONMENT>`.
The message starts with `fault drill: this failure is on purpose` and names the variable.
In every other run the test passes. A token that is not in the table fails the test in every run, so a typo cannot pass in silence.

To run a drill:

1. In the service repository, open Settings, Secrets and variables, Actions, Variables.
2. Add the repository variable `E2E_FAULT_DRILL` with one token, for example `smoke-staging`.
3. Start a release. The run that the token names fails on purpose, and the release stops there.
4. Check that the release did not go on to the next environment.
5. **Delete the variable.** While it exists, every run of that kind fails.

Only the owner of the repository can set a repository variable.
A pipeline gives the variable to the action as the input `fault-drill`. The workflow `run.yml` does this with `vars.E2E_FAULT_DRILL` of the repository that started the run.
So the variable of a service repository affects the releases of that service. The variable of lab-e2e affects the runs that lab-e2e starts.
The logic is in `lib/drill.ts`. The unit tests are in `unit/drill.test.ts`.

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

`npm run test:unit` tests the helper code: the URL check, the warm-up, the summary, the release check and the fault drill. It uses the test runner of Node.js. It needs no network.

To run the E2E suite, give it the URL of each application:

| Variable | Meaning |
| --- | --- |
| `WEB_URL` | The base URL of web. |
| `CATALOGUE_URL` | The base URL of the catalogue API. |
| `ACCOUNT_URL` | The base URL of the account API. |
| `WARMUP_TIMEOUT_SECONDS` | Optional. The time limit of the warm-up. The default is 90. |
| `E2E_ENVIRONMENT`, `E2E_COMMIT` | Optional. The summary uses them. The fault drill uses `E2E_ENVIRONMENT` too. |
| `E2E_SUITE` | Optional. `full` or `smoke`. The summary and the fault drill use it. The default of the summary is `full`. `npm run smoke` does not set it. |
| `E2E_EXPECT_SERVICE`, `E2E_EXPECT_VERSION` | Optional. The release test uses them. Set both or none. |
| `E2E_FAULT_DRILL` | Optional. The token of the fault drill. Leave it empty for a normal run. |

Each stack publishes its URL as an SSM parameter in its account: `/lab/web/url`, `/lab/catalogue/url` and `/lab/account/url`.
With a read-only AWS profile, you can read them and run the suite:

```
profile=lab-test
export WEB_URL="$(aws ssm get-parameter --name /lab/web/url --profile $profile --query Parameter.Value --output text)"
export CATALOGUE_URL="$(aws ssm get-parameter --name /lab/catalogue/url --profile $profile --query Parameter.Value --output text)"
export ACCOUNT_URL="$(aws ssm get-parameter --name /lab/account/url --profile $profile --query Parameter.Value --output text)"
npm test
```

`npm run smoke` runs the smoke subset instead of the full suite.

The suite itself calls no AWS API. Only these three commands do.
`npx playwright test --list` needs no URL.

## The summary of a run

The reporter `reporter/summary-reporter.ts` writes a summary to the log and to the job summary of GitHub (`$GITHUB_STEP_SUMMARY`).
It shows:

- the exact version of web, catalogue, account and core that the run tested,
- the commit of lab-e2e,
- the suite, in the title of a smoke run, for example `E2E against staging (smoke): passed`,
- the number of tests that passed, failed, were flaky and were skipped,
- the warm-up tries and the tests that used a retry.

The versions come from the consistency test. It attaches them to its result before it compares them, so a run with a failed comparison has them too. This was checked on a laptop with a changed expectation.
The lab has not checked whether a failed run gives its outputs (`web-version` and the others) to the calling workflow. The GitHub documentation does not say. The release workflow writes "not recorded" for an empty output.

If the run fails, the action uploads the Playwright HTML report and the traces as an artefact. It keeps them for 7 days.
The name is `playwright-report-<suite>-<environment>-attempt<N>`, for example `playwright-report-smoke-staging-attempt1`. An artefact name must be unique in a run, so a re-run gets a new name.
This repository is public, so everyone can download the artefact. The report holds only URLs and mock data.

## The workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/run.yml` | `workflow_call`, `workflow_dispatch`, and a schedule at 03:17 UTC each night | Runs the suite against one environment. For Test, a run that lab-e2e starts takes the Test lock first. |
| `.github/workflows/ci.yml` | A pull request, and a push to `main` | Checks the code. After a push to `main`, it also calls `run.yml` for Test. |

A pull request gets lint, typecheck, the unit tests and `npx playwright test --list`.
It gets no AWS access, because the environments allow only `main`.
After a merge, the suite runs against Test. So a change to the tests is itself tested against Test.

`run.yml` has these inputs:

| Input | Values | Meaning |
| --- | --- | --- |
| `environment` | `test`, `staging`, `production`. The default is `test`. | The environment to test. |
| `suite` | `full` or `smoke`. The default is `full`. | The suite to run. |
| `service` | `web`, `catalogue`, `account`, `core`, or empty. | The released service. Only a call (`workflow_call`) has it. |
| `version` | `1.2.3`, or empty. | The version of the release. Only a call has it. |

A manual run (`workflow_dispatch`) has the inputs `environment` and `suite`. A call that sets only `environment` runs the full suite, as before.
The outputs are `web-version`, `catalogue-version`, `account-version`, `core-version` and `commit`.

`run.yml` has four jobs:

| Job | What it does |
| --- | --- |
| `check` | Checks the inputs. A job that names an unknown environment creates it, so the check comes first. A call of the smoke suite must set `service` and `version`. A manual run of the smoke suite may leave them empty. The release test is then skipped. |
| `lock` | Takes the Test lock. It runs only when lab-e2e started the run and the environment is Test. See "The Test lock for runs that lab-e2e starts". |
| `suite` | Logs in to AWS with OIDC (the role is `github-deploy` of the environment). For Test, it makes sure that the run holds the lock. Then it runs the action `actions/suite`. |
| `unlock` | Releases the lock that `lock` took. |

The role `github-deploy` needs `ssm:GetParameter` on `/lab/*`. The stack in [lab-platform](https://github.com/jross24/lab-platform) gives it.
Without that permission, the SSM step of the action fails with an access error.

GitHub disables a scheduled workflow in a public repository after 60 days with no repository activity.
Make a commit, or run the workflow by hand, to start the schedule again.

## The Test lock for runs that lab-e2e starts

Test is shared. A release holds the Test lock of lab-workflows from `lock-test` to `unlock-test`. The README of [lab-workflows](https://github.com/jross24/lab-workflows) explains the lock.
Before this change, a run that lab-e2e starts (a push to `main`, the schedule or a manual run) did not take the lock.
A release that deployed to Test at the same time could break such a run.

Now these runs take the lock in the job `lock`:

- The job runs only when `github.repository` is `jross24/lab-e2e` and the environment is `test`. In a call from a release, `github.repository` is the service repository. So the job is skipped there, and the release keeps its own lock steps.
- It waits up to 20 minutes for the lock (`max-wait-minutes: 20`). The job limit is 25 minutes. A manual run can set a shorter wait with the input `lock-wait-minutes` (0 to 20). This lets a person test the skip without a wait of 20 minutes.
- If the lock stays with another run for 20 minutes, the job does not fail. The action uses `on-timeout: skip`. It prints a notice and sets the output `acquired` to `false`.
- The job `suite` then does not run, and the job summary says so. The run ends green, with a skipped suite. The next run tests Test again.
- If the job `lock` took the lock, the job `unlock` releases it after the suite, whatever the result.

Why does the run skip and not fail? A busy Test environment says nothing about the code. A red run is a signal that something is broken.
If a nightly run turns red because a release was slow, people learn to ignore red runs.
The cost is that one night can pass with no result. The job summary shows that.

The job `suite` has a GitHub rule to respect. A job is skipped when a job in `needs` is skipped, unless its `if` uses a status function.
The job `lock` is skipped on purpose in some runs. So the `if` of `suite` starts with `!cancelled()`. Then it checks by hand that `check` passed and that `lock` was skipped or took the lock.

### The step that makes sure the run holds the lock

For Test, the job `suite` has the step `make sure this run holds the lock`. It uses `lock-acquire` with `max-wait-minutes: 0` and `on-timeout: fail`. It does not wait.
The holder text of the lock is `<repository>#<run id>#<attempt>`. The step does not release the lock. The job `unlock` (or `unlock-test` in a release) does.

- **In a release,** the holder text is the one of the caller. `lock-test` took the lock, so the step finds its own lock. It starts the expiry again and changes nothing else.
- **In a run that lab-e2e starts,** the job `lock` holds the lock. The step is a no-op here too.
- **After "Re-run failed jobs",** GitHub runs only the failed jobs again. `lock-test` (or `lock`) did not fail, so it does not run again, and the first attempt has released the lock. The step takes the lock again if Test is free.
- **If another run holds the lock,** the step fails at once. The error tells the person to run all jobs again, so that the lock job queues for the lock.

The lab has not checked whether the job that releases the lock runs again after "Re-run failed jobs".
If it does not, the lock ends by itself after its expiry time. The README of lab-workflows gives the time.

The lock covers Test only. Staging and Production have no lock in this repository.

## The action `actions/suite`

`actions/suite/action.yml` is a composite action. It runs the suite as steps of the job that calls it.

```yaml
- uses: jross24/lab-e2e/actions/suite@main
  with:
    environment: staging
    suite: smoke
    service: web
    version: 0.3.1
```

The calling job must give `id-token: write` and `contents: read`. It must log in to AWS first, with the role `github-deploy` of its environment.
The action does not log in. It reads the three URLs from SSM with that login.

| Input | Meaning |
| --- | --- |
| `environment` | Required. `test`, `staging` or `production`. The summary and `E2E_ENVIRONMENT` use it. |
| `suite` | `full` (the default) or `smoke`. |
| `service`, `version` | The released service and its version. They are optional for `full` and required for `smoke`. The action fails early with a clear message when one is missing or has a bad form. |
| `require-release` | The default is `true`. Set it to `false` to let the smoke suite run with no service and version. Only a manual run of lab-e2e does this. A release keeps the default. |
| `ref` | The ref of lab-e2e to check out. The default is `main`. |
| `fault-drill` | The token of the fault drill. It becomes `E2E_FAULT_DRILL`. The default is empty. |
| `report-name` | The name of the artefact with the failure report. The default is `playwright-report-<suite>-<environment>-attempt<run attempt>`. |

| Output | Meaning |
| --- | --- |
| `web-version`, `catalogue-version`, `account-version`, `core-version` | The versions that the run tested. They have the same meaning as the outputs of `run.yml`. |
| `commit` | The commit of lab-e2e that the run used. |

The steps are:

1. It checks the inputs.
2. It checks out `jross24/lab-e2e` at `ref` into the folder `lab-e2e`. The workspace of the caller holds another repository.
3. It records the commit, sets up Node.js 22 with the npm cache, and runs `npm ci` in that folder.
4. It reads `/lab/web/url`, `/lab/catalogue/url` and `/lab/account/url` from SSM.
5. It installs Chromium and runs `npx playwright test` (full) or `npx playwright test --grep @smoke` (smoke).
6. It reads `.e2e/versions.json` into the outputs, unless the run was cancelled.
7. If a step failed, it uploads `playwright-report/` and `test-results/`.

A composite action cannot set `timeout-minutes` on a step. The calling job sets the time limit.

### Why steps and not a separate job

A deploy job can call the suite as a job of a reusable workflow, or as steps through this action. A deploy job that needs a smoke check uses the steps, for two reasons:

- **The approval.** A second job in the protected `production` environment would need a second approval from a reviewer. Steps in the deploy job need none.
- **The order.** The steps run inside the deploy job. When the deploy job holds the concurrency group of its environment, no other release can deploy between the deployment and the smoke check. A separate job would leave a gap between the two.

### A pull request cannot test the action

A call from another repository names the action with `@main`. Inside this repository, `run.yml` also calls `jross24/lab-e2e/actions/suite@main`.
A local path (`uses: ./`) would point to the workspace of the caller, so it cannot work in a nested call.
So a pull request that changes the action does not run its own change. The change runs for the first time after the merge.
`run.yml` passes the commit of lab-e2e as `ref` for a run that lab-e2e starts, so the tests are those of that commit. The action itself comes from `main`.

## Use the suite from a release in another repository

The release workflow of lab-workflows calls `run.yml`. A service repository calls the release workflow.
So `run.yml` runs as a nested reusable workflow. The job `suite` in it runs the action `actions/suite`:

```
lab-web: release.yml  ->  lab-workflows: release.yml  ->  lab-e2e: run.yml
```

These rules decide which environment, which secrets and which OIDC identity the job has.

- **The environment.** The job `suite` in `run.yml` sets `environment:`. A caller job with `uses:` cannot set it. The environment is the `test` environment of the repository that started the run, for example lab-web. It is not the environment of lab-e2e.
- **The secret.** `secrets.AWS_ACCOUNT_ID` is the secret of that `test` environment in the repository that started the run. `vars.AWS_REGION` is the variable of that repository.
- **The pass-through.** GitHub passes secrets only to the workflow that a job calls directly. So each level must pass them on. Each caller must use `secrets: inherit`. If one level does not, the secret is an empty string, and the login fails.
- **The OIDC identity.** The `sub` claim of the token names the repository that started the run and the environment, for example `repo:jross24@<owner id>/lab-web@<repository id>:environment:test`. It does not name lab-e2e. The token also has the claim `job_workflow_ref` for `run.yml`, but the trust policy of `github-deploy` does not check it. So the role needs no change.
- **The permissions.** The caller job must give `id-token: write` and `contents: read`. A called workflow can lower the permissions of its caller and cannot raise them.
- **The checkout.** In a called workflow, `actions/checkout` checks out the caller repository by default. So the action names `jross24/lab-e2e` and a folder. `run.yml` passes the input `ref`. A run that lab-e2e starts tests its own commit. A call from another repository tests `main`.
- **The lock.** In a call from a release, `github.repository` is the service repository. So the job `lock` of `run.yml` does not run. The release holds the Test lock with `lock-test` and `unlock-test`. The job `suite` only makes sure that the lock is still held.
- **The fault drill.** `vars.E2E_FAULT_DRILL` is the variable of the repository that started the run, for example lab-web.

The summary shows the commit that the run used. The workflow `@main`, the action `@main` and the checkout of `main` can differ if someone merges between the reads.

The GitHub documentation describes these rules. See [Reusing workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) and [OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc).
The call from a service repository has not run in the lab yet. These rules come from the documentation.
The call from `ci.yml` of this repository to `run.yml` is the same mechanism with one level less. It runs after each merge to `main`.
The first run of it showed that the secret of the environment and the OIDC login work in a called workflow. The run then stopped at the SSM step, because the role did not have `ssm:GetParameter` yet ([lab-platform#18](https://github.com/jross24/lab-platform/pull/18)).
The steps that prove the nested call in a real release are in [lab-platform#20](https://github.com/jross24/lab-platform/issues/20).

## What the suite does not do yet

- The versions that pass in Test can differ from the versions in Staging and Production. The release workflow of lab-workflows records the set of versions that the suite tested. See [lab-platform#21](https://github.com/jross24/lab-platform/issues/21).
- A manual run of lab-e2e against Staging or Production takes no lock. The lock covers Test only.
- A pull request cannot test a change to `actions/suite`. The change runs for the first time after the merge.
- The suite does not check the data of a service. It checks that the services connect.

## Layout

| Path | Content |
| --- | --- |
| `tests/` | The five test files. |
| `lib/config.ts` | Reads and checks the three base URLs. |
| `lib/api.ts` | Calls `/health`, `/products` and `/profile`, and checks the shape of the answers. |
| `lib/page.ts` | Reads the four versions from the page. |
| `lib/warmup.ts` | The warm-up with a time limit. |
| `lib/release.ts` | Reads the expected service and version, and finds the versions that do not match. |
| `lib/drill.ts` | Decides if the fault drill fails the run. |
| `lib/summary.ts` | Makes the markdown of the summary. |
| `global-setup.ts` | Runs the warm-up before the first test. |
| `reporter/summary-reporter.ts` | Collects the results, writes the summary and the version file. |
| `unit/` | Unit tests of the helper code. |
| `actions/suite/action.yml` | The composite action that runs the suite as steps of another job. |
| `.github/workflows/` | `run.yml` and `ci.yml`. |

The only dependencies are `@playwright/test`, `typescript`, `eslint`, `typescript-eslint` and `@types/node`.
