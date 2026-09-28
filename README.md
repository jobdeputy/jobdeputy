# JobDeputy

JobDeputy helps job seekers find relevant roles from any job site and prepare tailored application materials, using their own AI and service credentials (Bring Your Own Token).

> Status: early development. The first slice being built: create a profile, submit a job-listing URL, and let an asynchronous crawler find and store the relevant jobs.

## Documentation

- [Problem statement](docs/problem-statement.md)
- [Current slice scope](docs/scope-current-slice.md)
- [Task board](docs/tasks/README.md)
- [Decision records](docs/decisions/README.md)

## Quick start

```sh
npm install -g corepack@latest && corepack enable pnpm
pnpm install
pnpm verify   # lint, typecheck, tests
pnpm synth    # build the AWS CloudFormation for every Region cell
```

Architecture: fully serverless on AWS, with one self-contained cell per Region (US, India, UK). See the [decision records](docs/decisions/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

JobDeputy is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must make your source code available to its users.

This repository is set up for AI-assisted development. Agents start from [CLAUDE.md](CLAUDE.md).
