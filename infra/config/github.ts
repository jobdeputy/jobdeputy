/**
 * GitHub identity allowed to deploy into JobDeputy AWS accounts (via OIDC).
 *
 * This repository issues OIDC tokens in GitHub's immutable subject format:
 *   repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:<environment>
 *
 * The numeric IDs are assigned once by GitHub and never change on rename.
 * A deleted and re-created org or repo with the same name gets new IDs and
 * therefore cannot deploy. The IDs are public metadata, not secrets.
 *
 * Re-read the prefix after a repo transfer or a change to the org's OIDC
 * settings:
 *   gh api repos/jobdeputy/jobdeputy/actions/oidc/customization/sub
 */
export const GITHUB_OIDC_SUBJECT_PREFIX = 'repo:jobdeputy@334723288/jobdeputy@1391498158';
