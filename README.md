![JobDeputy](apps/web/public/jobdeputy-animated.svg)

# JobDeputy

JobDeputy helps job seekers find relevant roles from any job site and prepare tailored application materials, using their own AI and service credentials (Bring Your Own Token).

> Status: early development. The first slice being built: create a profile, submit a job-listing URL, and let an asynchronous crawler find and store the relevant jobs.

## Documentation

- [Problem statement](docs/problem-statement.md)
- [Current slice scope](docs/scope-current-slice.md)
- Tasks: [GitHub issues](https://github.com/jobdeputy/jobdeputy/issues)
- [Decision records](docs/decisions/README.md)
- Earlier history (the T01–T14 task write-ups, design rounds 1–7, and the HTML prototypes): the read-only [archive repository](https://github.com/jobdeputy/jobdeputy-archive)

## Quick start

```sh
npm install -g corepack@latest && corepack enable pnpm
pnpm install
pnpm verify   # lint, typecheck, tests
pnpm synth    # build the web app and the AWS CloudFormation for every stack
pnpm --filter @jobdeputy/web dev   # run the web app locally
```

Architecture: fully serverless on AWS, with one self-contained cell per Region (US, India, UK). See the [decision records](docs/decisions/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

JobDeputy is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must make your source code available to its users.

This repository is set up for AI-assisted development. Agents start from [CLAUDE.md](CLAUDE.md).
