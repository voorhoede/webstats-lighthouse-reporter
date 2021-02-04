const {info, setFailed} = require('@actions/core')
const {getOctokit, context} = require('@actions/github');
const fetch = require('node-fetch')
const {groupBy} = require('@lhci/utils/src/lodash.js')
const {computeRepresentativeRuns} = require('@lhci/utils/src/representative-runs.js')
const {loadSavedLHRs} = require('@lhci/utils/src/saved-reports.js')

async function main() {
  // post tot web stats
  const lighthouseReport = getRepresentativeBuild();

  info('Posting to webstats....');
  const projectId = await fetch('https://webstats.vercel.app/api/graphql', {
    method: 'post',
    headers: {
      'x-api-key': process.env.WEBSTATS_API_KEY
    },
    body: JSON.stringify({
      query: `
      mutation($lighthouseReport: JSONObject!) {
        createLighthouseStatistic (
          projectId: "${process.env.WEBSTATS_PROJECT_ID}",
          gitCommitSha: "${process.env.GITHUB_SHA}",
          data: $lighthouseReport
        ) {
          id
        }
      }
    `,
      variables: {
        lighthouseReport
      }
    })
  })
    .then(res => res.json())
    .then(({data}) => {
      if (data.createLighthouseStatistic) {
        data.createLighthouseStatistic.id
      } else {
        setFailed('Could not read the ID of your posted report. The mutation has probably failed')
      }
    });
  info(`Posted lighthouse report to webstats. Statistic ID: ${projectId}`);

  // if not pr stop here
  if (context.eventName === 'push') {
    return
  }

  const octokit = getOctokit(process.env.GITHUB_TOKEN);

  const {data: {default_branch}} = await octokit.repos.get({
    owner: context.repo.owner,
    repo: context.repo.repo
  });


  info(`Default branch: ${default_branch}`);

  const {data: {commit: {sha}}} = await octokit.repos.getBranch({
    owner: context.repo.owner,
    repo: context.repo.repo,
    branch: default_branch
  });

  // get latest base lhr
  const baseReport = await getLatestBaseReport(sha);
  const commentIdentifier = '<!---WEBSTATSREPORTERCOMMENT-->'

  // compare to pr report
  const comment = lighthouseReport && baseReport && !baseReport.hasFailed ? `${commentIdentifier}
| Category | Current Build | Base Build | Difference
| --- | --- | --- | --- |
| Performance | ${lighthouseReport.categories.performance.score * 100} | ${baseReport.categories.performance.score * 100} | ${diff(lighthouseReport.categories.performance.score * 100, baseReport.categories.performance.score * 100)}|
| Accessibility | ${lighthouseReport.categories.accessibility.score * 100} | ${baseReport.categories.accessibility.score * 100} | ${diff(lighthouseReport.categories.accessibility.score * 100, baseReport.categories.accessibility.score * 100)}|
| Best Practices | ${lighthouseReport.categories['best-practices'].score * 100} | ${baseReport.categories['best-practices'].score * 100} | ${diff(lighthouseReport.categories['best-practices'].score * 100, baseReport.categories['best-practices'].score * 100)}|
| SEO | ${lighthouseReport.categories.seo.score * 100} | ${baseReport.categories.seo.score * 100} | ${diff(lighthouseReport.categories.seo.score * 100, baseReport.categories.seo.score * 100)}|
| PWA | ${lighthouseReport.categories.pwa.score * 100} | ${baseReport.categories.pwa.score * 100} | ${diff(lighthouseReport.categories.pwa.score * 100, baseReport.categories.pwa.score * 100)}|

` : `Lighthouse comparison | Could not compare ${process.env.GITHUB_SHA} to ${sha}. There is probably no report for ${sha} on the default branch \`${default_branch}\`  `;

  const {data: comments} = await octokit.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: process.env.PR_NUMBER,
  });
  const myComment = comments.find(comment => comment.body.startsWith(commentIdentifier));
  if (myComment) {
    octokit.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: myComment.id,
      body: comment,
    });
  } else {
    octokit.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: process.env.PR_NUMBER,
      body: comment,
    });
  }
}

main().catch(err => setFailed(err.message))

function getRepresentativeBuild() {
  const lhrs = loadSavedLHRs().map(lhr => JSON.parse(lhr))
  const lhrsByUrl = groupBy(lhrs, lhr => lhr.finalUrl).map(lhrs => lhrs.map(lhr => [lhr, lhr]))
  const representativeLhrs = computeRepresentativeRuns(lhrsByUrl)
  return representativeLhrs[0]
}

function getLatestBaseReport(gitCommitSha) {
  return fetch('https://webstats.vercel.app/api/graphql', {
    method: 'post',
    headers: {
      'x-api-key': process.env.WEBSTATS_API_KEY
    },
    body: JSON.stringify({
      query: `
        query Statistic($id: String!, $gitCommitSha: String) {
          project(id: $id) {
            id
            statistics(
              filter: {type: LIGHTHOUSE, gitCommitSha: {equals: $gitCommitSha}}
              first: 1
            ) {
              __typename
              ... on LighthouseStatistic {
                raw
              }
            }
            __typename
          }
        }
      `,
      variables: {
        id: process.env.WEBSTATS_PROJECT_ID,
        gitCommitSha,
      }
    })
  })
    .then(res => res.json())
    .then(body => {
      if (body.data && body.data.project) {
        return body.data.project.statistics[0].raw
      } else {
        return ({hasFailed: true})
      }
    })
}

function diff(a, b) {
  return a > b ? `<span style="color:green;">+${a - b}</span>` : `<span style="color:red;">${a - b}</span>`
}

