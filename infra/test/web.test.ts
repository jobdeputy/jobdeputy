import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { WEB_SITES } from '../config/web.js';
import { buildApp } from '../lib/build-app.js';
import { checkGuards } from '../lib/guards.js';
import { COGNITO_ORIGIN, WEB_CSP } from '../lib/web-stack.js';

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
    expect(WEB_CSP).toContain("default-src 'self'");
    expect(WEB_CSP).toContain("frame-ancestors 'none'");
    expect(WEB_CSP).not.toContain('unsafe-');
    // Sign-in talks to the US cell's Cognito, and nothing else beyond this origin.
    expect(COGNITO_ORIGIN).toBe('https://cognito-idp.us-east-1.amazonaws.com');
    expect(WEB_CSP).toContain(`connect-src 'self' ${COGNITO_ORIGIN};`);
    web.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: { ContentSecurityPolicy: WEB_CSP, Override: true },
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

  it("writes the US cell's sign-in IDs to the site's config.json", () => {
    const dist = mkdtempSync(join(tmpdir(), 'web-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
    const withContent = stack('jobdeputy-dev-web', dist);
    // Two sources: the built app, and the config written from the cell's outputs.
    const [deployment] = Object.values(
      withContent.findResources('Custom::CDKBucketDeployment'),
    ) as { Properties: { SourceObjectKeys: unknown[]; SourceMarkers?: unknown[] } }[];
    expect(deployment?.Properties.SourceObjectKeys).toHaveLength(2);
    // The IDs arrive from the US cell's stack (imported values), not as fixed text.
    expect(JSON.stringify(deployment?.Properties.SourceMarkers)).toMatch(/Fn::ImportValue/);
    expect(JSON.stringify(deployment?.Properties.SourceMarkers)).toMatch(/UserPool/);
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
});
