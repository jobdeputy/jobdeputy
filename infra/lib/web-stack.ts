import {
  Annotations,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Token,
} from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  Distribution,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AaaaRecord, ARecord, type IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, BucketEncryption, type IBucket } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CELLS, type CellId } from '../config/cells.js';
import type { StageName } from '../config/stages.js';
import { webSignInParameter } from './cell-stack.js';

export interface WebStackProps extends StackProps {
  /** The site's address; also the zone's name (the site sits at the zone apex). */
  readonly domain: string;
  readonly zone: IHostedZone;
  /**
   * The built web app to upload. Left out in unit tests, which check the
   * infrastructure only; bin/app.ts always passes it (and fails if it is missing).
   */
  readonly contentDir?: string;
  /**
   * Where people sign in (#14): the shared cell whose sign-in config (an SSM parameter, read at
   * deploy time) becomes the site's `/config.json`, and whose Cognito the CSP lets the app call.
   * It must be in this stack's Region (decision 0004). Left out, the site has no sign-in.
   */
  readonly signIn?: { stage: StageName; cell: CellId };
}

/** Cognito's sign-in endpoint in a Region. */
export function cognitoOrigin(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com`;
}

/**
 * Content-Security-Policy for the static app: everything from this origin only, and sign-in calls
 * to Cognito in the signing-in cell's Region, when there is one (#14). The API origin is added to
 * connect-src by the task that first calls it.
 */
export const webCsp = (signInRegion?: string): string =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    ['connect-src', "'self'", ...(signInRegion ? [cognitoOrigin(signInRegion)] : [])].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

/**
 * Decision 0011: the web app as static files in a private S3 bucket behind CloudFront,
 * at the stage's own domain. CloudFront reads the bucket through Origin Access Control;
 * nothing is public. No idle cost: S3 and CloudFront bill per use (always-free tier:
 * 1 TB and 10 million requests a month), and the certificate is free.
 *
 * Decision 0004: global CloudFront serves static app files only, never user data.
 */
export class WebStack extends Stack {
  readonly bucket: Bucket;
  readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    // The config is read in this stack's Region: a cell elsewhere would mean a hand-off across
    // Regions, which decision 0004 rules out.
    const signInRegion = props.signIn ? CELLS[props.signIn.cell].region : undefined;
    if (signInRegion && !Token.isUnresolved(this.region) && signInRegion !== this.region) {
      throw new Error(
        `The site in ${this.region} cannot sign people in to a cell in ${signInRegion}.`,
      );
    }
    // The zone comes from the DNS stack as a strong reference on purpose: that stack can't
    // drop the zone while this one uses it (the delegation names its name servers).
    Annotations.of(this).acknowledgeWarning(
      '@aws-cdk/core:crossStackReferencesDefaultStrong',
      'The web stack must keep its zone; a strong reference is intended.',
    );

    this.bucket = new Bucket(this, 'Site', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Only built files live here; the next deploy uploads them again.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    // Cast: Bucket's optional getters do not satisfy exactOptionalPropertyTypes.
    const siteBucket = this.bucket as unknown as IBucket;

    // CloudFront certificates must be in us-east-1 (decision 0004).
    const certificate = new Certificate(this, 'Certificate', {
      domainName: props.domain,
      validation: CertificateValidation.fromDns(props.zone),
    });

    const headers = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: webCsp(signInRegion),
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    this.distribution = new Distribution(this, 'Cdn', {
      comment: `JobDeputy web app (${props.domain})`,
      domainNames: [props.domain],
      certificate,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        responseHeadersPolicy: headers,
        compress: true,
      },
      // A single-page app: an unknown path is a client-side route, so serve index.html.
      // The bucket is private, so a missing object answers 403, not 404.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      })),
      // The cheapest edge set (North America and Europe); others are served from there.
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    const target = RecordTarget.fromAlias(new CloudFrontTarget(this.distribution));
    new ARecord(this, 'SiteA', { zone: props.zone, target });
    new AaaaRecord(this, 'SiteAaaa', { zone: props.zone, target });

    if (props.contentDir) {
      new BucketDeployment(this, 'Content', {
        sources: [
          Source.asset(props.contentDir),
          // Fetched with cache: 'no-store' (src/lib/auth/amplify.ts), so browsers never keep it;
          // each deploy clears CloudFront's copy.
          ...(props.signIn
            ? [
                Source.data(
                  'config.json',
                  StringParameter.valueForStringParameter(
                    this,
                    webSignInParameter(props.signIn.stage, props.signIn.cell),
                  ),
                ),
              ]
            : []),
        ],
        destinationBucket: siteBucket,
        // Every deploy replaces the whole site; one '/*' invalidation counts as one path
        // (1,000 free a month).
        distribution: this.distribution,
        distributionPaths: ['/*'],
        prune: true,
        // Decision 0005: the upload function's logs are kept 14 days.
        logGroup: new LogGroup(this, 'ContentLogs', {
          retention: RetentionDays.TWO_WEEKS,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });
    }

    new CfnOutput(this, 'SiteUrl', { value: `https://${props.domain}` });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
  }
}
