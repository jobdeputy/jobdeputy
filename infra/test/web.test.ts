import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { WEB_SITES } from '../config/web.js';
import { buildApp } from '../lib/build-app.js';
import { CellStack, webConnectParameter, webSignInParameter } from '../lib/cell-stack.js';
import { checkGuards } from '../lib/guards.js';
import { WebDnsStack } from '../lib/web-dns-stack.js';
import { WebStack, webCsp } from '../lib/web-stack.js';

function stack(name: string, webContentDir?: string): Template {
  const app = buildApp({ stage: 'dev', env: {}, ...(webContentDir ? { webContentDir } : {}) });
  return Template.fromStack(app.node.findChild(name) as never);
}

describe('web app hosting (decision 0011)', () => {
  const web = stack('jobdeputy-dev-web');
  const dns = stack('jobdeputy-dev-web-dns');

  it('serves dev at dev.jobdeputy.com; prod has no site until launch', () => {
    expect(WEB_SITES.dev?.domain).toBe('dev.jobdeputy.com');
    expect(WEB_SITES.prod).toBeUndefined();
    const prod = buildApp({ stage: 'prod', env: {} }).node.children.map((c) => c.node.id);
    expect(prod.filter((id) => id.includes('web'))).toEqual([]);
  });

  it('keeps the delegated zone when its stack is deleted', () => {
    dns.hasResource('AWS::Route53::HostedZone', {
      DeletionPolicy: 'Retain',
      Properties: { Name: 'dev.jobdeputy.com.' },
    });
  });

  it('keeps the site in a private, encrypted, HTTPS-only bucket that only CloudFront reads', () => {
    web.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
    web.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
          Match.objectLike({
            Effect: 'Allow',
            Action: 's3:GetObject',
            Principal: { Service: 'cloudfront.amazonaws.com' },
          }),
        ]),
      },
    });
    web.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('answers only on its domain, over HTTPS (TLS 1.2+), from the cheapest edge set', () => {
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['dev.jobdeputy.com'],
        DefaultRootObject: 'index.html',
        PriceClass: 'PriceClass_100',
        ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021' }),
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: ['GET', 'HEAD'],
        }),
      }),
    });
    web.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'dev.jobdeputy.com',
      ValidationMethod: 'DNS',
    });
  });

  it('routes unknown paths to the app (403 and 404 serve index.html)', () => {
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: [403, 404].map((code) => ({
          ErrorCode: code,
          ResponseCode: 200,
          ResponsePagePath: '/index.html',
          ErrorCachingMinTTL: 0,
        })),
      }),
    });
  });

  it('sends a same-origin CSP, HSTS, and no-framing headers', () => {
    const csp = webCsp('us-east-1');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-');
    // Sign-in talks to the US cell's Cognito, and nothing else beyond this origin; a site
    // without sign-in talks to itself only.
    expect(csp).toContain("connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com;");
    expect(webCsp()).toContain("connect-src 'self';");
    // The cell's own origins (its API and documents bucket) follow Cognito.
    expect(webCsp('us-east-1', 'https://a.example https://b.example')).toContain(
      "connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com https://a.example https://b.example;",
    );
    web.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          // Joined at deploy time with the cell's origins, read from its SSM parameter.
          ContentSecurityPolicy: {
            ContentSecurityPolicy: {
              'Fn::Join': [
                '',
                [
                  Match.stringLikeRegexp(
                    "connect-src 'self' https://cognito-idp\\.us-east-1\\.amazonaws\\.com $",
                  ),
                  { Ref: Match.stringLikeRegexp('webconnectsrc') },
                  Match.stringLikeRegexp("^; object-src 'none'"),
                ],
              ],
            },
            Override: true,
          },
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000 }),
          FrameOptions: { FrameOption: 'DENY', Override: true },
        }),
      }),
    });
  });

  it('points the domain at CloudFront over IPv4 and IPv6', () => {
    for (const Type of ['A', 'AAAA']) {
      web.hasResourceProperties('AWS::Route53::RecordSet', {
        Name: 'dev.jobdeputy.com.',
        Type,
        AliasTarget: Match.objectLike({ HostedZoneId: Match.anyValue() }),
      });
    }
  });

  it('uploads the built app and refreshes CloudFront only when given the build', () => {
    web.resourceCountIs('Custom::CDKBucketDeployment', 0);
    const dist = mkdtempSync(join(tmpdir(), 'web-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
    const withContent = stack('jobdeputy-dev-web', dist);
    withContent.hasResourceProperties('Custom::CDKBucketDeployment', {
      DistributionPaths: ['/*'],
      Prune: true,
    });
    withContent.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
  });

  it("writes the US cell's sign-in config to the site's config.json, through SSM", () => {
    const app = buildApp({ stage: 'dev', env: {}, webContentDir: builtApp() });
    const parameter = webSignInParameter('dev', 'iad');
    // The cell writes it: JSON naming its pool and web client (joined in at deploy time).
    const cell = Template.fromStack(app.node.findChild('jobdeputy-dev-iad') as never);
    const written = Object.values(cell.findResources('AWS::SSM::Parameter')).find(
      (r) => r.Properties.Name === parameter,
    );
    const value = JSON.stringify(written?.Properties.Value);
    expect(value).toMatch(/userPoolId.*Ref.*AuthUserPool/);
    expect(value).toMatch(/userPoolClientId.*Ref.*AuthUserPoolWebClient/);
    expect(value).toMatch(/apiUrl.*HttpApi.*ApiEndpoint/);
    // #111: managed login on the site's own sign-in domain.
    expect(value).toMatch(/authDomain.*https:\/\/.*Ref.*AuthUserPoolSignInDomain/);
    // And the origins the site may call there: exactly its API, its documents bucket, and
    // managed login (Amplify calls its token and revoke endpoints, #111).
    const origins = JSON.stringify(
      Object.values(cell.findResources('AWS::SSM::Parameter')).find(
        (r) => r.Properties.Name === webConnectParameter('dev', 'iad'),
      )?.Properties.Value,
    );
    expect(origins).toMatch(
      /HttpApi.*ApiEndpoint.*https:\/\/.*DocumentsBucket.*RegionalDomainName.*https:\/\/.*AuthUserPoolSignInDomain/,
    );
    // …and the site reads it at deploy time, after the cell: no stack export, so the pool and
    // client can still be replaced.
    const webStack = app.node.findChild('jobdeputy-dev-web') as never;
    const web = Template.fromStack(webStack);
    expect(JSON.stringify(web.toJSON())).not.toContain('"Fn::ImportValue":"jobdeputy-dev-iad:');
    expect(Object.values(web.findParameters('*')).map((p) => p.Default)).toContain(parameter);
    const [deployment] = Object.values(web.findResources('Custom::CDKBucketDeployment')) as {
      Properties: { SourceObjectKeys: unknown[] };
    }[];
    expect(deployment?.Properties.SourceObjectKeys).toHaveLength(2);
    expect(
      (webStack as { dependencies: { stackName: string }[] }).dependencies.map((d) => d.stackName),
    ).toContain('jobdeputy-dev-iad');
  });

  it('will not sign people in to a cell in another Region or account, or an unknown one (0004)', () => {
    const app = new App();
    const india = new CellStack(app, 'jobdeputy-dev-bom', {
      stage: 'dev',
      cell: 'bom',
      env: { region: 'ap-south-1' },
    });
    const personal = new CellStack(app, 'jobdeputy-dev-alice-iad', {
      stage: 'dev',
      cell: 'iad',
      owner: 'alice',
      env: { region: 'us-east-1' },
    });
    const zone = new WebDnsStack(app, 'dns', { domain: 'x.example', env: { region: 'us-east-1' } });
    const site = (id: string, signIn: CellStack, region?: string) =>
      new WebStack(app, id, {
        domain: 'x.example',
        zone: zone.zone,
        ...(region ? { env: { region } } : {}),
        signIn,
      });
    expect(() => site('a', india, 'us-east-1')).toThrow(
      'cannot sign people in to a cell in ap-south-1',
    );
    expect(() => site('b', india)).toThrow('need a known Region');
    expect(() => site('c', personal, 'us-east-1')).toThrow('writes no web config');
    // Same Region, another account: the parameter could not be read there.
    const elsewhere = new CellStack(app, 'jobdeputy-dev-iad', {
      stage: 'dev',
      cell: 'iad',
      env: { region: 'us-east-1', account: '111111111111' },
    });
    expect(
      () =>
        new WebStack(app, 'd', {
          domain: 'x.example',
          zone: zone.zone,
          env: { region: 'us-east-1', account: '222222222222' },
          signIn: elsewhere,
        }),
    ).toThrow('must be in the same account');
  });

  it('writes no sign-in parameter from personal or PR stacks (they have no site)', () => {
    const personal = buildApp({ stage: 'dev', env: {}, owner: 'alice' });
    const cell = personal.node.children.find((c) => c.node.id.endsWith('-iad'));
    const parameters = Template.fromStack(cell as never).findResources('AWS::SSM::Parameter');
    expect(JSON.stringify(parameters)).not.toContain('web-sign-in');
  });

  it('refuses to build when the web app has not been built', () => {
    expect(() =>
      buildApp({ stage: 'dev', env: {}, webContentDir: join(tmpdir(), 'no-such-web-dist') }),
    ).toThrow(/web app is not built/);
  });

  it('gives personal and PR stacks no web app', () => {
    const ids = buildApp({ stage: 'dev', owner: 'pr42', env: {} }).node.children.map(
      (c) => c.node.id,
    );
    expect(ids).toEqual(['jobdeputy-dev-pr42-iad']);
  });

  it('passes every guard with the upload included', () => {
    const dist = mkdtempSync(join(tmpdir(), 'web-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
    expect(checkGuards(buildApp({ stage: 'dev', env: {}, webContentDir: dist }))).toEqual([]);
  });
  it("lets only the site's origin call the site cell's API and post its uploads (#33)", () => {
    const app = buildApp({ stage: 'dev', env: {} });
    const cell = Template.fromStack(app.node.findChild('jobdeputy-dev-iad') as never);
    cell.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Name: 'jobdeputy-dev-iad',
      CorsConfiguration: {
        AllowOrigins: ['https://dev.jobdeputy.com'],
        AllowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
        AllowHeaders: ['authorization', 'content-type'],
        ExposeHeaders: ['retry-after'],
        MaxAge: 3600,
      },
    });
    cell.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [
          {
            AllowedOrigins: ['https://dev.jobdeputy.com'],
            AllowedMethods: ['POST'],
            MaxAge: 3600,
          },
        ],
      },
    });
    // Personal and PR stacks: no browser may call them.
    const personal = buildApp({ stage: 'dev', env: {}, owner: 'alice' });
    const own = Template.fromStack(
      personal.node.children.find((c) => c.node.id.endsWith('-iad')) as never,
    );
    expect(JSON.stringify(own.findResources('AWS::ApiGatewayV2::Api'))).not.toContain('Cors');
    expect(JSON.stringify(own.findResources('AWS::S3::Bucket'))).not.toContain('CorsConfiguration');
  });
});

function builtApp(): string {
  const dist = mkdtempSync(join(tmpdir(), 'web-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
  return dist;
}
