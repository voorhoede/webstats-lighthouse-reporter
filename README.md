# Web Stats Lighthouse reporter

This CI step does 2 things.
1. Run a lighthouse report on a push to the default branch.
2. Run a lighthouse report on a pull request, compare the report of that PR to the latest report on the default branch and comment a visual diff of those scores.

## How to install
- Configure a `lighthouserc.js` for your project. I.E.
```js
module.exports = {
    ci: {
        upload: {
            target: 'temporary-public-storage'
        },
        collect: {
            staticDistDir: './build' // or wherever your project builds to
        }
    },
};
```
- Add the secrets `WEBSTATS_PROJECT_ID` and `WEBSTATS_API_KEY` to your repo
- add the following `.yml` file to `.github/workflows/<filename>.yml` (or use our `webstats.example.yml` and rename it)
```yaml
name: Web Stats Reporter
on:
  push:
    branches:
      - main
      - master
  pull_request:
jobs:
  lhci:
    name: Lighthouse Reporter
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Use Node.js 12.x
        uses: actions/setup-node@v2
        with:
          node-version: 12.x
      - name: Cache node modules
        uses: actions/cache@v2
        env:
          cache-name: cache-node-modules
        with:
          # npm cache files are stored in `~/.npm` on Linux/macOS
          path: ~/.npm
          key: ${{ runner.os }}-build-${{ env.cache-name }}-${{ hashFiles('**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-build-${{ env.cache-name }}-
            ${{ runner.os }}-build-
            ${{ runner.os }}-
      - name: Install dependencies
        run: npm ci --ignore-scripts
      - name: Build
        run: npm run build
        env:
          NODE_ENV: ${{ secrets.NODE_ENV }}
      - name: Run Lighthouse CI
        run: |
          npm install -g @lhci/cli@0.6.x
          lhci autorun
      - name: Webstats Lighthouse reporter
        id: webstats-lighthouse-reporter
        uses: voorhoede/webstats-lighthouse-reporter@0.1.4
        env:
          GITHUB_SHA: ${{ github.sha }}
          GITHUB_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          WEBSTATS_PROJECT_ID: ${{ secrets.WEBSTATS_PROJECT_ID }}
          WEBSTATS_API_KEY: ${{ secrets.WEBSTATS_API_KEY }}
```
## TODO
- It now only reports the first item in a report array from the `lhci` package, but it should report all representative builds (Every route has it's opwn report)
- The default branch is now hardcoded as `main` for the `.yml` file, but it should detect the default branch
- Release as an action that can be used in the `.yml` file without having to commit the action folder
- Release on Github Marketplace to streamline the installation process as much as possible
